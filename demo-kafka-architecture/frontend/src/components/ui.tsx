import { useState, type ReactNode } from "react";
import { Check, Copy, Layers3 } from "lucide-react";
export const time = (value?: string | null) =>
  value
    ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false })
    : "等待采样";
export const fmt = (n?: number | null) =>
  n == null ? "—" : n.toLocaleString();
export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Layers3 size={26} />
      <p>{children}</p>
    </div>
  );
}
export function Panel({
  title,
  note,
  children,
  tools,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  tools?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {tools}
      </div>
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
}) {
  return (
    <div className="metric">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  );
}
export function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const points = data
    .map(
      (n, i) =>
        `${(i * 400) / Math.max(1, data.length - 1)},${68 - (n * 58) / max}`,
    )
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox="0 0 400 80"
      role="img"
      aria-label="消费积压趋势"
    >
      <path d="M0 70H400 M0 35H400" stroke="#e9edea" strokeDasharray="3 5" />
      <polyline
        fill="none"
        stroke="#158568"
        strokeWidth="2.5"
        points={points}
      />
    </svg>
  );
}
export function Command({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="command">
      <code>{value}</code>
      <button
        aria-label={`复制 ${value}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}
