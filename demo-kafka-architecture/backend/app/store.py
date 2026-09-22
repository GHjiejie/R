import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path


class Store:
    """幂等业务结果和观察记录持久化；消费进度仍由 Kafka 保存。"""

    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS deliveries (
                    group_id TEXT NOT NULL,
                    event_id TEXT NOT NULL,
                    topic TEXT NOT NULL,
                    partition_id INTEGER NOT NULL,
                    offset_id INTEGER NOT NULL,
                    consumer_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    amount_minor INTEGER NOT NULL,
                    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                    PRIMARY KEY (group_id, event_id)
                );
                CREATE TABLE IF NOT EXISTS attempts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_id TEXT NOT NULL,
                    consumer_id TEXT NOT NULL,
                    event_id TEXT NOT NULL,
                    topic TEXT NOT NULL,
                    partition_id INTEGER NOT NULL,
                    offset_id INTEGER NOT NULL,
                    duplicate INTEGER NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                );
                CREATE TABLE IF NOT EXISTS activity (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kind TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                );
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def process(self, group, consumer, topic, partition, offset, event):
        # 唯一约束、业务结果和处理尝试在一个本地事务内提交。
        with self.connection() as db:
            inserted = db.execute(
                """INSERT OR IGNORE INTO deliveries
                (group_id,event_id,topic,partition_id,offset_id,consumer_id,payload,amount_minor)
                VALUES (?,?,?,?,?,?,?,?)""",
                (
                    group,
                    event["event_id"],
                    topic,
                    partition,
                    offset,
                    consumer,
                    json.dumps(event, ensure_ascii=False),
                    event["amount_minor"],
                ),
            ).rowcount
            db.execute(
                """INSERT INTO attempts
                (group_id,consumer_id,event_id,topic,partition_id,offset_id,duplicate)
                VALUES (?,?,?,?,?,?,?)""",
                (group, consumer, event["event_id"], topic, partition, offset, not inserted),
            )
            db.execute("DELETE FROM attempts WHERE id <= (SELECT MAX(id)-5000 FROM attempts)")
        return bool(inserted)

    def activity(self, kind, message):
        with self.connection() as db:
            db.execute("INSERT INTO activity (kind,message) VALUES (?,?)", (kind, message))
            db.execute("DELETE FROM activity WHERE id <= (SELECT MAX(id)-500 FROM activity)")

    def overview(self):
        with self.connection() as db:
            return {
                "results": [
                    dict(r)
                    for r in db.execute(
                        """SELECT group_id,COUNT(*) AS unique_events,
                    SUM(amount_minor) AS amount_minor FROM deliveries GROUP BY group_id"""
                    )
                ],
                "attempts": [
                    dict(r) for r in db.execute("SELECT * FROM attempts ORDER BY id DESC LIMIT 60")
                ],
                "activity": [
                    dict(r) for r in db.execute("SELECT * FROM activity ORDER BY id DESC LIMIT 30")
                ],
            }
