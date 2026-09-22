import { api } from "../api";
import { useEffect, useState } from "react";
import { Database, Activity, Layers3, RefreshCw } from "lucide-react";
import type { Storage, Act } from "../types";
import { Badge, Empty, Panel, Command, fmt } from "../components/ui";
export default function StoragePage({
  busy,
  act,
}: {
  busy: boolean;
  act: Act;
}) {
  const [data, setData] = useState<Storage | null>(null);
  const [broker, setBroker] = useState("1");
  async function load() {
    const result = await act(() => api<Storage>("/storage"));
    if (result) setData(result);
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <div className="storage-explainer">
        <div>
          <Database size={22} />
          <h3>.log</h3>
          <p>顺序追加的消息批次。文件名是日志段的基准 Offset。</p>
        </div>
        <div>
          <Layers3 size={22} />
          <h3>.index</h3>
          <p>Offset 到文件位置的稀疏索引，用于加速定位。</p>
        </div>
        <div>
          <Activity size={22} />
          <h3>.timeindex</h3>
          <p>时间戳到 Offset 的索引，支持按时间定位消息。</p>
        </div>
      </div>
      <Panel
        title="Broker 磁盘文件"
        note="API 以只读方式挂载三个 Broker 数据卷，不修改 Kafka 日志。"
        tools={
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw size={15} />
            刷新文件
          </button>
        }
      >
        <div className="tabs">
          {["1", "2", "3"].map((id) => (
            <button
              key={id}
              className={broker === id ? "active" : ""}
              onClick={() => setBroker(id)}
            >
              Broker {id}
            </button>
          ))}
        </div>
        {data?.unavailable_brokers.length ? (
          <p className="alert error">
            数据卷未挂载：Broker {data.unavailable_brokers.join(", ")}
            。请使用完整 Docker Compose 环境。
          </p>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>分区目录</th>
                <th>文件名</th>
                <th>大小</th>
                <th>最后修改</th>
              </tr>
            </thead>
            <tbody>
              {data?.files
                .filter((f) => String(f.broker) === broker)
                .map((f) => (
                  <tr key={`${f.partition}/${f.name}`}>
                    <td>
                      <Badge>{f.partition}</Badge>
                    </td>
                    <td className="mono">{f.name}</td>
                    <td>{fmt(f.bytes)} B</td>
                    <td>
                      {new Date(f.modified_at * 1000).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!data?.files.length && (
            <Empty>初始化主题并发送消息后，刷新查看日志文件</Empty>
          )}
        </div>
        <p className="inline-note">
          当前展示最多 600 个文件（实际 {data?.total_files ?? "—"}{" "}
          个）。索引文件可能预分配空间；文件大小不等于消息数量。消费不会删除日志，清理由保留策略控制。
        </p>
      </Panel>
      <Panel
        title="读取日志段的内容"
        note="下面的命令只读取本实验集群的日志段。"
      >
        <Command value={`./scripts/lab.sh dump broker-${broker} orders 0`} />
        <p className="inline-note">
          控制层元数据日志另存于 Controller 数据卷的
          __cluster_metadata-0；它不承载业务消息。
        </p>
        <Command value="./scripts/lab.sh metadata controller-1" />
      </Panel>
    </>
  );
}
