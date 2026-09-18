# Redis 分布式锁 Demo

## Demo 目的

使用多个 Python 进程同时竞争同一个 Redis Key，直观观察 Redis 分布式锁的互斥效果，并演示一个基础分布式锁实现中必须考虑的安全点：

- 使用 `SET key value NX EX seconds` 原子加锁；
- 使用唯一 token 标识锁的持有者；
- 使用 Lua 脚本原子完成“校验 token + 删除锁”；
- 使用 TTL 避免持锁进程异常退出后留下永久锁；
- 观察锁 TTL 小于临界区执行时间时产生的风险。

## 涉及的 Redis 知识点

- `SET ... NX EX`：Key 不存在时创建，并设置自动过期时间
- 分布式锁的互斥性：同一时刻只有一个进程获得锁
- 锁持有者 token：防止旧请求误删新请求持有的锁
- Lua 脚本：保证比较和删除操作的原子性
- 锁 TTL：避免进程崩溃造成永久阻塞
- 临界区：一次只能由一个进程执行的业务代码
- 锁过期风险：业务执行时间超过 TTL 后，其他进程可能重新获得锁
- Redis Key 命名空间和结果数据自动过期

## 目录或关键文件说明

```text
demo-distributed-lock/
├── Makefile               # 一键启动 Redis 并运行 Demo
├── distributed_lock.py  # 启动多个进程竞争 Redis 分布式锁
└── README.md             # 使用说明
```

项目根目录的 `pyproject.toml` 和 `uv.lock` 提供 Python 运行环境及 `redis-py` 依赖。

## 运行前置条件

- 已安装 Docker 与 Docker Compose，或已有 Redis 服务；
- 已安装 `uv`；也可以把命令中的 `uv run` 替换为已经安装 `redis-py` 的 Python 环境；
- 已安装 `make`（macOS 通常自带）；
- Redis 服务已在本机 `6379` 端口监听；
- Python 进程可以访问 Redis 地址。

推荐使用仓库内的 Redis 安装 Demo：

```bash
cd demo-install-redis
docker compose up -d redis
cd ..
```

启动前检查 Redis：

```bash
docker compose -f demo-install-redis/docker-compose.yml exec redis redis-cli ping
# PONG
```

## 启动或运行方式

### 使用 Makefile 一键运行（推荐）

进入 Demo 目录后执行 `make`：

```bash
cd demo-distributed-lock
make
```

`make` 会依次完成以下操作：

1. 使用仓库根目录的 `pyproject.toml` 同步 Python 依赖；
2. 先检测 `REDIS_URL` 是否已经可用；
3. 如果 Redis 不可用，再启动 `../demo-install-redis/docker-compose.yml` 中的 Redis 容器并等待就绪；
4. 启动多个进程竞争分布式锁。

因此，如果本机的 `6379` 端口已经有 Redis 服务，`make` 会直接复用它，不会重复启动 Docker Redis，也不会产生端口占用冲突。

也可以不切换目录，直接在项目根目录执行：

```bash
make -C demo-distributed-lock
```

Makefile 默认参数如下：

| Make 参数 | 默认值 | 含义 |
|---|---:|---|
| `START_REDIS` | `1` | 是否自动启动仓库自带的 Redis，`0` 表示跳过 |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis 连接地址 |
| `ARGS` | 空 | 透传给 Python Demo 的命令行参数 |

例如，使用 Makefile 启动 8 个进程：

```bash
cd demo-distributed-lock
make run ARGS="--workers 8 --hold-seconds 1 --wait-timeout 15 --lock-ttl 5"
```

如果已经有 Redis 在运行，不希望 Makefile 启动 Docker Redis：

```bash
make run START_REDIS=0 REDIS_URL=redis://localhost:6380/0
```

停止由 Makefile 启动的 Redis（不会删除数据卷）：

```bash
make redis-stop
```

查看所有 Makefile 命令：

```bash
make help
```

### 手动运行

如果不使用 Makefile，也可以在项目根目录执行：

```bash
uv run python demo-distributed-lock/distributed_lock.py
```

默认参数如下：

| 参数 | 默认值 | 含义 |
|---|---:|---|
| `--workers` | `5` | 同时竞争锁的进程数 |
| `--hold-seconds` | `1` | 每个进程持有锁并执行临界区的时间 |
| `--wait-timeout` | `10` | 单个进程等待锁的最长时间 |
| `--lock-ttl` | `5` | 锁的自动过期时间 |
| `--redis-url` | `REDIS_URL` 或 `redis://localhost:6379/0` | Redis 连接地址 |

例如，运行 8 个进程竞争锁：

```bash
uv run python demo-distributed-lock/distributed_lock.py \
  --workers 8 \
  --hold-seconds 1 \
  --wait-timeout 15 \
  --lock-ttl 5
```

如果 Redis 不是默认地址，可以通过环境变量或命令参数覆盖：

```bash
REDIS_URL=redis://localhost:6380/0 \
  uv run python demo-distributed-lock/distributed_lock.py

uv run python demo-distributed-lock/distributed_lock.py \
  --redis-url redis://localhost:6380/0
```

## 预期输出或可观察现象

正常运行时，多个进程会轮流获得锁。类似输出如下：

```text
Redis：redis://localhost:6379/0
运行标识：20260918150000-a1b2c3d4
启动 5 个进程竞争同一个锁，临界区 1.0s，锁 TTL 5s
Worker 3 (pid=10001) 获取锁成功，等待 0.00s，进入临界区（当前并发数=1）
Worker 3 退出临界区并安全释放锁
Worker 1 (pid=10002) 获取锁成功，等待 1.01s，进入临界区（当前并发数=1）
Worker 1 退出临界区并安全释放锁
...

=== 运行结果 ===
并发进程数：5
成功获取锁：5
等待超时：0
安全释放锁：5
释放失败：0
临界区重叠次数：0
结论：锁的 TTL 覆盖了临界区，正常情况下只有一个进程同时执行临界区。
临界区活动计数：0
```

重点观察：

- 多个进程竞争同一个 Lock Key，但同一时刻的“当前并发数”应为 `1`；
- `临界区重叠次数` 正常应为 `0`；
- `安全释放锁` 应与成功获取锁的数量一致；
- 每次运行使用独立 Key，结果 Hash 会保留约 5 分钟，便于用 `redis-cli` 观察。

## 锁 TTL 过短的风险演示

让临界区执行 4 秒，但锁只存活 1 秒：

```bash
uv run python demo-distributed-lock/distributed_lock.py \
  --workers 3 \
  --hold-seconds 4 \
  --wait-timeout 12 \
  --lock-ttl 1
```

这时可能观察到：

- 前一个进程仍未执行完，锁已经自动过期；
- 后一个进程重新获得同一个锁；
- `当前并发数` 可能大于 `1`；
- `临界区重叠次数` 可能大于 `0`；
- 旧进程释放锁时可能提示“锁已过期或不再属于当前进程”。

这不是实现失败，而是为了展示生产环境中的重要约束：锁 TTL 必须覆盖正常业务执行时间；对于执行时间不可预测的任务，需要续期机制，并且关键业务还要使用数据库约束、幂等设计或 fencing token 兜底。

## 如何观察 Redis 中的 Key

脚本输出会打印本次运行的 `锁 Key` 和 `结果 Key`。也可以使用命名空间查找：

```bash
redis-cli --scan --pattern 'demo:distributed-lock:*'
```

查看某次运行的结果：

```bash
redis-cli HGETALL 'demo:distributed-lock:<运行标识>:result'
redis-cli TTL 'demo:distributed-lock:<运行标识>:result'
redis-cli GET 'demo:distributed-lock:<运行标识>:lock'
```

锁成功释放后，锁 Key 通常已经不存在；结果 Hash 和活动计数 Key 会在约 5 分钟后自动过期。

## 清理方式

脚本创建的结果 Key 会自动过期。若要立即清理某次运行的数据，使用脚本输出的完整 Key：

```bash
redis-cli DEL \
  'demo:distributed-lock:<运行标识>:lock' \
  'demo:distributed-lock:<运行标识>:active' \
  'demo:distributed-lock:<运行标识>:result'
```

不建议在共享 Redis 上直接使用 `KEYS demo:distributed-lock:*` 后批量删除；如果需要清理多个运行记录，应使用 `SCAN` 分批查找，并确认目标 Redis 仅用于本学习项目。

如需停止仓库内启动的 Redis：

```bash
docker compose -f demo-install-redis/docker-compose.yml down
```

## 常见问题

### `Connection refused` 或无法连接 Redis

先启动 Redis：

```bash
docker compose -f demo-install-redis/docker-compose.yml up -d redis
```

再检查：

```bash
docker compose -f demo-install-redis/docker-compose.yml exec redis redis-cli ping
```

如果 Redis 使用其他端口，请设置 `REDIS_URL` 或传入 `--redis-url`。

### `No module named redis`

在项目根目录执行：

```bash
uv sync
uv run python demo-distributed-lock/distributed_lock.py
```

不要直接调用没有安装项目依赖的系统 Python。

### 为什么不能用 `SETNX` 后再单独执行 `EXPIRE`？

如果 `SETNX` 成功后、`EXPIRE` 执行前进程崩溃，就可能留下没有过期时间的永久锁。应使用一条命令同时完成加锁和过期设置：

```redis
SET lock-key unique-token NX EX 30
```

### 为什么释放锁不能直接使用 `DEL`？

如果当前进程持有的锁已经过期，并被另一个进程重新获得，旧进程直接 `DEL` 会误删新进程的锁。因此必须保存唯一 token，并使用 Lua 脚本原子校验 token 后再删除。

### 这个 Demo 能保证生产环境的强一致性吗？

不能。它演示的是单 Redis 实例上的基础分布式锁实现和常见风险。支付、库存、账户余额等关键业务还需要数据库事务、唯一约束、幂等记录、状态校验、故障恢复和监控告警等机制共同保证正确性。
