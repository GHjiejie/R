"""Redis 分布式锁 Demo。

这个示例使用多个 Python 进程竞争同一个 Redis Key，演示：

1. ``SET key token NX EX seconds`` 原子加锁；
2. 每个持有者使用唯一 token 标识自己的锁；
3. Lua 脚本原子完成 token 校验和删除锁；
4. TTL 小于临界区耗时时，锁可能提前过期并产生并发进入。

这是单个 Redis 实例上的学习示例，不等同于生产环境的完整一致性方案。
"""

from __future__ import annotations

import argparse
import multiprocessing
import os
import time
import uuid
from typing import Any

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
    """一个最小的 Redis 分布式锁实现。"""

    def __init__(
        self,
        client: redis.Redis,
        key: str,
        ttl_seconds: int,
        token: str | None = None,
    ) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds 必须大于 0")

        self.client = client
        self.key = key
        self.ttl_seconds = ttl_seconds
        self.token = token or uuid.uuid4().hex
        self._release_script = client.register_script(RELEASE_LOCK_SCRIPT)
        self.acquired = False

    def acquire(self, wait_timeout: float, retry_interval: float = 0.05) -> bool:
        """在 wait_timeout 内反复尝试获取锁。"""
        deadline = time.monotonic() + max(wait_timeout, 0)

        while True:
            # NX 和 EX 必须放在同一条 SET 命令中，避免加锁成功后进程崩溃，
            # 还来不及设置过期时间而留下永久锁。
            if self.client.set(
                self.key,
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

        try:
            deleted = self._release_script(keys=[self.key], args=[self.token])
            return int(deleted) == 1
        finally:
            self.acquired = False


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
    """子进程：竞争锁，执行模拟的临界区逻辑，然后释放锁。"""
    client = redis.Redis.from_url(redis_url, decode_responses=True)
    lock = RedisDistributedLock(
        client=client,
        key=lock_key,
        ttl_seconds=lock_ttl,
        token=f"worker-{worker_id}-{uuid.uuid4().hex}",
    )

    try:
        # 让所有子进程尽量同时开始竞争，方便观察互斥效果。
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
            return

        active_workers = client.incr(active_key)
        client.expire(active_key, RESULT_TTL_SECONDS)
        client.hincrby(result_key, "acquired", 1)

        if active_workers > 1:
            # 正常 TTL 足够长时应为 0；TTL 过短时可能出现并发进入。
            client.hincrby(result_key, "overlap", 1)

        print(
            f"Worker {worker_id} (pid={os.getpid()}) 获取锁成功，"
            f"等待 {waited_seconds:.2f}s，进入临界区"
            f"（当前并发数={active_workers}）",
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
                print(f"Worker {worker_id} 退出临界区并安全释放锁", flush=True)
            else:
                client.hincrby(result_key, "release_failed", 1)
                print(
                    f"Worker {worker_id} 退出临界区，但锁已过期或不再属于当前进程",
                    flush=True,
                )
    finally:
        client.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Redis 分布式锁并发竞争 Demo")
    parser.add_argument(
        "--redis-url",
        default=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        help="Redis 连接地址，默认读取 REDIS_URL 或 redis://localhost:6379/0",
    )
    parser.add_argument("--workers", type=int, default=5, help="竞争锁的进程数，默认 5")
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
    result: dict[str, Any] = client.hgetall(result_key)
    acquired = int(result.get("acquired", 0))
    timed_out = int(result.get("timed_out", 0))
    released = int(result.get("released", 0))
    release_failed = int(result.get("release_failed", 0))
    overlap = int(result.get("overlap", 0))

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
        print("结论：锁 TTL 覆盖了临界区，正常情况下只有一个进程同时执行临界区。")
    elif lock_ttl <= hold_seconds:
        print(
            "结论：锁 TTL 不大于临界区耗时，锁可能提前过期；"
            "请观察临界区重叠或释放失败。"
        )
    else:
        print("结论：本次未观察到临界区重叠，可结合参数再次运行。")

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
    key_prefix = f"demo:redis-lock:{run_id}"
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
