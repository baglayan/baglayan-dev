from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen


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
        for path in ("/asdasd", "/missing/nested/page", "/updates/missing.xml"):
            for method in ("GET", "HEAD"):
                try:
                    urlopen(Request(f"http://127.0.0.1:{port}{path}", method=method), timeout=5)
                except HTTPError as response:
                    with response:
                        assert response.code == 404
                        assert response.headers.get_content_type() == "text/html"
                        expected = (directory / "public" / "404.html").read_bytes()
                        assert int(response.headers["Content-Length"]) == len(expected)
                        assert response.read() == (expected if method == "GET" else b"")
                else:
                    raise AssertionError(f"Missing path returned success: {path}")
    finally:
        process.send_signal(signal.SIGINT)
        process.wait(timeout=5)
        process.stdout.close()


check(4173)
with socket.create_server(("127.0.0.1", 4173)):
    check(4174)
    with socket.create_server(("127.0.0.1", 4174)):
        check(4175)
print("Static server: port fallback, both pages and custom 404 GET/HEAD responses passed.")
