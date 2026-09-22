# 实际验证记录

验证日期：2026-09-22（Asia/Shanghai）。

环境：macOS Apple Silicon、Docker Engine 29.4.0、Apache Kafka 4.1.2；容器内 Python 3.12，`confluent-kafka` 2.15.1；React + TypeScript + Vite 构建，Chromium 浏览器验收。

## 已通过的检查

| 检查 | 实际结果 |
| --- | --- |
| Docker Compose 配置 | 解析通过，三个专用 Controller、三个专用 Broker 均成功启动 |
| Python 单元测试 | 9 项通过：事务去重、并发重复处理、持久记录、Quorum 解析、过期采样、无 Leader、子进程退出 / 超时隔离 |
| Python 静态检查 | Ruff 通过 |
| 前端生产构建 | TypeScript 类型检查、Vite 构建通过；容器构建通过 |
| 真实集群集成测试 | 1 项端到端测试通过，内部包含多个断言，见下节 |
| 浏览器端到端测试 | 2 项通过：真实操作流程；390 px 移动视口导航及无页面横向溢出 |
| 业务日志解码 | 官方工具成功输出消息批次、LZ4 压缩、Key、Offset 和事件 JSON |
| 元数据日志解码 | 官方工具成功读取 `__cluster_metadata-0` 中的 LeaderChange 等控制记录 |
| 分区扩展 | `orders` 从 2 扩为 3，新分区 ISR 为 `[3,1,2]`；缩回 2 被接口以 422 拒绝 |
| 文档与脚本 | README 存在；Markdown 代码块配对正常；Shell 语法检查通过 |

## 端到端测试实际断言

`make integration` 使用真实 API 和集群，不替换 Kafka 服务：

1. 初始化两个业务 Topic，并检查 Broker 数、Controller Leader 和三副本。
2. 向固定分区发送 12 条消息，确认全部获得写入回执且 Offset 连续。
3. 从回执对应位置读回 12 条相同 Key 的消息。
4. 为两个消费组各创建两个消费者，检查各组独立处理事件并追平位移。
5. 检查运行中的消费组不能重置位移。
6. 停止分析组、重置并重放，检查重复事件不增加业务结果。
7. 检查三个 Broker 日志卷可读，并存在 `.log`、`.index`、`.timeindex`。

浏览器测试实际点击发送、只读回放、增加消费者、修改处理延迟、停止消费者、查看磁盘文件和实验页面。桌面视口为 1440 × 1000，移动视口为 390 × 844。

## 故障实验记录

执行 `python3 scripts/verify_faults.py` 得到以下结果：

| 实验 | 观测结果 |
| --- | --- |
| 停止 Active Controller | Active 从 102 切换为 101，Leader Epoch 增长到 4 |
| 停止 `orders/P0` 分区 Leader | Leader 从 Broker 1 切换为 Broker 2，ISR 变为 `[2,3]` |
| 一个 Broker 离线时写入 | 3 条消息全部获得成功确认 |
| 第二个 Broker 离线，ISR=1 | 1 条测试消息在约 10 秒后超时：确认 0、失败 1、待定 0 |
| 恢复节点 | 三个 Broker 恢复，全部业务分区重新达到 ISR=3 |
| 同时重启三个 Broker | 重启后成功读回已确认的 `persistence-check` 消息，本次 Offset 为 31 |
| 故障过程 API 稳定性 | 修正后的整轮故障实验中，API 容器重启次数为 0 |

这些 ID / Offset 是当次实验结果，不是每次运行必须出现的固定值。不同选举顺序和已有数据会改变它们。

## 测试发现并修正的问题

- 显式副本分配需要同时提供分区数量，已修正初始化参数。
- 重启后的验收不能使用重启前的缓存快照判断就绪，脚本改为等待新的采样时间。
- 一次 Broker 断连实验触发旧客户端底层的 Coordinator Admin 断言，导致进程退出。客户端已更新，消费组查询 / 位移管理放入有界子进程，并补充异常退出与超时测试。上游有[相同断言的报告](https://github.com/confluentinc/librdkafka/issues/4605)；本项目不依赖“新版必然修复”的假设来保护 API。
- 下拉框补充明确的无障碍名称，浏览器真实操作复测通过。
- Nginx 使用 Docker DNS 动态解析 API，支持 API 容器重建后继续代理。
- `LeaderId=-1` 按“尚未选出 Leader”处理，不展示为正常 Active。

## 验证范围

本轮实际执行了上表列出的检查。实验手册还提供了“双 Controller 同时故障导致多数派丢失”的手工流程；该流程未在本轮自动验收中执行。

没有执行跨主机 / 跨可用区容灾、长期稳定性压测、严谨吞吐基准、安全渗透或生产数据恢复演练，不能据此宣称已达到生产上线标准。

运行环境中保留了验收消息、业务记录和扩展后的分区，因此当前 `orders` 为 3 个分区；全新数据卷的默认拓扑仍为原图对应的 `orders=2`、`payments=1`。
