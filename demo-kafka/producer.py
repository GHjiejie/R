"""Kafka 最小生产者 Demo：向一个 Topic 发送一条文本消息。"""

from __future__ import annotations

import argparse
import os
import uuid

from kafka import KafkaProducer
from kafka.errors import KafkaError


DEFAULT_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
DEFAULT_TOPIC = os.getenv("KAFKA_TOPIC", "demo-events")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Kafka 最小生产者 Demo")
    parser.add_argument(
        "--bootstrap-servers",
        default=DEFAULT_BOOTSTRAP_SERVERS,
        help="Kafka Broker 地址，默认读取 KAFKA_BOOTSTRAP_SERVERS 或 localhost:9092",
    )
    parser.add_argument(
        "--topic",
        default=DEFAULT_TOPIC,
        help="目标 Topic，默认读取 KAFKA_TOPIC 或 demo-events",
    )
    parser.add_argument(
        "--message",
        default=None,
        help="要发送的消息；不传时自动生成一条带唯一标识的消息",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    message = args.message or f"hello kafka ({uuid.uuid4().hex[:8]})"

    producer = KafkaProducer(
        bootstrap_servers=args.bootstrap_servers,
        key_serializer=lambda value: value.encode("utf-8"),
        value_serializer=lambda value: value.encode("utf-8"),
        acks="all",
    )

    try:
        try:
            metadata = producer.send(
                args.topic,
                key="greeting",
                value=message,
            ).get(timeout=10)
        except KafkaError as exc:
            raise SystemExit(f"发送失败，请确认 Kafka 已启动：{exc}") from exc

        print("消息发送成功")
        print(f"topic={metadata.topic}")
        print(f"partition={metadata.partition}")
        print(f"offset={metadata.offset}")
        print("key=greeting")
        print(f"value={message}")
    finally:
        producer.flush()
        producer.close()


if __name__ == "__main__":
    main()
