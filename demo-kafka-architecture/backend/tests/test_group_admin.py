import subprocess

import pytest

from app.group_admin import call_group_admin


def test_native_abort_is_reported_without_killing_caller(monkeypatch):
    def aborted(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], -6, stdout="", stderr="native assertion")

    monkeypatch.setattr(subprocess, "run", aborted)
    with pytest.raises(RuntimeError, match="API 仍可用"):
        call_group_admin("localhost:19092", "describe", [])


def test_hung_group_probe_has_a_bounded_timeout(monkeypatch):
    def hung(*args, **kwargs):
        assert kwargs["timeout"] <= 12
        raise subprocess.TimeoutExpired(args[0], kwargs["timeout"])

    monkeypatch.setattr(subprocess, "run", hung)
    with pytest.raises(RuntimeError, match="超时"):
        call_group_admin("localhost:19092", "describe", [])
