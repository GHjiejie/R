"""真实故障验收：只作用于当前 Compose 项目的节点，finally 恢复节点。

用法：在项目目录执行 python3 scripts/verify_faults.py。
需要先 make up 并初始化 Topic；执行期间不要同时手动启停节点。
"""
import json
import subprocess
import time
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://localhost:8088/api"


def api(path, data=None):
    req = Request(BASE + path, data=json.dumps(data).encode() if data is not None else None,
                  headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=40) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def state():
    status, result = api("/state")
    assert status == 200, result
    return result


def partition(s):
    return next(t for t in s["topics"] if t["name"] == "orders")["partitions"][0]


def wait_for(predicate, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate(state())
        if result:
            return result
        time.sleep(1)
    raise AssertionError("集群未在限定时间内达到预期状态")


def compose(*args):
    subprocess.run(["docker", "compose", *args], cwd=ROOT, check=True, timeout=100)


def report(name, **data):
    print(json.dumps({"check": name, **data}, ensure_ascii=False), flush=True)


def main():
    assert api("/initialize", {})[0] == 200
    wait_for(lambda s: len(s["topics"]) == 2 and s["status"] == "online")
    stopped = set()
    try:
        before = state()["quorum"]
        controller = f"controller-{before['leader_id'] - 100}"
        stopped.add(controller)
        compose("stop", controller)
        after = wait_for(lambda s: s["quorum"] if not s["quorum"]["stale"]
                         and s["quorum"].get("leader_id") != before["leader_id"] else None)
        assert after["leader_epoch"] > before["leader_epoch"]
        report("active-controller-failover", before=before["leader_id"],
               after=after["leader_id"], epoch=after["leader_epoch"])
        compose("start", controller)
        stopped.remove(controller)
        wait_for(lambda s: all(n["reachable"] for n in s["quorum"]["nodes"]))

        old_leader = partition(state())["leader"]
        broker = f"broker-{old_leader}"
        stopped.add(broker)
        compose("stop", broker)
        changed = wait_for(lambda s: partition(s) if partition(s)["leader"] != old_leader
                           and partition(s)["leader"] > 0 and len(partition(s)["isrs"]) == 2 else None)
        status, produced = api("/messages", {"partition": 0, "count": 3, "key": "single-failure"})
        assert status == 200 and produced["acknowledged"] == 3, produced
        report("broker-leader-failover", before=old_leader, after=changed["leader"],
               isr=changed["isrs"], acknowledged=produced["acknowledged"])

        second = next(i for i in (1, 2, 3) if i != old_leader and i != changed["leader"])
        stopped.add(f"broker-{second}")
        compose("stop", f"broker-{second}")
        wait_for(lambda s: len(partition(s)["isrs"]) == 1)
        status, rejected = api("/messages", {"partition": 0, "count": 1, "key": "two-failures"})
        assert status >= 500 or (rejected["acknowledged"] == 0 and rejected["failed"] > 0), rejected
        report("min-isr-protection", http_status=status, result=rejected)
    finally:
        if stopped:
            compose("start", *sorted(stopped))
        wait_for(lambda s: len(s["brokers"]) == 3 and all(n["reachable"] for n in s["quorum"]["nodes"])
                 and all(len(p["isrs"]) == 3 for t in s["topics"] for p in t["partitions"]), timeout=120)
        report("all-nodes-restored", brokers=len(state()["brokers"]))

    # 同时重启数据层，验证命名卷中已经确认的业务消息仍然存在。
    status, produced = api("/messages", {"partition": 0, "count": 1, "key": "persistence-check"})
    assert status == 200 and produced["acknowledged"] == 1
    offset = produced["receipts"][0]["offset"]
    compose("restart", "broker-1", "broker-2", "broker-3")
    restarted_at = time.time()
    wait_for(lambda s: datetime.fromisoformat(s["updated_at"]).timestamp() > restarted_at
             and len(s["brokers"]) == 3 and len(partition(s)["isrs"]) == 3)
    status, replayed = api(f"/messages/replay?topic=orders&partition=0&start={offset}&limit=1")
    assert status == 200 and replayed["messages"][0]["key"] == "persistence-check", replayed
    report("broker-restart-persistence", offset=offset, recovered=True)


if __name__ == "__main__":
    main()
