import type { State } from "../types";
import { Badge, Empty, Panel, fmt, time } from "./ui";
export function QuorumPanel({ state }: { state: State | null }) {
  const q = state?.quorum;
  return (
    <Panel
      title="Raft 元数据复制"
      note="来自 kafka-metadata-quorum 的真实采样；TCP 可达只表示端口可连接。"
      tools={
        <Badge tone={q?.stale ? "amber" : "green"}>
          {q?.stale ? "采样缺失 / 已过期" : `${q?.age_seconds ?? "—"} 秒前`}
        </Badge>
      }
    >
      <div className="quorum-stats">
        <span>
          Leader Epoch <b>{fmt(q?.leader_epoch)}</b>
        </span>
        <span>
          High Watermark <b>{fmt(q?.high_watermark)}</b>
        </span>
        <span>
          Max Follower Lag <b>{fmt(q?.max_follower_lag)}</b>
        </span>
      </div>
      {q?.error && <p className="inline-note">{q.error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>节点</th>
              <th>角色</th>
              <th>Log End Offset</th>
              <th>Lag</th>
              <th>最近追平时间</th>
            </tr>
          </thead>
          <tbody>
            {q?.replication?.map((r) => (
              <tr key={r.NodeId}>
                <td className="mono">{r.NodeId}</td>
                <td>
                  <Badge tone={r.Status === "Leader" ? "green" : ""}>
                    {r.Status}
                  </Badge>
                </td>
                <td>{r.LogEndOffset}</td>
                <td>{r.Lag}</td>
                <td className="mono">
                  {r.LastCaughtUpTimestamp === "-1"
                    ? "—"
                    : new Date(
                        Number(r.LastCaughtUpTimestamp),
                      ).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="inline-note">
        101–103 是有投票权的 Controller；1–3 是 Broker，可能作为 Observer
        出现在复制列表中。复制表采样年龄：{q?.replication_age_seconds ?? "—"}{" "}
        秒。
      </p>
    </Panel>
  );
}
export function ActivityPanel({ state }: { state: State | null }) {
  return (
    <Panel title="集群活动" note="主题初始化、生产回执和消费者再均衡记录。">
      <div className="activity-list">
        {state?.activity.length ? (
          state.activity.slice(0, 10).map((a) => (
            <div key={a.id}>
              <span className="activity-dot" />
              <time>{time(a.created_at)}</time>
              <Badge>{a.kind}</Badge>
              <span>{a.message}</span>
            </div>
          ))
        ) : (
          <Empty>完成一次操作后，活动会显示在这里</Empty>
        )}
      </div>
    </Panel>
  );
}
