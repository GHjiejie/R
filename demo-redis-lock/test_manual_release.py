"""通过真实 Redis 和 HTTP 请求验证人工释放与锁交接。"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import redis

from manual_release_api import get_data_keys


class ManualReleaseTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = redis.Redis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=3,
        )
        self.client.ping()
        self.process = None
        self.snapshot = None
        self.log = tempfile.TemporaryFile(mode="w+")

    def start_demo(self, *args: str) -> None:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        self.base_url = f"http://127.0.0.1:{port}"
        self.process = subprocess.Popen(
            [
                sys.executable,
                str(Path(__file__).with_name("distributed_lock.py")),
                "--api-port",
                str(port),
                "--lock-ttl",
                "1",
                *args,
            ],
            stdout=self.log,
            stderr=subprocess.STDOUT,
        )

    def request(self, path: str, body: dict | None = None) -> tuple[int, dict]:
        request = Request(
            self.base_url + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def wait_for(self, predicate, timeout: float = 10) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                code, snapshot = self.request("/status")
                if code == 200:
                    self.snapshot = snapshot
                    if predicate(snapshot):
                        return snapshot
            except (URLError, TimeoutError):
                pass
            time.sleep(0.03)
        self.log.flush()
        self.log.seek(0)
        self.fail(f"等待演示状态超时：{self.snapshot}\n{self.log.read()}")

    def stop_demo(self) -> None:
        if self.process is not None and self.process.poll() is None:
            self.process.send_signal(signal.SIGINT)
            self.process.wait(timeout=12)

    def tearDown(self) -> None:
        try:
            self.stop_demo()
            if self.snapshot is not None:
                prefix = self.snapshot["key_prefix"]
                names = [s["name"] for s in self.snapshot["services"]]
                self.client.delete(f"{prefix}:lock", *get_data_keys(prefix, names))
        finally:
            self.log.close()
            self.client.close()

    def test_manual_release_and_handoffs(self) -> None:
        self.start_demo("--hold-seconds", "2")
        processing = self.wait_for(
            lambda s: s["lock"]["held"] and not s["lock"]["release_ready"]
        )
        first_token = processing["lock"]["token"]
        self.assertEqual(self.request("/lock/release", {"token": first_token})[0], 409)

        first = self.wait_for(lambda s: s["lock"]["release_ready"])
        self.assertEqual(first["shared_resource"]["value"], 1)
        # 超过 1 秒租约后仍是同一持有者，证明没有人工释放就不会自然接棒。
        time.sleep(1.4)
        _, unchanged = self.request("/status")
        self.assertEqual(unchanged["lock"]["token"], first_token)
        self.assertEqual(unchanged["stats"]["acquired"], 1)
        self.assertEqual(
            self.request("/lock/release", {"token": "wrong-token"})[0], 409
        )
        self.assertEqual(self.request("/lock/release", {})[0], 422)

        # 两个请求同时释放同一 token，只有一个请求成功。
        with ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(
                pool.map(
                    lambda _: self.request("/lock/release", {"token": first_token})[0],
                    range(2),
                )
            )
        self.assertEqual(replies.count(200), 1)
        self.assertTrue(all(code in (200, 404, 409) for code in replies))

        second = self.wait_for(
            lambda s: s["lock"]["release_ready"] and s["lock"]["token"] != first_token
        )
        second_token = second["lock"]["token"]
        self.assertEqual(second["shared_resource"]["value"], 2)
        self.assertEqual(self.request("/lock/release", {"token": first_token})[0], 409)
        self.assertEqual(self.request("/status")[1]["lock"]["token"], second_token)
        self.assertEqual(self.request("/lock/release", {"token": second_token})[0], 200)

        third = self.wait_for(
            lambda s: s["lock"]["release_ready"]
            and s["lock"]["token"] not in (first_token, second_token)
        )
        third_token = third["lock"]["token"]
        self.assertEqual(self.request("/lock/release", {"token": third_token})[0], 200)
        finished = self.wait_for(lambda s: s["finished"] and not s["lock"]["held"])
        self.assertEqual(finished["shared_resource"]["value"], 3)
        self.assertEqual(finished["stats"]["manual_released"], 3)
        self.assertEqual(finished["stats"]["completed"], 3)
        self.assertEqual(finished["stats"]["overlap"], 0)
        self.assertEqual(finished["active_operations"], 0)
        self.assertEqual(self.request("/lock/release", {"token": third_token})[0], 404)
        self.assertEqual(self.request("/health")[0], 200)

    def test_process_exit_stops_renewal(self) -> None:
        self.start_demo("--services", "1", "--hold-seconds", "0")
        state = self.wait_for(lambda s: s["lock"]["release_ready"])
        self.stop_demo()
        deadline = time.monotonic() + 3
        while self.client.exists(state["lock"]["key"]) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(self.client.exists(state["lock"]["key"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
