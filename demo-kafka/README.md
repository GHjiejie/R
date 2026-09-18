# Kafka 基础与最小 Demo

## Demo 目的

用一个单节点 Kafka 实例和两个 Python 脚本，演示最基本的消息流转：

```text
Producer（生产者） -> Topic（demo-events） -> Consumer（消费者）
```

本 Demo 使用 Kafka 的 KRaft 单节点模式，不需要额外启动 ZooKeeper。重点是先理解 Kafka 的基本组成和一次完整的“发送—保存—读取”过程。

## Kafka 是什么

Kafka 是一个分布式事件流平台，应用可以把事件持续写入 Kafka，再由一个或多个消费者读取和处理。常见用途包括：

- 服务之间的异步解耦和消息传递
- 用户行为、日志、订单等事件的采集
- 数据管道和流式处理
- 同一份事件被多个下游系统分别消费

Kafka 的核心特点是：消息先写入 Broker 的磁盘日志，并在 Topic 中按顺序追加；消费者通过 offset 记录自己的读取位置。因此，消费者读取消息后，消息不会像传统“取出即删除”的队列那样马上消失，其他消费者仍然可以按自己的进度读取。

## 核心概念

| 概念 | 说明 |
| --- | --- |
| Broker | Kafka 服务节点，负责接收、保存和提供消息 |
| Topic | 消息的逻辑分类，本 Demo 使用 `demo-events` |
| Partition | Topic 的分片。单个 Partition 内的消息按 offset 有序 |
| Producer | 向 Topic 写入消息的客户端 |
| Consumer | 从 Topic 拉取消息的客户端 |
| Consumer Group | 一组协作消费的消费者。同一个 Partition 在同一时刻只会分配给组内一个消费者 |
| Offset | 消息在 Partition 中的位置，也是消费者的读取进度 |

本例只有一个 Topic、一个 Partition 和一个 Consumer，便于把注意力放在基础流程上。真实环境通常会使用多个 Partition 和多个消费者实例来提高吞吐量和可用性。

## Kafka 与 Redis Pub/Sub 的简单区别

- Kafka 会把消息持久化到 Topic 日志，消费者可以按 offset 重放；Redis Pub/Sub 更偏向实时广播，订阅者离线时通常收不到错过的消息。
- Kafka 通过 Consumer Group 分摊一个 Topic 的消费工作；Redis Pub/Sub 的多个订阅者通常都会各自收到一份广播消息。
- Kafka 适合事件流、日志和可回放的数据管道；Redis Pub/Sub 适合轻量的即时通知。

## 目录或关键文件说明

```text
demo-kafka/
├── Makefile             # Kafka 启动、Topic、生产者、消费者等快捷命令
├── backend/
│   ├── __init__.py       # FastAPI 后端包标记
│   └── main.py           # HTTP 接口和 Kafka 读写逻辑
├── docker-compose.yml  # 启动单节点 Kafka（KRaft）
├── frontend/
│   ├── package.json      # React/Vite 前端依赖和脚本
│   ├── vite.config.js    # Vite 开发服务器和 FastAPI 代理
│   ├── index.html
│   └── src/
│       ├── App.jsx       # Kafka 消息控制台页面
│       ├── main.jsx
│       └── styles.css
├── producer.py         # 发送一条文本消息
├── consumer.py         # 读取并打印一条消息
└── README.md           # 概念介绍和运行说明
```

根目录的 `pyproject.toml` 和 `uv.lock` 提供 `kafka-python` 客户端依赖。

## 运行前置条件

- 已安装并启动 Docker Desktop（或 Docker Engine + Compose v2）。
- 已安装 `uv`。
- 如果运行 React 页面，另外需要安装 Node.js 和 npm。
- 当前终端位于项目根目录 `/Users/zhengjie/Github/R`，或者后续命令中的路径使用实际项目路径。

## 启动或运行方式

### 使用 Makefile（推荐）

在 `demo-kafka` 目录执行：

```bash
make setup
```

`make setup` 会启动 Kafka、等待服务健康，并创建 `demo-events` Topic。然后分别在两个终端执行：

```bash
# 终端一：启动消费者
make consume
```

```bash
# 终端二：发送消息
make produce MESSAGE="你好，Kafka"
```

常用的其他命令：

```bash
make describe                         # 查看 Topic 信息
make ps                               # 查看 Kafka 容器状态
make logs                             # 查看 Kafka 日志
make produce MESSAGE="hello kafka"   # 发送自定义消息
make frontend-build                  # 构建 React 前端
make down                             # 停止并删除 Kafka 容器
```

默认参数也可以覆盖，例如使用新的消费者组重新读取旧消息：

```bash
make consume GROUP="demo-kafka-consumer-$(date +%s)"
```

### FastAPI + React 页面

这个版本把 Kafka 操作封装成 HTTP 接口，React 只需要调用 FastAPI，不需要在浏览器中直接连接 Kafka。

先在第一个终端启动 Kafka 和 FastAPI：

```bash
cd demo-kafka
make api
```

`make api` 会自动启动 Kafka、等待服务健康、创建 `demo-events` Topic，然后启动监听 http://localhost:8000 的 FastAPI 服务。开发模式下修改 backend/main.py 会自动重载。

再开第二个终端启动 React：

```bash
cd demo-kafka
make frontend-install  # 第一次运行时执行
make frontend-dev
```

打开 http://localhost:5173，即可使用页面发送消息和查看最近消息。Vite 会把前端的 /api 请求代理到 FastAPI 的 8000 端口。

如果本机的 8000 端口已被其他服务占用，可以同时覆盖后端端口和前端代理目标：

```bash
# 终端一
make api API_PORT=8001

# 终端二
make frontend-dev API_PORT=8001
```

#### HTTP 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | /api/health | 检查 FastAPI、Kafka 和 Topic 是否可用 |
| POST | /api/messages | 将一条消息写入 demo-events |
| GET | /api/messages?limit=20 | 读取 Topic 最近的消息，不提交消费者组 offset |

发送消息的请求体：

```json
{
  "key": "greeting",
  "message": "你好，Kafka"
}
```

也可以不用 React，直接调用 HTTP 接口：

```bash
curl http://localhost:8000/api/health

curl http://localhost:8000/api/messages?limit=20

curl -X POST http://localhost:8000/api/messages \
  -H "Content-Type: application/json" \
  -d '{"key":"greeting","message":"hello from curl"}'
```

后端默认允许 http://localhost:5173 和 http://127.0.0.1:5173 跨域访问，也可以通过 CORS_ORIGINS 环境变量传入逗号分隔的来源列表。

### 手动运行 Python 命令行 Demo

#### 1. 启动 Kafka

```bash
cd demo-kafka
docker compose up -d --wait
```

官方 `apache/kafka` 镜像默认使用单节点 KRaft 配置，并将客户端端口映射到本机的 `9092`。

#### 2. 创建 Topic

在 `demo-kafka` 目录执行：

```bash
docker compose exec kafka \
  /opt/kafka/bin/kafka-topics.sh \
  --create \
  --if-not-exists \
  --topic demo-events \
  --bootstrap-server localhost:9092 \
  --partitions 1 \
  --replication-factor 1
```

可以查看 Topic：

```bash
docker compose exec kafka \
  /opt/kafka/bin/kafka-topics.sh \
  --describe \
  --topic demo-events \
  --bootstrap-server localhost:9092
```

#### 3. 启动消费者

保持第一个终端运行，在项目根目录另开一个终端：

```bash
uv run python demo-kafka/consumer.py
```

消费者会等待最多 30 秒，读到第一条消息后打印消息内容、Partition 和 offset，然后退出。

#### 4. 发送消息

再开一个终端，在项目根目录执行：

```bash
uv run python demo-kafka/producer.py --message "你好，Kafka"
```

如果希望由脚本自动生成消息，可以省略 `--message`：

```bash
uv run python demo-kafka/producer.py
```

也可以直接在 `demo-kafka` 目录执行脚本：

```bash
uv run --project .. python producer.py --message "hello kafka"
```

#### 5. 重复观察旧消息

消费者组会保存读取进度。若使用默认的 `demo-kafka-consumer` 组再次运行，已经提交过 offset 的旧消息不会重复读取。想重新从最早消息开始观察，可以换一个新的消费者组：

```bash
uv run python demo-kafka/consumer.py \
  --group "demo-kafka-consumer-$(date +%s)"
```

这也能直观看到：同一个 Topic 的消息可以被不同消费者组分别读取。

## 预期输出或可观察现象

生产者输出示例：

```text
消息发送成功
topic=demo-events
partition=0
offset=0
key=greeting
value=你好，Kafka
```

消费者输出示例：

```text
收到消息
topic=demo-events
partition=0
offset=0
key=greeting
value=你好，Kafka
```

其中 `offset` 是消息在该 Partition 中的位置。再次发送消息时，通常会看到 offset 递增；新建消费者组则可以从 Topic 的最早消息开始读取。

## 常见问题

### make api 报 NoBrokersAvailable

请先确认 Docker 正常运行，并执行：

```bash
make setup
make ps
```

如果 Kafka 容器不是 Healthy 状态，可以执行 make logs 查看启动日志。

### npm: command not found

说明本机还没有安装 Node.js/npm。安装后在 demo-kafka 目录执行 make frontend-install，再执行 make frontend-dev。

### 页面显示“等待后端连接”

请确认第一个终端中的 make api 仍在运行，并访问 http://localhost:5173。如果直接修改了前端端口，需要同步修改 frontend/vite.config.js 中的代理目标或后端的 CORS_ORIGINS。
### `Connection refused` 或 `NoBrokersAvailable`

Kafka 可能还没有完成启动。检查容器状态和日志：

```bash
docker compose ps
docker compose logs kafka
```

确认 `docker compose up -d --wait` 已成功完成，并确认本机 `9092` 端口没有被其他程序占用。

### `Topic ... does not exist`

请先执行上面的 Topic 创建命令。命令中的 `--if-not-exists` 使其可以重复执行。

### 消费者没有读到消息

先启动消费者，再运行生产者。若默认消费者组之前已经读过消息，请换一个新的 `--group`，或者发送一条新消息。

### 为什么示例只有一个 Partition？

为了让初学者先看清消息、offset 和消费者组的关系。Partition 数量增加后，可以通过多个消费者实例并行消费，但同一消费者组内的消息顺序和分配规则也会更值得专门学习。

### 这个配置能用于生产环境吗？

不能。本 Demo 只有一个 Broker、一个副本、明文连接，没有认证、授权、监控和高可用配置，仅用于本地学习。生产环境需要根据可靠性、吞吐量、安全和数据保留要求配置多节点集群。

## 清理方式

停止并删除本 Demo 创建的 Kafka 容器：

```bash
docker compose down
```

本 Demo 没有挂载数据卷，因此容器删除后，示例消息也会随容器数据一起清理。若只想暂时停止容器，可以使用：

```bash
docker compose stop
```
