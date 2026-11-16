"""Redis 分布式锁 Demo。

服务 A、B、C 使用独立 Python 进程争抢同一把 Redis 锁，
获得锁后才能读取并更新同一个共享计数器。默认处理完成后继续持锁，
由人通过 HTTP 接口释放；其他服务等待接棒。持有者持续校验 token 并续期，
异常退出后由 TTL 兜底。传入 --auto-release 可以运行自动释放的对照实验。

涉及的 Redis 知识点：

1. ``SET key token NX EX seconds`` 原子加锁；
2. 每个持有者使用唯一 token 标识自己的锁；
3. Lua 脚本原子完成 token 校验和删除锁；
4. TTL 小于临界区耗时时，锁可能提前过期并产生并发进入。

这是单个 Redis 实例上的学习示例，不等同于生产环境的完整一致性方案。
"""

from __future__ import annotations

import argparse
import math
import multiprocessing
import os
import time
import uuid
from contextlib import suppress
from typing import Any

import redis
import uvicorn

from manual_release_api import DATA_TTL_SECONDS, create_app, get_data_keys


RELEASE_LOCK_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
"""

RENEW_LOCK_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
"""

MARK_READY_SCRIPT = """
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[2], 'status', 'awaiting_release')
redis.call('EXPIRE', KEYS[2], ARGV[2])
return 1
"""

RESULT_TTL_SECONDS = DATA_TTL_SECONDS


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

    def acquire(
        self,
        wait_timeout: float | None,
        retry_interval: float = 0.05,
        stop_event: Any = None,
    ) -> bool:
        """None 表示持续等待；0 表示只尝试一次；停止信号可中断等待。"""
        deadline = (
            None if wait_timeout is None else time.monotonic() + max(wait_timeout, 0)
        )

        while True:
            if stop_event is not None and stop_event.is_set():
                return False
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

            remaining = None if deadline is None else deadline - time.monotonic()
            if remaining is not None and remaining <= 0:
                return False
            delay = (
                retry_interval if remaining is None else min(retry_interval, remaining)
            )
            if stop_event is not None:
                stop_event.wait(delay)
            else:
                time.sleep(delay)

    def renew(self) -> bool:
        """只给仍属于本次 token 的锁续期，不重新创建已经丢失的锁。"""
        return (
            int(
                self.client.eval(
                    RENEW_LOCK_SCRIPT, 1, self.key, self.token, self.ttl_seconds * 1000
                )
            )
            == 1
        )

    def release(self) -> bool:
        """只释放仍然由当前 token 持有的锁。"""
        if not self.acquired:
            return False

        try:
            deleted = self._release_script(keys=[self.key], args=[self.token])
            return int(deleted) == 1
        finally:
            self.acquired = False


def get_service_name(service_id: int) -> str:
    """前 26 个实例使用服务 A 至 Z，更多实例使用数字命名。"""
    suffix = chr(ord("A") + service_id - 1) if service_id <= 26 else str(service_id)
    return f"服务{suffix}"


def update_service(
    client: redis.Redis, state_key: str, status: str, **fields: Any
) -> None:
    with client.pipeline() as pipe:
        pipe.hset(state_key, mapping={"status": status, **fields})
        pipe.expire(state_key, DATA_TTL_SECONDS)
        pipe.execute()


def process_with_renewal(
    lock: RedisDistributedLock, hold_seconds: float, stop_event: Any
) -> bool:
    """模拟业务处理期间也持续续期，避免只有处理完成后才开始续期。"""
    deadline = time.monotonic() + hold_seconds
    interval = min(0.5, lock.ttl_seconds / 3)
    while True:
        if stop_event.is_set() or not lock.renew():
            return False
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return True
        if stop_event.wait(min(interval, remaining)):
            return False


def worker(
    worker_id: int,
    redis_url: str,
    lock_key: str,
    active_key: str,
    result_key: str,
    resource_key: str,
    start_barrier: multiprocessing.Barrier,
    hold_seconds: float,
    wait_timeout: float | None,
    lock_ttl: int,
    manual_release: bool,
    stop_event: Any,
) -> None:
    """一个服务实例：抢锁成功后，读取并更新共享资源。"""
    service_name = get_service_name(worker_id)
    client = redis.Redis.from_url(
        redis_url, decode_responses=True, socket_connect_timeout=3, socket_timeout=3
    )
    state_key = f"{lock_key.rsplit(':', 1)[0]}:service:{service_name}"
    lock = RedisDistributedLock(
        client=client,
        key=lock_key,
        ttl_seconds=lock_ttl,
        token=f"{service_name}-{uuid.uuid4().hex}",
    )
    entered_resource = False

    try:
        update_service(
            client,
            state_key,
            "competing",
            name=service_name,
            token=lock.token,
            pid=os.getpid(),
        )
        print(
            f"{service_name} (pid={os.getpid()}) 已启动，准备争抢同一把 Redis 锁",
            flush=True,
        )
        # 第一轮：所有服务都准备好后，同时发起一次加锁请求。
        start_barrier.wait(timeout=10)
        started_at = time.monotonic()
        acquired = lock.acquire(wait_timeout=0)

        # 等所有服务完成首次尝试后，成功者再操作资源和释放锁。
        # 这样即使模拟处理耗时为 0，也能观察到本轮竞争的胜者与失败者。
        start_barrier.wait(timeout=10)
        if not acquired and (wait_timeout is None or wait_timeout > 0):
            update_service(client, state_key, "waiting")
            wait_label = (
                ("直到人工释放" if manual_release else "直到其他服务释放")
                if wait_timeout is None
                else f"最多等待 {wait_timeout:g}s"
            )
            print(
                f"{service_name} 首次抢锁失败，等待其他服务释放锁（{wait_label}）",
                flush=True,
            )
            acquired = lock.acquire(wait_timeout=wait_timeout, stop_event=stop_event)
        waited_seconds = time.monotonic() - started_at

        if not acquired:
            if stop_event.is_set():
                update_service(client, state_key, "cancelled")
            elif wait_timeout == 0:
                update_service(client, state_key, "skipped")
                client.hincrby(result_key, "skipped", 1)
                print(
                    f"{service_name} 抢锁失败，跳过本次共享资源操作",
                    flush=True,
                )
            else:
                update_service(client, state_key, "timed_out")
                client.hincrby(result_key, "timed_out", 1)
                print(
                    f"{service_name} 等待锁超时，等待 {waited_seconds:.2f}s，"
                    "跳过本次共享资源操作",
                    flush=True,
                )
            return

        update_service(client, state_key, "processing")
        active_workers = client.incr(active_key)
        entered_resource = True
        client.expire(active_key, RESULT_TTL_SECONDS)
        client.hincrby(result_key, "acquired", 1)

        if active_workers > 1:
            # 正常 TTL 足够长时应为 0；TTL 过短时可能出现并发进入。
            client.hincrby(result_key, "overlap", 1)

        print(
            f"{service_name} 抢锁成功，等待 {waited_seconds:.2f}s，开始操作共享资源"
            f"（当前并发数={active_workers}）",
            flush=True,
        )

        # 故意使用 GET -> 模拟处理 -> SET，让整个业务过程需要锁来保护。
        # 如果改成单条 INCR，共享计数器本身就能原子递增，会掩盖锁的作用。
        old_value = int(client.get(resource_key))
        print(
            f"{service_name} 读取共享资源：{old_value}，模拟处理 {hold_seconds:g}s",
            flush=True,
        )
        if manual_release:
            if not process_with_renewal(lock, hold_seconds, stop_event):
                status = "cancelled" if stop_event.is_set() else "lock_lost"
                update_service(client, state_key, status)
                if status == "lock_lost":
                    client.hincrby(result_key, "lock_lost", 1)
                return
        elif stop_event.wait(hold_seconds):
            update_service(client, state_key, "cancelled")
            return
        new_value = old_value + 1
        client.set(resource_key, new_value, ex=RESULT_TTL_SECONDS)
        client.hincrby(result_key, "completed", 1)
        # 操作已完成，等待人工释放时不再占用临界区活动计数。
        client.decr(active_key)
        entered_resource = False
        client.hset(state_key, mapping={"before": old_value, "after": new_value})
        print(
            f"{service_name} 完成共享资源更新：{old_value} -> {new_value}",
            flush=True,
        )
        if manual_release:
            ready = client.eval(
                MARK_READY_SCRIPT, 2, lock_key, state_key, lock.token, DATA_TTL_SECONDS
            )
            if not ready:
                update_service(client, state_key, "lock_lost")
                client.hincrby(result_key, "lock_lost", 1)
                return
            print(
                f"{service_name} 继续持锁并续期，等待人工调用 POST /lock/release",
                flush=True,
            )
            interval = min(0.5, lock_ttl / 3)
            while True:
                if client.hget(state_key, "status") == "released":
                    lock.acquired = False
                    print(
                        f"{service_name} 已确认人工释放，结束本次服务操作", flush=True
                    )
                    return
                if stop_event.is_set():
                    update_service(client, state_key, "cancelled")
                    return
                if not lock.renew():
                    # 接口会在删除锁的同一个 Lua 脚本内标记 released。
                    if client.hget(state_key, "status") != "released":
                        update_service(client, state_key, "lock_lost")
                        client.hincrby(result_key, "lock_lost", 1)
                        print(f"{service_name} 已失去锁，停止续期", flush=True)
                    lock.acquired = False
                    return
                stop_event.wait(interval)
    except BaseException:
        # 某个服务失败时解除同步等待，避免其他服务永久卡在 Barrier。
        start_barrier.abort()
        with suppress(redis.RedisError):
            update_service(client, state_key, "failed")
        raise
    finally:
        try:
            if entered_resource:
                client.decr(active_key)
        finally:
            try:
                if lock.acquired and not manual_release:
                    released = lock.release()
                    if released:
                        update_service(
                            client, state_key, "released", release_source="auto"
                        )
                        client.hincrby(result_key, "released", 1)
                        print(f"{service_name} 已安全释放 Redis 锁", flush=True)
                    else:
                        update_service(client, state_key, "lock_lost")
                        client.hincrby(result_key, "release_failed", 1)
                        print(
                            f"{service_name} 释放锁失败：锁已过期或不再属于当前服务",
                            flush=True,
                        )
            finally:
                client.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="服务 A、B、C 争抢 Redis 锁并操作共享资源"
    )
    parser.add_argument(
        "--redis-url",
        default=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        help="Redis 连接地址，默认读取 REDIS_URL 或 redis://localhost:6379/0",
    )
    parser.add_argument(
        "--services",
        "--workers",
        dest="workers",
        type=int,
        default=3,
        help="服务实例数，默认 3（服务 A、B、C）；兼容 --workers 参数",
    )
    parser.add_argument(
        "--hold-seconds",
        type=float,
        default=1.0,
        help="读取共享资源后，模拟业务处理的秒数，默认 1 秒",
    )
    parser.add_argument(
        "--wait-timeout",
        type=float,
        default=None,
        help="首次失败后的最长等待秒数，默认持续等待人工释放；0 表示直接跳过",
    )
    parser.add_argument(
        "--lock-ttl",
        type=int,
        default=30,
        help="锁租约秒数，默认 30；手动模式持有者持续续期，异常退出后才自然过期",
    )
    parser.add_argument(
        "--auto-release",
        action="store_true",
        help="对照模式：业务结束自动释放锁，不启动 HTTP 接口、不续期",
    )
    parser.add_argument(
        "--api-host", default="127.0.0.1", help="接口监听地址，默认 127.0.0.1"
    )
    parser.add_argument(
        "--api-port", type=int, default=8010, help="接口端口，默认 8010"
    )
    return parser.parse_args()


def print_result(
    client: redis.Redis,
    result_key: str,
    lock_key: str,
    active_key: str,
    resource_key: str,
    workers: int,
    wait_timeout: float | None,
) -> None:
    result: dict[str, Any] = client.hgetall(result_key)
    acquired = int(result.get("acquired", 0))
    skipped = int(result.get("skipped", 0))
    timed_out = int(result.get("timed_out", 0))
    released = int(result.get("released", 0))
    release_failed = int(result.get("release_failed", 0))
    overlap = int(result.get("overlap", 0))
    completed = int(result.get("completed", 0))
    resource_value = int(client.get(resource_key))

    print("\n=== 运行结果 ===")
    print(f"服务实例数：{workers}")
    print(f"成功获取锁：{acquired}")
    print(f"抢锁失败并跳过：{skipped}")
    print(f"等待超时：{timed_out}")
    print(f"安全释放锁：{released}")
    print(f"释放失败：{release_failed}")
    print(f"临界区重叠次数：{overlap}")
    print(f"共享资源操作完成次数：{completed}")
    print(f"共享资源预期值：{completed}（初始为 0，每次完成操作加 1）")
    print(f"共享资源实际值：{resource_value}")
    print(f"锁 Key：{lock_key}")
    print(f"共享资源 Key：{resource_key}")
    print(f"结果 Key：{result_key}（{RESULT_TTL_SECONDS}s 后自动过期）")

    if overlap > 0 or resource_value != completed:
        print(
            "结论：观察到并发进入共享资源或更新丢失。"
            "锁提前过期后，旧服务仍可能继续执行，安全解锁不能阻止旧写入。"
        )
    elif release_failed > 0:
        print("结论：有服务执行期间失去了锁，本次未观察到共享资源更新丢失。")
    elif wait_timeout == 0:
        print("结论：本轮服务各抢一次，成功者操作共享资源，失败者跳过。")
    else:
        print("结论：成功获取锁的服务轮流操作共享资源，本次未观察到临界区重叠。")

    print(f"临界区活动计数：{client.get(active_key) or 0}")


def main() -> None:
    args = parse_args()

    if args.workers < 1:
        raise SystemExit("--services / --workers 必须大于等于 1")
    if not math.isfinite(args.hold_seconds) or args.hold_seconds < 0:
        raise SystemExit("--hold-seconds 必须是非负有限数值")
    if args.wait_timeout is not None and (
        not math.isfinite(args.wait_timeout) or args.wait_timeout < 0
    ):
        raise SystemExit("--wait-timeout 必须是非负有限数值")
    if args.lock_ttl <= 0:
        raise SystemExit("--lock-ttl 必须大于 0")
    if not 1 <= args.api_port <= 65535:
        raise SystemExit("--api-port 必须在 1 到 65535 之间")

    client = redis.Redis.from_url(
        args.redis_url,
        decode_responses=True,
        socket_connect_timeout=3,
        socket_timeout=3,
    )
    client.ping()

    run_id = f"{time.strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    key_prefix = f"demo:redis-lock:{run_id}"
    lock_key = f"{key_prefix}:lock"
    active_key = f"{key_prefix}:active"
    result_key = f"{key_prefix}:result"
    resource_key = f"{key_prefix}:resource"

    client.set(resource_key, 0, ex=RESULT_TTL_SECONDS)

    client.hset(
        result_key,
        mapping={
            "acquired": 0,
            "skipped": 0,
            "timed_out": 0,
            "released": 0,
            "release_failed": 0,
            "overlap": 0,
            "completed": 0,
            "manual_released": 0,
            "lock_lost": 0,
        },
    )
    client.expire(result_key, RESULT_TTL_SECONDS)

    print(f"Redis：{args.redis_url}", flush=True)
    print(f"运行标识：{run_id}", flush=True)
    service_names = [get_service_name(i) for i in range(1, args.workers + 1)]
    for name in service_names:
        update_service(client, f"{key_prefix}:service:{name}", "starting", name=name)
    print(f"参与服务：{'、'.join(service_names)}（每个服务是一个独立进程）", flush=True)
    print(f"共享资源：{resource_key}，初始值为 0", flush=True)
    wait_label = (
        "持续等待" if args.wait_timeout is None else f"最多等待 {args.wait_timeout:g}s"
    )
    print(
        f"业务处理 {args.hold_seconds:g}s，锁 TTL {args.lock_ttl}s；"
        f"首次失败后{wait_label}（0 表示直接跳过）",
        flush=True,
    )
    if not args.auto_release:
        base_url = f"http://{args.api_host}:{args.api_port}"
        print(f"人工释放模式：处理完成后继续持锁；查看 {base_url}/status", flush=True)
        print(
            f"接口文档：{base_url}/docs；释放接口：POST {base_url}/lock/release",
            flush=True,
        )

    context = multiprocessing.get_context("spawn")
    start_barrier = context.Barrier(args.workers)
    stop_event = context.Event()
    processes = []
    for worker_id in range(1, args.workers + 1):
        process = context.Process(
            target=worker,
            args=(
                worker_id,
                args.redis_url,
                lock_key,
                active_key,
                result_key,
                resource_key,
                start_barrier,
                args.hold_seconds,
                args.wait_timeout,
                args.lock_ttl,
                not args.auto_release,
                stop_event,
            ),
        )
        processes.append(process)

    try:
        for process in processes:
            process.start()
        if args.auto_release:
            for process in processes:
                process.join()
            print_result(
                client,
                result_key,
                lock_key,
                active_key,
                resource_key,
                args.workers,
                args.wait_timeout,
            )
            failed = [p.pid for p in processes if p.exitcode not in (0, None)]
            if failed:
                raise SystemExit(f"以下进程异常退出：{failed}")
        else:
            uvicorn.run(
                create_app(client, key_prefix, service_names),
                host=args.api_host,
                port=args.api_port,
            )
    finally:
        stop_event.set()
        start_barrier.abort()
        for process in processes:
            if process.pid is not None:
                process.join(timeout=4)
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=4)
        try:
            for key in get_data_keys(key_prefix, service_names):
                client.expire(key, DATA_TTL_SECONDS)
        finally:
            client.close()


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
