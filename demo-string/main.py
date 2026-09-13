"""使用 redis-py 演示 Redis String 的常用操作。"""

from __future__ import annotations
import os
import sys
import redis


KEY_PREFIX = "demo:string"
NICKNAME_KEY = f"{KEY_PREFIX}:user:1:nickname"
VISITS_KEY = f"{KEY_PREFIX}:user:1:visits"
TEMPORARY_KEY = f"{KEY_PREFIX}:temporary"


def create_client() -> redis.Redis:
    """根据 REDIS_URL 创建客户端，默认连接本机 6379 端口。"""

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    return redis.Redis.from_url(redis_url, decode_responses=True)


def print_keys(client: redis.Redis) -> None:
    """列出本 Demo 创建的 key。scan_iter 比 KEYS 更适合真实环境。"""

    print("示例 key：")
    for key in sorted(client.scan_iter(match=f"{KEY_PREFIX}:*")):
        print(key)


def run_demo(client: redis.Redis) -> None:
    # 删除本脚本上一次运行留下的 key，使示例可以重复执行。
    client.delete(NICKNAME_KEY, VISITS_KEY, TEMPORARY_KEY)

    print("== Redis String Demo ==\n")

    print("== 1. SET / GET：保存并读取字符串 ==")
    client.set(NICKNAME_KEY, "redis learner")
    print(f"nickname = {client.get(NICKNAME_KEY)}\n")

    print("== 2. INCR：原子自增整数值 ==")
    client.set(VISITS_KEY, 0)
    client.incr(VISITS_KEY)
    print(f"visits = {client.get(VISITS_KEY)}\n")

    print("== 3. MGET：一次读取多个 key ==")
    nickname, visits = client.mget(NICKNAME_KEY, VISITS_KEY)
    print(f"nickname / visits = {nickname} / {visits}\n")

    print("== 4. SET EX / TTL：设置过期时间 ==")
    client.set(TEMPORARY_KEY, "temporary value", ex=30)
    print(f"temporary = {client.get(TEMPORARY_KEY)}")
    print(f"ttl(temporary) = {client.ttl(TEMPORARY_KEY)}\n")

    print_keys(client)


def main() -> int:
    client = create_client()
    try:
        client.ping()
        run_demo(client)
    except redis.RedisError as exc:
        print(
            "错误：无法连接或操作 Redis。请确认 demo-install-redis 中的 Compose 服务已经启动。",
            file=sys.stderr,
        )
        print(f"详细信息：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
