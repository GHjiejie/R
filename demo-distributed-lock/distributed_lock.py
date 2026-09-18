"""Redis 分布式锁 Demo。

启动多个进程竞争同一个 Redis Key，演示：

1. SET NX EX 只有一个进程可以成功获得锁；
2. 锁 Value 使用唯一 token，释放时只能删除自己持有的锁；
3. Lua 脚本把“校验 token + 删除锁”合并为一个原子操作；
4. 锁 TTL 小于临界区执行时间时，可能出现锁自动过期和并发进入，
   用来说明生产环境必须合理设置 TTL 或实现续期。
"""

from __future__ import annotations

import argparse
import multiprocessing
import os
import time
import uuid
from typing import Any, Dict

import redis

RELEASE_LOCK_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
"""

RESULT_TTL_SECONDS = 300


class RedisDistributedLock:
    """一个最小但相对安全的 Redis 分布式锁实现。"""

    def __init__(
        self,
        client: redis.Redis,
        name: str,
        ttl_seconds: int,
        token: str | None = None,
    ) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds 必须大于 0")

        self.client = client
        self.name = name
        self.ttl_seconds = ttl_seconds
        self.token = token or uuid.uuid4().hex
        self._release_script = client.register_script(RELEASE_LOCK_SCRIPT)
        self.acquired = False

    def acquire(self, wait_timeout: float, retry_interval: float = 0.05) -> bool:
        """在等待时间内尝试获取锁。"""
        deadline = time.monotonic() + max(wait_timeout, 0)

        while True:
            # SET NX EX 是一条原子命令，避免 SETNX 和 EXPIRE 分成两步。
            if self.client.set(
                self.name,
                self.token,
                nx=True,
                ex=self.ttl_seconds,
            ):
                self.acquired = True
                return True

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            time.sleep(min(retry_interval, remaining))

    def release(self) -> bool:
        """只释放仍然由当前 token 持有的锁。"""
        if not self.acquired:
            return False

        deleted = self._release_script(keys=[self.name], args=[self.token])
        self.acquired = False
        return int(deleted) == 1


def worker(
    worker_id: int,
    redis_url: str,
    lock_key: str,
    active_key: str,
    result_key: str,
    start_barrier: multiprocessing.Barrier,
    hold_seconds: float,
    wait_timeout: float,
    lock_ttl: int,
) -> None:
    """子进程任务：竞争锁并执行一段模拟临界区逻辑。"""
    client = redis.Redis.from_url(redis_url, decode_responses=True)
    token = f"worker-{worker_id}-{uuid.uuid4().hex}"
    lock = RedisDistributedLock(
        client=client,
        name=lock_key,
        ttl_seconds=lock_ttl,
        token=token,
    )

    # 让所有进程尽量同时发起竞争，便于观察锁的互斥效果。
    start_barrier.wait()
    started_at = time.monotonic()
    acquired = lock.acquire(wait_timeout=wait_timeout)
    waited_seconds = time.monotonic() - started_at

    if not acquired:
        client.hincrby(result_key, "timed_out", 1)
        print(
            f"Worker {worker_id} (pid={os.getpid()}) 获取锁超时，"
            f"等待 {waited_seconds:.2f}s",
            flush=True,
        )
        client.close()
        return

    active_workers = client.incr(active_key)
    client.expire(active_key, RESULT_TTL_SECONDS)
    client.hincrby(result_key, "acquired", 1)

    if active_workers > 1:
        # 正常情况下应为 0；只有锁 TTL 太短、锁已经被其他进程重新获得时，
        # 才可能出现多个进程同时进入临界区。
        client.hincrby(result_key, "overlap", 1)

    print(
        f"Worker {worker_id} (pid={os.getpid()}) 获取锁成功，"
        f"等待 {waited_seconds:.2f}s，进入临界区（当前并发数={active_workers}）",
        flush=True,
    )

    try:
        # 用 sleep 模拟订单创建、库存扣减或定时任务等临界区逻辑。
        time.sleep(hold_seconds)
    finally:
        client.decr(active_key)
        released = lock.release()
        if released:
            client.hincrby(result_key, "released", 1)
            print(
                f"Worker {worker_id} 退出临界区并安全释放锁",
                flush=True,
            )
        else:
            client.hincrby(result_key, "release_failed", 1)
            print(
                f"Worker {worker_id} 退出临界区，但锁已过期或不再属于当前进程",
                flush=True,
            )

    client.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Redis 分布式锁并发竞争 Demo")
    parser.add_argument(
        "--redis-url",
        default=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        help="Redis 连接地址，默认读取 REDIS_URL 或 redis://localhost:6379/0",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=5,
        help="并发竞争的进程数，默认 5",
    )
    parser.add_argument(
        "--hold-seconds",
        type=float,
        default=1.0,
        help="持有锁并执行临界区的秒数，默认 1 秒",
    )
    parser.add_argument(
        "--wait-timeout",
        type=float,
        default=10.0,
        help="单个进程等待锁的最长秒数，默认 10 秒",
    )
    parser.add_argument(
        "--lock-ttl",
        type=int,
        default=5,
        help="锁的自动过期时间，默认 5 秒",
    )
    return parser.parse_args()


def print_result(
    client: redis.Redis,
    result_key: str,
    lock_key: str,
    active_key: str,
    workers: int,
    hold_seconds: float,
    lock_ttl: int,
) -> None:
    result: Dict[str, Any] = client.hgetall(result_key)
    acquired = int(result.get("acquired", 0))
    timed_out = int(result.get("timed_out", 0))
    overlap = int(result.get("overlap", 0))
    released = int(result.get("released", 0))
    release_failed = int(result.get("release_failed", 0))

    print("\n=== 运行结果 ===")
    print(f"并发进程数：{workers}")
    print(f"成功获取锁：{acquired}")
    print(f"等待超时：{timed_out}")
    print(f"安全释放锁：{released}")
    print(f"释放失败：{release_failed}")
    print(f"临界区重叠次数：{overlap}")
    print(f"锁 Key：{lock_key}")
    print(f"结果 Key：{result_key}（{RESULT_TTL_SECONDS}s 后自动过期）")

    if lock_ttl > hold_seconds and overlap == 0:
        print("结论：锁的 TTL 覆盖了临界区，正常情况下只有一个进程同时执行临界区。")
    elif lock_ttl <= hold_seconds:
        print(
            "结论：当前锁 TTL 不大于临界区耗时，锁可能提前过期；"
            "请观察是否出现临界区重叠或释放失败。"
        )
    else:
        print("结论：本次没有观察到临界区重叠，可结合参数再次运行。")

    # active_key 正常情况下会回到 0；这里保留结果 Key 方便用 redis-cli 观察。
    print(f"临界区活动计数：{client.get(active_key) or 0}")


def main() -> None:
    args = parse_args()

    if args.workers < 1:
        raise SystemExit("--workers 必须大于等于 1")
    if args.hold_seconds < 0:
        raise SystemExit("--hold-seconds 不能小于 0")
    if args.wait_timeout < 0:
        raise SystemExit("--wait-timeout 不能小于 0")
    if args.lock_ttl <= 0:
        raise SystemExit("--lock-ttl 必须大于 0")

    client = redis.Redis.from_url(args.redis_url, decode_responses=True)
    client.ping()

    run_id = f"{time.strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    key_prefix = f"demo:distributed-lock:{run_id}"
    lock_key = f"{key_prefix}:lock"
    active_key = f"{key_prefix}:active"
    result_key = f"{key_prefix}:result"

    client.hset(
        result_key,
        mapping={
            "acquired": 0,
            "timed_out": 0,
            "released": 0,
            "release_failed": 0,
            "overlap": 0,
        },
    )
    client.expire(result_key, RESULT_TTL_SECONDS)

    print(f"Redis：{args.redis_url}")
    print(f"运行标识：{run_id}")
    print(
        f"启动 {args.workers} 个进程竞争同一个锁，"
        f"临界区 {args.hold_seconds:.1f}s，锁 TTL {args.lock_ttl}s"
    )

    start_barrier = multiprocessing.Barrier(args.workers)
    processes = []
    for worker_id in range(1, args.workers + 1):
        process = multiprocessing.Process(
            target=worker,
            args=(
                worker_id,
                args.redis_url,
                lock_key,
                active_key,
                result_key,
                start_barrier,
                args.hold_seconds,
                args.wait_timeout,
                args.lock_ttl,
            ),
        )
        process.start()
        processes.append(process)

    for process in processes:
        process.join()

    failed_processes = [
        process.pid for process in processes if process.exitcode not in (0, None)
    ]
    print_result(
        client=client,
        result_key=result_key,
        lock_key=lock_key,
        active_key=active_key,
        workers=args.workers,
        hold_seconds=args.hold_seconds,
        lock_ttl=args.lock_ttl,
    )
    client.close()

    if failed_processes:
        raise SystemExit(f"以下进程异常退出：{failed_processes}")


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
