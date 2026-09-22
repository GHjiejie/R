import { api } from "../api";
import { useState } from "react";
import { Boxes, FlaskConical } from "lucide-react";
import type { PageProps } from "../types";
import { Panel, Command } from "../components/ui";
export default function Experiments({ state, busy, act }: PageProps) {
  const [count, setCount] = useState(4);
  const leader = state?.quorum.leader_id;
  const controller = leader ? leader - 100 : 1;
  const broker =
    state?.topics.find((t) => t.name === "orders")?.partitions[0]?.leader ?? 1;
  const experiments = [
    {
      title: "验证同 Key 分区与顺序",
      tag: "01 / PRODUCE",
      content:
        "在消息工作台固定 Key，发送 10 条消息。比较回执中的分区与递增 Offset；再切换 Producer 重复发送。顺序范围是分区内，不是全局。",
      commands: [],
    },
    {
      title: "消费组分工与再均衡",
      tag: "02 / CONSUME",
      content:
        "在两个消费组分别启动消费者。它们独立读取同一批事件；为同组增加实例，观察分区重新分配。初始共有 3 个分区，第四个成员通常空闲。",
      commands: [],
    },
    {
      title: "积压、恢复与幂等回放",
      tag: "03 / REPLAY",
      content:
        "把消费者延迟调到 1500 ms，发送一批消息，观察 Lag 增长。恢复 0 ms 后等待追平。停止该组所有实例，重置到最早位置再启动：处理记录显示“重复已跳过”，业务计数不重复增加。",
      commands: [],
    },
    {
      title: "Broker 故障与分区 Leader 切换",
      tag: "04 / DATA PLANE",
      content: `当前 orders/P0 的 Leader 为 Broker ${broker}。停止它，观察 ISR 缩小、其他副本成为 Leader；仍有两个同步副本时可以继续写入。结束后恢复节点并等待 ISR 追平。`,
      commands: [
        `./scripts/lab.sh stop broker-${broker}`,
        `./scripts/lab.sh start broker-${broker}`,
      ],
    },
    {
      title: "Active Controller 选举",
      tag: "05 / CONTROL PLANE",
      content: `当前采样的 Active Controller 为 ${leader ?? "待确认"}。停止它后，剩余两节点构成多数派，选出新的 Active Controller，Leader Epoch 增加。与分区 Leader 选举分别观察。`,
      commands: [
        `./scripts/lab.sh stop controller-${controller}`,
        "./scripts/lab.sh quorum",
        `./scripts/lab.sh start controller-${controller}`,
      ],
    },
    {
      title: "副本可靠性与持久化",
      tag: "06 / DURABILITY",
      content:
        "依次停止两个 Broker，待 ISR 缩为 1 后发送消息：min ISR=2 与 acks=all 将阻止成功确认。恢复节点后再发送。重启集群但保留数据卷，已有消息和组位移仍可读取。",
      commands: [
        "./scripts/lab.sh stop broker-2",
        "./scripts/lab.sh stop broker-3",
        "./scripts/lab.sh start broker-2",
        "./scripts/lab.sh start broker-3",
      ],
    },
    {
      title: "Controller 多数派丢失",
      tag: "07 / RAFT QUORUM",
      content:
        "停止两个 Controller 后，集群失去元数据多数派，不能可靠提交新的元数据变更。已有分区的数据读写可能暂时继续；不要把控制层失效简单等同于所有请求立即失败。恢复两个节点后观察采样恢复。",
      commands: [
        "./scripts/lab.sh stop controller-2",
        "./scripts/lab.sh stop controller-3",
        "./scripts/lab.sh start controller-2",
        "./scripts/lab.sh start controller-3",
      ],
    },
  ];
  return (
    <>
      <div className="info-box standalone">
        <FlaskConical size={20} />
        <p>
          故障操作在项目目录的终端执行；每次只做一组实验并恢复节点。网页不挂载
          Docker Socket，也不接受任意系统命令。
        </p>
      </div>
      <div className="experiments-grid">
        {experiments.map((e) => (
          <section className="experiment" key={e.tag}>
            <div className="eyebrow">{e.tag}</div>
            <h2>{e.title}</h2>
            <p>{e.content}</p>
            {e.commands.map((c) => (
              <Command value={c} key={c} />
            ))}
          </section>
        ))}
      </div>
      <Panel
        title="扩展分区 · 增加消费并行度"
        note="只扩展 orders，最多 24 个分区。扩分区不能撤销，也可能改变相同 Key 后续消息的分区映射。"
      >
        <div className="toolbar">
          <label>
            目标分区总数
            <input
              type="number"
              min={
                (state?.topics.find((t) => t.name === "orders")?.partitions
                  .length ?? 0) + 1
              }
              max={24}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <button
            className="button secondary"
            disabled={
              busy ||
              count <=
                (state?.topics.find((t) => t.name === "orders")?.partitions
                  .length ?? 0) ||
              count > 24
            }
            onClick={() =>
              void act(
                () =>
                  api("/partitions", { topic: "orders", partitions: count }),
                "分区已扩展。请观察新分区、副本和消费组分配。",
              )
            }
          >
            <Boxes size={16} />
            扩展 orders 分区
          </button>
        </div>
        <p className="inline-note">
          本地实验包含六个独立 Kafka
          节点，但都在同一台机器上。横向扩容到不同主机还需要容量规划、网络、安全和副本重分配；详见项目文档。
        </p>
      </Panel>
    </>
  );
}
