import errno
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


port = 4173
handler = partial(SimpleHTTPRequestHandler, directory="public")

while True:
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), handler)
        break
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
        port += 1

with server:
    print(f"Serving HTTP at http://127.0.0.1:{port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
