import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ChevronRight,
  FlaskConical,
  Database,
  Layers3,
  Network,
  Plus,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { api } from "./api";
import type { State } from "./types";
import {
  Badge,
  Empty,
  Metric,
  Panel,
  Sparkline,
  fmt,
  time,
} from "./components/ui";
import { ActivityPanel, QuorumPanel } from "./components/ClusterDetails";
import Messages from "./pages/Messages";
import Consumers from "./pages/Consumers";
import StoragePage from "./pages/StoragePage";
import Experiments from "./pages/Experiments";
const pages = [
  {
    id: "overview",
    title: "架构总览",
    sub: "从控制层到数据层，观察真实集群的每一次变化。",
    icon: Network,
  },
  {
    id: "messages",
    title: "消息工作台",
    sub: "发送事件，追踪分区与 Offset，再从日志中读回它们。",
    icon: Send,
  },
  {
    id: "consumers",
    title: "消费者与位移",
    sub: "观察组间广播、组内分工，以及业务处理与位移提交。",
    icon: Users,
  },
  {
    id: "storage",
    title: "持久化日志",
    sub: "查看 Broker 数据卷中的真实日志段、位置索引和时间索引。",
    icon: Database,
  },
  {
    id: "experiments",
    title: "架构实验室",
    sub: "通过可重复的操作，验证架构图中的每一条连接。",
    icon: FlaskConical,
  },
];
export default function App() {
  const [page, setPage] = useState("overview");
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fetching = useRef(false);
  const [history, setHistory] = useState<number[]>([]);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setRefreshing(true);
    try {
      const value = await api<State>("/state");
      setState(value);
      setError("");
      setHistory((h) => [
        ...h.slice(-23),
        value.groups.reduce((n, g) => n + (g.lag ?? 0), 0),
      ]);
    } catch (e) {
      setError(`连接失败：${(e as Error).message}。请检查 API 服务。`);
    } finally {
      fetching.current = false;
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 6000);
    return () => clearInterval(id);
  }, [refresh]);
  async function act<T>(
    work: () => Promise<T>,
    message?: string,
  ): Promise<T | undefined> {
    setBusy(true);
    setNotice("");
    try {
      const result = await work();
      if (message) setNotice(message);
      void refresh();
      return result;
    } catch (e) {
      setNotice(`操作失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  const selected = pages.find((p) => p.id === page)!;
  const live = state?.status === "online" && !error;
  const partitions =
    state?.topics.flatMap((t) =>
      t.partitions.map((p) => ({ ...p, topic: t.name })),
    ) ?? [];
  const initialized = (state?.topics.length ?? 0) === 2;
  const lag = state?.groups.every((g) => g.lag !== null)
    ? state.groups.reduce((n, g) => n + (g.lag ?? 0), 0)
    : null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("overview");
          }}
        >
          <span className="brand-mark">
            <Network size={24} />
          </span>
          <span>
            KRaft Lab<small>分布式架构实验台</small>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="主导航">
          {pages.map((p) => (
            <button
              key={p.id}
              className={page === p.id ? "nav-item active" : "nav-item"}
              onClick={() => setPage(p.id)}
            >
              <p.icon size={18} />
              {p.title}
              {page === p.id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={19} />
          <strong>真实集群 · 实时观察</strong>
          <p>
            3 Controllers + 3 Brokers
            <br />
            数据来自 Kafka 与磁盘，
            <br />每 6 秒刷新一次。
          </p>
          <span className="small-tag">KRaft / 无 ZooKeeper</span>
        </div>
        <div className="sidebar-bottom">
          <span className={`dot ${live ? "" : "amber"}`} />
          本地学习环境 <span>v1.0</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            实验工作区 <ChevronRight size={13} />
            <span>{selected.title}</span>
          </div>
          <div className="topbar-right">
            <span className="mono">Apache Kafka 4.1</span>
            <Badge tone={live ? "green" : "amber"}>
              <span className="dot" />
              {live
                ? "集群在线"
                : state?.status === "degraded"
                  ? "集群降级"
                  : "等待连接"}
            </Badge>
          </div>
        </header>
        <div className="workspace">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                KAFKA ARCHITECTURE /{" "}
                {String(pages.indexOf(selected) + 1).padStart(2, "0")}
              </div>
              <h1>{selected.title}</h1>
              <p>{selected.sub}</p>
            </div>
            <button
              className="button secondary"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <RefreshCw size={16} className={refreshing ? "spin" : ""} />
              刷新数据
            </button>
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error} {state && "当前显示上次成功采样的数据。"}
            </div>
          )}
          {notice && (
            <div
              className={`alert ${notice.startsWith("操作失败") ? "error" : "success"}`}
              role="status"
            >
              {notice}
              <button aria-label="关闭提示" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {state?.errors?.length ? (
            <details className="alert error">
              <summary>集群报告 {state.errors.length} 个异常</summary>
              {state.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </details>
          ) : null}
          {!initialized && (
            <div className="setup-banner">
              <div>
                <strong>准备好你的第一次消息旅程</strong>
                <p>
                  创建 orders（2 分区）与 payments（1 分区），每个分区拥有 3
                  个副本。
                </p>
              </div>
              <button
                className="button"
                disabled={busy || !state || state.status === "offline"}
                onClick={() =>
                  void act(
                    () => api("/initialize", {}),
                    "主题已准备好，等待下一次元数据刷新。",
                  )
                }
              >
                <Plus size={16} />
                初始化主题
              </button>
            </div>
          )}
          {page === "overview" && (
            <>
              <div className="metrics">
                <Metric
                  label="BROKER 节点"
                  value={`${state?.brokers.length ?? "—"} / 3`}
                  note="独立的数据存储层"
                  icon={<Server />}
                />
                <Metric
                  label="ACTIVE CONTROLLER"
                  value={
                    state?.quorum.stale
                      ? "—"
                      : String(state?.quorum.leader_id ?? "—")
                  }
                  note={`Raft Epoch ${fmt(state?.quorum.leader_epoch)}`}
                  icon={<ShieldCheck />}
                />
                <Metric
                  label="业务分区"
                  value={String(partitions.length)}
                  note={`${state?.topics.length ?? 0} Topics · 副本因子 3`}
                  icon={<Layers3 />}
                />
                <Metric
                  label="消费积压"
                  value={fmt(lag)}
                  note="两个消费组 Lag 合计"
                  icon={<Activity />}
                />
              </div>
              <Panel
                title="集群实时拓扑"
                note="控制层管理元数据；业务消息直接在 Producer、Broker 与 Consumer 之间流动。"
                tools={
                  <span className="legend">
                    <i />
                    Leader <i className="follower" />
                    Follower
                  </span>
                }
              >
                <div className="topology">
                  <div className="plane-label">
                    <ShieldCheck size={15} />
                    控制层 <span>CONTROLLER QUORUM</span>
                    <Badge tone="green">Raft 共识</Badge>
                  </div>
                  <div className="controller-grid">
                    {[101, 102, 103].map((id, i) => {
                      const node = state?.quorum.nodes?.find(
                        (n) => n.id === id,
                      );
                      const leader =
                        state?.quorum.leader_id === id &&
                        !state?.quorum.stale &&
                        node?.reachable;
                      return (
                        <div
                          className={`controller-card ${leader ? "leader" : ""}`}
                          key={id}
                        >
                          <ShieldCheck size={21} />
                          <div>
                            <strong>Controller {i + 1}</strong>
                            <small>Node {id}</small>
                          </div>
                          <Badge
                            tone={
                              leader ? "green" : !node?.reachable ? "amber" : ""
                            }
                          >
                            {!node
                              ? "待采样"
                              : !node.reachable
                                ? "不可达"
                                : state?.quorum.stale
                                  ? "角色待确认"
                                  : leader
                                    ? "Active"
                                    : "Standby"}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                  <div className="plane-connector">
                    <ArrowDown size={16} />
                    <span>Broker 注册 · 心跳 · 元数据更新</span>
                    <ArrowDown size={16} />
                  </div>
                  <div className="data-flow">
                    <div className="flow-edge">
                      <div className="edge-icon orange">
                        <Send size={23} />
                      </div>
                      <strong>Producers</strong>
                      <small>3 个独立客户端</small>
                      <span>按 Key / 分区写入</span>
                      <button onClick={() => setPage("messages")}>
                        发送消息 <ArrowRight size={13} />
                      </button>
                    </div>
                    <div className="broker-grid">
                      {[1, 2, 3].map((id) => (
                        <div className="broker-card" key={id}>
                          <div className="broker-title">
                            <Server size={17} />
                            <strong>Broker {id}</strong>
                            <span
                              className={`dot ${state?.brokers.some((b) => b.id === id) ? "" : "amber"}`}
                            />
                          </div>
                          <div className="replicas">
                            {partitions
                              .filter((p) => p.replicas.includes(id))
                              .map((p) => (
                                <div
                                  key={`${p.topic}-${p.id}`}
                                  className={`replica ${p.leader === id ? "is-leader" : ""}`}
                                >
                                  <div>
                                    <strong>{p.topic}</strong>
                                    <span>P{p.id}</span>
                                  </div>
                                  <small>
                                    {p.leader === id
                                      ? "◆ Leader"
                                      : "◇ Follower"}
                                    <span
                                      className={
                                        !p.isrs.includes(id)
                                          ? "warning-text"
                                          : ""
                                      }
                                    >
                                      {p.isrs.includes(id) ? "ISR ✓" : "ISR 外"}
                                    </span>
                                  </small>
                                </div>
                              ))}
                            {!partitions.length && (
                              <p className="muted tiny">初始化主题后显示副本</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flow-edge">
                      <div className="edge-icon purple">
                        <Users size={23} />
                      </div>
                      <strong>Consumers</strong>
                      <small>2 个独立消费组</small>
                      <span>按分区拉取消息</span>
                      <button onClick={() => setPage("consumers")}>
                        管理消费组 <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="topology-caption">
                    <span>
                      <span className="dot" />
                      真实元数据 · {time(state?.updated_at)}
                    </span>
                    <span>3 副本 / min ISR 2 / acks all</span>
                  </div>
                </div>
              </Panel>
              <div className="two-columns">
                <Panel
                  title="分区与副本"
                  note="Offset 是分区内的位置，不是全局消息编号。"
                >
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>主题 / 分区</th>
                          <th>Leader</th>
                          <th>ISR</th>
                          <th>日志末端</th>
                        </tr>
                      </thead>
                      <tbody>
                        {partitions.map((p) => (
                          <tr key={`${p.topic}-${p.id}`}>
                            <td>
                              <strong>{p.topic}</strong>{" "}
                              <span className="muted">/ P{p.id}</span>
                            </td>
                            <td>B{p.leader}</td>
                            <td>
                              <Badge
                                tone={
                                  p.isrs.length === p.replicas.length
                                    ? "green"
                                    : "amber"
                                }
                              >
                                {p.isrs.length} / {p.replicas.length}
                              </Badge>
                            </td>
                            <td className="mono">{fmt(p.high)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!partitions.length && <Empty>主题尚未初始化</Empty>}
                  </div>
                </Panel>
                <Panel title="消费进度" note="最近 24 次浏览器采样的总积压量。">
                  <div className="lag-chart">
                    <strong>
                      {fmt(lag)}
                      <small>条待处理</small>
                    </strong>
                    <Sparkline data={history} />
                    {state?.groups.map((g) => (
                      <div className="group-summary" key={g.id}>
                        <span>{g.id}</span>
                        <Badge>{g.members.length} 个成员</Badge>
                        <b>{fmt(g.lag)}</b>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
              <QuorumPanel state={state} />
              <ActivityPanel state={state} />
            </>
          )}
          {page === "messages" && (
            <Messages state={state} busy={busy} act={act} />
          )}
          {page === "consumers" && (
            <Consumers state={state} busy={busy} act={act} />
          )}
          {page === "storage" && <StoragePage busy={busy} act={act} />}
          {page === "experiments" && (
            <Experiments state={state} busy={busy} act={act} />
          )}
          <footer>
            <span>KRaft Lab · Python + React</span>
            <span>最近集群采样 {time(state?.updated_at)} · 仅供本地实验</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
