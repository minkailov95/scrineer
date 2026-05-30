#!/usr/bin/env python3
import http.server
import urllib.request
import urllib.error
import json
import sys

PROXY_PORT = 5000
BINANCE_FAPI = "https://fapi.binance.com"
BINANCE_FSTREAM = "https://fstream.binance.com"

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/"):
            self.proxy_binance()
        elif self.path.startswith("/ws/"):
            self.send_error(404)
        else:
            super().do_GET()

    def proxy_binance(self):
        path = self.path[4:]  # remove /api/ prefix
        target_url = f"{BINANCE_FAPI}{path}"
        
        try:
            req = urllib.request.Request(target_url)
            req.add_header("Accept", "application/json")
            resp = urllib.request.urlopen(req, timeout=10)
            data = resp.read()
            
            self.send_response(resp.status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        if "/api/" in str(args[0]):
            print(f"[proxy] {args[0]}")
        else:
            pass

if __name__ == "__main__":
    import os
    os.chdir("/root/scrineer")
    print(f"Serving /root/scrineer on port {PROXY_PORT}")
    print(f"Proxy: /api/fapi/v1/* -> {BINANCE_FAPI}")
    server = http.server.HTTPServer(("0.0.0.0", PROXY_PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
