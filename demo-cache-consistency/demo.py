"""用同一次用户改名演示旁路缓存、漏删补偿和慢请求回填。"""

import argparse
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from redis import Redis
from redis.exceptions import RedisError

from local_redis import open_redis


OLD_NAME = "小林"
NEW_NAME = "林一"
CACHE_TTL = 60
LEASE_TTL = 30

# 校验资格、写入缓存、消费令牌在 Redis 中一次完成。
FILL_WITH_LEASE = """
if redis.call('GET', KEYS[2]) ~= ARGV[1] then
    return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('DEL', KEYS[2])
return 1
"""


class UserStore:
    def __init__(self, database: Path, cache: Redis):
        self.database = database
        self.cache = cache
        self.key = f"learn:cache-consistency:{uuid4().hex}:user:42"
        self.lease_key = self.key + ":lease"
        with self.transaction() as db:
            db.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
            db.execute("INSERT INTO users VALUES (42, ?)", (OLD_NAME,))
            db.execute("CREATE TABLE outbox (id INTEGER PRIMARY KEY, cache_key TEXT NOT NULL)")

    @contextmanager
    def transaction(self):
        # 每次新开连接，保证后续读请求和恢复任务只依赖已提交的数据。
        with closing(sqlite3.connect(self.database)) as db, db:
            yield db

    def name_in_database(self):
        with self.transaction() as db:
            return db.execute("SELECT name FROM users WHERE id = 42").fetchone()[0]

    def rename(self, name, *, record_invalidation=False):
        with self.transaction() as db:
            db.execute("UPDATE users SET name = ? WHERE id = 42", (name,))
            if record_invalidation:
                db.execute("INSERT INTO outbox (cache_key) VALUES (?)", (self.key,))

    def invalidate(self, cache_key=None):
        # 同一条 DEL 同时使缓存和已经发出的回填令牌失效。
        key = self.key if cache_key is None else cache_key
        return self.cache.delete(key, key + ":lease")

    def read(self, *, use_lease=False, after_database_read=None):
        cached = self.cache.get(self.key)
        if cached is not None:
            print(f"  GET 命中，返回 {cached}")
            return cached

        token = uuid4().hex if use_lease else None
        if use_lease:
            acquired = self.cache.set(self.lease_key, token, nx=True, ex=LEASE_TTL)
            if not acquired:
                print("  已有请求持有回填令牌，本次直接查库并跳过回填")
                return self.name_in_database()
            print("  读请求领取了回填令牌")

        name = self.name_in_database()
        print(f"  GET 未命中，从 SQLite 读到 {name}")
        if after_database_read is not None:
            # 固定并发顺序：读请求持有旧结果时，让写请求完成提交和失效。
            after_database_read()

        if use_lease:
            written = self.cache.eval(
                FILL_WITH_LEASE, 2, self.key, self.lease_key, token, name, CACHE_TTL
            )
            if not written:
                print(f"  回填令牌已失效，Redis 拒绝写入 {name}")
                return name
        else:
            self.cache.set(self.key, name, ex=CACHE_TTL)
        print(f"  回填 Redis = {name}，TTL 为 {CACHE_TTL} 秒")
        return name

    def show_state(self, step, expected_db, expected_cache):
        actual = (self.name_in_database(), self.cache.get(self.key))
        print(f"  {step} | SQLite = {actual[0]} | Redis = {actual[1] or '（空）'}")
        if actual != (expected_db, expected_cache):
            raise AssertionError(f"{step} 实际为 {actual!r}，预期为 {(expected_db, expected_cache)!r}")


def normal(store):
    print("首次查询，然后再查一次")
    store.read()
    store.read()
    store.rename(NEW_NAME)
    store.invalidate()
    store.show_state("改名已提交，缓存已删除", NEW_NAME, None)
    store.read()
    store.show_state("下一次查询回源后", NEW_NAME, NEW_NAME)


def deliver_one(store, *, interrupt_before_ack=False):
    """处理一条已提交的失效任务，返回 DEL 的结果。没有待办时返回 None。"""
    with store.transaction() as db:
        event = db.execute("SELECT id, cache_key FROM outbox ORDER BY id LIMIT 1").fetchone()
    if event is None:
        return None
    event_id, cache_key = event
    removed = store.invalidate(cache_key)
    print(f"  任务 {event_id} 执行 DEL，删除了 {removed} 个键")
    if interrupt_before_ack:
        print("  模拟恢复任务在确认前中断，待办仍在 SQLite 中")
    else:
        with store.transaction() as db:
            db.execute("DELETE FROM outbox WHERE id = ?", (event_id,))
    return removed


def outbox(store):
    store.read()
    store.rename(NEW_NAME, record_invalidation=True)
    # 模拟写进程在 COMMIT 后退出：它没有机会调用 Redis。
    store.show_state("数据库已提交，写请求漏删缓存", NEW_NAME, OLD_NAME)

    print("恢复任务重新连接 SQLite，补删缓存。随后重试同一条待办")
    first = deliver_one(store, interrupt_before_ack=True)
    retry = deliver_one(store)
    if (first, retry) != (1, 0) or deliver_one(store) is not None:
        raise AssertionError("同一条待办应可重试，并在确认后移除")
    store.show_state("补删完成", NEW_NAME, None)
    store.read()
    store.show_state("重新回填后", NEW_NAME, NEW_NAME)


def slow_refill(store, *, use_lease):
    def writer():
        store.rename(NEW_NAME)
        removed = store.invalidate()
        print(f"  B 提交改名并执行 DEL，删除了 {removed} 个键")

    print("A 遇到缓存未命中，B 将在 A 查库后、回填前完成改名")
    answer = store.read(use_lease=use_lease, after_database_read=writer)
    print(f"  A 本次请求返回 {answer}")
    expected_cache = None if use_lease else OLD_NAME
    store.show_state("A 尝试回填后", NEW_NAME, expected_cache)
    print("C 在 B 完成后发起新查询")
    later_answer = store.read(use_lease=use_lease)
    expected_answer = NEW_NAME if use_lease else OLD_NAME
    if (answer, later_answer) != (OLD_NAME, expected_answer):
        raise AssertionError(f"读请求 A、C 的返回值与预期不符：{answer!r}、{later_answer!r}")
    store.show_state("C 查询后", NEW_NAME, expected_answer)


SCENARIOS = {
    "normal": ("正常读写", normal),
    "outbox": ("提交后漏删与 Outbox 补偿", outbox),
    "race": ("慢请求回填旧值", lambda store: slow_refill(store, use_lease=False)),
    "lease": ("撤销令牌阻止旧值回填", lambda store: slow_refill(store, use_lease=True)),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "scenario", choices=["all", *SCENARIOS], nargs="?", default="all",
        help="只运行选中的场景，默认全部运行",
    )
    selected = parser.parse_args().scenario
    names = SCENARIOS.keys() if selected == "all" else [selected]
    with open_redis() as cache, TemporaryDirectory() as directory:
        for name in names:
            title, run = SCENARIOS[name]
            print(f"\n[{name}] {title}")
            store = UserStore(Path(directory) / f"{name}.sqlite", cache)
            try:
                run(store)
            finally:
                store.invalidate()
    print("\n所选场景的数据库与缓存状态均符合预期。")


if __name__ == "__main__":
    try:
        main()
    except RedisError as error:
        raise SystemExit(f"Redis 操作失败（{type(error).__name__}），请检查连接和命令权限。") from None
