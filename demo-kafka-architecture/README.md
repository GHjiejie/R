# KRaft Lab：Kafka 架构实验台

以项目根目录的 [kafka_kraft_arch.png](../kafka_kraft_arch.png) 为指引，用 **Python + React + 真实 Kafka KRaft 集群**实现的独立学习项目。

核心拓扑为 **3 个专用 Controller + 3 个专用 Broker**。Controller 与 Broker 不混合部署；没有 ZooKeeper。控制台展示来自 Kafka Admin API、官方元数据工具、消费回调和磁盘的真实结果。

## 1. 项目目的与知识点

通过一条订单事件的发送、存储、复制、消费和回放，理解：

- KRaft Controller Quorum、Active / Standby、Raft 多数派与元数据复制。
- Broker 注册、心跳、元数据传播和控制层 / 数据层的职责边界。
- Topic、Partition、Leader / Follower、ISR、复制因子与可靠写入。
- 多 Producer、Key 分区、批处理、压缩与生产确认。
- Consumer Group、组内分工、组间独立消费、Rebalance、Offset、Lag。
- 顺序追加、日志段、`.log`、`.index`、`.timeindex`、持久化和保留策略。
- 消费失败恢复、位移重置、幂等回放、分区扩容及故障实验。

完整覆盖关系见 [架构与知识点映射](docs/architecture.md)，操作步骤见 [实验手册](docs/experiments.md)。
已经实际执行的测试、故障结果与验证边界见 [验证记录](docs/verification.md)。

## 2. 一键启动

前置条件：

- Docker Engine / Docker Desktop，以及 Docker Compose v2（支持 `--wait`）。
- Docker 可用内存建议至少 8 GB，预留数 GB 磁盘空间；已有其他容器时应额外留出余量。
- 可下载 Docker 镜像及 Python / npm 依赖。macOS Apple Silicon 和 Linux 均使用镜像对应的原生架构。
- 本机端口 `5188`、`8088`、`19092`–`19097` 可用。

在本目录执行：

```bash
cp .env.example .env
make up
```

第一次启动需要下载镜像和构建应用。之后打开：

- **React 控制台**：<http://localhost:5188>
- **API / OpenAPI 文档**：<http://localhost:8088/docs>
- **进程健康检查**：<http://localhost:8088/api/health>

`/api/health` 表示 API 进程可用；集群是否可用应查看 `/api/state` 中的 `status`、分区 ISR 和 Quorum 采样。

首次进入后：

1. 点击“初始化主题”，创建 `orders` 与 `payments`。
2. 到“消费者与位移”，为两个组各增加两个消费者。
3. 到“消息工作台”，发送 10 条订单消息，查看回执中的分区与 Offset。
4. 返回总览和消费者页面，观察副本、分区分配、Lag 和处理记录。
5. 在“消息回放”读取已消费的数据，验证消费不等于删除消息。

## 3. 组成与目录

| 目录 / 文件 | 作用 |
| --- | --- |
| `compose.yaml` | 六节点 KRaft 拓扑、观察器、API、React / Nginx，以及独立持久卷 |
| `backend/app/main.py` | FastAPI 接口、参数验证、错误处理、请求耗时 |
| `backend/app/kafka_service.py` | Admin API、Producer、拓扑快照、位移和回放 |
| `backend/app/workers.py` | 真正使用 Kafka Consumer 的工作线程、Rebalance、手动提交 |
| `backend/app/store.py` | SQLite WAL、事务、按消费组隔离的业务去重和处理记录 |
| `backend/app/quorum.py` | 解析官方 Quorum 工具输出，标记缺失和过期采样 |
| `backend/app/group_admin.py` | 将消费组 Coordinator 查询和位移管理放入有超时限制的子进程，隔离底层客户端异常退出 |
| `backend/tests/` | 并发幂等、持久化、采样可靠性和真实集群集成测试 |
| `frontend/src/` | React + TypeScript 控制台与响应式样式 |
| `scripts/observe-quorum.sh` | 通过官方工具读取 Raft 状态，原子更新只读观察文件 |
| `scripts/lab.sh` | 启停、状态、节点故障实验、业务 / 元数据日志解码 |
| `docs/` | 架构映射、实验手册、验证记录 |

Python 与前端依赖分别由 `backend/uv.lock` 和 `frontend/package-lock.json` 固定。Docker 默认使用 `apache/kafka:4.1.2`，API 使用 Python 3.12。

## 4. 初始数据模型

| 业务对象 | 配置 |
| --- | --- |
| `orders`（对应图中 Topic A） | 2 个分区，3 副本；初始副本顺序 `[1,2,3]`、`[2,3,1]` |
| `payments`（对应图中 Topic B） | 1 个分区，3 副本；初始副本顺序 `[3,1,2]` |
| `lab-fulfillment` | 履约消费组，订阅两个业务 Topic |
| `lab-analytics` | 分析消费组，独立订阅两个业务 Topic |
| `producer-1`–`producer-3` | 三个独立 Producer 客户端 |
| Controller Node ID | 101、102、103 |
| Broker Node ID | 1、2、3 |

初始 Leader 通常对应副本列表首项；故障和选举后位置可能变化，页面以实际元数据为准。Controller 也不保证由 Node 101 当选 Active。

生产事件包含 `event_id`、`schema_version`、业务 `key`、`type`、`producer`、`amount_minor`、`sequence`、`created_at`。金额使用最小货币单位的整数。示例不包含真实账户或敏感信息。

## 5. 控制台功能

| 页面 | 可以操作 / 观察什么 |
| --- | --- |
| 架构总览 | Active Controller、Leader Epoch、Quorum High Watermark、复制 Lag、Broker、分区 Leader、ISR、消费 Lag、活动日志 |
| 消息工作台 | 选择 Producer / Topic / Key / 分区、批量发送、查看逐条确认、按 Offset 只读回放 |
| 消费者与位移 | 为两个组增加或停止成员、设置处理延迟、观察 Rebalance、已提交 Offset、Lag、幂等处理记录 |
| 持久化日志 | 查看三个 Broker 数据卷中的真实文件及大小，复制日志解码命令 |
| 架构实验室 | 分区扩展、Broker 故障、Active Controller 故障、多数派丢失、双 Broker 故障等实验指引 |

页面约每 6 秒请求快照；API 后台约每 3 秒采集 Kafka 状态，网络失败时可能延长。Quorum 工具独立采样，不是与业务指标严格同步的一致性快照。超过 30 秒的状态采样会标记为过期，不会把旧 Active 信息当成最新状态。

## 6. 可靠性设计与适用边界

本项目按可维护的工程结构组织，面向**本地架构实验**：

- Producer 开启幂等，采用 `acks=all`、LZ4 压缩、短时间批处理。
- 业务 Topic 使用 3 副本、`min.insync.replicas=2`；关闭不干净 Leader 选举。
- Consumer 关闭自动提交与自动存储位移，先提交 SQLite 事务，再同步提交 Kafka 位移。
- `(group_id, event_id)` 唯一约束防止回放导致重复业务结果；业务结果和观察记录在同一事务提交。
- Kafka 数据、Controller 元数据、业务处理结果各自持久化；`down` 后再次 `up` 保留这些状态。
- Producer 失败、Kafka 异常、消费者异常、过期观测均有界面反馈；坏消息使该 Worker 停止并保留错误，不会悄悄跳过再提交位移。
- 消费组管理调用放入有界子进程；相关 native 客户端异常退出时，只报告该次查询失败，不结束 API 进程。该处理来自真实断连故障测试，而非用模拟数据掩盖问题。
- API 非 root 运行；Broker 数据只读挂载；控制台不挂载 Docker Socket。故障脚本限定节点、主题和数字分区参数。
- 单次最多发送 500 条、每组最多 6 个消费者、回放最多读取 100 条，防止误操作产生无界任务。

以下限制决定了它不能原样部署到公网生产环境：

- 使用本机绑定端口和 PLAINTEXT，未提供用户鉴权、TLS / SASL、Kafka ACL、审计平台或多租户隔离。
- 六节点位于同一宿主机，不能验证跨主机、机架或可用区容灾。
- Consumer 实例是 API 进程中的独立线程，拥有独立 Kafka Group 成员身份；API 重启后需要重新启动消费者。运行时管理必须保持 **单个 Uvicorn Worker**，不能直接增加 `--workers`。
- SQLite 适合单机实验；生产业务应改用对应的数据库、外部 Worker 部署、告警和备份方案。
- 图中未涉及 Outbox、完整重试 / 死信平台、Schema Registry、Kafka Connect 和分布式事务，因此本项目不假装实现这些生产体系。
- “写入确认”不意味着每条消息都已单独执行磁盘 `fsync`，也不能覆盖所有副本同时损坏等故障。Kafka 的复制机制与操作系统刷盘机制需要分别理解。

消费进度在 Kafka 的 `__consumer_offsets` 中；业务 SQLite 的去重记录不能替代消费位移。幂等 Producer 与业务幂等也不是同一概念。

## 7. 开发与验证

仅运行项目不需要本机 Python / Node。修改代码时建议安装 `uv`、Python ≥ 3.12、Node ≥ 22.12（建议 Node 24）和 npm。

```bash
# 后端单元测试和静态检查
make test

# 前端依赖安装、类型检查与生产构建
make frontend-check

# 真实 Kafka 集成测试，先启动完整环境
make integration

# 真实节点故障验收：会停启本实验节点，结束后自动恢复
python3 scripts/verify_faults.py

# 前端真实页面测试，先启动完整环境
cd frontend
npx playwright install chromium
npm run test:e2e
```

集成测试会初始化 Topic、发送带唯一 Key 的消息、停止现有实验消费者、创建两组消费者并重置分析组位移。它只应指向本实验环境。

前端本地开发：

```bash
# 停止容器中的 Web，释放 5188；API 和 Kafka 保持运行
docker compose stop web
cd frontend
npm ci
npm run dev
```

Vite 将 `/api` 代理到 `127.0.0.1:8088`。修改 API 后在项目目录运行 `docker compose up -d --build api`。API 依赖挂载卷的日志和 Quorum 观察功能，建议通过容器运行；单独本机启动时，这两项会明确显示数据不可用。

接口说明由 `/docs` 自动生成，主要接口如下：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/state` | 集群、Quorum、消费者与业务记录快照 |
| POST | `/api/initialize` | 初始化不存在的实验 Topic，不清空已有数据 |
| POST | `/api/messages` | 发送事件并返回确认 / 失败 / 待定数量 |
| GET | `/api/messages/replay` | 指定 Topic、分区、起始 Offset 只读回放 |
| POST / DELETE / PATCH | `/api/consumers` 或 `/api/consumers/{id}` | 启动、停止、调整处理延迟 |
| POST | `/api/offsets/reset` | 空闲消费组重置至 earliest / latest |
| POST | `/api/partitions` | 增加业务 Topic 分区数 |
| GET | `/api/storage` | 只读查看磁盘日志文件 |

## 8. 停止与清理

```bash
# 停止并移除本项目容器和网络，保留所有持久数据
make down

# 再次启动，恢复已有数据
make up
```

确实需要清空**本项目**所有实验消息、位移、元数据和业务记录时，执行以下命令。该操作不可恢复：

```bash
docker compose down -v
```

项目使用独立的 `kafka-kraft-lab` Compose 项目名，不会停止仓库其他 Redis / 数据库 Demo。修改项目名会创建另一套卷与网络；已占用的宿主机端口仍需要处理。

## 9. 常见问题

- **首次启动慢 / 镜像下载超时**：查看 `make status` 和 `make logs`；确认 Docker 网络后重试 `make up`，已下载的镜像层可以复用。
- **六节点占用较多内存**：停止暂时不用的其他实验或调高 Docker 内存。不要把“3 Controller + 3 Broker”改成单节点后仍声称已验证多数派和故障切换。
- **只有 `health` 正常但集群未就绪**：`health` 只反映 API 进程；检查 Controller 多数派、Broker 注册、ISR 和 API 返回的错误。
- **增加消费者后短暂没有分区**：等待再均衡；初始两个 Topic 合计三个分区，同组超过三个成员时会空闲。
- **消费失败后没有自动跳过**：查看 Worker 错误和日志，修复原因后重新增加成员。项目有意保留未提交进度以便排查。
- **重置位移被拒绝**：先停止该组全部消费者，并等待 Kafka 确认退组；其他外部消费者也不能仍在该组中运行。
- **停止一个 Broker 后发送失败**：等 Leader 选举和元数据更新；检查剩余节点是否确实在 ISR。可靠写入需要满足 `min ISR=2`。
- **副本文件大小并非完全同步**：页面是离散采样，日志滚动、索引预分配和复制延迟会影响观察结果。
- **已消费消息仍存在**：正常现象。业务日志默认保留 24 小时，实际删除按日志段和检查周期进行，并非精确到每条消息的 24 小时。
- **分区扩展后相同 Key 落到不同分区**：分区数改变会影响映射；扩展不可直接缩回，历史数据也不会自动均匀迁移。

## 10. 官方资料

- [Kafka KRaft 文档](https://kafka.apache.org/41/operations/kraft/)：Controller Quorum、元数据日志及官方诊断工具。
- [Kafka 官方 Docker 文档](https://kafka.apache.org/41/getting-started/docker/)：镜像使用方式。
- [Confluent Python Client API](https://docs.confluent.io/platform/current/clients/confluent-kafka-python/html/index.html)：本项目所用 Kafka Python 客户端的 API 参考，具体可用接口以锁定版本为准。
