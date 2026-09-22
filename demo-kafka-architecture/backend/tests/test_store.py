from concurrent.futures import ThreadPoolExecutor

import pytest

from app.store import Store


def test_idempotency_survives_restart_and_is_scoped_to_group(tmp_path):
    path = str(tmp_path / "lab.db")
    store = Store(path)
    event = {"event_id": "e-1", "amount_minor": 120}
    assert store.process("g1", "c1", "orders", 0, 0, event)
    assert not Store(path).process("g1", "c2", "orders", 0, 0, event)
    assert store.process("g2", "c3", "orders", 0, 0, event)
    results = store.overview()
    assert [r["unique_events"] for r in results["results"]] == [1, 1]
    assert [r["amount_minor"] for r in results["results"]] == [120, 120]
    assert sum(a["duplicate"] for a in results["attempts"]) == 1


def test_concurrent_duplicate_delivery_only_creates_one_result(tmp_path):
    store = Store(str(tmp_path / "lab.db"))
    event = {"event_id": "race", "amount_minor": 350}
    with ThreadPoolExecutor(max_workers=8) as pool:
        inserted = list(
            pool.map(lambda n: store.process("g", f"c{n}", "orders", 0, 1, event), range(20))
        )
    assert sum(inserted) == 1
    result = store.overview()
    assert result["results"][0]["amount_minor"] == 350
    assert len(result["attempts"]) == 20


def test_failed_business_write_does_not_record_delivery(tmp_path):
    store = Store(str(tmp_path / "lab.db"))
    with pytest.raises(KeyError):
        store.process("g", "c", "orders", 0, 0, {"event_id": "invalid"})
    assert store.overview()["results"] == []
    assert store.overview()["attempts"] == []
