import json
import socket
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from confluent_kafka import (
    Consumer,
    KafkaError,
    Producer,
    TopicPartition,
)
from confluent_kafka.admin import AdminClient, NewPartitions, NewTopic, OffsetSpec

from .config import GROUPS, TOPICS
from .group_admin import call_group_admin
from .workers import Worker
from .quorum import read_quorum


class LabError(Exception):
    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


class KafkaService:
    def __init__(self, settings, store):
        self.settings = settings
        self.store = store
        self.admin = AdminClient(
            {"bootstrap.servers": settings.bootstrap_servers, "socket.timeout.ms": 5000}
        )
        self.producers = {}
        self.producer_locks = {}
        for i in range(1, 4):
            name = f"producer-{i}"
            self.producers[name] = Producer(
                {
                    "bootstrap.servers": settings.bootstrap_servers,
                    "client.id": name,
                    "enable.idempotence": True,
                    "acks": "all",
                    "compression.type": "lz4",
                    "linger.ms": 10,
                    "delivery.timeout.ms": 10000,
                    "request.timeout.ms": 5000,
                }
            )
            self.producer_locks[name] = threading.Lock()
        self.workers = {}
        self.lock = threading.RLock()
        self.snapshot = {
            "status": "connecting",
            "brokers": [],
            "topics": [],
            "groups": [],
            "quorum": {},
            "errors": [],
            "updated_at": None,
        }
        self.stop_event = threading.Event()
        self.monitor = threading.Thread(
            target=self.monitor_loop, name="cluster-monitor", daemon=True
        )
        self.monitor.start()

    def close(self):
        self.stop_event.set()
        with self.lock:
            for worker in self.workers.values():
                worker.stop()
        self.monitor.join(timeout=20)
        for producer in self.producers.values():
            producer.flush(2)

    def initialize(self):
        with self.lock:
            existing = self.admin.list_topics(timeout=5).topics
            # 副本顺序中的第一个为初始首选 Leader，对应用户架构图。
            assignments = {"orders": [[1, 2, 3], [2, 3, 1]], "payments": [[3, 1, 2]]}
            requests = [
                NewTopic(
                    name,
                    num_partitions=len(replicas),
                    replica_assignment=replicas,
                    config={
                        "min.insync.replicas": "2",
                        "retention.ms": "86400000",
                        "segment.bytes": "1048576",
                        "segment.ms": "60000",
                        "cleanup.policy": "delete",
                    },
                )
                for name, replicas in assignments.items()
                if name not in existing
            ]
            for future in (
                self.admin.create_topics(requests, request_timeout=10).values() if requests else []
            ):
                future.result(timeout=12)
            self.store.activity("setup", "主题初始化完成：已有主题保留，缺失主题按三副本配置创建")
            return {
                "created": [r.topic for r in requests],
                "existing": [t for t in TOPICS if t in existing],
            }

    def produce(self, request):
        metadata = self.admin.list_topics(timeout=5)
        topic = metadata.topics.get(request.topic)
        if topic is None or topic.error:
            raise LabError("请先初始化主题", 409)
        if request.partition is not None and request.partition not in topic.partitions:
            raise LabError("指定分区不存在", 422)
        receipts, failures = [], []
        producer = self.producers[request.producer]
        batch = uuid.uuid4().hex[:10]

        def delivered(error, message, event_id):
            if error:
                failures.append({"event_id": event_id, "error": str(error)})
            else:
                receipts.append(
                    {
                        "event_id": event_id,
                        "topic": message.topic(),
                        "partition": message.partition(),
                        "offset": message.offset(),
                        "key": message.key().decode(),
                    }
                )

        started = time.monotonic()
        with self.producer_locks[request.producer]:
            for i in range(request.count):
                key = f"{request.key}-{i}" if request.vary_keys else request.key
                event_id = f"{batch}-{i}"
                event = {
                    "event_id": event_id,
                    "schema_version": 1,
                    "key": key,
                    "type": "OrderCreated" if request.topic == "orders" else "PaymentReceived",
                    "producer": request.producer,
                    "amount_minor": request.amount_minor,
                    "sequence": i,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                producer.produce(
                    request.topic,
                    key=key,
                    value=json.dumps(event, ensure_ascii=False),
                    partition=request.partition if request.partition is not None else -1,
                    on_delivery=lambda err, msg, eid=event_id: delivered(err, msg, eid),
                )
            pending = producer.flush(12)
        self.store.activity(
            "produce",
            f"{request.producer} → {request.topic}："
            f"确认 {len(receipts)}，失败 {len(failures)}，结果待定 {pending}",
        )
        return {
            "acknowledged": len(receipts),
            "failed": len(failures),
            "pending": pending,
            "duration_ms": round((time.monotonic() - started) * 1000),
            "receipts": receipts,
            "failures": failures,
        }

    def start_worker(self, group, delay_ms):
        with self.lock:
            active = [w for w in self.workers.values() if w.thread.is_alive()]
            if len(active) >= 12 or sum(w.group == group for w in active) >= 6:
                raise LabError("每组最多 6 个消费者，总计最多 12 个")
            if any(t not in self.admin.list_topics(timeout=5).topics for t in TOPICS):
                raise LabError("请先初始化主题")
            # 保留最近的结束实例，避免长时间实验无限累积线程对象。
            if len(self.workers) >= 30:
                self.workers = {k: w for k, w in self.workers.items() if w.thread.is_alive()}
            worker = Worker(self.settings.bootstrap_servers, self.store, group, delay_ms)
            self.workers[worker.id] = worker
            worker.thread.start()
            self.store.activity("consumer", f"{group} 启动 {worker.id}")
            return worker.describe()

    def stop_worker(self, worker_id):
        with self.lock:
            worker = self.workers.get(worker_id)
            if not worker:
                raise LabError("消费者不存在", 404)
            worker.stop()
            self.store.activity("consumer", f"停止 {worker_id}")
            return worker.describe()

    def set_delay(self, worker_id, delay_ms):
        with self.lock:
            worker = self.workers.get(worker_id)
            if not worker or not worker.thread.is_alive():
                raise LabError("消费者未运行", 404)
            worker.delay_ms = delay_ms
            return worker.describe()

    def expand(self, topic, count):
        with self.lock:
            metadata = self.admin.list_topics(timeout=5).topics.get(topic)
            if not metadata or metadata.error:
                raise LabError("请先初始化主题")
            if count <= len(metadata.partitions):
                raise LabError("只允许增加分区，不能减少或保持原数量", 422)
            self.admin.create_partitions([NewPartitions(topic, count)], request_timeout=10)[
                topic
            ].result(12)
            self.store.activity("partition", f"{topic} 扩展到 {count} 个分区；Key 映射可能改变")
            return {"topic": topic, "partitions": count}

    def reset(self, group, position):
        with self.lock:
            if any(w.group == group and w.thread.is_alive() for w in self.workers.values()):
                raise LabError("先停止该消费组的全部消费者，再重置位移")
            metadata = self.admin.list_topics(timeout=5)
            spec = OffsetSpec.earliest() if position == "earliest" else OffsetSpec.latest()
            query = {
                TopicPartition(t, p): spec
                for t in TOPICS
                if t in metadata.topics
                for p in metadata.topics[t].partitions
            }
            offsets = [
                TopicPartition(tp.topic, tp.partition, f.result(7).offset)
                for tp, f in self.admin.list_offsets(query, request_timeout=5).items()
            ]
            try:
                call_group_admin(
                    self.settings.bootstrap_servers,
                    "reset",
                    [
                        {"topic": p.topic, "partition": p.partition, "offset": p.offset}
                        for p in offsets
                    ],
                    group=group,
                )
            except RuntimeError as exc:
                raise LabError(str(exc), 503) from exc
            self.store.activity("reset", f"{group} 位移重置到 {position}；业务去重记录保留")
            return {"group": group, "position": position}

    def replay(self, topic, partition, start, limit):
        consumer = Consumer(
            {
                "bootstrap.servers": self.settings.bootstrap_servers,
                "group.id": f"inspect-{uuid.uuid4().hex}",
                "enable.auto.commit": False,
                "enable.auto.offset.store": False,
                "enable.partition.eof": True,
                "allow.auto.create.topics": False,
            }
        )
        try:
            low, high = consumer.get_watermark_offsets(TopicPartition(topic, partition), timeout=5)
            cursor = max(low, start)
            consumer.assign([TopicPartition(topic, partition, cursor)])
            messages = []
            deadline = time.monotonic() + 5
            while len(messages) < limit and cursor < high and time.monotonic() < deadline:
                message = consumer.poll(0.3)
                if message is None:
                    continue
                if message.error():
                    if message.error().code() == KafkaError._PARTITION_EOF:
                        break
                    raise LabError(str(message.error()), 503)
                # 固定本次读取上界，避免读入查询开始后追加的消息。
                if message.offset() >= high:
                    break
                try:
                    value = json.loads(message.value())
                except (ValueError, TypeError):
                    value = message.value().decode(errors="replace") if message.value() else None
                messages.append(
                    {
                        "offset": message.offset(),
                        "partition": partition,
                        "key": message.key().decode(errors="replace") if message.key() else None,
                        "value": value,
                        "timestamp": message.timestamp()[1],
                    }
                )
                cursor = message.offset() + 1
            return {
                "topic": topic,
                "partition": partition,
                "low": low,
                "high": high,
                "next_offset": cursor,
                "messages": messages,
                "truncated_start": start < low,
            }
        finally:
            consumer.close()

    def storage(self):
        rows, unavailable = [], []
        root = Path(self.settings.broker_data_root)
        for broker in (1, 2, 3):
            directory = root / str(broker)
            if not directory.is_dir():
                unavailable.append(broker)
                continue
            for topic in TOPICS:
                for partition_dir in sorted(directory.glob(f"{topic}-*")):
                    for file in sorted(partition_dir.iterdir()):
                        if file.suffix in (".log", ".index", ".timeindex"):
                            try:
                                stat = file.stat()
                            except FileNotFoundError:
                                continue  # segment 清理可能与观察同时发生
                            rows.append(
                                {
                                    "broker": broker,
                                    "partition": partition_dir.name,
                                    "name": file.name,
                                    "bytes": stat.st_size,
                                    "modified_at": stat.st_mtime,
                                }
                            )
        return {"files": rows[:600], "unavailable_brokers": unavailable, "total_files": len(rows)}

    def quorum_status(self):
        def probe(address):
            host, port = address.rsplit(":", 1)
            try:
                with socket.create_connection((host, int(port)), timeout=1.5):
                    return {"address": address, "reachable": True}
            except OSError as exc:
                return {"address": address, "reachable": False, "error": str(exc)}

        with ThreadPoolExecutor(max_workers=3) as pool:
            nodes = list(pool.map(probe, self.settings.controller_hosts.split(",")))
        quorum = read_quorum(Path(self.settings.observations_path))
        quorum["nodes"] = [{"id": 101 + i, **node} for i, node in enumerate(nodes)]
        return quorum

    def collect(self):
        data = {
            "status": "online",
            "brokers": [],
            "topics": [],
            "groups": [],
            "errors": [],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            cluster = self.admin.list_topics(timeout=4)
            data["cluster_id"] = cluster.cluster_id
            data["brokers"] = [
                {"id": b.id, "host": b.host, "port": b.port} for b in cluster.brokers.values()
            ]
            partitions = [
                TopicPartition(name, p)
                for name in TOPICS
                if name in cluster.topics
                for p in cluster.topics[name].partitions
            ]
            ends = (
                self.admin.list_offsets(
                    {p: OffsetSpec.latest() for p in partitions}, request_timeout=4
                )
                if partitions
                else {}
            )
            starts = (
                self.admin.list_offsets(
                    {p: OffsetSpec.earliest() for p in partitions}, request_timeout=4
                )
                if partitions
                else {}
            )
            bounds = {}
            for tp in partitions:
                try:
                    bounds[(tp.topic, tp.partition)] = (
                        starts[tp].result(5).offset,
                        ends[tp].result(5).offset,
                    )
                except Exception as exc:
                    bounds[(tp.topic, tp.partition)] = (None, None)
                    data["errors"].append(f"{tp.topic}/{tp.partition}: {exc}")
            for name in TOPICS:
                topic = cluster.topics.get(name)
                if topic is None:
                    continue
                rows = []
                for p in topic.partitions.values():
                    low, high = bounds.get((name, p.id), (None, None))
                    rows.append(
                        {
                            "id": p.id,
                            "leader": p.leader,
                            "replicas": p.replicas,
                            "isrs": p.isrs,
                            "low": low,
                            "high": high,
                            "error": str(p.error) if p.error else None,
                        }
                    )
                data["topics"].append({"name": name, "partitions": rows})
            try:
                group_rows = call_group_admin(
                    self.settings.bootstrap_servers,
                    "describe",
                    [{"topic": p.topic, "partition": p.partition} for p in partitions],
                )["groups"]
            except RuntimeError as exc:
                group_rows = [
                    {"id": g, "state": "unavailable", "members": [], "error": str(exc)}
                    for g in GROUPS
                ]
            for raw in group_rows:
                row = {**raw, "offsets": [], "lag": None}
                try:
                    if raw.get("error"):
                        raise RuntimeError(raw["error"])
                    commits = {
                        (p["topic"], p["partition"]): p["offset"] for p in row.pop("commits", [])
                    }
                    for tp in partitions:
                        low, high = bounds[(tp.topic, tp.partition)]
                        offset = commits.get((tp.topic, tp.partition), -1)
                        effective = offset if offset >= 0 else low
                        lag = (
                            max(0, high - effective)
                            if high is not None and effective is not None
                            else None
                        )
                        row["offsets"].append(
                            {
                                "topic": tp.topic,
                                "partition": tp.partition,
                                "committed": offset if offset >= 0 else None,
                                "high": high,
                                "lag": lag,
                            }
                        )
                    row["lag"] = (
                        sum(p["lag"] for p in row["offsets"])
                        if all(p["lag"] is not None for p in row["offsets"])
                        else None
                    )
                except Exception as exc:
                    row["error"] = str(exc)
                    row["lag"] = None
                    data["status"] = "degraded"
                    data["errors"].append(f"消费组 {row['id']}: {exc}")
                data["groups"].append(row)
            if len(data["brokers"]) < 3 or any(
                len(p["isrs"]) < len(p["replicas"]) for t in data["topics"] for p in t["partitions"]
            ):
                data["status"] = "degraded"
        except Exception as exc:
            data["status"] = "offline"
            data["errors"].append(str(exc))
        data["quorum"] = self.quorum_status()
        if data["status"] == "online" and (
            data["quorum"].get("stale", True)
            or any(not n["reachable"] for n in data["quorum"]["nodes"])
        ):
            data["status"] = "degraded"
        return data

    def monitor_loop(self):
        while not self.stop_event.is_set():
            try:
                self.snapshot = self.collect()
            except Exception as exc:
                self.snapshot = {**self.snapshot, "status": "error", "errors": [str(exc)]}
            self.stop_event.wait(3)

    def overview(self):
        with self.lock:
            workers = [worker.describe() for worker in self.workers.values()]
        return {**self.snapshot, "workers": workers, **self.store.overview()}
