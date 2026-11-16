"""查看演示状态，并通过 HTTP 原子释放当前服务持有的锁。"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from typing import Any

import redis
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


DATA_TTL_SECONDS = 300
TERMINAL_STATES = {
    "released",
    "skipped",
    "timed_out",
    "lock_lost",
    "cancelled",
    "failed",
}

MANUAL_RELEASE_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if not current then return -2 end
if current ~= ARGV[1] then return 0 end
if redis.call('HGET', KEYS[2], 'token') ~= ARGV[1] then return 0 end
if redis.call('HGET', KEYS[2], 'status') ~= 'awaiting_release' then return -1 end
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[2], 'status', 'released', 'release_source', 'api')
redis.call('HINCRBY', KEYS[3], 'released', 1)
redis.call('HINCRBY', KEYS[3], 'manual_released', 1)
redis.call('EXPIRE', KEYS[2], ARGV[2])
redis.call('EXPIRE', KEYS[3], ARGV[2])
return 1
"""


class ReleaseRequest(BaseModel):
    token: str = Field(
        min_length=1,
        max_length=256,
        description="从 GET /status 的 lock.token 复制，标识本次要释放的锁",
    )


def get_data_keys(key_prefix: str, service_names: list[str]) -> list[str]:
    """锁有独立的租约 TTL，不能被演示数据的保活操作延长。"""
    return [
        f"{key_prefix}:resource",
        f"{key_prefix}:active",
        f"{key_prefix}:result",
        *(f"{key_prefix}:service:{name}" for name in service_names),
    ]


def create_app(
    client: redis.Redis,
    key_prefix: str,
    service_names: list[str],
) -> FastAPI:
    lock_key = f"{key_prefix}:lock"
    result_key = f"{key_prefix}:result"

    def refresh_data() -> None:
        with client.pipeline() as pipe:
            for key in get_data_keys(key_prefix, service_names):
                pipe.expire(key, DATA_TTL_SECONDS)
            pipe.execute()

    async def keep_data_alive() -> None:
        while True:
            await asyncio.sleep(30)
            try:
                await asyncio.to_thread(refresh_data)
            except redis.RedisError:
                # 不补写丢失的数据，也不修改锁；恢复连接后继续保活现有数据。
                continue

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = asyncio.create_task(keep_data_alive())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    app = FastAPI(
        title="Redis 分布式锁：人工释放 Demo",
        description="先查看状态，再提交当前 token 释放锁，让下一个服务继续竞争。",
        lifespan=lifespan,
    )

    @app.exception_handler(redis.RedisError)
    async def redis_error_handler(request: Request, exc: redis.RedisError):
        return JSONResponse(
            status_code=503, content={"detail": "Redis 暂不可用，请稍后重试"}
        )

    @app.get("/health", summary="检查 API 与 Redis")
    def health() -> dict[str, str]:
        client.ping()
        return {"status": "ok"}

    @app.get("/status", summary="查看锁、共享资源和各服务状态")
    def status() -> dict[str, Any]:
        # 使用事务型 pipeline 读取一致的快照，避免混合释放前后的状态。
        with client.pipeline() as pipe:
            pipe.get(lock_key)
            pipe.pttl(lock_key)
            pipe.get(f"{key_prefix}:resource")
            pipe.get(f"{key_prefix}:active")
            pipe.hgetall(result_key)
            for name in service_names:
                pipe.hgetall(f"{key_prefix}:service:{name}")
            values = pipe.execute()
        token, ttl_ms, resource, active, result, *service_states = values
        stats = {key: int(value) for key, value in result.items()}
        services = [
            {"name": name, **state}
            for name, state in zip(service_names, service_states)
        ]
        owner = next((s for s in services if token and s.get("token") == token), None)
        return {
            "run_id": key_prefix.rsplit(":", 1)[-1],
            "key_prefix": key_prefix,
            "lock": {
                "key": lock_key,
                "held": token is not None,
                "owner": owner["name"] if owner else None,
                "token": token,
                "ttl_ms": ttl_ms,
                "release_ready": bool(
                    owner and owner.get("status") == "awaiting_release"
                ),
            },
            "shared_resource": {
                "key": f"{key_prefix}:resource",
                "value": int(resource) if resource is not None else None,
                "expected_value": stats.get("completed", 0),
            },
            "active_operations": int(active or 0),
            "stats": stats,
            "services": services,
            "finished": all(s.get("status") in TERMINAL_STATES for s in services),
        }

    @app.post("/lock/release", summary="人工释放指定 token 对应的锁")
    def release_lock(body: ReleaseRequest) -> dict[str, Any]:
        snapshot = status()
        owner = next(
            (
                service
                for service in snapshot["services"]
                if service.get("token") == body.token
            ),
            None,
        )
        if owner is None:
            raise HTTPException(
                status_code=409, detail="token 不匹配，请重新查看 /status"
            )

        # 所有权、业务完成状态和删除都在同一个 Lua 脚本中检查与执行。
        released = int(
            client.eval(
                MANUAL_RELEASE_SCRIPT,
                3,
                lock_key,
                f"{key_prefix}:service:{owner['name']}",
                result_key,
                body.token,
                DATA_TTL_SECONDS,
            )
        )
        if released == -2:
            raise HTTPException(status_code=404, detail="当前没有锁，无需释放")
        if released == -1:
            raise HTTPException(
                status_code=409,
                detail="服务仍在处理共享资源，请等待 release_ready=true",
            )
        if released == 0:
            raise HTTPException(
                status_code=409, detail="锁已变更，请重新查看 /status 并使用新的 token"
            )

        print(
            f"人工通过接口释放了 {owner['name']} 的锁，其他等待服务可以继续竞争",
            flush=True,
        )
        return {"released": True, "service": owner["name"], "token": body.token}

    return app
