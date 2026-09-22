"""Redis 三大业务模式 Demo 的 FastAPI 接口。"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from redis.exceptions import RedisError

from .store import RedisPatternStore, now_iso
from .worker import DelayedTaskWorker


DEFAULT_CORS_ORIGINS = "http://localhost:5174,http://127.0.0.1:5174"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]


class ScoreChange(BaseModel):
    player: str = Field(min_length=1, max_length=32)
    score: int = Field(ge=-100_000, le=100_000)


class PriorityJobCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    priority: int = Field(ge=0, le=10)


class DelayedTaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    delay_seconds: float = Field(ge=0, le=3600)
    duration_seconds: float = Field(default=2, ge=0, le=30)


class WorkerToggle(BaseModel):
    enabled: bool


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = RedisPatternStore()
    app.state.store = store
    app.state.startup_error = None

    try:
        store.ensure_demo_data()
    except RedisError as exc:
        # Redis 晚启动时，接口仍可启动；每次请求会返回清晰的 503。
        app.state.startup_error = str(exc)

    worker = DelayedTaskWorker(store)
    app.state.worker = worker
    await worker.start()
    yield
    await worker.stop()


app = FastAPI(
    title="Redis Patterns Demo API",
    description="排行榜、优先级队列与延迟任务的 Redis 可视化实验台。",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_store(request: Request) -> RedisPatternStore:
    return request.app.state.store


def redis_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail=f"Redis 暂不可用，请先执行 make up：{exc}",
    )


def run_redis(action):
    """统一把同步 Redis 调用转换成一致的 HTTP 错误。"""

    try:
        return action()
    except RedisError as exc:
        raise redis_unavailable(exc) from exc


@app.get("/api/health")
def health(request: Request) -> dict[str, Any]:
    store = get_store(request)
    worker: DelayedTaskWorker = request.app.state.worker
    try:
        connected = store.ping()
    except RedisError as exc:
        raise redis_unavailable(exc) from exc

    return {
        "status": "ok" if connected else "degraded",
        "redis": "up" if connected else "down",
        "leaderboard_count": run_redis(store.leaderboard_size),
        "priority_count": run_redis(lambda: store.priority_queue(1)["total"]),
        "delayed": run_redis(store.delayed_task_stats),
        "worker": {
            "enabled": worker.enabled,
            "processed_count": worker.processed_count,
            "last_error": worker.last_error,
            "last_tick_at": worker.last_tick_at,
        },
        "server_time": now_iso(),
    }


@app.get("/api/leaderboard")
def list_leaderboard(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    store = get_store(request)
    return {
        "items": run_redis(lambda: store.leaderboard(limit)),
        "total": run_redis(store.leaderboard_size),
    }


@app.post("/api/leaderboard/score")
def add_leaderboard_score(
    payload: ScoreChange,
    request: Request,
) -> dict[str, Any]:
    return run_redis(
        lambda: get_store(request).add_score(payload.player.strip(), payload.score)
    )


@app.post("/api/leaderboard/reset")
def reset_leaderboard(request: Request) -> dict[str, bool]:
    run_redis(lambda: get_store(request).reset_leaderboard(seed=True))
    return {"ok": True}


@app.get("/api/priority/queue")
def get_priority_queue(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    return run_redis(lambda: get_store(request).priority_queue(limit))


@app.post("/api/priority/jobs", status_code=201)
def create_priority_job(
    payload: PriorityJobCreate,
    request: Request,
) -> dict[str, Any]:
    return run_redis(
        lambda: get_store(request).enqueue_priority_job(
            payload.name.strip(),
            payload.priority,
        )
    )


@app.post("/api/priority/consume")
def consume_priority_job(request: Request) -> dict[str, Any]:
    job = run_redis(get_store(request).consume_priority_job)
    if job is None:
        raise HTTPException(status_code=404, detail="优先级队列为空")
    return job


@app.post("/api/priority/reset")
def reset_priority_queue(request: Request) -> dict[str, bool]:
    run_redis(lambda: get_store(request).reset_priority_queue(seed=True))
    return {"ok": True}


@app.get("/api/delayed/tasks")
def list_delayed_tasks(request: Request) -> dict[str, Any]:
    store = get_store(request)
    return {
        "items": run_redis(store.list_delayed_tasks),
        "stats": run_redis(store.delayed_task_stats),
    }


@app.post("/api/delayed/tasks", status_code=201)
def create_delayed_task(
    payload: DelayedTaskCreate,
    request: Request,
) -> dict[str, Any]:
    return run_redis(
        lambda: get_store(request).enqueue_delayed_task(
            payload.name.strip(),
            payload.delay_seconds,
            payload.duration_seconds,
        )
    )


@app.post("/api/delayed/run-due")
async def run_due_tasks(request: Request) -> dict[str, Any]:
    worker: DelayedTaskWorker = request.app.state.worker
    try:
        due_tasks = await worker.run_due_once()
    except RedisError as exc:
        raise redis_unavailable(exc) from exc
    return {"claimed": len(due_tasks), "items": due_tasks}


@app.post("/api/delayed/worker")
def toggle_worker(
    payload: WorkerToggle,
    request: Request,
) -> dict[str, Any]:
    worker: DelayedTaskWorker = request.app.state.worker
    worker.set_enabled(payload.enabled)
    return {"enabled": worker.enabled}


@app.post("/api/delayed/reset")
def reset_delayed_tasks(request: Request) -> dict[str, bool]:
    run_redis(get_store(request).reset_delayed_tasks)
    return {"ok": True}
