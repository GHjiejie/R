import os
import time

from app.quorum import parse_replication, parse_status, read_quorum


def test_real_cli_output_with_controller_and_broker_observer():
    raw = "ClusterId: abc\nLeaderId: 103\nLeaderEpoch: 4\nHighWatermark: 98\nMaxFollowerLag: 0\n"
    assert parse_status(raw)["leader_id"] == 103
    rows = parse_replication(
        "NodeId DirectoryId LogEndOffset Lag LastFetchTimestamp LastCaughtUpTimestamp Status\n"
        "103 AAAAA 98 0 123 123 Leader\n1 BBBBB 97 1 122 121 Observer\n"
    )
    assert rows[1]["Status"] == "Observer"
    assert rows[0]["LogEndOffset"] == "98"


def test_missing_and_expired_samples_are_not_healthy(tmp_path):
    assert read_quorum(tmp_path)["stale"]
    file = tmp_path / "status.txt"
    file.write_text("LeaderId: 101\nLeaderEpoch: 3\n")
    assert not read_quorum(tmp_path)["stale"]
    old = time.time() - 60
    os.utime(file, (old, old))
    assert read_quorum(tmp_path)["stale"]


def test_invalid_cli_output_never_invents_leader(tmp_path):
    (tmp_path / "status.txt").write_text("command timed out")
    assert read_quorum(tmp_path)["leader_id"] is None
    assert read_quorum(tmp_path)["stale"]


def test_no_elected_leader_is_not_displayed_as_active(tmp_path):
    (tmp_path / "status.txt").write_text("LeaderId: -1\nLeaderEpoch: 5\n")
    assert read_quorum(tmp_path)["leader_id"] is None
    assert read_quorum(tmp_path)["stale"]
