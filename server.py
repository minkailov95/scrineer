#!/usr/bin/env python3
import http.server
import urllib.request
import urllib.error
import json
import sys
import socketserver
import threading
import time
import os
import websocket 
 
PROXY_PORT = 5000
BINANCE_FAPI = "https://fapi.binance.com"
BINANCE_WS = "wss://fstream.binance.com/market/stream?streams=!miniTicker@arr"
 
# RAM Buffers
BASE_TICKERS = [] # Base symbols and info
PRICE_BUFFER = {} # { 'BTCUSDT': {'p': 60000.0, 't': 1716...}, ... }
NATR_BUFFER = {}  # { 'BTCUSDT': 0.12, ... }
TICKERS_CACHE = {'data': [], 'time': 0}  # 1-second micro-cache for /api/tickers
 
def calc_natr(klines):
    if len(klines) < 15: return -1
    tr_sum = 0
    for i in range(len(klines) - 14, len(klines)):
        h = float(klines[i][2])
        l = float(klines[i][3])
        pc = float(klines[i-1][4])
        tr = max(h - l, abs(h - pc), abs(l - pc))
        tr_sum += tr
    atr = tr_sum / 14
    close = float(klines[-1][4])
    return (atr / close) * 100
 
def ws_price_collector():
    """Connects to Binance WS and fills PRICE_BUFFER"""
    def on_message(ws, message):
        try:
            data = json.loads(message)
            if 'data' in data:
                for t in data['data']:
                    sym = t['s']
                    PRICE_BUFFER[sym] = {
                        'p': float(t['c']),
                        't': time.time()
                    }
        except Exception as e:
            print(f"[WS] Error: {e}")
 
    def on_error(ws, error):
        print(f"[WS] Error: {error}")
 
    def on_close(ws, close_status_code, close_msg):
        print("[WS] Closed. Reconnecting...")
 
    ws = websocket.WebSocketApp(BINANCE_WS,
                              on_message=on_message,
                              on_error=on_error,
                              on_close=on_close)
    ws.run_forever()
 
def price_buffer_cleaner():
    """Removes data older than 30 minutes"""
    while True:
        now = time.time()
        to_delete = [sym for sym, val in PRICE_BUFFER.items() if now - val['t'] > 1800]
        for sym in to_delete:
            del PRICE_BUFFER[sym]
        time.sleep(1)
 
def natr_background_worker():
    """Slowly calculates NATR for all pairs and updates NATR_BUFFER"""
    while True:
        try:
            with urllib.request.urlopen(f"{BINANCE_FAPI}/fapi/v1/ticker/24hr") as r:
                tickers = json.loads(r.read().decode())
            
            valid_tickers = [t for t in tickers if t['symbol'].endswith('USDT')]
            
            for t in valid_tickers:
                sym = t['symbol']
                try:
                    with urllib.request.urlopen(f"{BINANCE_FAPI}/fapi/v1/klines?symbol={sym}&interval=5m&limit=20", timeout=5) as kr:
                        kls = json.loads(kr.read().decode())
                        natr_val = calc_natr(kls)
                        if natr_val >= 0:
                            NATR_BUFFER[sym] = natr_val
                except Exception as e:
                    pass  # Skip silently to avoid rate limits
                time.sleep(0.1) # Avoid 429
            print("[NATR] Full update completed")
        except Exception as e:
            print(f"[NATR] Error: {e}")
        time.sleep(60) # Update NATR every minute
 
def ticker_refresh_worker():
    """Periodically refreshes BASE_TICKERS with fresh 24hr data to prevent stale openPrice"""
    while True:
        try:
            with urllib.request.urlopen(f"{BINANCE_FAPI}/fapi/v1/ticker/24hr") as r:
                fresh = json.loads(r.read().decode())
            fresh_map = {}
            for t in fresh:
                if t['symbol'].endswith('USDT'):
                    fresh_map[t['symbol']] = t

            updated = 0
            for base in BASE_TICKERS:
                sym = base['symbol']
                if sym in fresh_map:
                    ft = fresh_map[sym]
                    base['c'] = float(ft['lastPrice'])
                    base['o'] = float(ft['openPrice'])
                    base['ch'] = float(ft['priceChangePercent'])
                    base['v'] = float(ft['quoteVolume'])
                    updated += 1

            print(f"[TICKERS] BASE_TICKERS обновлено: {updated} монет")
        except Exception as e:
            print(f"[TICKERS] Error: {e}")
        time.sleep(300)  # каждые 5 минут

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/tickers":
            self.serve_full_tickers()
        elif self.path == "/api/prices":
            self.send_json(PRICE_BUFFER)
        elif self.path == "/api/natr":
            self.send_json(NATR_BUFFER)
        elif self.path.startswith("/api/"):
            self.proxy_binance()
        elif self.path.startswith("/ws/"):
            self.send_error(404)
        else:
            super().do_GET()
 
    def serve_full_tickers(self):
        """Returns combined list: Base Info + Current Price + NATR with 1s cache"""
        try:
            global BASE_TICKERS, PRICE_BUFFER, NATR_BUFFER, TICKERS_CACHE
            now = time.time()
            
            if TICKERS_CACHE['data'] and (now - TICKERS_CACHE['time']) < 1:
                self.send_json(TICKERS_CACHE['data'])
                return
                
            if not BASE_TICKERS:
                self.send_json([])
                return
                
            combined = []
            for base in BASE_TICKERS:
                sym = base['symbol']
                price_info = PRICE_BUFFER.get(sym, {'p': base['c']})
                natr_val = NATR_BUFFER.get(sym, -1)
                current_price = price_info['p']
                open_price = base.get('o', base['c'])
                ch = ((current_price - open_price) / open_price * 100) if open_price > 0 else base['ch']
                combined.append({
                    'symbol': sym,
                    's': base['s'],
                    'c': current_price,
                    'ch': ch,
                    'v': base['v'],
                    'natr': natr_val
                })
            
            TICKERS_CACHE = {'data': combined, 'time': now}
            self.send_json(combined)
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())
 
    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
 
    def proxy_binance(self):
        path = self.path[4:]
        target_url = f"{BINANCE_FAPI}{path}"
        try:
            req = urllib.request.Request(target_url)
            req.add_header("Accept", "application/json")
            resp = urllib.request.urlopen(req, timeout=10)
            data = resp.read()
            self.send_response(resp.status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
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
        pass
 
if __name__ == "__main__":
    import os
    os.chdir("/root/scrineer")
    
    try:
        print("[server] Loading base tickers...")
        with urllib.request.urlopen(f"{BINANCE_FAPI}/fapi/v1/ticker/24hr") as r:
            all_t = json.loads(r.read().decode())
            BASE_TICKERS = [
                {'symbol': t['symbol'], 's': t['symbol'].replace('USDT', ''), 'c': float(t['lastPrice']), 'ch': float(t['priceChangePercent']), 'o': float(t['openPrice']), 'v': float(t['quoteVolume'])}
                for t in all_t if t['symbol'].endswith('USDT')
            ]
        print(f"[server] Loaded {len(BASE_TICKERS)} coins")
    except Exception as e:
        print(f"[server] Critical error loading base tickers: {e}")
        BASE_TICKERS = []
    
    threading.Thread(target=ws_price_collector, daemon=True).start()
    threading.Thread(target=price_buffer_cleaner, daemon=True).start()
    threading.Thread(target=natr_background_worker, daemon=True).start()
    threading.Thread(target=ticker_refresh_worker, daemon=True).start()
    
    print(f"Serving on port {PROXY_PORT} with RAM buffers")
    class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
        pass
    server = ThreadedHTTPServer(("0.0.0.0", PROXY_PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()





