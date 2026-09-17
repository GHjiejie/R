"""Redis 缓存客户端与缓存键约定。

缓存键： user:{id}  -> JSON 字符串，TTL = settings.CACHE_TTL
策略：Cache-Aside（读：先缓存后回源；写：先写库再删缓存）

缓存穿透防护：空值缓存（Cache Null）
- 用户不存在时，写入特殊占位值 NULL_CACHE_VALUE，TTL 取较短的
  NULL_CACHE_TTL，避免恶意请求不存在的 ID 反复打穿缓存直达数据库。
"""
import json

import redis

from .config import settings

redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

# 空值占位符：用户不存在时写入缓存的标记
NULL_CACHE_VALUE = "__NULL__"


def user_key(user_id: int) -> str:
    return f"user:{user_id}"


def get_cached_user(user_id: int) -> dict | None | str:
    """读取缓存。

    返回值含义：
    - dict              : 正常缓存命中
    - NULL_CACHE_VALUE  : 命中空值缓存（已知该用户不存在）
    - None              : 缓存未命中，需要回源数据库
    """
    data = redis_client.get(user_key(user_id))
    if data is None:
        return None
    if data == NULL_CACHE_VALUE:
        return NULL_CACHE_VALUE
    return json.loads(data)


def set_cached_user(user_id: int, user_dict: dict) -> None:
    redis_client.setex(user_key(user_id), settings.CACHE_TTL, json.dumps(user_dict))


def set_null_cache(user_id: int) -> None:
    """写入空值缓存（防缓存穿透），TTL 较短。"""
    redis_client.setex(user_key(user_id), settings.NULL_CACHE_TTL, NULL_CACHE_VALUE)


def invalidate_user(user_id: int) -> None:
    redis_client.delete(user_key(user_id))
