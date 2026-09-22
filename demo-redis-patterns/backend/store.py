"""Redis 业务模式封装：排行榜、优先级队列与延迟任务。"""

from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import redis
from redis.exceptions import RedisError


REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6380/0")

LEADERBOARD_KEY = "patterns:leaderboard"
PRIORITY_QUEUE_KEY = "patterns:priority:queue"
PRIORITY_JOBS_KEY = "patterns:priority:jobs"
PRIORITY_SEQUENCE_KEY = "patterns:priority:sequence"
PRIORITY_CONSUMED_KEY = "patterns:priority:consumed"
DELAYED_TASKS_KEY = "patterns:delayed:tasks"
DELAYED_TASKS_HASH_KEY = "patterns:delayed:task-data"

PRIORITY_BASE = 2**32
SEED_PLAYERS = {
    "Alice": 1280,
    "Bob": 980,
    "Carol": 760,
    "David": 520,
}
SEED_JOBS = [
    ("生成日报", 3, 4),
    ("发送欢迎邮件", 7, 3),
    ("审核退款", 9, 2),
    ("同步库存", 5, 1),
]


def now_iso() -> str:
    """返回 UTC ISO 时间，前端负责转换成本地时间。"""

    return datetime.now(timezone.utc).isoformat()


def now_ms() -> int:
    return int(time.time() * 1000)


class RedisPatternStore:
    """用少量 Redis Key 演示三个常见业务模式。"""

    def __init__(self, redis_url: str = REDIS_URL) -> None:
        self.redis = redis.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )

    def ping(self) -> bool:
        return bool(self.redis.ping())

    @staticmethod
    def _json_load(raw: str | None) -> dict[str, Any] | None:
        if raw is None:
            return None
        return json.loads(raw)

    # ------------------------------------------------------------------
    # 排行榜：Sorted Set
    # ------------------------------------------------------------------
    def ensure_demo_data(self) -> None:
        """首次启动时写入少量数据，方便直接观察可视化效果。"""

        if self.redis.zcard(LEADERBOARD_KEY) == 0:
            self.redis.zadd(LEADERBOARD_KEY, SEED_PLAYERS)

        if self.redis.zcard(PRIORITY_QUEUE_KEY) == 0 and not self.redis.exists(
            PRIORITY_SEQUENCE_KEY
        ):
            for name, priority, sequence in SEED_JOBS:
                self._create_priority_job(name, priority, sequence)

    def leaderboard(self, limit: int = 20) -> list[dict[str, Any]]:
        rows = self.redis.zrevrange(
            LEADERBOARD_KEY,
            0,
            max(limit - 1, 0),
            withscores=True,
        )
        return [
            {
                "rank": index + 1,
                "player": player,
                "score": int(score),
            }
            for index, (player, score) in enumerate(rows)
        ]

    def leaderboard_size(self) -> int:
        return int(self.redis.zcard(LEADERBOARD_KEY))

    def add_score(self, player: str, delta: int) -> dict[str, Any]:
        score = int(self.redis.zincrby(LEADERBOARD_KEY, delta, player))
        rank = int(self.redis.zrevrank(LEADERBOARD_KEY, player) or 0) + 1
        return {
            "rank": rank,
            "player": player,
            "score": score,
            "delta": delta,
            "updated_at": now_iso(),
        }

    def reset_leaderboard(self, seed: bool = True) -> None:
        self.redis.delete(LEADERBOARD_KEY)
        if seed:
            self.redis.zadd(LEADERBOARD_KEY, SEED_PLAYERS)

    # ------------------------------------------------------------------
    # 优先级队列：复合分数 Sorted Set + Hash
    # ------------------------------------------------------------------
    @staticmethod
    def priority_score(priority: int, sequence: int) -> float:
        """高分先出，同优先级下 sequence 越小越先出。"""

        tie_breaker = PRIORITY_BASE - 1 - (sequence % PRIORITY_BASE)
        return float(priority * PRIORITY_BASE + tie_breaker)

    def _create_priority_job(
        self,
        name: str,
        priority: int,
        sequence: int | None = None,
    ) -> dict[str, Any]:
        if sequence is None:
            sequence = int(self.redis.incr(PRIORITY_SEQUENCE_KEY))
        else:
            current = int(self.redis.get(PRIORITY_SEQUENCE_KEY) or 0)
            if sequence > current:
                self.redis.set(PRIORITY_SEQUENCE_KEY, sequence)

        job_id = uuid.uuid4().hex[:12]
        job = {
            "id": job_id,
            "name": name,
            "priority": priority,
            "sequence": sequence,
            "created_at": now_iso(),
            "score": self.priority_score(priority, sequence),
        }
        pipe = self.redis.pipeline(transaction=True)
        pipe.hset(PRIORITY_JOBS_KEY, job_id, json.dumps(job, ensure_ascii=False))
        pipe.zadd(PRIORITY_QUEUE_KEY, {job_id: job["score"]})
        pipe.execute()
        return job

    def enqueue_priority_job(self, name: str, priority: int) -> dict[str, Any]:
        return self._create_priority_job(name, priority)

    def priority_queue(self, limit: int = 20) -> dict[str, Any]:
        rows = self.redis.zrevrange(
            PRIORITY_QUEUE_KEY,
            0,
            max(limit - 1, 0),
            withscores=True,
        )
        jobs: list[dict[str, Any]] = []
        if rows:
            pipe = self.redis.pipeline()
            for job_id, _ in rows:
                pipe.hget(PRIORITY_JOBS_KEY, job_id)
            raw_jobs = pipe.execute()
            for (job_id, score), raw in zip(rows, raw_jobs):
                job = self._json_load(raw)
                if job is not None:
                    job["score"] = float(score)
                    jobs.append(job)

        consumed_raw = self.redis.lrange(PRIORITY_CONSUMED_KEY, 0, 9)
        consumed = [
            item
            for item in (self._json_load(raw) for raw in consumed_raw)
            if item is not None
        ]
        return {
            "jobs": jobs,
            "consumed": consumed,
            "total": int(self.redis.zcard(PRIORITY_QUEUE_KEY)),
        }

    def consume_priority_job(self) -> dict[str, Any] | None:
        """Lua 将“读取并删除队首”变成一个原子操作。"""

        script = """
        local job_id = redis.call('ZREVRANGE', KEYS[1], 0, 0)[1]
        if not job_id then
          return nil
        end
        redis.call('ZREM', KEYS[1], job_id)
        return job_id
        """
        job_id = self.redis.eval(script, 1, PRIORITY_QUEUE_KEY)
        if not job_id:
            return None

        raw = self.redis.hget(PRIORITY_JOBS_KEY, job_id)
        job = self._json_load(raw)
        self.redis.hdel(PRIORITY_JOBS_KEY, job_id)
        if job is None:
            return None

        job["consumed_at"] = now_iso()
        self.redis.lpush(
            PRIORITY_CONSUMED_KEY,
            json.dumps(job, ensure_ascii=False),
        )
        self.redis.ltrim(PRIORITY_CONSUMED_KEY, 0, 9)
        return job

    def reset_priority_queue(self, seed: bool = True) -> None:
        self.redis.delete(
            PRIORITY_QUEUE_KEY,
            PRIORITY_JOBS_KEY,
            PRIORITY_SEQUENCE_KEY,
            PRIORITY_CONSUMED_KEY,
        )
        if seed:
            for name, priority, sequence in SEED_JOBS:
                self._create_priority_job(name, priority, sequence)

    # ------------------------------------------------------------------
    # 延迟任务：Timestamp Sorted Set + Hash
    # ------------------------------------------------------------------
    def enqueue_delayed_task(
        self,
        name: str,
        delay_seconds: float,
        duration_seconds: float,
    ) -> dict[str, Any]:
        task_id = uuid.uuid4().hex[:12]
        run_at_ms = now_ms() + int(delay_seconds * 1000)
        task = {
            "id": task_id,
            "name": name,
            "delay_seconds": delay_seconds,
            "duration_seconds": duration_seconds,
            "status": "pending",
            "created_at": now_iso(),
            "run_at_ms": run_at_ms,
            "started_at": None,
            "completed_at": None,
        }
        pipe = self.redis.pipeline(transaction=True)
        pipe.hset(
            DELAYED_TASKS_HASH_KEY,
            task_id,
            json.dumps(task, ensure_ascii=False),
        )
        pipe.zadd(DELAYED_TASKS_KEY, {task_id: run_at_ms})
        pipe.execute()
        return task

    def list_delayed_tasks(self) -> list[dict[str, Any]]:
        raw_tasks = self.redis.hvals(DELAYED_TASKS_HASH_KEY)
        tasks = [
            task
            for task in (self._json_load(raw) for raw in raw_tasks)
            if task is not None
        ]
        pending_scores = self.redis.zrange(DELAYED_TASKS_KEY, 0, -1, withscores=True)
        pending_set = {task_id for task_id, _ in pending_scores}
        score_map = {task_id: int(score) for task_id, score in pending_scores}

        for task in tasks:
            task["in_timer"] = task["id"] in pending_set
            task["timer_score"] = score_map.get(task["id"])
        tasks.sort(key=lambda item: (item["run_at_ms"], item["created_at"]))
        return tasks

    def claim_due_tasks(self, limit: int = 5) -> list[dict[str, Any]]:
        """原子地把到期任务移出 ZSET，再由 worker 模拟执行。"""

        script = """
        local ids = redis.call(
          'ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2]
        )
        for _, task_id in ipairs(ids) do
          redis.call('ZREM', KEYS[1], task_id)
        end
        return ids
        """
        due_ids = self.redis.eval(
            script,
            1,
            DELAYED_TASKS_KEY,
            str(now_ms()),
            str(limit),
        )
        if not due_ids:
            return []

        tasks: list[dict[str, Any]] = []
        for task_id in due_ids:
            raw = self.redis.hget(DELAYED_TASKS_HASH_KEY, task_id)
            task = self._json_load(raw)
            if task is None:
                continue
            task["status"] = "processing"
            task["started_at"] = now_iso()
            self.redis.hset(
                DELAYED_TASKS_HASH_KEY,
                task_id,
                json.dumps(task, ensure_ascii=False),
            )
            tasks.append(task)
        return tasks

    def complete_delayed_task(self, task_id: str) -> dict[str, Any] | None:
        raw = self.redis.hget(DELAYED_TASKS_HASH_KEY, task_id)
        task = self._json_load(raw)
        if task is None:
            return None
        task["status"] = "completed"
        task["completed_at"] = now_iso()
        self.redis.hset(
            DELAYED_TASKS_HASH_KEY,
            task_id,
            json.dumps(task, ensure_ascii=False),
        )
        return task

    def delayed_task_stats(self) -> dict[str, int]:
        tasks = self.list_delayed_tasks()
        return {
            "total": len(tasks),
            "pending": sum(task["status"] == "pending" for task in tasks),
            "processing": sum(task["status"] == "processing" for task in tasks),
            "completed": sum(task["status"] == "completed" for task in tasks),
        }

    def reset_delayed_tasks(self) -> None:
        self.redis.delete(DELAYED_TASKS_KEY, DELAYED_TASKS_HASH_KEY)

