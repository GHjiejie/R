# Redis 分布式锁 Demo

## Demo 目的

使用多个 Python 进程竞争同一个 Redis Key，观察 Redis 分布式锁的互斥效果，并演示基础实现中必须处理的安全点：

- 使用 `SET key token NX EX seconds` 原子加锁；
- 使用唯一 token 标识锁的持有者；
- 使用 Lua 脚本原子完成“校验 token + 删除锁”；
- 使用 TTL 避免持锁进程异常退出后留下永久锁；
- 演示锁 TTL 小于临界区执行时间时的风险。

本 Demo 面向单个 Redis 实例的学习场景，不是支付、库存等关键业务的完整一致性方案。

## 涉及的 Redis 知识点

- `SET ... NX EX`：Key 不存在时创建，并同时设置自动过期时间；
- 唯一 token：避免一个进程删除另一个进程持有的锁；
- Lua 脚本：让比较 token 和删除 Key 在 Redis 中原子执行；
- 锁 TTL：进程崩溃时自动释放锁；
- 临界区：同一时刻只允许一个进程执行的业务代码；
- 锁过期风险：业务执行超过 TTL 后，其他进程可能重新获得同一把锁。

## 目录说明

```text
demo-redis-lock/
├── distributed_lock.py  # 锁实现、并发 Worker 和运行结果统计
├── Makefile             # 依赖同步、Redis 启动和 Demo 运行命令
└── README.md            # 使用说明
```

项目根目录的 `pyproject.toml` 提供 `redis-py` 依赖。本 Demo 复用 `demo-install-redis/` 中的 Redis 配置。

## 运行前置条件

- 已安装 Python 3.9 或更高版本；
- 已安装 `uv` 和 `make`；
- 已安装 Docker 与 Docker Compose，或者已有可访问的 Redis 服务。

如果使用仓库内的 Redis，先启动：

```bash
cd demo-install-redis
docker compose up -d redis
cd ..
```

检查 Redis：

```bash
docker compose -f demo-install-redis/docker-compose.yml exec redis redis-cli ping
# PONG
```

## 启动方式

### 使用 Makefile

进入 Demo 目录后执行：

```bash
cd demo-redis-lock
make
```

Makefile 会同步项目依赖，检查 `REDIS_URL` 是否可用；如果不可用，则启动仓库内的 Redis，再运行多个进程竞争锁。

也可以在项目根目录执行：

```bash
make -C demo-redis-lock
```

常用参数通过 `ARGS` 传入：

```bash
make run ARGS="--workers 8 --hold-seconds 1 --wait-timeout 15 --lock-ttl 5"
```

连接已有 Redis 时：

```bash
make run START_REDIS=0 REDIS_URL=redis://localhost:6380/0
```

停止由 Makefile 启动的 Redis：

```bash
make redis-stop
```

### 手动运行

在项目根目录执行：

```bash
uv run python demo-redis-lock/distributed_lock.py
```

脚本参数：

| 参数 | 默认值 | 含义 |
| --- | ---: | --- |
| `--workers` | `5` | 同时竞争锁的进程数 |
| `--hold-seconds` | `1` | 每个进程持有锁并执行临界区的秒数 |
| `--wait-timeout` | `10` | 单个进程等待锁的最长秒数 |
| `--lock-ttl` | `5` | 锁的自动过期时间 |
| `--redis-url` | `REDIS_URL` 或 `redis://localhost:6379/0` | Redis 连接地址 |

## 预期现象

正常运行时，多个进程会依次获得锁：

```text
Worker 2 获取锁成功，等待 0.00s，进入临界区（当前并发数=1）
Worker 2 退出临界区并安全释放锁
Worker 1 获取锁成功，等待 1.01s，进入临界区（当前并发数=1）
...
=== 运行结果 ===
成功获取锁：5
临界区重叠次数：0
安全释放锁：5
```

重点观察：

- 同一时刻的“当前并发数”通常为 `1`；
- `临界区重叠次数` 通常为 `0`；
- `安全释放锁` 应与成功获取锁的数量一致；
- 结果 Hash 会保留约 5 分钟，便于使用 `redis-cli` 检查。

## 演示 TTL 过短的风险

让临界区执行 4 秒，但锁只存活 1 秒：

```bash
uv run python demo-redis-lock/distributed_lock.py \
  --workers 3 \
  --hold-seconds 4 \
  --wait-timeout 12 \
  --lock-ttl 1
```

可能观察到：

- 前一个进程仍未执行完，锁已经自动过期；
- 后一个进程重新获得同一个锁；
- “当前并发数”大于 `1`，`临界区重叠次数` 增加；
- 旧进程释放锁时提示锁已过期或不再属于当前进程。

生产环境中应让 TTL 覆盖正常执行时间。执行时间不可预测时，需要续期机制；库存、支付、账户余额等关键操作还应配合数据库约束、幂等设计或 fencing token。

## 观察和清理 Redis Key

脚本会输出本次运行的锁 Key 和结果 Key，也可以使用：

```bash
redis-cli --scan --pattern 'demo:redis-lock:*'
```

查看某次运行的数据：

```bash
redis-cli HGETALL 'demo:redis-lock:<运行标识>:result'
redis-cli TTL 'demo:redis-lock:<运行标识>:result'
redis-cli GET 'demo:redis-lock:<运行标识>:lock'
```

结果 Key 会自动过期。若要立即清理某次运行的数据：

```bash
redis-cli DEL \
  'demo:redis-lock:<运行标识>:lock' \
  'demo:redis-lock:<运行标识>:active' \
  'demo:redis-lock:<运行标识>:result'
```

共享 Redis 上不要直接使用 `KEYS demo:redis-lock:*` 批量删除；清理多次运行记录时应使用 `SCAN`，并确认目标 Redis 仅用于本学习项目。

## 常见问题

### 为什么不把 `SETNX` 和 `EXPIRE` 分开执行？

如果 `SETNX` 成功后、`EXPIRE` 执行前进程崩溃，就可能留下没有过期时间的永久锁。因此应使用一条命令：

```redis
SET lock-key unique-token NX EX 30
```

### 为什么释放锁不能直接使用 `DEL`？

当前进程的锁可能已经过期，并被另一个进程重新获得。旧进程直接 `DEL` 会误删新进程的锁，所以必须使用唯一 token，并通过 Lua 脚本原子校验后删除。

### 这个 Demo 能保证生产环境的强一致性吗？

不能。它展示的是单 Redis 实例上的基础分布式锁算法和 TTL 风险。生产环境还需要结合业务幂等、数据库事务或约束、故障恢复和监控告警设计。
