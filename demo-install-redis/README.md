# Redis 安装与简单使用 Demo

## Demo 目的

使用 Docker Compose 在本机启动一个 Redis 7 实例和 RedisInsight 可视化界面，并通过 `redis-cli` 完成第一次连接和常用数据结构操作。

## 涉及的 Redis 知识点

- Redis 服务启动与连通性检查：`PING`
- String：`SET`、`GET`、`INCR`
- List：`LPUSH`、`RPUSH`、`LRANGE`
- Hash：`HSET`、`HGETALL`
- Set：`SADD`、`SMEMBERS`
- 过期策略：`SETEX`、`TTL`
- RedisInsight：浏览、编辑和查询 Redis 数据

## 目录或关键文件说明

```text
demo-install-redis/
├── docker-compose.yml          # Redis 7、RedisInsight 服务和数据卷配置
├── scripts/
│   └── basic-commands.sh       # 自动执行一组基础命令
└── README.md
```

## 运行前置条件

- 已安装并启动 [Docker Desktop](https://www.docker.com/products/docker-desktop/)（或 Docker Engine + Compose v2）。
- 当前终端位于本 demo 目录：

  ```bash
  cd demo-install-redis
  ```

如果不使用 Docker，也可以使用系统包管理器安装 Redis：

```bash
# macOS（Homebrew）
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt update
sudo apt install redis-server
sudo systemctl enable --now redis-server
```

## 启动或运行方式

### 方式一：Docker Compose（推荐）

```bash
docker compose up -d
bash scripts/basic-commands.sh
```

脚本会在容器中调用 `redis-cli`，因此主机不需要另外安装 `redis-cli`。也可以手动进入 Redis：

```bash
docker compose exec redis redis-cli
127.0.0.1:6379> SET greeting "hello redis"
OK
127.0.0.1:6379> GET greeting
"hello redis"
127.0.0.1:6379> exit
```

启动后可以打开 RedisInsight：

[http://localhost:5540](http://localhost:5540)

在 RedisInsight 中新增连接时填写：

- Host：`redis`
- Port：`6379`
- Username：留空
- Password：留空
- Database：`0`

RedisInsight 和 Redis 在同一个 Compose 网络中，因此使用服务名 `redis` 连接，而不是 `localhost`。RedisInsight 的配置会保存到 `redisinsight-data` 数据卷中。

### 方式二：本机 Redis

如果 Redis 是通过 Homebrew 或 APT 运行的，直接执行：

```bash
redis-cli ping
# PONG
redis-cli SET greeting "hello redis"
redis-cli GET greeting
```

## 预期输出或可观察现象

脚本首先输出 `PONG`，随后展示 String、List、Hash、Set 的写入和读取结果，以及临时 key 的剩余秒数。最后可以看到以 `demo:install:` 开头的 key 列表。

`temporary` key 使用 `SETEX` 设置为 60 秒后过期；等待一段时间后执行下面的命令会返回 `(nil)`：

```bash
docker compose exec redis redis-cli GET demo:install:temporary
```

## 清理方式

停止容器但保留数据卷：

```bash
docker compose down
```

连同本 demo 创建的 Redis 和 RedisInsight 数据卷一起删除（仅作用于当前 Compose 项目）：

```bash
docker compose down -v
```

## 常见问题

### `Cannot connect to the Docker daemon`

请先启动 Docker Desktop，确认 Docker Engine 已就绪后再执行 `docker compose up -d`。

### `Bind for 0.0.0.0:6379 failed: port is already allocated`

说明本机 6379 端口已被占用，通常是已有 Redis 实例。可以先执行 `redis-cli ping` 检查现有服务，或将 `docker-compose.yml` 的端口改为例如 `6380:6379`，并同步使用 `-p 6380` 连接。

### 为什么示例没有密码？

这是仅绑定本机的学习环境，便于快速体验。生产环境必须配置访问控制（例如 ACL/密码）、网络隔离和持久化策略，不能直接复用本配置。
