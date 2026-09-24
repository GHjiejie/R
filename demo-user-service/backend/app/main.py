"""FastAPI 入口：用户服务 API（数据量加大版）。

演示三组接口的对比：
- GET /users/db/{id}           -> 直接查 PostgreSQL，不走缓存
- GET /users/cache-unsafe/{id} -> 缓存未命中且用户不存在时每次回源（无穿透防护）
- GET /users/cache/{id}        -> Cache-Aside + 空值缓存（防穿透）+ TTL 抖动（防雪崩）

缓存雪崩防护：写入缓存时在基础 TTL 上叠加随机扰动，让大量键错峰过期；
另提供 POST /cache/warm-batch?jitter=false 的"统一 TTL"对照模式，
以及 GET /cache/ttl-distribution 观察 TTL 分布差异。

启动时自动向数据库写入种子数据（默认 10000 条），模拟大数据量场景。
"""

import random
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

from . import cache
from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .models import User
from .schemas import UserCreate, UserOut

SEED_COUNT = 10000
_first_names = [
    "伟", "芳", "娜", "敏", "静", "磊", "洋", "勇",
    "杰", "涛", "明", "超", "秀英", "霞", "平", "刚",
]
_last_names = [
    "王", "李", "张", "刘", "陈", "杨", "赵", "黄",
    "周", "吴", "徐", "孙", "胡", "朱", "高", "林",
]


def seed_users(db: Session) -> None:
    """补齐缺失的演示用户，不重写已有数据，并同步 PostgreSQL 自增序列。"""
    # 多个 worker 同时启动时串行执行种子检查，避免重复生成同一批数据。
    db.execute(text("SELECT pg_advisory_xact_lock(72401931)"))
    existing_ids = set(db.scalars(select(User.id).where(User.id <= SEED_COUNT)))

    for start in range(1, SEED_COUNT + 1, 1000):
        rows = [
            {
                "id": user_id,
                "name": random.choice(_last_names) + random.choice(_first_names),
                "email": f"user{user_id}@example.com",
            }
            for user_id in range(start, min(start + 1000, SEED_COUNT + 1))
            if user_id not in existing_ids
        ]
        if rows:
            db.execute(pg_insert(User).values(rows).on_conflict_do_nothing())

    db.execute(
        text(
            "SELECT setval(pg_get_serial_sequence('users', 'id'), "
            "GREATEST(COALESCE((SELECT MAX(id) FROM users), 1), 1), "
            "EXISTS (SELECT 1 FROM users))"
        )
    )
    db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时创建表结构，并补齐默认的 10000 条种子数据。"""
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_users(db)
    yield


app = FastAPI(
    title="User Service - DB vs Redis Cache", version="0.4.0", lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/stats")
def stats(db: Session = Depends(get_db)):
    return {"total_users": db.query(func.count(User.id)).scalar()}


@app.post("/users", response_model=UserOut, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    user = User(name=payload.name, email=payload.email)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="email 已存在")
    db.refresh(user)
    user_dict = {"id": user.id, "name": user.name, "email": user.email}
    # 写库后用真实数据覆盖（可能存在的）空值缓存，保证一致性
    cache.set_cached_user(user.id, user_dict)
    return user_dict


# ---------- 接口一：直接访问数据库 ----------


@app.get("/users/db/{user_id}")
def get_user_from_db(user_id: int, db: Session = Depends(get_db)):
    t0 = time.perf_counter()
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    return {
        "source": "postgresql",
        "elapsed_ms": elapsed_ms,
        "user": {"id": user.id, "name": user.name, "email": user.email},
    }


# ---------- 接口二：缓存，但不做缓存穿透防护（对照组） ----------


@app.get("/users/cache-unsafe/{user_id}")
def get_user_from_cache_unsafe(user_id: int, db: Session = Depends(get_db)):
    t0 = time.perf_counter()

    cached = cache.get_cached_user(user_id)
    if isinstance(cached, dict):
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {"source": "redis (hit)", "elapsed_ms": elapsed_ms, "user": cached}

    # 未命中直接回源；用户不存在时既不写缓存也不拦截，下次请求仍会打库
    user = db.get(User, user_id)
    if not user:
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "source": "postgresql (缓存穿透：未命中且用户不存在，未写空值缓存)",
            "elapsed_ms": elapsed_ms,
            "user": None,
            "db_hit": True,
            "message": "用户不存在，且未做穿透防护，每次请求都会打到数据库",
        }
    user_dict = {"id": user.id, "name": user.name, "email": user.email}
    cache.set_cached_user(user_id, user_dict)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    return {
        "source": "postgresql (cache miss, 已回填)",
        "elapsed_ms": elapsed_ms,
        "user": user_dict,
    }


# ---------- 接口三：缓存 + 空值缓存（防缓存穿透） ----------


@app.get("/users/cache/{user_id}")
def get_user_from_cache(user_id: int, db: Session = Depends(get_db)):
    t0 = time.perf_counter()

    # 1. 先查 Redis
    cached = cache.get_cached_user(user_id)
    if isinstance(cached, dict):
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {"source": "redis (hit)", "elapsed_ms": elapsed_ms, "user": cached}
    if cached == cache.NULL_CACHE_VALUE:
        # 命中空值缓存：已知用户不存在，直接返回，不回源数据库
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "source": "redis (null cache hit, 空值缓存命中)",
            "elapsed_ms": elapsed_ms,
            "user": None,
            "db_hit": False,
            "message": "用户不存在（空值缓存拦截，未访问数据库）",
        }

    # 2. 未命中，回源 PostgreSQL
    user = db.get(User, user_id)
    if not user:
        # 3a. 用户不存在：写入短 TTL 的空值缓存，防止缓存穿透
        cache.set_null_cache(user_id)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "source": "postgresql (用户不存在，已写入空值缓存)",
            "elapsed_ms": elapsed_ms,
            "user": None,
            "db_hit": True,
            "message": f"用户不存在，已写入空值缓存（TTL {cache.settings.NULL_CACHE_TTL}s），后续请求不再打库",
        }
    user_dict = {"id": user.id, "name": user.name, "email": user.email}
    # 3b. 回填缓存
    cache.set_cached_user(user_id, user_dict)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    return {
        "source": "postgresql (cache miss, 已回填)",
        "elapsed_ms": elapsed_ms,
        "user": user_dict,
    }


# ---------- 缓存雪崩演示：批量预热 + TTL 分布 ----------


@app.post("/cache/warm-batch")
def warm_batch(
    start: int = 1, end: int = 200, jitter: bool = True, db: Session = Depends(get_db)
):
    """批量预热 [start, end] 范围内的用户缓存。

    jitter=true（默认）：每个键的 TTL = CACHE_TTL + 随机扰动，错峰过期（防雪崩）。
    jitter=false：所有键使用统一 TTL，同时过期（雪崩对照组，危险！仅演示）。
    """
    if end < start or end - start > 5000:
        raise HTTPException(
            status_code=400, detail="范围不合法：end >= start 且跨度不超过 5000"
        )
    users = db.scalars(
        select(User).where(User.id >= start, User.id <= end).order_by(User.id)
    ).all()
    ttls = cache.set_cached_users(
        [{"id": u.id, "name": u.name, "email": u.email} for u in users],
        jitter=jitter,
    )
    return {
        "warmed": len(users),
        "jitter": jitter,
        "ttl_min": min(ttls) if ttls else None,
        "ttl_max": max(ttls) if ttls else None,
        "note": "jitter=false 时所有键同时过期，是缓存雪崩的典型诱因"
        if not jitter
        else "TTL 已加随机扰动，键将错峰过期",
    }


@app.get("/cache/ttl-distribution")
def ttl_distribution(limit: int = Query(default=2000, ge=1, le=10000)):
    """统计当前 user:* 缓存键的 TTL 分布（每秒一个桶），用于观察雪崩风险。"""
    cursor = 0
    buckets = {}
    scanned = 0
    while True:
        cursor, keys = cache.redis_client.scan(cursor=cursor, match="user:*", count=500)
        keys = keys[: max(limit - scanned, 0)]
        if keys:
            # 用 pipeline 批量取 TTL，避免逐键往返（N+1）
            with cache.redis_client.pipeline() as pipe:
                for k in keys:
                    pipe.ttl(k)
                for ttl in pipe.execute():
                    if ttl > 0:
                        buckets[ttl] = buckets.get(ttl, 0) + 1
        scanned += len(keys)
        if cursor == 0 or scanned >= limit:
            break
    return {
        "total_keys": sum(buckets.values()),
        "ttl_distribution": {str(k): buckets[k] for k in sorted(buckets)},
        "note": "若大量键集中在同一 TTL 桶，它们将同时过期，存在雪崩风险",
    }


@app.delete("/cache/all")
def clear_user_cache():
    """清空所有 user:* 缓存键（演示前后重置用）。"""
    cursor = 0
    deleted = 0
    while True:
        cursor, keys = cache.redis_client.scan(cursor=cursor, match="user:*", count=500)
        if keys:
            deleted += cache.redis_client.delete(*keys)
        if cursor == 0:
            break
    return {"deleted": deleted}


@app.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    db.delete(user)
    db.commit()
    cache.invalidate_user(user_id)
