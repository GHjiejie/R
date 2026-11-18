"""为演示启动独立的 Redis，或复用 REDIS_URL 指定的实例。"""

import os
import shutil
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from redis import Redis
from redis.exceptions import ConnectionError


def wait_until_ready(server, socket, client):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise SystemExit("临时 Redis 启动失败，请检查 redis-server。")
        if socket.exists():
            try:
                client.ping()
                return
            except ConnectionError:
                pass
        time.sleep(0.03)
    raise SystemExit("等待临时 Redis 启动超时。")


@contextmanager
def open_redis():
    url = os.environ.get("REDIS_URL")
    if url:
        with Redis.from_url(url, decode_responses=True, socket_connect_timeout=3, socket_timeout=3) as client:
            client.ping()
            print("已连接 REDIS_URL 指定的 Redis。")
            yield client
        return

    executable = shutil.which("redis-server")
    if not executable:
        raise SystemExit("未找到 redis-server。请安装本地 Redis，或设置 REDIS_URL 连接已有实例。")

    # macOS 的系统临时目录可能超过 Unix socket 的路径长度限制。
    with TemporaryDirectory(prefix="cache-demo-", dir="/tmp") as directory:
        socket = Path(directory) / "redis.sock"
        command = [
            executable, "--port", "0", "--unixsocket", str(socket),
            "--unixsocketperm", "700", "--dir", directory,
            "--save", "", "--appendonly", "no",
        ]
        with subprocess.Popen(command, stdout=subprocess.DEVNULL) as server:
            try:
                with Redis(unix_socket_path=str(socket), decode_responses=True, socket_timeout=3) as client:
                    wait_until_ready(server, socket, client)
                    print("已启动本次演示专用的 Redis。")
                    yield client
            finally:
                if server.poll() is None:
                    server.terminate()
