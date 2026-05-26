#!/usr/bin/env python3
"""Starts a local HTTP server and opens the RAG viewer in the browser."""

import http.server
import socketserver
import threading
import webbrowser
import os
import json
import sys
import subprocess
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PORT = 7842
ROOT = Path(__file__).parent

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass  # suppress request logs

    def do_POST(self):
        """Handle POST requests for sync API."""
        if self.path.startswith('/api/sync'):
            self.handle_sync()
        else:
            self.send_error(405, "Method Not Allowed")

    def handle_sync(self):
        """Run sync for a project and return status."""
        content_length = int(self.headers.get('Content-Length', 0))
        try:
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body) if body else {}
            project_path = data.get('path', '').strip()
        except Exception:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid request"}).encode())
            return

        if not project_path:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Missing path"}).encode())
            return

        project_path = Path(project_path).resolve()
        if not project_path.exists():
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"Path not found: {project_path}"}).encode())
            return

        # Run sync.py
        sync_script = ROOT / 'scripts' / 'sync.py'
        try:
            result = subprocess.run(
                [sys.executable, str(sync_script), str(project_path)],
                capture_output=True,
                text=True,
                timeout=30
            )

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()

            response = {
                "success": result.returncode == 0,
                "output": result.stdout,
                "error": result.stderr if result.returncode != 0 else None
            }
            self.wfile.write(json.dumps(response).encode())
        except subprocess.TimeoutExpired:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Sync timeout"}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

def main():
    os.chdir(ROOT)
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}/viewer/index.html"
        print(f"RAG Viewer → {url}")
        print("Ctrl+C to stop\n")
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    main()
