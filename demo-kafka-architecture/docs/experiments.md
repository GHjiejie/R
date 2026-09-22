# KRaft 架构实验手册

在 `demo-kafka-architecture/` 目录执行命令。先 `make up`，在页面初始化 Topic。每次故障实验结束，都要恢复对应节点并等待 ISR 回到 3，再进入下一项实验。

## 实验 1：先区分两种 Leader

打开“架构总览”，分别记录：

- 控制层 Active Controller 的节点 ID、Leader Epoch。
- `orders/P0`、`orders/P1`、`payments/P0` 的分区 Leader。

```bash
./scripts/lab.sh quorum
```

预期：3 个投票 Controller 中有 1 个 Leader；业务分区 Leader 位于 Broker 1–3。Controller 的 ID 为 101–103，不和业务 Broker 混淆。

观察 `HighWatermark` 和各节点 `LogEndOffset` / `Lag`。这些值反映元数据日志；即使没有发送订单，控制层也可能因内部记录而继续推进。

## 实验 2：Key、分区与顺序追加

1. 消息工作台选择 `orders`、`producer-1`，固定 Key `order-learning`，数量 10，自动分区。
2. 发送并记录回执。相同 Key 的消息应进入相同分区，Offset 递增。
3. 更换 `producer-2`，保持同一个 Key，再发送一批。
4. 勾选“为每条消息附加不同 Key”，发送 100 条，观察消息分布。
5. 显式指定另一个分区，验证显式分区优先于自动 Key 分区。

预期：消息通过分区 Leader 写入，回执返回实际分区和 Offset。不要把不同 Producer 上相同的 `sequence=0` 当成重复事件；sequence 仅表示该批次内的序号，event_id 才是业务唯一标识。

批量回执耗时包含发送、等待确认及 API 开销，只用于比较实验行为，不是严谨的吞吐基准。

## 实验 3：组间独立消费、组内负载分担

1. 在两个消费组中分别增加两个消费者。
2. 观察分区标签：同组成员分担分区，不同组可以同时读取相同分区。
3. 发送一批新事件，两个组的“去重后事件”都应增长。
4. 给履约组增加第三、第四个消费者。
5. 在初始 3 个分区的情况下，第四个消费者通常没有分区。
6. 停止一个有分区的成员，观察剩余成员的 Rebalance 和分配变化。

预期：分配变更可能短暂暂停消费。页面展示的本地 Worker 与 Kafka 组成员采样可能有数秒差异。

## 实验 4：积压与恢复

1. 给履约组中所有运行消费者设置每条延迟 1500 ms。
2. 发送 100 条不同 Key 的事件。
3. 观察履约组 Lag 增大，而分析组仍按自身速度处理。
4. 将延迟恢复为 0，等待履约组 Lag 回到 0。

预期：组间进度独立。队列可以暂存高峰，但长期写入速度超过消费能力仍会持续积压。

## 实验 5：只读回放与业务幂等

先做不会修改业务位移的回放：

1. 在工作台按分区、起始 Offset 读取日志。
2. 再次读取相同位置，仍能看到消息。
3. 观察消费组已提交位移不会因为该只读查询被重置。

再做真正的消费组回放：

1. 等分析组 Lag 回到 0，记下“去重后事件”数量。
2. 停止分析组所有消费者。
3. 点击“重置至最早”。若 Kafka 仍认为组内有成员，稍后重试。
4. 重新启动分析组消费者。
5. 在处理记录中观察“重复已跳过”。

预期：消费者重新读取历史事件，但唯一业务结果数不增加。幂等记录与 Kafka 日志独立持久化；若清空业务数据库，该去重效果自然不再保留。

## 实验 6：分区 Leader 故障转移

先查看 `orders/P0` 当前的 Leader；以下以 Broker 1 为例：

```bash
./scripts/lab.sh stop broker-1
```

等待故障检测后观察：Broker 数减少，ISR 从 3 缩为 2，原来位于该节点上的分区 Leader 迁移到存活副本。再次发送消息，满足 min ISR 的情况下可以确认成功。

恢复节点：

```bash
./scripts/lab.sh start broker-1
```

预期：副本重新追赶并进入 ISR。旧 Leader 不一定立即重新成为 Leader；这不代表恢复失败。

## 实验 7：两个 Broker 故障与可靠写入边界

先确认所有业务分区 ISR 为 3，然后执行：

```bash
./scripts/lab.sh stop broker-2
./scripts/lab.sh stop broker-3
```

待 ISR 为 1 后，从工作台发送到 `orders/P0`。预期在等待 / 重试后返回失败，或因元数据请求超时提示不可用；不能得到正常的可靠写入确认。

```bash
./scripts/lab.sh start broker-2
./scripts/lab.sh start broker-3
```

等待 ISR 恢复再发送。`acks=all` 不是“所有配置副本任何时候都必须存活”，它与 ISR、`min.insync.replicas` 共同决定成功条件。超时还可能存在结果不确定性，业务重试应保持稳定的幂等标识。

## 实验 8：Active Controller 切换

通过总览或 `quorum` 命令确定当前 Active；若 ID 为 103，对应 `controller-3`：

```bash
./scripts/lab.sh stop controller-3
./scripts/lab.sh quorum
```

预期：剩余两个 Controller 可以形成多数派，选出新的 Active，Leader Epoch 增长。数据分区 Leader 不必全部随之变化。

```bash
./scripts/lab.sh start controller-3
```

等待恢复的节点追上元数据日志。观察器在切换期间可能显示过期 / 不可达，不能把单次 TCP 探测成功当作 Raft 健康证明。

## 实验 9：丢失 Controller 多数派

```bash
./scripts/lab.sh stop controller-2
./scripts/lab.sh stop controller-3
```

观察 Quorum 采样是否停止推进，尝试创建新的元数据变更，例如增加 orders 分区。预期操作可能超时，新的元数据提交无法正常完成。已经存在且 Leader 正常的分区读写可能暂时继续，这与 Kafka 的状态和故障时序有关。

```bash
./scripts/lab.sh start controller-2
./scripts/lab.sh start controller-3
```

恢复后核对分区数量。**超时不保证变更未发生**，不要在不核对状态的情况下连续增加目标分区数。

## 实验 10：日志段和索引文件

打开“持久化日志”，查看相同分区在三个 Broker 上的文件：

- `.log`：消息批次的实际内容。
- `.index`：Offset 到文件位置的稀疏映射。
- `.timeindex`：时间戳到 Offset 的稀疏映射。

```bash
./scripts/lab.sh dump broker-1 orders 0
./scripts/lab.sh metadata controller-1
```

第一条解码业务日志，第二条解码控制层元数据日志。若最新日志段刚滚动而为空，可以先向该分区再发送消息。文件名是固定宽度的基准 Offset，不应照搬示意图中的任意位数。

默认 `segment.ms=60000`、`segment.bytes=1048576`。间隔超过一分钟后再次写入，通常可以观察到新的日志段。时间条件满足不代表空闲分区立刻自行滚动。

不要直接编辑或删除 Broker / Controller 的数据文件。保留策略的清理与消费确认无关。

## 实验 11：分区扩展与持久化重启

1. 实验室将 `orders` 从 2 个分区扩为 4 个。
2. 观察新分区及其副本，消费组触发 Rebalance。
3. 增加消费者，验证可分配的并行工作增加。
4. 重新发送之前的 Key，观察它可能映射到不同分区。

分区只能增加，不能通过这个接口缩回；历史消息不会自动迁移到新分区。

保留数据重启：

```bash
make down
make up
```

预期：Topic、消息、组位移、SQLite 业务去重记录仍在。API 中的运行消费者是内存管理对象，需要重新启动，随后按持久位移继续消费。

## 实验结束检查

- 三个 Controller 均可达，Active 采样有效。
- 三个 Broker 已注册，业务分区 ISR 全部回到 3。
- 无实验 Worker 处于未处理的 error 状态。
- 按需要停止消费者或 `make down`，减少本机资源占用。
