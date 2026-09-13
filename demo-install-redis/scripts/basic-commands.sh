#!/usr/bin/env bash

set -euo pipefail

compose=(docker compose -f "$(dirname "$0")/../docker-compose.yml")
redis_cli=("${compose[@]}" exec -T redis redis-cli)
prefix="demo:install"

echo "== 检查 Redis 连接 =="
"${redis_cli[@]}" ping

echo
echo "== String：设置、读取和自增 =="
"${redis_cli[@]}" set "$prefix:name" "redis-demo"
printf "name = "
"${redis_cli[@]}" get "$prefix:name"
"${redis_cli[@]}" set "$prefix:visits" 1
"${redis_cli[@]}" incr "$prefix:visits"
printf "visits = "
"${redis_cli[@]}" get "$prefix:visits"

echo
echo "== List：从两端写入并读取 =="
"${redis_cli[@]}" del "$prefix:tasks" >/dev/null
"${redis_cli[@]}" rpush "$prefix:tasks" "read" "practice"
"${redis_cli[@]}" lpush "$prefix:tasks" "install"
printf "tasks = "
"${redis_cli[@]}" lrange "$prefix:tasks" 0 -1

echo
echo "== Hash：保存一组字段 =="
"${redis_cli[@]}" hset "$prefix:user" name "Alice" level beginner
printf "user = "
"${redis_cli[@]}" hgetall "$prefix:user"

echo
echo "== Set：保存不重复的标签 =="
"${redis_cli[@]}" sadd "$prefix:tags" redis database redis
printf "tags = "
"${redis_cli[@]}" smembers "$prefix:tags"

echo
echo "== 过期时间 =="
"${redis_cli[@]}" setex "$prefix:temporary" 60 "60 秒后过期"
printf "ttl(temporary) = "
"${redis_cli[@]}" ttl "$prefix:temporary"

echo
echo "== 本 demo 创建的 key =="
"${redis_cli[@]}" keys "$prefix:*"
