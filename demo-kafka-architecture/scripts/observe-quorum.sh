#!/usr/bin/env bash
set -u
mkdir -p /observations
cat > /tmp/observer.properties <<'EOF'
request.timeout.ms=5000
default.api.timeout.ms=8000
EOF
while true; do
  for mode in status replication; do
    if /opt/kafka/bin/kafka-metadata-quorum.sh \
      --bootstrap-controller controller-1:9093,controller-2:9093,controller-3:9093 \
      --command-config /tmp/observer.properties describe "--$mode" \
      > "/observations/$mode.tmp" 2> "/observations/$mode.error"; then
      mv "/observations/$mode.tmp" "/observations/$mode.txt"
      chmod 644 "/observations/$mode.txt"
    fi
  done
  sleep 5
done
