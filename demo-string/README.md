# Redis String 基础 Demo

## Demo 目的

在已经通过 `demo-install-redis/docker-compose.yml` 启动的 Redis 服务上，使用 Python 和 `redis-py` 快速练习最常用的 String 操作。项目使用 `uv` 管理 Python 版本环境和依赖。

## 涉及的 Redis 知识点

- `SET`、`GET`：保存和读取字符串
- `INCR`：对整数值进行原子自增
- `MGET`：一次读取多个 key
- `SET ... EX`、`TTL`：设置和查看过期时间
- key 命名空间：使用 `demo:string:` 前缀隔离本 Demo 的数据

## 目录或关键文件说明

```text
demo-string/
├── README.md
├── main.py                  # Python Demo 入口
├── pyproject.toml            # uv 项目和依赖配置
├── uv.lock                  # uv 生成的依赖锁定文件
└── .gitignore               # 忽略 uv 虚拟环境和 Python 缓存
```

## 运行前置条件

- 已安装并启动 Docker Desktop（或 Docker Engine + Compose v2）。
- 已安装 `uv`。安装方式见 [uv 官方文档](https://docs.astral.sh/uv/getting-started/installation/)。
- Redis Compose 服务已经启动。首次运行可以从项目根目录执行：

  ```bash
  cd demo-install-redis
  docker compose up -d
  cd ../demo-string
  ```

首次运行或依赖发生变化时，`uv` 会根据 `pyproject.toml` 创建隔离环境并安装 `redis-py`；也可以提前执行 `uv sync`。

## 启动或运行方式

在项目根目录执行（推荐）：

```bash
cd demo-string
uv run main.py
```

默认连接 `redis://localhost:6379/0`。如果 Redis 映射到了其他地址，可以通过 `REDIS_URL` 覆盖：

```bash
REDIS_URL=redis://localhost:6380/0 uv run main.py
```

## 预期输出或可观察现象

Python 程序会先执行 `PING` 检查连接，然后依次展示：

1. 写入并读取用户昵称；
2. 将访问次数从 `0` 原子地增加到 `1`；
3. 使用 `MGET` 一次读取多个 String key；
4. 创建一个 30 秒后过期的临时 key，并显示剩余 TTL。

每次执行前程序只删除自己使用的三个 key，因此可以重复运行，不会影响其他 Redis 数据。

## 清理方式

程序结束时会保留示例 key，方便手动观察。清理本 Demo 创建的数据，可以使用 Python 一次性删除：

```bash
cd demo-string
uv run python -c 'import redis; c = redis.Redis.from_url("redis://localhost:6379/0"); print(c.delete("demo:string:user:1:nickname", "demo:string:user:1:visits", "demo:string:temporary"))'
```

如果要停止 Redis 并删除 Compose 数据卷（会删除该 Compose 项目的 Redis 数据），请在 `demo-install-redis/` 目录执行：

```bash
docker compose down -v
```

## 常见问题

### `Cannot connect to the Docker daemon`

请先启动 Docker Desktop，确认 Docker Engine 已就绪，再运行 `uv run main.py`。

### `service "redis" is not running`

说明 Compose 服务尚未启动。进入 `demo-install-redis/` 执行 `docker compose up -d`，然后重新运行 `uv run main.py`。

### `No module named redis`

请在 `demo-string/` 目录执行 `uv sync`，再通过 `uv run main.py` 运行。不要直接使用未安装依赖的系统 `python3`。

### 为什么 `TTL` 的结果不是固定的 30？

`TTL` 返回的是剩余秒数，命令执行和输出本身会消耗时间，因此通常会小于或等于 30。
