from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
from urllib.request import urlopen


directory = Path(__file__).resolve().parent.parent


def check(port):
    process = subprocess.Popen(
        [sys.executable, "tools/start.py"],
        cwd=directory,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert select.select([process.stdout], [], [], 5)[0], "Server did not start"
        assert process.stdout.readline().strip() == f"Serving HTTP at http://127.0.0.1:{port}/"
        for path in ("/", "/acouplet/"):
            with urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as response:
                assert response.status == 200
                assert response.read() == (directory / "public" / path.lstrip("/") / "index.html").read_bytes()
    finally:
        process.send_signal(signal.SIGINT)
        process.wait(timeout=5)
        process.stdout.close()


check(4173)
with socket.create_server(("127.0.0.1", 4173)):
    check(4174)
    with socket.create_server(("127.0.0.1", 4174)):
        check(4175)
print("Static server: default port, occupied-port fallback and both pages passed.")
