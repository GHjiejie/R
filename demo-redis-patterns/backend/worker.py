"""延迟任务的异步消费 worker。"""

from __future__ import annotations

import asyncio
from contextlib import suppress

from redis.exceptions import RedisError

from .store import RedisPatternStore, now_iso


class DelayedTaskWorker:
    """轮询到期任务，并用 sleep 模拟业务处理耗时。"""

    def __init__(self, store: RedisPatternStore, poll_interval: float = 0.4) -> None:
        self.store = store
        self.poll_interval = poll_interval
        self.enabled = True
        self._task: asyncio.Task[None] | None = None
        self.last_error: str | None = None
        self.last_tick_at: str | None = None
        self.processed_count = 0

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="delayed-task-worker")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled

    async def run_due_once(self) -> list[dict[str, object]]:
        """手动触发一次扫描，返回本次领取的任务。"""

        return await self._claim_and_process()

    async def _claim_and_process(self) -> list[dict[str, object]]:
        try:
            due_tasks = await asyncio.to_thread(self.store.claim_due_tasks)
            self.last_tick_at = now_iso()
            self.last_error = None
        except RedisError as exc:
            self.last_error = str(exc)
            return []

        for task in due_tasks:
            duration = float(task.get("duration_seconds") or 0)
            if duration > 0:
                await asyncio.sleep(duration)
            try:
                await asyncio.to_thread(
                    self.store.complete_delayed_task,
                    str(task["id"]),
                )
                self.processed_count += 1
            except RedisError as exc:
                self.last_error = str(exc)
        return due_tasks

    async def _run(self) -> None:
        while True:
            if self.enabled:
                await self._claim_and_process()
            await asyncio.sleep(self.poll_interval)
