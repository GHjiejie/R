import { api } from "../api";
import { useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  CircleHelp,
  RotateCcw,
  Send,
} from "lucide-react";
import type { Receipt, Replay, PageProps } from "../types";
import { Badge, Empty, Panel } from "../components/ui";
export default function Messages({ state, busy, act }: PageProps) {
  const [topic, setTopic] = useState("orders");
  const [producer, setProducer] = useState("producer-1");
  const [key, setKey] = useState("order-1001");
  const [count, setCount] = useState(10);
  const [partition, setPartition] = useState("auto");
  const [vary, setVary] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [readTopic, setReadTopic] = useState("orders");
  const [readPartition, setReadPartition] = useState(0);
  const [start, setStart] = useState(0);
  const [replay, setReplay] = useState<Replay | null>(null);
  async function send() {
    const result = await act(() =>
      api<Receipt>("/messages", {
        topic,
        producer,
        key,
        count,
        partition: partition === "auto" ? null : Number(partition),
        vary_keys: vary,
        amount_minor: 19900,
      }),
    );
    if (result) setReceipt(result);
  }
  async function read(offset = start) {
    const result = await act(() =>
      api<Replay>(
        `/messages/replay?topic=${readTopic}&partition=${readPartition}&start=${offset}&limit=30`,
      ),
    );
    if (result) {
      setReplay(result);
      setStart(offset);
    }
  }
  return (
    <>
      <div className="two-columns message-columns">
        <Panel
          title="发布业务事件"
          note="3 个真实 Producer 客户端，启用幂等、批处理和 acks=all。"
        >
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="form-row">
              <label>
                Producer
                <select
                  aria-label="Producer"
                  value={producer}
                  onChange={(e) => setProducer(e.target.value)}
                >
                  {[1, 2, 3].map((i) => (
                    <option key={i}>producer-{i}</option>
                  ))}
                </select>
              </label>
              <label>
                Topic
                <select
                  aria-label="发送 Topic"
                  value={topic}
                  onChange={(e) => {
                    setTopic(e.target.value);
                    setPartition("auto");
                  }}
                >
                  <option>orders</option>
                  <option>payments</option>
                </select>
              </label>
            </div>
            <label>
              消息 Key
              <input
                value={key}
                maxLength={100}
                required
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <div className="form-row">
              <label>
                消息数量
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  required
                />
              </label>
              <label>
                目标分区
                <select
                  aria-label="目标分区"
                  value={partition}
                  onChange={(e) => setPartition(e.target.value)}
                >
                  <option value="auto">按 Key 自动分区</option>
                  {state?.topics
                    .find((t) => t.name === topic)
                    ?.partitions.map((p) => (
                      <option value={p.id} key={p.id}>
                        Partition {p.id}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={vary}
                onChange={(e) => setVary(e.target.checked)}
              />
              为每条消息附加不同 Key（观察分布）
            </label>
            <div className="info-box">
              <CircleHelp size={17} />
              <p>
                相同 Key 在分区数与分区策略不变时进入相同分区。各分区独立递增
                Offset，不保证跨分区全局顺序。
              </p>
            </div>
            <button className="button" disabled={busy || !state?.topics.length}>
              <Send size={16} />
              {busy ? "处理中…" : "发送事件"}
            </button>
          </form>
        </Panel>
        <Panel
          title="生产回执"
          note="只有收到 Broker 成功确认的消息，才计入确认数量。"
        >
          {receipt ? (
            <>
              <div className="receipt-summary">
                <div>
                  <b>{receipt.acknowledged}</b>
                  <span>已确认</span>
                </div>
                <div>
                  <b>{receipt.failed}</b>
                  <span>失败</span>
                </div>
                <div>
                  <b>{receipt.pending}</b>
                  <span>结果待定</span>
                </div>
                <div>
                  <b>{receipt.duration_ms}</b>
                  <span>耗时 ms</span>
                </div>
              </div>
              {receipt.failures.length > 0 && (
                <p className="alert error">
                  {receipt.failures[0].error}
                  。失败或超时不能直接视作业务绝对未写入。
                </p>
              )}
              <div className="table-wrap receipt-table">
                <table>
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>分区</th>
                      <th>Offset</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipt.receipts.map((r) => (
                      <tr key={r.event_id}>
                        <td className="mono">{r.key}</td>
                        <td>P{r.partition}</td>
                        <td>{r.offset}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <Empty>发送消息后，查看每条消息的分区和 Offset</Empty>
          )}
        </Panel>
      </div>
      <Panel
        title="消息回放"
        note="直接指定分区和 Offset 读取；不修改任何业务消费组的位移。"
      >
        <div className="toolbar">
          <label>
            Topic
            <select
              aria-label="回放 Topic"
              value={readTopic}
              onChange={(e) => {
                setReadTopic(e.target.value);
                setReadPartition(0);
                setReplay(null);
              }}
            >
              <option>orders</option>
              <option>payments</option>
            </select>
          </label>
          <label>
            分区
            <select
              aria-label="回放分区"
              value={readPartition}
              onChange={(e) => {
                setReadPartition(Number(e.target.value));
                setReplay(null);
              }}
            >
              {(
                state?.topics.find((t) => t.name === readTopic)?.partitions ?? [
                  { id: 0 },
                ]
              ).map((p) => (
                <option value={p.id} key={p.id}>
                  P{p.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            起始 Offset
            <input
              type="number"
              min={0}
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </label>
          <button
            className="button secondary"
            disabled={busy || start < 0}
            onClick={() => void read()}
          >
            <RotateCcw size={16} />
            读取日志
          </button>
        </div>
        {replay && (
          <div className="replay-bounds">
            保留范围 [{replay.low}, {replay.high}) · 本次读取{" "}
            {replay.messages.length} 条
            {replay.truncated_start &&
              " · 起始位置已过期，自动从当前最早位置读取"}
          </div>
        )}
        {replay?.messages.length ? (
          <div className="event-list">
            {replay.messages.map((m) => (
              <details key={m.offset}>
                <summary>
                  <Badge tone="green">
                    P{m.partition} · #{m.offset}
                  </Badge>
                  <strong>{m.key}</strong>
                  <span>{new Date(m.timestamp).toLocaleTimeString()}</span>
                  <ChevronRight size={15} />
                </summary>
                <pre>{JSON.stringify(m.value, null, 2)}</pre>
              </details>
            ))}
            <button
              className="button secondary"
              disabled={busy || replay.next_offset >= replay.high}
              onClick={() => void read(replay.next_offset)}
            >
              读取下一批 <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <Empty>
            {replay
              ? "该分区在指定位置没有可读消息"
              : "选择一个分区，开始查看它的消息日志"}
          </Empty>
        )}
      </Panel>
    </>
  );
}
