# Redis String 基础 Demo

## Demo 目的

使用 Python 的 `redis-py` 客户端，直观演示 Redis 最常用的数据结构 String：
字符串读写、字符串修改、整数计数、批量读写、条件写入和过期时间。

## 涉及的 Redis 知识点

- `SET`、`GET`、`TYPE`：保存、读取并查看 String 类型
- `APPEND`、`STRLEN`、`GETRANGE`：追加内容、获取长度和截取字符串
- `INCRBY`、`DECRBY`：对整数值执行原子计数
- `MSET`、`MGET`：一次写入或读取多个 key
- `SET ... NX`：仅当 key 不存在时写入，适合实现简单的“只创建一次”逻辑
- `SET ... EX`、`TTL`：设置过期时间并查看剩余秒数
- key 命名空间：所有示例 key 都使用 `demo:string:` 前缀，避免污染其他学习数据

## 目录或关键文件说明

```text
demo1/
├── redis_string.py  # Python Demo 入口
└── README.md  # 使用说明
```

项目根目录的 `pyproject.toml` 和 `uv.lock` 提供 Python 运行环境及 `redis-py` 依赖。

## 运行前置条件

- 已安装并启动 Docker Desktop（或 Docker Engine + Compose v2）。
- 已安装 `uv`；也可以把命令中的 `uv run` 替换为已经安装 `redis-py` 的 Python 环境。
- Redis 服务已在本机 `6379` 端口监听。

推荐使用仓库内的安装 Demo 启动 Redis：

```bash
cd demo-install-redis
docker compose up -d redis
cd ..
```

启动前可以检查连通性：

```bash
docker compose -f demo-install-redis/docker-compose.yml exec redis redis-cli ping
# PONG
```

## 启动或运行方式

在项目根目录执行：

```bash
uv run python demo1/redis_string.py
```

默认连接 `redis://localhost:6379/0`。如果 Redis 使用了其他地址，可以通过 `REDIS_URL` 覆盖：

```bash
REDIS_URL=redis://localhost:6380/0 uv run python demo1/redis_string.py
```

程序启动时先执行 `PING`，随后依次运行 5 组操作。脚本开始时会删除自己上次留下的示例 key，因此可以重复运行；不会删除其他命名空间的数据。

## 预期输出或可观察现象

输出大致如下（`TTL` 会因执行耗时而小于 30）：

```text
PING -> PONG

== 1. SET / GET：保存和读取字符串（String） ==
GET demo:string:message -> 'hello'
TYPE demo:string:message -> string

== 2. APPEND / STRLEN / GETRANGE：修改和查看字符串 ==
APPEND 后 -> 'hello Redis'
STRLEN -> 11
GETRANGE(0, 4) -> 'hello'

== 3. INCRBY / DECRBY：对整数值原子计数 ==
初始值 -> 10
INCRBY 5 -> 15
DECRBY 2 -> 13
```

后续输出会展示 `MGET` 返回 `['Alice', 'Shanghai']`、第二次 `SET ... NX` 返回 `None`，以及临时 key 的剩余 TTL。可以在另一个终端用 `redis-cli` 或 RedisInsight 观察这些 key。

## 清理方式

脚本不会在结束时自动删除 key，便于观察结果。清理本 Demo 创建的数据：

```bash
redis-cli DEL \
  demo:string:message \
  demo:string:counter \
  demo:string:profile:name \
  demo:string:profile:city \
  demo:string:temporary
```

如果使用了自定义 `REDIS_URL`，请改用对应的主机、端口和数据库参数。

如果 Redis 是由本仓库的 Compose 启动，并且希望同时停止容器：

```bash
docker compose -f demo-install-redis/docker-compose.yml down
```

## 常见问题

### `Connection refused` 或无法连接 Redis

先执行 `docker compose -f demo-install-redis/docker-compose.yml up -d redis`，再检查 `redis-cli -p 6379 ping` 是否返回 `PONG`。如果端口不同，请设置正确的 `REDIS_URL`。

### `No module named redis`

在项目根目录执行 `uv sync`，然后使用 `uv run python demo1/redis_string.py`，不要直接调用未安装依赖的系统 Python。

### 为什么 `INCRBY` 只能对整数值使用？

Redis 会把 String 的内容按整数解析；如果 key 中保存的是 `hello` 等非数字文本，执行 `INCR`/`INCRBY` 会返回错误。String 可以存储文本、数字或二进制数据，但数值运算要求内容是合法整数。

### `SET ... NX` 为什么第二次返回 `None`？

`NX` 表示“key 不存在时才设置”。第一次已经创建了 key，第二次条件不满足，所以原值保持不变。
