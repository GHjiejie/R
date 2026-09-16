"""Redis 缓存客户端与缓存键约定。

缓存键： user:{id}  -> JSON 字符串，TTL = settings.CACHE_TTL
策略：Cache-Aside（读：先缓存后回源；写：先写库再删缓存）
"""
import json
import redis

from .config import settings

redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)


def user_key(user_id: int) -> str:
    return f"user:{user_id}"


def get_cached_user(user_id: int) -> dict | None:
    data = redis_client.get(user_key(user_id))
    return json.loads(data) if data else None


def set_cached_user(user_id: int, user_dict: dict) -> None:
    redis_client.setex(user_key(user_id), settings.CACHE_TTL, json.dumps(user_dict))


def invalidate_user(user_id: int) -> None:
    redis_client.delete(user_key(user_id))
