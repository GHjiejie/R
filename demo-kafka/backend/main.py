"""Kafka Demo 的 FastAPI HTTP 接口。"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from kafka import KafkaConsumer, KafkaProducer
from kafka.errors import KafkaError
from kafka.structs import TopicPartition
from pydantic import BaseModel, Field


BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
TOPIC = os.getenv("KAFKA_TOPIC", "demo-events")
DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]


class MessageCreate(BaseModel):
    """HTTP 请求中的消息内容。"""

    key: str = Field(default="greeting", min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=2000)


class MessageView(BaseModel):
    """返回给前端的 Kafka 消息。"""

    topic: str
    partition: int
    offset: int
    key: Optional[str]
    message: str
    timestamp: Optional[str]


class MessageList(BaseModel):
    topic: str
    messages: list[MessageView]


def _producer() -> KafkaProducer:
    return KafkaProducer(
        bootstrap_servers=BOOTSTRAP_SERVERS,
        key_serializer=lambda value: value.encode("utf-8") if value else None,
        value_serializer=lambda value: value.encode("utf-8"),
        acks="all",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动时创建 Producer，退出时刷新并关闭。"""

    app.state.producer = _producer()
    yield
    app.state.producer.flush()
    app.state.producer.close()


app = FastAPI(
    title="Kafka Demo API",
    description="通过 FastAPI 发送和读取 Kafka 消息的最小示例。",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _kafka_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail=f"Kafka 暂不可用，请确认 Broker 已启动：{exc}",
    )


def _record_to_view(record: Any) -> MessageView:
    timestamp = None
    if record.timestamp is not None and record.timestamp >= 0:
        timestamp = datetime.fromtimestamp(
            record.timestamp / 1000,
            tz=timezone.utc,
        ).isoformat()

    return MessageView(
        topic=record.topic,
        partition=record.partition,
        offset=record.offset,
        key=record.key,
        message=record.value,
        timestamp=timestamp,
    )


def _read_recent_messages(limit: int) -> list[MessageView]:
    """不提交消费者 offset，直接读取 Topic 尾部的最近消息。"""

    consumer = KafkaConsumer(
        bootstrap_servers=BOOTSTRAP_SERVERS,
        enable_auto_commit=False,
        key_deserializer=lambda value: value.decode("utf-8") if value else None,
        value_deserializer=lambda value: value.decode("utf-8"),
        request_timeout_ms=5000,
        consumer_timeout_ms=1000,
    )

    try:
        partitions = consumer.partitions_for_topic(TOPIC)
        if not partitions:
            return []

        topic_partitions = [
            TopicPartition(TOPIC, partition) for partition in sorted(partitions)
        ]
        consumer.assign(topic_partitions)

        beginning_offsets = consumer.beginning_offsets(topic_partitions)
        end_offsets = consumer.end_offsets(topic_partitions)
        for topic_partition in topic_partitions:
            start = max(
                beginning_offsets[topic_partition],
                end_offsets[topic_partition] - limit,
            )
            consumer.seek(topic_partition, start)

        messages: list[MessageView] = []
        while len(messages) < limit:
            records = consumer.poll(timeout_ms=250)
            if not records:
                break

            for partition_records in records.values():
                for record in partition_records:
                    messages.append(_record_to_view(record))
                    if len(messages) >= limit:
                        break
                if len(messages) >= limit:
                    break

        messages.sort(key=lambda item: (item.partition, item.offset), reverse=True)
        return messages[:limit]
    finally:
        consumer.close()


@app.get("/api/health")
def health(request: Request) -> dict[str, Any]:
    """检查 FastAPI 和 Kafka Broker 是否可用。"""

    try:
        partitions = request.app.state.producer.partitions_for(TOPIC)
        if not partitions:
            raise RuntimeError(f"Topic {TOPIC!r} 不存在或暂时没有分区")
    except (KafkaError, RuntimeError) as exc:
        raise _kafka_unavailable(exc) from exc

    return {
        "status": "ok",
        "kafka": "up",
        "topic": TOPIC,
        "partitions": sorted(partitions),
    }


@app.post("/api/messages", response_model=MessageView, status_code=201)
def create_message(payload: MessageCreate, request: Request) -> MessageView:
    """向 Kafka Topic 发送一条消息。"""

    try:
        metadata = request.app.state.producer.send(
            TOPIC,
            key=payload.key,
            value=payload.message,
        ).get(timeout=10)
    except KafkaError as exc:
        raise _kafka_unavailable(exc) from exc

    return MessageView(
        topic=metadata.topic,
        partition=metadata.partition,
        offset=metadata.offset,
        key=payload.key,
        message=payload.message,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/api/messages", response_model=MessageList)
def list_messages(
    limit: int = Query(default=20, ge=1, le=100),
) -> MessageList:
    """读取 Topic 中最近的消息，不改变任何消费者组的 offset。"""

    try:
        messages = _read_recent_messages(limit)
    except KafkaError as exc:
        raise _kafka_unavailable(exc) from exc

    return MessageList(topic=TOPIC, messages=messages)
