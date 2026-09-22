import json
import logging
import threading
import uuid

from confluent_kafka import Consumer, KafkaException

from .config import TOPICS

logger = logging.getLogger(__name__)


class Worker:
    def __init__(self, bootstrap, store, group, delay_ms):
        self.id = f"consumer-{uuid.uuid4().hex[:6]}"
        self.group = group
        self.delay_ms = delay_ms
        self.bootstrap = bootstrap
        self.store = store
        self.stop_event = threading.Event()
        self.state = "starting"
        self.error = None
        self.assignment = []
        self.processed = 0
        self.duplicates = 0
        self.thread = threading.Thread(target=self.run, name=self.id, daemon=True)

    def describe(self):
        return {
            "id": self.id,
            "group": self.group,
            "delay_ms": self.delay_ms,
            "state": self.state,
            "assignment": list(self.assignment),
            "processed": self.processed,
            "duplicates": self.duplicates,
            "error": self.error,
        }

    def assigned(self, consumer, partitions):
        self.assignment = [{"topic": p.topic, "partition": p.partition} for p in partitions]
        self.state = "running"
        self.store.activity("rebalance", f"{self.id} 获得分区 {self.assignment}")

    def revoked(self, consumer, partitions):
        self.assignment = []
        self.state = "rebalancing"
        self.store.activity("rebalance", f"{self.id} 释放分区")

    def run(self):
        consumer = None
        try:
            consumer = Consumer(
                {
                    "bootstrap.servers": self.bootstrap,
                    "group.id": self.group,
                    "client.id": self.id,
                    "auto.offset.reset": "earliest",
                    "enable.auto.commit": False,
                    "enable.auto.offset.store": False,
                    "partition.assignment.strategy": "roundrobin",
                    "session.timeout.ms": 10000,
                    "max.poll.interval.ms": 60000,
                    "allow.auto.create.topics": False,
                }
            )
            consumer.subscribe(list(TOPICS), on_assign=self.assigned, on_revoke=self.revoked)
            while not self.stop_event.is_set():
                message = consumer.poll(0.5)
                if message is None:
                    continue
                if message.error():
                    raise KafkaException(message.error())
                if self.stop_event.wait(self.delay_ms / 1000):
                    break
                event = json.loads(message.value())
                inserted = self.store.process(
                    self.group,
                    self.id,
                    message.topic(),
                    message.partition(),
                    message.offset(),
                    event,
                )
                # 先提交本地业务结果，再同步提交下一条应读取的 offset。
                consumer.commit(message=message, asynchronous=False)
                self.processed += 1
                self.duplicates += int(not inserted)
        except Exception as exc:
            self.error = str(exc)
            logger.exception("consumer failed: %s", self.id)
            self.store.activity("error", f"{self.id} 停止：{exc}")
        finally:
            if consumer is not None:
                consumer.close()
            self.assignment = []
            self.state = "error" if self.error else "stopped"

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=15)
        if self.thread.is_alive():
            raise RuntimeError("消费者仍在结束请求，请稍后重试")
