# Scrineer — Session History

## Project Overview
Crypto screener terminal: Binance Futures API (REST + WebSocket). D3.js v7 charts. Coin panel with NATR/CH24h. Server on port 5000 at `176.97.70.161`.

## Current State (Working)
- **Chart library**: D3.js v7 — Full SVG rendering.
- **Server**: `server.py` — Multi-threaded proxy with RAM-buffers (prices + NATR).
- **Frontend**: `index.html` — Single-file app.
- **NATR**: **584/587 coins** have real-time NATR values, calculated server-side.
- **Loading**: Instant. Base list of 587 coins from RAM, prices from WebSocket.

## Architecture (Final)

### Server Side (`server.py`)
- **RAM Buffers** (no disk files):
    - `BASE_TICKERS` — 587 USDT pairs loaded once at startup.
    - `PRICE_BUFFER` — Stores latest price + timestamp for all coins. Data older than 30 minutes removed.
    - `NATR_BUFFER` — Stores calculated NATR values for all coins.
- **Price Collector**: WebSocket `!miniTicker@arr` fills `PRICE_BUFFER` in real-time.
- **NATR Worker**: Background thread. Fetches 5m klines → calculates NATR → stores in `NATR_BUFFER`. 0.1s delay between coins to avoid rate limits. Full cycle ~60 seconds.
- **Endpoints**:
    - `/api/tickers` — Combines BASE_TICKERS + PRICE_BUFFER + NATR_BUFFER into one JSON response. Uses 1-second micro-cache.
    - `/api/prices` — Raw PRICE_BUFFER.
    - `/api/natr` — Raw NATR_BUFFER.
    - `/api/*` — Proxy to Binance REST API.
- **Thread Safety**: `ThreadingMixIn` for concurrent requests.

### Frontend Side (`index.html`)
- **Initial Load**: `init()` → `/api/tickers` → `renderCoinTable()` creates table structure.
- **Live Updates**: `setInterval(fetchAllTickers, 2000)` → `/api/tickers` → `updateCoinTableValues()` updates only cell text (no flickering).
- **Prices**: Direct WebSocket `!miniTicker@arr` on frontend (for instant price updates).
- **Chart**: `fetchKlines()` → Binance REST for historical data. `connectKlineWS()` → Binance WebSocket for live candle.
- **WebSocket Fix**: `onclose = null` before `close()` to prevent recursive loop.

### Data Flow Summary
| Data | Source | Method |
|:---|:---|:---|
| Coin List + NATR | Server RAM | HTTP GET `/api/tickers` every 2s |
| Real-time Prices | Binance | WebSocket `!miniTicker@arr` |
| Chart Candles | Binance | REST `/klines` + WebSocket `@kline` |
| 24h Stats | Binance | REST `/ticker/24hr`, `/bookTicker` |

## Features Implemented

### Chart (D3.js v7)
- Candles: wick lines + body rects, body width scales with zoom, green/red
- Types: Toggle between Candles and Line chart
- Volumes: Histogram at bottom, color-synced with candles
- Grid: Horizontal lines at yScale ticks
- Y-axis: 18 ticks, JetBrains Mono font, `parseFloat(t.toFixed(6))` for trailing-zero removal
- Y-axis wheel zoom, X-axis zoom via d3.zoom with scaleExtent([1, 20])
- Crosshair: vertical line + horizontal line + price label, magnet snap to OHLC
- Price tag: Color-coded (green/red) floating tag at current price level
- Current price dashed line: From last candle to right edge

### Indicators
- SMA 20: yellow line
- Bollinger Bands 20,2: purple dashed lines + fill
- RSI 14: blue line in bottom pane, 30/70 reference lines
- Customizable: period and multiplier settings popup

### Auto-levels (Williams Fractals)
- Step=3, filtered (untouched levels only)
- Higher TF mapping: M1→M5, M5→M15, ..., 4h→1d
- Render as horizontal lines from fractal point to right edge

### Drawing Tools
- Horizontal line: dashed purple line, label on right
- Ray: two clicks, orange lines extending right
- Magnet: OHLC snapping toggle
- Eraser: clears all drawn lines

### Coin Table (Right Panel)
- All Binance Futures USDT perpetuals (587 pairs)
- Columns: Coin name, NATR, CH24h, OI5m
- Sortable by name/NATR/CH24h
- Search filter
- Smart updates: `updateCoinTableValues()` changes only text, no full re-render

## Key Variables (`index.html`)
- `activeCoin`, `activeInterval` — current symbol and timeframe
- `klineData[]` — candle data for chart
- `tickersData[]` — all tickers for right panel
- `coinPrices{}`, `changes24h{}`, `natrData{}` — real-time per-symbol data
- `fetchAllTickers()` — fetches from `/api/tickers`, calls `updateCoinTableValues()`
- `updateCoinTableValues()` — updates cell text without re-rendering table
- `renderCoinTable()` — full table structure rebuild (called on init/sort/search)
- `renderCandles()` — D3 candle rendering with zoom-aware width
- `renderVolumes()` — D3 volume histogram
- `renderCurrentPriceLine()` — dashed line from last candle to right edge
- `initChart()` — D3 SVG creation, scales, zoom, crosshair
- `connectKlineWS()` — WebSocket for live candle, with bugfix (`onclose = null`)

## Key Variables (`server.py`)
- `BASE_TICKERS[]` — 587 coin base info, loaded at startup
- `PRICE_BUFFER{}` — `{symbol: {p: float, t: timestamp}}`
- `NATR_BUFFER{}` — `{symbol: natr_float}`
- `TICKERS_CACHE` — 1-second micro-cache for `/api/tickers`
- `calc_natr(klines)` — NATR calculation with `float()` conversion
- `ws_price_collector()` — WebSocket thread for price collection
- `natr_background_worker()` — NATR calculation thread (60s cycle)

## Known Bugs Fixed
- [x] `SyntaxError: Unexpected token '}'` — Removed orphan duplicate code in `index.html`.
- [x] NATR always `-1` — Fixed `calc_natr()` to convert string kline values to `float()`.
- [x] WebSocket recursive loop — Added `klineWS.onclose = null` before `close()`.
- [x] `/api/tickers` timeouts — Added 1-second micro-cache.

## Competitor Research (wintrading.live)
- URL: https://wintrading.live/
- Login: minkailov.95@gmail.com
- Password: wAMATAWAMATA1212!

## ⚠️ CRITICAL — DO NOT CHANGE THESE URLS ⚠️

**Binance Futures WebSocket URLs use `/market/` path (not `/ws/`). This was changed in Binance API update April/May 2025. The old URLs connect but send NO data.**

```
❌ OLD (dead):   wss://fstream.binance.com/ws/!miniTicker@arr
❌ OLD (dead):   wss://fstream.binance.com/ws/btcusdt@kline_5m
❌ OLD (dead):   wss://fstream.binance.com/stream?streams=!miniTicker@arr

✅ NEW (works):  wss://fstream.binance.com/market/ws/!miniTicker@arr
✅ NEW (works):  wss://fstream.binance.com/market/ws/btcusdt@kline_5m
✅ NEW (works):  wss://fstream.binance.com/market/stream?streams=!miniTicker@arr
```

**Where these URLs live:**
- `server.py` line ~15: `BINANCE_WS = "wss://fstream.binance.com/market/stream?streams=!miniTicker@arr"`
- `index.html` line ~347: `var BINANCE_WS = 'wss://fstream.binance.com/market/stream?streams=';`
- `index.html` line ~349: `var BINANCE_WS_SINGLE = 'wss://fstream.binance.com/market/ws/';`

**Validated**: After this fix, PRICE_BUFFER fills with 480+ entries immediately.

## Known Issues / TODO
- OI5m column shows "—" (no open interest data)
- Right panel click-to-select doesn't consistently re-highlight active row

## Session 2025-05-31 (Part 3) — Rendering Fixes & Drawing Tools
- **Fixed "Standing Candles" Bug**: Migrated `renderCandles()` and `renderVolumes()` from "remove-all-and-recreate" to D3.js `.join()` pattern. Eliminated DOM churn, ensuring smooth real-time candle updates.
- **Ruler Tool Overhaul**:
    - Improved UX: auto-deactivates mode after the second click.
    - Enhanced visual: real-time data label (price + %) follows the crosshair during placement.
- **Ray Tool Redesign**:
    - Single-click placement: Ray now starts exactly at the crosshair point.
    - Settings Panel: Implemented a context menu for rays (color, thickness, custom text label, and deletion).
- **Indicator UI Update**: Removed checkboxes; active indicators are now highlighted by color and font weight.
- **Crosshair Improvements**:
    - Enabled free movement across the entire chart area, including the void space beyond the last candle.
    - Added a dynamic time label on the X-axis that tracks the crosshair position.
- **Text Tool Fix**: Fixed the button handler to correctly enter text placement mode.

## Files
- `/root/scrineer/index.html` — main app (single file: HTML + CSS + JS, D3.js v7)
- `/root/scrineer/server.py` — proxy + RAM-buffer server (4 threads)
- `/root/scrineer/monitor.py` — automated tester bot (Playwright/Chromium)
- `/root/scrineer/monitor.html` — test monitoring dashboard
- `/root/scrineer/docs/system.md` — technical documentation
- `/root/scrineer/tasks.json` — project tasks
- `/root/scrineer/tasks.html` — tasks viewer
- `/root/scrineer/session_history.md` — this file
- `/root/scrineer/test_results.json` — bot output (auto-generated)

## Session 2025-05-31 (Part 2) — Bug Fixes & Monitor Bot

### Bugs Fixed
6. **CH24h flickering (PORTAL 123%→18%)**: `fetchAllTickers()` overwrote live WS `changes24h` with stale BASE_TICKERS data every 2s. Fix: WS data takes priority; API data only for initial load.
7. **Full DOM re-render in WebSocket handler**: `connectPriceWS` called `renderCoinTable()` on every message (~1s). Fix: replaced with `updateCoinTableValues()`.
8. **Stale CH24h on server**: `BASE_TICKERS` loaded once at startup, never updated. `openPrice` (24h) never refreshed. Fix: added `openPrice` to BASE_TICKERS, recalculate `ch` from `PRICE_BUFFER` on every `/api/tickers` request.
9. **Periodic BASE_TICKERS refresh**: Added `ticker_refresh_worker()` thread — every 5 minutes fetches fresh 24h ticker data and updates `o`/`c`/`ch`/`v`.

### Monitor Bot (`monitor.py` v2)
Automated tester running in background (PID varies). Checks:
- **Backend**: HTTP endpoints, data structure, NaN/Inf, NATR fill%, static code analysis (`server.py`, `index.html`)
- **Frontend (Playwright/Chromium)**: JS errors, WebSocket status, D3 chart, coin table, API, price
- **Deep mode**: Flicker detector (6 samples/0.8s, CH24h jumps >10%), data consistency (front vs API), performance (DOM/SVG nodes, memory)
- **Indicators**: Toggle BB/SMA/RSI/Fractals via checkboxes, verify SVG elements render
- **Drawing tools**: All 9 buttons in DOM, HLine click test
- **Candle rendering**: Check X-ordering, wick-body containment, color variety, position stability
- **Candle watchdog**: Long-term observation mode, 30 min without page reload, 30s snapshots, compares consecutive frames, detects "price line moves but candles stay still"
- **Post-reload verification**: After 60 snapshots, reloads page, takes #61, compares all 60 against fresh render
- **Tab switching**: After each snapshot, switches to `about:blank`, returns before next — simulates real user behavior
- **Deduplication**: Static warnings not repeated every cycle

Commands: `--once`, `--deep`, `--interval N`, `--observe-candles`

### Monitor Dashboard (`monitor.html`)
- Status badge (OK/DEGRADED/ERROR/НАБЛЮДЕНИЕ)
- Last check summary, statistics bar
- Error/warning logs with timestamps and sources
- Check history (last 20)
- **Candle watchdog section**: progress bar (snaps/expected), anomaly count, last 5 snapshot coordinates table
- Auto-refresh every 5s
- Reads `test_results.json`

### Documentation (`docs/system.md`)
- Full architecture diagram
- Data flow table
- Critical Binance WebSocket URLs
- Server.py details: RAM buffers, cache, endpoints, threads
- Index.html details: state, init flow, render cycle, triggers, drawing tools, fmtNum
- WebSocket protocol and reconnection safety
- Known issues list
- Changelog

### Files Changed
- `index.html` — fetchAllTickers fix, WS handler fix
- `server.py` — openPrice in BASE_TICKERS, fresh ch calculation, ticker_refresh_worker
- `monitor.py` — full v2 rewrite (see above)
- `monitor.html` — candle watchdog section, status handling
- `docs/system.md` — new file
- `session_history.md` — this update

### Current State
- Server: running on port 5000
- Monitor bot: running with `--observe-candles` (or default loop)
- 30-min candle observation completed: 60 snapshots, 0 anomalies, post-reload comparison clean
- Rendering: migrated to D3 .join() pattern for candles & volumes (fixes "standing candles" bug)
- Settings panel: PyQt6 Cyan floating toolbar design (horizontal, #1E1E1E, cyan accents)
- 20 design variants available in `panels2.html` for comparison
- Tools: fully interactive (hover highlight, left-click drag, right-click close panels)

## Session 2025-05-31 (Part 5) — Tools Interaction & Settings Panel Redesign

### Changes
1. **Ray/Tools Interaction**: Redesigned to wintrading style:
   - Hover → highlight (with 10px invisible hit area for easy targeting)
   - Mousedown (left click) → opens settings panel + starts drag mode
   - Drag (hold left button + move) → moves the tool
   - Mouseup → ends drag, settings panel stays open
   - Right-click outside panel → closes it
2. **Settings Panel** (Ray & Text): Complete redesign:
   - Horizontal floating toolbar layout (all controls in one row)
   - Dark background `#1E1E1E`, border-radius `12px`, cyan accent `#06B6D4`
   - Color swatches (5 preset colors) + circular color picker
   - Line style selector (solid/dashed `<select>`)
   - Thickness input, text label, delete button
   - Panels are draggable by the handle
3. **X-axis**: Fixed time formatting using `d3.scaleLinear` with custom `tickFormat` (HH:MM).
   - Removed custom `xAxisTimeLabel` that was conflicting with `renderAxes()`
4. **Fractal Price Labels**: Now rendered on `yAxisG` (right Y-axis) with rounded `rect` background (low opacity) and colored text (red/green).
5. **Ray Text Labels**: Added dark rounded `rect` background with colored border behind the text on the chart.
6. **Color Palette**: Added 5 preset color swatches (gold, green, red, purple, white) to ray & text panels.
7. **Design Explorer**: Created `panels.html` (10 CSS variants) and `panels2.html` (20 variants including 10 PyQt6 floating toolbar colors).
8. **Fixed syntax error**: Missing `if (drawMode === 'ruler' && pendingRuler) {` guard was causing JS parse error.

### Files Changed
- `index.html` — tools interaction, settings panel redesign, fractal labels, ray labels
- `panels.html` — 10 CSS design variants (new)
- `panels2.html` — 20 design variants including 10 PyQt6 colors (new)
- `docs/system.md` — updated documentation
- `session_history.md` — this update

## Session 2025-06-01 — V2 (PixiJS) Migration

### Stack Change
- **FROM**: Vanilla JS + D3.js SVG (monolithic `index.html`)
- **TO**: TypeScript + PixiJS v8 (WebGL) + Vite

### What was built
1. **Project scaffold**: Vite + TypeScript + PixiJS project in `v2/`
2. **Core**: types, constants, utils (fmtNum, calcSMA/BB/RSI/fractals)
3. **Chart Engine** (PixiJS): candles, volumes, grid, Y-axis prices, X-axis time, crosshair (dashed)
4. **WebSocket**: WSManager (price + kline), RingBuffer
5. **Drawing tools**: Ray, rect, text, ruler, hline via Canvas (DrawingManager)
6. **main.ts**: Init, tickers, coin table with sort/search, TF buttons, info blocks, price updates
7. **Server**: Runs in tmux session for persistence
8. **Documentation**: `docs/architecture.md`, `docs/next.md`, `docs/bugs.md`, `docs/howto.md`

### Known gaps (from V1)
- No indicators on chart (SMA, BB, RSI) — code in utils, no PixiJS render
- No fractals — code in utils, no render
- Dashed lines not working (PixiJS v8 has no stroke dash)
- Settings panel for tools not fully integrated
- Zoom/pan primitive (only range squeeze)
- No magnet (snap to OHLC)
- No fractal price labels on Y-axis
- Crosshair Y-axis label only (no X-axis time follow)

### Files Changed
- `v2/` — complete rewrite
- `server.py` — now serves `v2/dist/`
- `docs/` — 4 new doc files
- `session_history.md` — this update
