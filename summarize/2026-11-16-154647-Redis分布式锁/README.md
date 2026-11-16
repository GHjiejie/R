记录时间：2026-11-16 15:46:47 (Asia/Shanghai)

# Redis 分布式锁学习目录

本目录用于集中学习 Redis 分布式锁，概念正文保存在带时间戳的 Markdown 文件中。

## 阅读入口

从 [Redis 分布式锁详解](./2026-11-16-154647-Redis分布式锁.md) 开始，依次了解：

1. 为什么多实例应用需要分布式锁。
2. `SET NX PX` 加锁、唯一 token 和 Lua 安全解锁。
3. 命令实践、预期输出与清理方式。
4. TTL、续期、故障切换与 fencing token。
5. 分布式锁与幂等、数据库事务的关系。

## 补充学习记录

- [Redis 加锁的目的](./2026-11-16-161748-Redis加锁的目的.md)：通过库存并发、缓存重建和现有 Demo 理解为什么需要加锁。

## 配套实践

| 入口 | 用途 |
| --- | --- |
| [Redis 分布式锁 Demo](../../demo-redis-lock/README.md) | 运行多进程竞争与 TTL 过短实验 |
| [已有分布式锁 Demo](../../demo-distributed-lock/README.md) | 查阅另一份已有示例 |
| [Redis 安装 Demo](../../demo-install-redis/README.md) | 准备本地 Redis 环境 |

正文包含已有学习记录的链接。后续补充请新增带时间戳的总结文件，并在这里增加入口。
