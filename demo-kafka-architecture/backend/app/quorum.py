import time
from pathlib import Path


def parse_status(raw: str) -> dict:
    fields = dict(line.split(":", 1) for line in raw.splitlines() if ":" in line)
    result = {"raw": raw}
    for source, dest in (
        ("LeaderId", "leader_id"),
        ("LeaderEpoch", "leader_epoch"),
        ("HighWatermark", "high_watermark"),
        ("MaxFollowerLag", "max_follower_lag"),
    ):
        try:
            result[dest] = int(fields[source].strip())
        except (KeyError, ValueError):
            result[dest] = None
    result["cluster_id"] = fields.get("ClusterId", "").strip()
    if result["leader_id"] is not None and result["leader_id"] < 0:
        result["leader_id"] = None
    return result


def parse_replication(raw: str) -> list:
    lines = [line.split() for line in raw.splitlines() if line.strip()]
    header = next((i for i, row in enumerate(lines) if row[0] == "NodeId"), None)
    if header is None:
        return []
    return [
        dict(zip(lines[header], row))
        for row in lines[header + 1 :]
        if row[0].isdigit() and len(row) == len(lines[header])
    ]


def read_quorum(path: Path) -> dict:
    try:
        status_file = path / "status.txt"
        age = max(0, time.time() - status_file.stat().st_mtime)
        data = parse_status(status_file.read_text())
        data.update(age_seconds=round(age, 1), stale=age > 30 or data["leader_id"] is None)
        replication = path / "replication.txt"
        data["replication"] = (
            parse_replication(replication.read_text()) if replication.exists() else []
        )
        data["replication_age_seconds"] = (
            round(time.time() - replication.stat().st_mtime, 1) if replication.exists() else None
        )
        return data
    except OSError:
        return {
            "stale": True,
            "nodes": [],
            "replication": [],
            "error": "等待 quorum-observer 采集真实元数据；不会以模拟值替代",
        }
