"""显式开启的真实集群验收；会发送消息、创建/停止消费者、重置分析组位移。"""

import os
import time
import uuid

import httpx
import pytest

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(os.getenv("LAB_INTEGRATION") != "1", reason="需要真实运行的实验集群"),
]
BASE = os.getenv("LAB_API_URL", "http://localhost:8088/api")


def wait_for(predicate, timeout=60):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        result = predicate()
        if result:
            return result
        time.sleep(1)
    raise AssertionError("等待真实集群状态超时")


def test_real_kraft_end_to_end():
    with httpx.Client(base_url=BASE, timeout=40) as client:

        def state():
            r = client.get("/state")
            r.raise_for_status()
            return r.json()

        client.post("/initialize").raise_for_status()
        wait_for(lambda: len(state()["topics"]) == 2)
        cluster = state()
        assert len(cluster["brokers"]) == 3
        assert cluster["quorum"]["leader_id"] in (101, 102, 103)
        assert not cluster["quorum"]["stale"]
        assert all(len(p["replicas"]) == 3 for t in cluster["topics"] for p in t["partitions"])
        for w in cluster["workers"]:
            if w["state"] not in ("stopped", "error"):
                client.delete(f"/consumers/{w['id']}").raise_for_status()
        before = {r["group_id"]: r["unique_events"] for r in state()["results"]}
        key = f"integration-{uuid.uuid4().hex[:8]}"
        result = client.post("/messages", json={"key": key, "count": 12, "partition": 0}).json()
        assert result["acknowledged"] == 12, result
        receipts = result["receipts"]
        assert all(r["partition"] == 0 for r in receipts)
        assert sorted(r["offset"] for r in receipts) == list(
            range(receipts[0]["offset"], receipts[0]["offset"] + 12)
        )
        replay = client.get(
            "/messages/replay",
            params={"topic": "orders", "partition": 0, "start": receipts[0]["offset"], "limit": 12},
        ).json()
        assert [m["key"] for m in replay["messages"]] == [key] * 12
        workers = []
        try:
            for group in ("lab-fulfillment", "lab-analytics"):
                for _ in range(2):
                    response = client.post("/consumers", json={"group": group})
                    response.raise_for_status()
                    workers.append(response.json())

            def caught_up():
                s = state()
                return (
                    len(s["results"]) == 2
                    and all(
                        r["unique_events"] >= before.get(r["group_id"], 0) + 12
                        for r in s["results"]
                    )
                    and all(g["lag"] == 0 and len(g["members"]) == 2 for g in s["groups"])
                )

            wait_for(caught_up)
            blocked = client.post("/offsets/reset", json={"group": "lab-analytics"})
            assert blocked.status_code == 409
            for worker in workers:
                client.delete(f"/consumers/{worker['id']}").raise_for_status()
            results_before = state()["results"]
            client.post("/offsets/reset", json={"group": "lab-analytics"}).raise_for_status()
            response = client.post("/consumers", json={"group": "lab-analytics"})
            response.raise_for_status()
            replay_worker = response.json()
            workers.append(replay_worker)
            wait_for(
                lambda: any(
                    w["id"] == replay_worker["id"] and w["duplicates"] >= 12
                    for w in state()["workers"]
                )
            )
            assert state()["results"] == results_before
            storage = client.get("/storage").json()
            assert not storage["unavailable_brokers"]
            assert {f["name"].split(".")[-1] for f in storage["files"]} >= {
                "log",
                "index",
                "timeindex",
            }
        finally:
            for worker in workers:
                client.delete(f"/consumers/{worker['id']}")
