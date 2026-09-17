"""实际 HTTP 与进程重启验证，不使用模型 mock，也不调用外部模型。"""

import json
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import httpx

PROJECT = Path(__file__).resolve().parents[2]


@contextmanager
def server(root: Path, port: int):
    program = """
import sys
from pathlib import Path
import uvicorn
from backend.app.config import Settings
from backend.app.main import create_app
app = create_app(Settings(data_dir=Path(sys.argv[1])))
uvicorn.run(app, host='127.0.0.1', port=int(sys.argv[2]), access_log=False, log_level='error')
"""
    process = subprocess.Popen(
        [sys.executable, "-c", program, str(root), str(port)],
        cwd=PROJECT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        with httpx.Client(
            base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=2
        ) as client:
            deadline = time.monotonic() + 10
            while True:
                if process.poll() is not None:
                    raise AssertionError("后端启动失败。")
                try:
                    response = client.get("/health")
                    if response.status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                if time.monotonic() >= deadline:
                    raise AssertionError("后端未能在等待期限内启动。")
                time.sleep(0.05)
            yield client
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        process.stderr.close()


def test_actual_http_restart_preserves_tasks_and_recovers_interruption(tmp_path):
    with socket.socket() as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]

    description = "用于功能验证的虚构非机密项目，采用 PEM 电解水制氢，规模和地点未确定。"
    with server(tmp_path, port) as client:
        assert client.get("/health").json()["key_configured"] is False
        created = client.post("/api/v1/tasks", json={"description": description})
        assert created.status_code == 201
        task = created.json()
        stream = client.post(f"/api/v1/tasks/{task['id']}/outline", json={})
        assert "event: error" in stream.text and "MISSING_KEY" in stream.text
        assert client.get("/api/v1/budget").json()["spent_or_reserved_cny"] == "0"

    # 仅修改本测试拥有的记录，模拟进程在生成中断；此时前一个服务已停止。
    path = tmp_path / "tasks" / f"{task['id']}.json"
    record = json.loads(path.read_text(encoding="utf-8"))
    record["status"] = "generating"
    path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")

    with server(tmp_path, port) as client:
        restored = client.get(f"/api/v1/tasks/{task['id']}").json()
        assert restored["description"] == description
        assert restored["status"] == "interrupted"
        assert restored["error"]["code"] == "INTERRUPTED"
        assert restored["attempts"] == 0
        assert client.get("/api/v1/budget").json()["spent_or_reserved_cny"] == "0"
