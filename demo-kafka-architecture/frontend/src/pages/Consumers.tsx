import { api } from "../api";
import { Plus, RotateCcw, Square, Users } from "lucide-react";
import type { PageProps } from "../types";
import { Badge, Empty, Panel, fmt, time } from "../components/ui";
const groups = ["lab-fulfillment", "lab-analytics"];
export default function Consumers({ state, busy, act }: PageProps) {
  return (
    <>
      <div className="info-box standalone">
        <Users size={19} />
        <p>
          <strong>同组分担，跨组独立。</strong>两个消费组都订阅 orders 和
          payments。新建成员触发 Rebalance；没有分区分配的成员会空闲。
        </p>
      </div>
      <div className="two-columns">
        {groups.map((group) => {
          const g = state?.groups.find((g) => g.id === group);
          const workers = state?.workers.filter((w) => w.group === group) ?? [];
          const result = state?.results.find((r) => r.group_id === group);
          const active = workers.filter(
            (w) => !["stopped", "error"].includes(w.state),
          );
          return (
            <Panel
              key={group}
              title={group}
              note={
                group === groups[0]
                  ? "履约业务 · 独立消费进度"
                  : "分析业务 · 独立消费进度"
              }
              tools={
                <Badge tone={g?.state === "stable" ? "green" : ""}>
                  {g?.state ?? "未启动"}
                </Badge>
              }
            >
              <div className="consumer-stats">
                <div>
                  <strong>{active.length}</strong>
                  <span>运行实例</span>
                </div>
                <div>
                  <strong>{fmt(g?.lag)}</strong>
                  <span>消费积压</span>
                </div>
                <div>
                  <strong>{fmt(result?.unique_events ?? 0)}</strong>
                  <span>去重后事件</span>
                </div>
              </div>
              <div className="consumer-actions">
                <button
                  className="button"
                  disabled={busy || !state?.topics.length || active.length >= 6}
                  onClick={() =>
                    void act(
                      () => api("/consumers", { group, delay_ms: 0 }),
                      "消费者正在加入，分区分配将在再均衡后更新。",
                    )
                  }
                >
                  <Plus size={15} />
                  增加消费者
                </button>
                <button
                  className="button secondary"
                  disabled={
                    busy || !!active.length || !g || g.state === "not_started"
                  }
                  onClick={() =>
                    void act(
                      () =>
                        api("/offsets/reset", { group, position: "earliest" }),
                      "位移已重置。重新启动消费者可验证幂等处理。",
                    )
                  }
                >
                  <RotateCcw size={15} />
                  重置至最早
                </button>
              </div>
              <div className="workers">
                {workers.length ? (
                  workers.slice(-8).map((w) => (
                    <div className="worker" key={w.id}>
                      <div className="worker-title">
                        <span
                          className={`dot ${w.state === "running" ? "" : "amber"}`}
                        />
                        <strong className="mono">{w.id}</strong>
                        <Badge>{w.state}</Badge>
                        <button
                          aria-label={`停止 ${w.id}`}
                          className="icon-button"
                          disabled={
                            busy || ["stopped", "error"].includes(w.state)
                          }
                          onClick={() =>
                            void act(
                              () =>
                                api(`/consumers/${w.id}`, undefined, "DELETE"),
                              "消费者已停止，其他成员将重新分配分区。",
                            )
                          }
                        >
                          <Square size={14} />
                        </button>
                      </div>
                      <div className="assignment">
                        {w.assignment.length ? (
                          w.assignment.map((p) => (
                            <span key={`${p.topic}-${p.partition}`}>
                              {p.topic} / P{p.partition}
                            </span>
                          ))
                        ) : (
                          <span>暂无分区分配</span>
                        )}
                      </div>
                      <div className="worker-bottom">
                        <small>
                          处理 {w.processed} · 去重 {w.duplicates}
                        </small>
                        <label>
                          单条延迟
                          <select
                            aria-label={`${w.id} 单条延迟`}
                            value={w.delay_ms}
                            disabled={
                              busy || ["stopped", "error"].includes(w.state)
                            }
                            onChange={(e) =>
                              void act(() =>
                                api(
                                  `/consumers/${w.id}`,
                                  { delay_ms: Number(e.target.value) },
                                  "PATCH",
                                ),
                              )
                            }
                          >
                            <option value={0}>0 ms</option>
                            <option value={500}>500 ms</option>
                            <option value={1500}>1500 ms</option>
                            <option value={3000}>3000 ms</option>
                          </select>
                        </label>
                      </div>
                      {w.error && (
                        <p className="warning-text tiny">{w.error}</p>
                      )}
                    </div>
                  ))
                ) : (
                  <Empty>增加消费者，开始处理事件</Empty>
                )}
              </div>
              {g?.offsets.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>分区</th>
                        <th>已提交</th>
                        <th>末端</th>
                        <th>Lag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.offsets.map((p) => (
                        <tr key={`${p.topic}-${p.partition}`}>
                          <td>
                            {p.topic} / P{p.partition}
                          </td>
                          <td>{fmt(p.committed)}</td>
                          <td>{fmt(p.high)}</td>
                          <td>{fmt(p.lag)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {g?.error && (
                <details className="inline-note">
                  <summary>消费组状态详情</summary>
                  {g.error}
                </details>
              )}
            </Panel>
          );
        })}
      </div>
      <Panel
        title="最近处理记录"
        note="业务记录持久化到 SQLite；相同消费组的相同 event_id 只产生一份业务结果。"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>消费组 / 实例</th>
                <th>事件</th>
                <th>分区 / Offset</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {state?.attempts.slice(0, 30).map((a) => (
                <tr key={a.id}>
                  <td>{time(a.created_at)}</td>
                  <td>
                    {a.group_id}
                    <small className="block muted mono">{a.consumer_id}</small>
                  </td>
                  <td className="mono">{a.event_id}</td>
                  <td>
                    {a.topic} / P{a.partition_id} / {a.offset_id}
                  </td>
                  <td>
                    <Badge tone={a.duplicate ? "amber" : "green"}>
                      {a.duplicate ? "重复已跳过" : "处理成功"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!state?.attempts.length && <Empty>还没有业务处理记录</Empty>}
        </div>
      </Panel>
    </>
  );
}
