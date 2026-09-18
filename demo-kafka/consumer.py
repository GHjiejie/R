"""Kafka 最小消费者 Demo：读取一条消息并打印。"""

from __future__ import annotations

import argparse
import os

from kafka import KafkaConsumer
from kafka.errors import KafkaError


DEFAULT_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
DEFAULT_TOPIC = os.getenv("KAFKA_TOPIC", "demo-events")
DEFAULT_GROUP = os.getenv("KAFKA_CONSUMER_GROUP", "demo-kafka-consumer")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Kafka 最小消费者 Demo")
    parser.add_argument(
        "--bootstrap-servers",
        default=DEFAULT_BOOTSTRAP_SERVERS,
        help="Kafka Broker 地址，默认读取 KAFKA_BOOTSTRAP_SERVERS 或 localhost:9092",
    )
    parser.add_argument(
        "--topic",
        default=DEFAULT_TOPIC,
        help="要订阅的 Topic，默认读取 KAFKA_TOPIC 或 demo-events",
    )
    parser.add_argument(
        "--group",
        default=DEFAULT_GROUP,
        help="消费者组名称，默认读取 KAFKA_CONSUMER_GROUP 或 demo-kafka-consumer",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=30,
        help="等待消息的最长时间，默认 30 秒",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.timeout_seconds <= 0:
        raise SystemExit("--timeout-seconds 必须大于 0")

    try:
        consumer = KafkaConsumer(
            args.topic,
            bootstrap_servers=args.bootstrap_servers,
            group_id=args.group,
            auto_offset_reset="earliest",
            enable_auto_commit=False,
            key_deserializer=lambda value: value.decode("utf-8") if value else None,
            value_deserializer=lambda value: value.decode("utf-8"),
            consumer_timeout_ms=int(args.timeout_seconds * 1000),
        )
    except KafkaError as exc:
        raise SystemExit(f"连接失败，请确认 Kafka 已启动：{exc}") from exc

    received = 0
    try:
        for record in consumer:
            print("收到消息")
            print(f"topic={record.topic}")
            print(f"partition={record.partition}")
            print(f"offset={record.offset}")
            print(f"key={record.key}")
            print(f"value={record.value}")

            # 手动提交 offset，便于观察“消息处理完成后再确认”的基本思路。
            consumer.commit()
            received += 1
            break
    finally:
        consumer.close()

    if received == 0:
        raise SystemExit(
            f"{args.timeout_seconds:g} 秒内没有读到消息；"
            "请先启动消费者，再运行 producer.py。"
        )


if __name__ == "__main__":
    main()
