"""FastAPI 入口：用户服务 API（数据量加大版）。

演示三组接口的对比：
- GET /users/db/{id}           -> 直接查 PostgreSQL，不走缓存
- GET /users/cache-unsafe/{id} -> 缓存未命中且用户不存在时每次回源（无穿透防护）
- GET /users/cache/{id}        -> Cache-Aside + 空值缓存（防缓存穿透）

启动时自动向数据库写入种子数据（默认 10000 条），模拟大数据量场景。
"""

import random
import time

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import cache
from .database import Base, engine, get_db
from .models import User
from .schemas import UserCreate, UserOut

Base.metadata.create_all(bind=engine)

app = FastAPI(title="User Service - DB vs Redis Cache", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SEED_COUNT = 10000
_first_names = [
    "伟",
    "芳",
    "娜",
    "敏",
    "静",
    "磊",
    "洋",
    "勇",
    "杰",
    "涛",
    "明",
    "超",
    "秀英",
    "霞",
    "平",
    "刚",
]
_last_names = [
    "王",
    "李",
    "张",
    "刘",
    "陈",
    "杨",
    "赵",
    "黄",
    "周",
    "吴",
    "徐",
    "孙",
    "胡",
    "朱",
    "高",
    "林",
]


@app.on_event("startup")
def seed_data():
    """启动时若表为空则批量插入种子数据。"""
    db = next(get_db())
    try:
        count = db.query(func.count(User.id)).scalar()
        if count and count >= SEED_COUNT:
            return
        batch = []
        for i in range(1, SEED_COUNT + 1):
            batch.append(
                User(
                    name=random.choice(_last_names) + random.choice(_first_names),
                    email=f"user{i}@example.com",
                )
            )
            if i % 1000 == 0:
                db.bulk_save_objects(batch)
                db.commit()
                batch = []
        if batch:
            db.bulk_save_objects(batch)
            db.commit()
    finally:
        db.close()


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
def get_user_from_db(user_id: int):
    t0 = time.perf_counter()
    db = next(get_db())
    try:
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "source": "postgresql",
            "elapsed_ms": elapsed_ms,
            "user": {"id": user.id, "name": user.name, "email": user.email},
        }
    finally:
        db.close()


# ---------- 接口二：缓存，但不做缓存穿透防护（对照组） ----------


@app.get("/users/cache-unsafe/{user_id}")
def get_user_from_cache_unsafe(user_id: int):
    t0 = time.perf_counter()

    cached = cache.get_cached_user(user_id)
    if isinstance(cached, dict):
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {"source": "redis (hit)", "elapsed_ms": elapsed_ms, "user": cached}

    # 未命中直接回源；用户不存在时既不写缓存也不拦截，下次请求仍会打库
    db = next(get_db())
    try:
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
    finally:
        db.close()


# ---------- 接口三：缓存 + 空值缓存（防缓存穿透） ----------


@app.get("/users/cache/{user_id}")
def get_user_from_cache(user_id: int):
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
    db = next(get_db())
    try:
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
    finally:
        db.close()


@app.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    db.delete(user)
    db.commit()
    cache.invalidate_user(user_id)
