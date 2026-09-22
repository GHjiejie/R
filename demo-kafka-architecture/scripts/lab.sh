#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
action="${1:-help}"
node="${2:-}"
validate_node() {
  case "$node" in broker-[123]|controller-[123]) ;; *) echo '节点只能是 broker-1..3 或 controller-1..3' >&2; exit 2;; esac
}
case "$action" in
  up) docker compose up -d --build --wait --wait-timeout 240 ;;
  down) docker compose down ;;
  status) docker compose ps ;;
  logs) docker compose logs --tail=100 ;;
  start|stop) validate_node; docker compose "$action" "$node" ;;
  quorum)
    docker compose exec -T quorum-observer /opt/kafka/bin/kafka-metadata-quorum.sh \
      --bootstrap-controller controller-1:9093,controller-2:9093,controller-3:9093 describe --status
    docker compose exec -T quorum-observer /opt/kafka/bin/kafka-metadata-quorum.sh \
      --bootstrap-controller controller-1:9093,controller-2:9093,controller-3:9093 describe --replication
    ;;
  dump)
    validate_node
    case "$node" in broker-*) ;; *) echo 'dump 只接受 Broker' >&2; exit 2;; esac
    topic="${3:-orders}"; partition="${4:-0}"
    case "$topic" in orders|payments) ;; *) echo '主题只能为 orders 或 payments' >&2; exit 2;; esac
    [[ "$partition" =~ ^[0-9]+$ ]] || exit 2
    docker compose exec -T "$node" bash -c '
      shopt -s nullglob
      files=(/var/lib/kafka/data/"$1-$2"/*.log)
      ((${#files[@]})) || { echo "日志段不存在" >&2; exit 1; }
      /opt/kafka/bin/kafka-dump-log.sh --files "${files[-1]}" --print-data-log
    ' _ "$topic" "$partition"
    ;;
  metadata)
    validate_node
    case "$node" in controller-*) ;; *) echo 'metadata 只接受 Controller' >&2; exit 2;; esac
    docker compose exec -T "$node" bash -c '
      shopt -s nullglob
      files=(/var/lib/kafka/data/__cluster_metadata-0/*.log)
      ((${#files[@]})) || { echo "元数据日志不存在" >&2; exit 1; }
      /opt/kafka/bin/kafka-dump-log.sh --cluster-metadata-decoder --files "${files[-1]}"
    '
    ;;
  *) cat <<'EOF'
用法：./scripts/lab.sh <操作> [参数]
  up / down / status / logs      启动、停止（保留数据）、状态、日志
  stop|start broker-1             受控故障实验，节点编号 1..3
  stop|start controller-1         Controller 选举实验
  quorum                         查看 Raft 状态与复制进度
  dump broker-1 orders 0          解码最新的业务日志段
  metadata controller-1          解码最新的控制层元数据日志
EOF
    ;;
esac
