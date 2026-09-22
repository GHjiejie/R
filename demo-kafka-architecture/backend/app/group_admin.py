"""隔离 coordinator-targeted Admin API，避免 native abort 终止 Web 进程。

仅接受服务端构造的 JSON，不使用 shell，不接受用户指定的可执行程序。
"""

import json
import subprocess
import sys


def call_group_admin(bootstrap, operation, partitions, group=None):
    payload = {
        "bootstrap": bootstrap,
        "operation": operation,
        "partitions": partitions,
        "group": group,
    }
    try:
        result = subprocess.run(
            [sys.executable, "-m", "app.group_admin"],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("消费组查询超时，稍后重新采样") from exc
    if result.returncode:
        raise RuntimeError(f"消费组管理子进程异常退出 ({result.returncode})；API 仍可用")
    response = json.loads(result.stdout)
    if "error" in response:
        raise RuntimeError(response["error"])
    return response


def execute(payload):
    # Kafka 客户端只在子进程内初始化，不能复用父进程中的线程 / 句柄。
    from confluent_kafka import ConsumerGroupTopicPartitions, TopicPartition
    from confluent_kafka.admin import AdminClient

    from .config import GROUPS

    admin = AdminClient({"bootstrap.servers": payload["bootstrap"], "socket.timeout.ms": 4000})
    partitions = [
        TopicPartition(p["topic"], p["partition"], p.get("offset", -1001))
        for p in payload["partitions"]
    ]
    if payload["operation"] == "reset":
        group = payload["group"]
        if group not in GROUPS:
            raise ValueError("未知消费组")
        desc = admin.describe_consumer_groups([group], request_timeout=3)[group].result(4)
        if desc.members:
            raise ValueError("Kafka 中仍有活跃成员，请等待退组完成")
        admin.alter_consumer_group_offsets(
            [ConsumerGroupTopicPartitions(group, partitions)], request_timeout=3
        )[group].result(4)
        return {"ok": True}
    if payload["operation"] != "describe":
        raise ValueError("未知操作")
    descriptions = admin.describe_consumer_groups(list(GROUPS), request_timeout=3)
    commits = (
        {
            g: admin.list_consumer_group_offsets(
                [ConsumerGroupTopicPartitions(g, partitions)], request_timeout=3
            )[g]
            for g in GROUPS
        }
        if partitions
        else {}
    )
    rows = []
    for group in GROUPS:
        row = {"id": group, "state": "unavailable", "members": [], "commits": []}
        try:
            desc = descriptions[group].result(4)
            row["state"] = str(desc.state).split(".")[-1].lower()
            row["members"] = [
                {
                    "id": m.member_id,
                    "client_id": m.client_id,
                    "partitions": [
                        {"topic": p.topic, "partition": p.partition}
                        for p in m.assignment.topic_partitions
                    ],
                }
                for m in desc.members
            ]
            committed = commits[group].result(4) if partitions else None
            row["commits"] = (
                [
                    {"topic": p.topic, "partition": p.partition, "offset": p.offset}
                    for p in committed.topic_partitions
                ]
                if committed
                else []
            )
        except Exception as exc:
            row["error"] = str(exc)
        rows.append(row)
    return {"groups": rows}


if __name__ == "__main__":
    try:
        response = execute(json.load(sys.stdin))
    except Exception as exc:
        response = {"error": str(exc)}
    print(json.dumps(response))
