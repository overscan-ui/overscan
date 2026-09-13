#!/usr/bin/env python3
"""A plain static server for the gates and the element harnesses.

    python3 tools/static_server.py [port]     # default 8842, serves the repo

Nothing here is specific to a preview: no-store on every response, byte ranges
for media, cross-origin isolation, and the media types the stdlib lacks. The
element harnesses need all four, so a bare `python3 -m http.server` is not a
substitute. tools/serve.py builds its preview server on this handler.

Cache-Control: no-store on everything, deliberately. iOS Safari will serve a
months-old stylesheet against freshly fetched HTML, so a fix looks inert and
the screenshots argue with you. A ?v= query is not enough, because the module
graph is cached separately. Serve from a no-store handler on a port that has
never run a plain http.server: a port that has is already poisoned.
"""
import os
import pathlib
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    # Media types the stdlib table gets wrong or lacks. A caption file served as
    # text/plain is ignored by the <track> that asked for it.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.vtt': 'text/vtt'}

    def do_GET(self):
        if self._ranged():
            return
        return super().do_GET()

    def _ranged(self):
        """Answer a byte-range request with 206, or return False to serve normally.

        🔴 A MEDIA ELEMENT CANNOT SEEK A FILE SERVED WITHOUT RANGES. The stdlib
        handler answers every request 200 with the whole file, so on this server
        a <video>'s seekable range stayed at what it had downloaded and ov-player
        had nothing honest to put on its bar. Only files, and one range per
        request, which is all a media element asks for.
        """
        m = re.match(r'bytes=(\d*)-(\d*)$', self.headers.get('Range') or '')
        if not m or not (m.group(1) or m.group(2)):
            return False
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return False
        size = os.path.getsize(path)
        if m.group(1):
            start = int(m.group(1))
            end = min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
        else:
            start, end = max(0, size - int(m.group(2))), size - 1
        if start > end:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.end_headers()
            return True
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        with open(path, 'rb') as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(65536, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break
                left -= len(chunk)
        return True

    def _send(self, data, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        # Cross-origin isolation, so performance.now() is not clamped to 100us.
        # Measured: under the clamp every profiling number is useless, and with
        # COOP/COEP the tick here is about 0.005 ms instead.
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        # credentialless rather than require-corp: it still gives
        # crossOriginIsolated, and it does not break the cross-origin font the
        # variable-axis demo loads, which require-corp would have silently
        # blocked while the page carried on claiming an axis it did not have.
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8842
    handler = partial(Handler, directory=str(ROOT))
    ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
