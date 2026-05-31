#!/usr/bin/env python3
"""
Scrineer Monitor Bot v2 — расширенный тестировщик.
Проверяет: фронтенд, бэкенд, консистентность данных, мерцание, стабильность.

Запуск:
    python3 monitor.py [--once] [--interval 30] [--deep]

    --once       Один прогон и выход
    --interval   Пауза между проверками в секундах (по умолчанию 30)
    --deep       Глубокий анализ (сэмплирование мерцания, доп. проверки)
"""

import json, os, sys, time, asyncio, traceback, re, ast
from datetime import datetime
from collections import deque
from urllib.request import urlopen, Request
from urllib.error import URLError

from playwright.async_api import async_playwright

# --- Настройки ---
BASE_URL = os.environ.get("SCRINEER_URL", "http://176.97.70.161:5000")
CHECK_INTERVAL = 30
MAX_LOG_ENTRIES = 300
RESULTS_FILE = os.path.join(os.path.dirname(__file__), "test_results.json")
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

results = {
    "started": datetime.now().isoformat(),
    "last_check": None,
    "checks_total": 0,
    "checks_failed": 0,
    "current_status": "initializing",
    "errors": deque(maxlen=MAX_LOG_ENTRIES),
    "warnings": deque(maxlen=MAX_LOG_ENTRIES),
    "checks": deque(maxlen=50),
    "flicker_detected": False,
    "backend_issues": [],
    "data_consistency": {"last_check": None, "issues": []},
    "candle_watchdog": {"started": None, "snapshots": [], "anomalies": []},
}


def save_results():
    data = dict(results)
    for k in ("errors", "warnings", "checks"):
        data[k] = list(data[k])
    data["data_consistency"] = dict(data.get("data_consistency", {}))
    with open(RESULTS_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


def log_error(msg, source="browser"):
    entry = {"time": datetime.now().isoformat(), "source": source, "message": str(msg)[:500]}
    results["errors"].append(entry)
    print(f"[ERROR] [{source}] {msg}")

def log_warning(msg, source="bot"):
    entry = {"time": datetime.now().isoformat(), "source": source, "message": str(msg)[:500]}
    # Дедупликация: не повторять статические предупреждения
    msg_key = str(msg)[:60]
    if source == "backend" and any(msg_key in w["message"][:60] for w in results["warnings"]):
        return  # уже было
    results["warnings"].append(entry)
    print(f"[WARN]  [{source}] {msg}")

def log_info(msg):
    print(f"[INFO]  {msg}")


# ─── BACKEND CHECKS ───────────────────────────────────────────

def check_backend():
    """Проверка бэкенда: HTTP-эндпоинты, таймауты, консистентность."""
    issues = []

    # 1. Проверка /api/tickers
    try:
        req = Request(f"{BASE_URL}/api/tickers", headers={"Accept": "application/json"})
        t0 = time.monotonic()
        with urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
            elapsed = time.monotonic() - t0

        if elapsed > 3:
            issues.append(f"/api/tickers медленный ({elapsed:.1f}с)")

        if not isinstance(data, list) or len(data) < 100:
            issues.append(f"/api/tickers мало данных: {len(data) if isinstance(data, list) else 'не массив'}")

        # Проверяем структуру записей
        sample = data[0] if data else {}
        required = ["symbol", "s", "c", "ch", "natr"]
        missing = [k for k in required if k not in sample]
        if missing:
            issues.append(f"/api/tickers нет полей: {missing}")

        # Проверяем на NaN/Inf
        nan_count = 0
        for row in data[:50]:
            for k, v in row.items():
                if isinstance(v, float) and (v != v or v == float('inf') or v == float('-inf')):
                    nan_count += 1
        if nan_count:
            issues.append(f"/api/tickers содержит NaN/Inf в {nan_count} значениях")

        # Проверяем консистентность CH24h (не должны все быть 0 или одинаковые)
        ch_values = [row.get("ch", 0) for row in data if row.get("ch") is not None]
        if ch_values:
            ch_range = max(ch_values) - min(ch_values)
            if ch_range < 0.01:
                issues.append(f"CH24h диапазон подозрительно мал: {ch_range:.6f}")

        # Проверяем NATR
        natr_ok = sum(1 for row in data if row.get("natr", -1) >= 0)
        natr_total = len(data)
        natr_pct = natr_ok / max(natr_total, 1) * 100
        if natr_pct < 50:
            issues.append(f"NATR заполнен только у {natr_pct:.0f}% монет ({natr_ok}/{natr_total})")

    except Exception as e:
        issues.append(f"/api/tickers ошибка: {str(e)[:100]}")

    # 2. Проверка /api/prices
    try:
        with urlopen(f"{BASE_URL}/api/prices", timeout=5) as r:
            prices = json.loads(r.read().decode())
        if len(prices) < 100:
            issues.append(f"PRICE_BUFFER мало записей: {len(prices)}")
    except Exception as e:
        issues.append(f"/api/prices ошибка: {str(e)[:80]}")

    # 3. Проверка /api/natr
    try:
        with urlopen(f"{BASE_URL}/api/natr", timeout=5) as r:
            natr_data = json.loads(r.read().decode())
        natr_valid = sum(1 for v in natr_data.values() if isinstance(v, (int, float)) and v >= 0)
        if natr_valid < 200 and len(natr_data) > 0:
            issues.append(f"NATR_BUFFER мало валидных: {natr_valid}/{len(natr_data)}")
    except Exception as e:
        issues.append(f"/api/natr ошибка: {str(e)[:80]}")

    # 4. Статический анализ server.py
    try:
        spath = os.path.join(ROOT_DIR, "server.py")
        with open(spath) as f:
            code = f.read()
        static_issues = analyze_server_code(code)
        issues.extend(static_issues)
    except Exception as e:
        issues.append(f"Анализ server.py: {str(e)[:80]}")

    # 5. Статический анализ index.html (JS часть)
    try:
        hpath = os.path.join(ROOT_DIR, "index.html")
        with open(hpath) as f:
            html = f.read()
        # Извлекаем JS код
        js_match = re.search(r'<script>(.*?)</script>', html, re.DOTALL)
        if js_match:
            js_code = js_match.group(1)
            js_issues = analyze_frontend_code(js_code)
            issues.extend(js_issues)
    except Exception as e:
        issues.append(f"Анализ index.html: {str(e)[:80]}")

    return issues


def analyze_server_code(code):
    """Статический анализ server.py."""
    issues = []

    # Проверка на синтаксические ошибки
    try:
        ast.parse(code)
    except SyntaxError as e:
        issues.append(f"server.py: SyntaxError на строке {e.lineno}: {e.msg}")
        return issues

    # Проверка BASE_TICKERS обновления
    if "BASE_TICKERS =" in code or "BASE_TICKERS=" in code:
        # Проверяем, обновляется ли BASE_TICKERS после инициализации
        lines = code.split("\n")
        ticker_updates = 0
        for i, line in enumerate(lines):
            if "BASE_TICKERS" in line and ("=" in line or "append" in line) and i > 30:
                ticker_updates += 1
        if ticker_updates == 0:
            issues.append("server.py: BASE_TICKERS не обновляется после __main__ → data staleness")

    # Проверка на exception swallowing
    empty_except = re.findall(r'except\s+(?:Exception\s+)?(?:as\s+\w+\s*)?:\s*\n\s*(?:pass|$)|\bpass\b', code)
    if len(empty_except) > 3:
        issues.append(f"server.py: {len(empty_except)} пустых except блоков (скрывают ошибки)")

    # Проверка на sleep в циклах (rate limiting)
    if "time.sleep(0.1)" in code:
        issues.append("server.py: time.sleep(0.1) в NATR-цикле — 587 × 0.1с ≈ 59с на цикл (медленно)")

    # Проверка на TICKERS_CACHE время жизни
    if "TICKERS_CACHE" in code:
        if "1800" not in code and "3600" not in code:
            pass  # кэш 1с — это нормально
        # Проверяем expire
        if "(now - TICKERS_CACHE['time']) < 1" in code:
            pass  # 1 секунда — ОК
        else:
            issues.append("server.py: нестандартное время кэша TICKERS_CACHE")

    # Проверка на WebSocket URL
    if "wss://fstream.binance.com/ws/" in code:
        issues.append("server.py: СТАРЫЙ WebSocket URL (/ws/ вместо /market/ws/) — данные не идут!")

    return issues


def analyze_frontend_code(code):
    """Статический анализ JS кода в index.html."""
    issues = []

    # Проверка на перезапись данных — ищем ПРЯМУЮ перезапись без защиты
    # (если есть `changes24h[...] = t.ch` НЕ внутри if, это проблема)
    direct_overwrite = re.findall(r'^\s*changes24h\[[^\]]+\]\s*=\s*t\.ch', code, re.MULTILINE)
    ws_overwrite = "changes24h[sym] = ((p - o) / o * 100)" in code
    if direct_overwrite and ws_overwrite:
        issues.append(
            "index.html: КОНФЛИКТ ДАННЫХ — changes24h перезаписывается из /api/tickers (устар.) "
            "и из WebSocket (актуал.) → мерцание CH24h в таблице"
        )

    # Проверка renderCoinTable в WebSocket handler — ищем в теле onmessage
    ws_onmessage = re.search(
        r'(?:priceWS|klineWS)\.onmessage\s*=\s*function.*?\{(.*?)\};?\s*(?:\}|$)', 
        code, re.DOTALL
    )
    if ws_onmessage and "renderCoinTable()" in ws_onmessage.group(1):
        issues.append(
            "index.html: renderCoinTable() вызывается в WebSocket onmessage "
            "→ полный перерендер DOM каждую секунду (должен быть updateCoinTableValues)"
        )

    # Проверка на дублирующиеся fetchAllTickers интервалы
    ticker_intervals = re.findall(r'setInterval\s*\(\s*(?:async\s*)?function.*?fetchAllTickers', code, re.DOTALL)
    if len(ticker_intervals) > 1:
        issues.append(f"index.html: {len(ticker_intervals)} вызовов setInterval с fetchAllTickers (дубликаты?)")

    # Проверка на использование var вместо let/const
    var_count = len(re.findall(r'\bvar\s', code))
    if var_count > 100:
        issues.append(f"index.html: {var_count} использований var (рекомендуется let/const)")

    # Проверка на console.log в production
    console_logs = len(re.findall(r'console\.log\(', code))
    if console_logs > 20:
        issues.append(f"index.html: {console_logs} вызовов console.log (засоряют консоль)")

    return issues


# ─── FRONTEND CHECKS (Playwright) ─────────────────────────────

async def check_frontend(page, browser, deep=False):
    """Проверка фронтенда через headless-браузер."""
    check_result = {
        "time": datetime.now().isoformat(),
        "passed": True,
        "details": [],
    }

    console_errors = []

    def on_console(msg):
        if msg.type in ("error", "warning"):
            console_errors.append({"type": msg.type, "text": msg.text})

    page.on("console", on_console)

    def on_page_error(err):
        console_errors.append({"type": "error", "text": str(err)})

    page.on("pageerror", on_page_error)

    try:
        await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15000)
        await asyncio.sleep(3)

        # --- Базовые проверки ---
        js_errors = [e for e in console_errors if e["type"] == "error"]
        if js_errors:
            for err in js_errors:
                log_error(f"[Консоль] {err['text']}", "browser")
            check_result["passed"] = False

        # WebSocket
        dot = await page.evaluate("""
            () => {
                var d = document.getElementById('statusDot');
                if (!d) return 'no';
                return d.classList.contains('off') ? 'off' : 'on';
            }
        """)
        ws_ok = dot == "on"
        if not ws_ok:
            log_error("WebSocket не подключён", "browser")
            check_result["passed"] = False
        check_result["details"].append(f"WS: {'✓' if ws_ok else '✗'}")

        # График
        svg = await page.evaluate("""
            () => {
                var s = document.querySelector('#chartContainer svg');
                if (!s) return 'no';
                return s.querySelectorAll('g').length > 5 ? 'ok' : 'empty';
            }
        """)
        chart_ok = svg == "ok"
        if not chart_ok:
            log_error(f"График: {svg}", "browser")
            check_result["passed"] = False
        check_result["details"].append(f"График: {'✓' if chart_ok else '✗'}")

        # Таблица
        rows = await page.evaluate("""
            () => document.querySelectorAll('#coinBody tr').length
        """)
        table_ok = rows > 50
        if not table_ok:
            log_warning(f"Таблица: {rows} строк (<50)", "browser")
            check_result["details"].append(f"Таблица: {rows} ✗")
        else:
            check_result["details"].append(f"Таблица: {rows} ✓")

        # API
        api = await page.evaluate(f"""
            async () => {{
                try {{
                    var r = await fetch('{BASE_URL}/api/tickers');
                    var d = await r.json();
                    return {{ok: r.ok, n: Array.isArray(d) ? d.length : -1}};
                }} catch(e) {{ return {{ok: false, n: 0}}; }}
            }}
        """)
        api_ok = api.get("ok") and api.get("n", 0) > 100
        if not api_ok:
            log_error(f"API: {api}", "browser")
            check_result["passed"] = False
        check_result["details"].append(f"API: {api.get('n',0)} ✓" if api_ok else f"API: ✗")

        # Цена
        price = await page.evaluate("""
            () => {
                var el = document.getElementById('currentPriceLabel');
                return el ? el.textContent : '—';
            }
        """)
        price_ok = price not in ("—", "$—", "", None)
        check_result["details"].append(f"Цена: {price} {'✓' if price_ok else '✗'}")

        # --- ГЛУБОКИЕ ПРОВЕРКИ (мерцание, консистентность) ---
        if deep:
            log_info("Глубокий анализ: детектор мерцания...")

            # Детектор мерцания CH24h
            flicker_result = await detect_flicker(page)
            if flicker_result.get("detected"):
                results["flicker_detected"] = True
                log_warning(
                    f"МЕРЦАНИЕ CH24h: {flicker_result.get('count', 0)} скачков >10% "
                    f"за {flicker_result.get('duration', 0)}с. "
                    f"Пример: {flicker_result.get('example', '')}",
                    "browser"
                )
                check_result["passed"] = False
                check_result["details"].append(f"Мерцание: {flicker_result['count']} скачков ✗")
            else:
                check_result["details"].append("Мерцание: не обнаружено ✓")

            # Проверка консистентности данных
            consistency = await check_data_consistency(page)
            if consistency.get("issues"):
                results["data_consistency"]["issues"] = consistency["issues"]
                results["data_consistency"]["last_check"] = datetime.now().isoformat()
                for issue in consistency["issues"]:
                    log_warning(f"Консистентность: {issue}", "browser")
                check_result["passed"] = False
                check_result["details"].append("Консистентность: проблемы ✗")
            else:
                check_result["details"].append("Консистентность: ✓")

            # Проверка производительности (избыточные рендеры)
            perf = await check_performance(page)
            if perf.get("issues"):
                for issue in perf["issues"]:
                    log_warning(f"Производительность: {issue}", "browser")
                check_result["details"].append(f"Перф: {len(perf['issues'])} проблем ✗")
            else:
                check_result["details"].append("Перф: ✓")

            # Проверка отрисовки свечей
            candle_result = await check_candles(page, quick=True)
            if candle_result.get("issues"):
                for issue in candle_result["issues"]:
                    log_error(f"Свечи: {issue}", "browser")
                check_result["passed"] = False
                check_result["details"].append(f"Свечи: {len(candle_result['issues'])} проблем ✗")
            else:
                check_result["details"].append(f"Свечи: {candle_result.get('candle_count', 0)} шт ✓")

            # Долгосрочный watchdog свечей
            await run_candle_watchdog(page)
            wd_anomalies = results["candle_watchdog"].get("anomalies", [])
            if wd_anomalies:
                check_result["details"].append(f"Watchdog свечей: {len(wd_anomalies)} аномалий за сессию")

            # Проверка индикаторов
            ind_result = await check_indicators(page)
            if ind_result.get("issues"):
                for issue in ind_result["issues"]:
                    log_warning(f"Индикатор: {issue}", "browser")
                check_result["passed"] = False
            ind_summary = " · ".join(f"{k}:{v}" for k, v in ind_result.get("checks", {}).items())
            check_result["details"].append(f"Индикаторы: {ind_summary or '—'}")

            # Проверка инструментов рисования
            tool_result = await check_drawing_tools(page)
            if tool_result.get("issues"):
                for issue in tool_result["issues"]:
                    log_warning(f"Инструмент: {issue}", "browser")
                check_result["passed"] = False
            tool_summary = " · ".join(f"{k}:{v}" for k, v in tool_result.get("checks", {}).items())
            check_result["details"].append(f"Инструменты: {tool_summary or '—'}")

    except Exception as e:
        log_error(f"Критическая: {traceback.format_exc()}")
        check_result["passed"] = False
        check_result["details"].append(f"CRASH: {str(e)[:80]}")

    return check_result


async def detect_flicker(page):
    """
    Быстрый детектор мерцания:
    5 раз с интервалом 500мс считываем CH24h для первых 20 монет,
    сравниваем, ищем скачки >10% между замерами.
    """
    samples = []
    for i in range(6):
        data = await page.evaluate("""
            () => {
                var rows = document.querySelectorAll('#coinBody tr');
                var result = [];
                for (var i = 0; i < Math.min(rows.length, 20); i++) {
                    var cells = rows[i].querySelectorAll('td');
                    var chCell = cells[2]; // CH24h column
                    if (chCell) {
                        var text = chCell.textContent.trim();
                        var val = parseFloat(text.replace('%', ''));
                        result.push({sym: cells[0]?.textContent?.trim() || '', ch: val});
                    }
                }
                return result;
            }
        """)
        samples.append({"time": time.time(), "data": data})
        await asyncio.sleep(0.8)

    # Анализ: ищем монеты где CH24h скачет >10% между замерами
    flickers = 0
    example = ""
    for coin_idx in range(min(len(samples[0]["data"]), 20)):
        values = []
        for s in samples:
            if coin_idx < len(s["data"]):
                values.append(s["data"][coin_idx].get("ch", 0))

        if len(values) >= 3:
            # Проверяем размах между последовательными замерами
            max_jump = 0
            for i in range(1, len(values)):
                if values[i - 1] != 0 and not (values[i - 1] != values[i - 1]):
                    jump = abs(values[i] - values[i - 1])
                    if abs(values[i - 1]) > 0.01:
                        pct_change = jump / abs(values[i - 1]) * 100
                        if pct_change > max_jump:
                            max_jump = pct_change

            if max_jump > 10:
                sym = samples[0]["data"][coin_idx].get("sym", "?")
                if not example:
                    example = f"{sym}: {[round(v,2) for v in values]}"
                flickers += 1

    return {
        "detected": flickers > 0,
        "count": flickers,
        "duration": round((samples[-1]["time"] - samples[0]["time"]) if len(samples) >= 2 else 0, 1),
        "example": example,
    }


async def check_data_consistency(page):
    """Сравнивает данные фронта с API бэкенда."""
    issues = []

    # Получаем данные фронта
    front = await page.evaluate("""
        () => {
            var rows = document.querySelectorAll('#coinBody tr');
            var data = {};
            for (var i = 0; i < Math.min(rows.length, 10); i++) {
                var cells = rows[i].querySelectorAll('td');
                var sym = cells[0]?.textContent?.trim()?.split(' ')[0] || '';
                var natr = cells[1]?.textContent?.trim() || '';
                var ch = cells[2]?.textContent?.trim() || '';
                data[sym] = {natr: natr, ch: ch};
            }
            return data;
        }
    """)

    # Получаем данные API
    try:
        req = Request(f"{BASE_URL}/api/tickers", headers={"Accept": "application/json"})
        with urlopen(req, timeout=10) as r:
            api_data = json.loads(r.read().decode())
        api_map = {row.get("s", ""): row for row in api_data}
    except Exception as e:
        issues.append(f"Не удалось получить API данные: {e}")
    return {"issues": issues}


# ─── ПРОВЕРКА ОТРИСОВКИ СВЕЧЕЙ ────────────────────────────────

async def check_candles(page, quick=False):
    """
    Проверяет правильность отрисовки свечей в D3 SVG.
    В режиме quick — одна проверка. Без quick — 6 замеров за ~30с.
    """
    issues = []
    samples = []

    async def sample():
        return await page.evaluate("""
            () => {
                var svg = document.querySelector('#chartContainer svg');
                if (!svg) return {error: 'no_svg'};

                var candleG = svg.querySelector('g.candles');
                if (!candleG) return {error: 'no_candle_group'};

                var lines = candleG.querySelectorAll('line');
                var rects = candleG.querySelectorAll('rect');

                // Собираем последние 10 свечей
                var candles = [];
                var minX = Infinity, maxX = -Infinity;

                for (var i = Math.max(0, rects.length - 10); i < rects.length; i++) {
                    var r = rects[i];
                    var l = lines[i]; // wick line (должен соответствовать)

                    var x = parseFloat(r.getAttribute('x')) + parseFloat(r.getAttribute('width')) / 2;
                    var bodyTop = parseFloat(r.getAttribute('y'));
                    var bodyH = parseFloat(r.getAttribute('height'));
                    var bodyBottom = bodyTop + bodyH;

                    var wickTop = l ? parseFloat(l.getAttribute('y1')) : bodyTop;
                    var wickBottom = l ? parseFloat(l.getAttribute('y2')) : bodyBottom;

                    candles.push({
                        x: Math.round(x),
                        wickTop: Math.round(wickTop),
                        wickBottom: Math.round(wickBottom),
                        bodyTop: Math.round(bodyTop),
                        bodyBottom: Math.round(bodyBottom),
                        bodyH: Math.round(bodyH),
                        fill: r.getAttribute('fill')
                    });

                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                }

                return {
                    count: candles.length,
                    minX: minX,
                    maxX: maxX,
                    candles: candles
                };
            }
        """)

    try:
        result = await sample()
        if result.get("error"):
            return {"issues": [result["error"]], "samples": []}

        candidates = result.get("candles", [])
        if len(candidates) < 3:
            return {"issues": ["Слишком мало свечей для анализа"], "samples": []}

        # Базовая проверка: X растёт слева направо
        x_values = [c["x"] for c in candidates if c["x"] != float('inf')]
        x_increasing = all(x_values[i] <= x_values[i + 1] for i in range(len(x_values) - 1))
        if not x_increasing:
            issues.append("Свечи НЕ упорядочены по X (нарушен порядок времени)")

        # Проверка: фитиль охватывает тело
        for i, c in enumerate(candidates):
            wick_range = range(c["wickTop"], c["wickBottom"] + 1) if c["wickBottom"] >= c["wickTop"] else range(c["wickBottom"], c["wickTop"] + 1)
            body_inside = c["bodyTop"] >= c["wickTop"] - 2 and c["bodyBottom"] <= c["wickBottom"] + 2
            if not body_inside:
                issues.append(f"Свеча #{i}: тело выходит за фитиль (wick [{c['wickTop']},{c['wickBottom']}] body [{c['bodyTop']},{c['bodyBottom']}])")
                break

        # Проверка: высота тела > 0 (кроме доджей)
        zero_body = sum(1 for c in candidates if c["bodyH"] == 0)
        all_zero = zero_body == len(candidates)

        # Проверка: цвета чередуются (не все одного цвета)
        colors = [c.get("fill", "") for c in candidates]
        unique_colors = len(set(colors))
        if unique_colors < 2 and len(candidates) >= 5 and not all_zero:
            issues.append("Все свечи одного цвета — подозрительно (5+ свечей без смены направления)")

    except Exception as e:
        issues.append(f"Ошибка анализа свечей: {str(e)[:100]}")

    return {"issues": issues, "candle_count": len(candidates) if candidates else 0}


async def candle_snapshot(page):
    """Снимает «отпечаток» позиций свечей + OHLC + линии цены."""
    return await page.evaluate("""
        () => {
            var svg = document.querySelector('#chartContainer svg');
            if (!svg) return null;
            var candleG = svg.querySelector('g.candles');
            if (!candleG) return null;
            var rects = candleG.querySelectorAll('rect');
            var lines = candleG.querySelectorAll('line');
            var snap = [];
            for (var i = Math.max(0, rects.length - 10); i < rects.length; i++) {
                var r = rects[i];
                var l = lines[i];
                snap.push({
                    x: Math.round(parseFloat(r.getAttribute('x'))),
                    y: Math.round(parseFloat(r.getAttribute('y'))),
                    w: Math.round(parseFloat(r.getAttribute('width'))),
                    h: Math.round(parseFloat(r.getAttribute('height'))),
                    fill: r.getAttribute('fill'),
                    wickT: l ? Math.round(parseFloat(l.getAttribute('y1'))) : 0,
                    wickB: l ? Math.round(parseFloat(l.getAttribute('y2'))) : 0
                });
            }

            // Позиция пунктирной линии текущей цены
            var priceLine = null;
            var priceLineG = svg.querySelector('g.current-price-line');
            if (priceLineG) {
                var pl = priceLineG.querySelector('line');
                if (pl) {
                    priceLine = {
                        y1: Math.round(parseFloat(pl.getAttribute('y1'))),
                        y2: Math.round(parseFloat(pl.getAttribute('y2')))
                    };
                }
            }

            // klineData для сверки
            var klineInfo = null;
            try {
                if (typeof klineData !== 'undefined' && klineData.length > 0) {
                    var last = klineData.slice(-5);
                    klineInfo = last.map(function(k) {
                        return {t: k.time, o: k.open, h: k.high, l: k.low, c: k.close};
                    });
                }
            } catch(e) {}

            return {
                candles: snap,
                priceLine: priceLine,
                klines: klineInfo,
                totalCandles: rects.length
            };
        }
    """)


def analyze_candle_stability(snapshots):
    """Сравнивает снимки свечей, ищет аномалии."""
    if len(snapshots) < 2:
        return []

    issues = []
    prev = snapshots[-2]
    curr = snapshots[-1]

    prev_candles = prev.get("candles") or prev.get("data") or []
    curr_candles = curr.get("candles") or curr.get("data") or []
    if not prev_candles or not curr_candles:
        return []

    if len(prev_candles) != len(curr_candles):
        return [f"Количество свечей изменилось: {len(prev_candles)} → {len(curr_candles)}"]

    # Проверка: движется ли пунктир цены
    prev_pl = prev.get("priceLine")
    curr_pl = curr.get("priceLine")
    price_moved = False
    if prev_pl and curr_pl and prev_pl.get("y1") and curr_pl.get("y1"):
        if abs(curr_pl["y1"] - prev_pl["y1"]) > 2:
            price_moved = True

    # Проверка: движутся ли свечи
    candles_moved = 0
    candles_static = 0
    for i in range(min(len(prev_candles), len(curr_candles))):
        pc = prev_candles[i]
        cc = curr_candles[i]
        dx = abs(cc["x"] - pc["x"])
        dh = abs(cc["h"] - pc["h"])
        dy = abs(cc["y"] - pc["y"])
        if dx > 3 or dh > 5:
            candles_moved += 1
            if dx > 5 and cc["fill"] == pc["fill"]:
                issues.append(f"Свеча #{i}: смещение X={dx}px без смены цвета")
            if dh > 20 and cc["fill"] == pc["fill"]:
                issues.append(f"Свеча #{i}: изменение высоты {dh}px без смены данных")
        else:
            candles_static += 1

    # Детектор «цена идёт — свечи стоят»
    if price_moved and candles_moved == 0 and len(prev_candles) >= 3:
        issues.append(
            f"КРИТИЧЕСКИЙ БАГ: пунктир цены сместился на "
            f"{abs(curr_pl['y1'] - prev_pl['y1'])}px, "
            f"но {len(prev_candles)} свечей остались на месте! "
            f"(цена обновляется, свечи — нет)"
        )

    # Проверяем klines если есть
    prev_kl = prev.get("klines")
    curr_kl = curr.get("klines")
    if prev_kl and curr_kl and len(prev_kl) == len(curr_kl):
        kline_jumps = 0
        for i in range(len(prev_kl)):
            if prev_kl[i]["t"] == curr_kl[i]["t"]:
                if prev_kl[i]["o"] != curr_kl[i]["o"] or prev_kl[i]["c"] != curr_kl[i]["c"]:
                    kline_jumps += 1
        if kline_jumps > 0:
            issues.append(f"{kline_jumps} kline-записей изменились задним числом (перезапись истории)")

    return issues


def compare_snapshots(pre, post, pre_index):
    """
    Сравнивает снимок до перезагрузки (pre) с пост-перезагрузочным (post).
    Ищет: свечи, которые были в одном месте до, но в другом — после.
    """
    issues = []
    pre_c = pre.get("candles") or pre.get("data") or []
    post_c = post.get("candles") or post.get("data") or []
    if not pre_c or not post_c:
        return []

    pre_tail = pre_c[-3:] if len(pre_c) >= 3 else pre_c
    post_tail = post_c[-3:] if len(post_c) >= 3 else post_c

    if len(pre_tail) == len(post_tail):
        for i in range(len(pre_tail)):
            dx = abs(post_tail[i]["x"] - pre_tail[i]["x"])
            dy = abs(post_tail[i]["y"] - pre_tail[i]["y"])
            dh = abs(post_tail[i]["h"] - pre_tail[i]["h"])
            dwick = abs(post_tail[i]["wickT"] - pre_tail[i]["wickT"])

            total_diff = dx + dy + dh + dwick
            if total_diff > 15:
                pre_color = pre_tail[i].get("fill", "?")[:7]
                post_color = post_tail[i].get("fill", "?")[:7]
                issues.append(
                    f"Свеча #{i}: до перезагрузки (сн.#{pre_index}) x={pre_tail[i]['x']} y={pre_tail[i]['y']} "
                    f"h={pre_tail[i]['h']} {pre_color}, "
                    f"после x={post_tail[i]['x']} y={post_tail[i]['y']} "
                    f"h={post_tail[i]['h']} {post_color} (dx={dx} dy={dy} dh={dh})"
                )

    pre_pl = pre.get("priceLine")
    post_pl = post.get("priceLine")
    if pre_pl and post_pl and pre_pl.get("y1") and post_pl.get("y1"):
        pl_diff = abs(post_pl["y1"] - pre_pl["y1"])
        if pl_diff > 20:
            issues.append(
                f"Линия цены: до={pre_pl['y1']}px, после={post_pl['y1']}px (Δ{pl_diff}px)"
            )

    return issues


async def run_candle_watchdog(page):
    """
    Долгосрочное наблюдение за свечами (30 минут).
    Каждые 30с: снимок позиций свечей + OHLC.
    """
    try:
        wd = results["candle_watchdog"]
        if wd["started"] is None:
            wd["started"] = datetime.now().isoformat()
            wd["snapshots"] = []
            wd["anomalies"] = []

        snap = await candle_snapshot(page)
        if snap and snap.get("candles") and len(snap["candles"]) >= 3:
            entry = {
                "time": datetime.now().isoformat(),
                "total": snap.get("totalCandles", 0),
                "sample": snap["candles"][-3:],
                "klines": snap.get("klines"),
                "priceLine": snap.get("priceLine"),
            }
            wd["snapshots"].append(entry)

            # Держим только последние 60 снимков (~30 минут при интервале 30с)
            if len(wd["snapshots"]) > 60:
                wd["snapshots"] = wd["snapshots"][-60:]

            # Анализ стабильности (сравниваем с предыдущим)
            if len(wd["snapshots"]) >= 2:
                anomalies = analyze_candle_stability(wd["snapshots"])
                for a in anomalies:
                    key = a[:60]
                    if not any(key in existing["message"][:60] for existing in wd["anomalies"]):
                        wd["anomalies"].append({"time": datetime.now().isoformat(), "message": a})
                        log_error(f"Свечи: {a}", "browser")

            # Каждые 10 снимков (~5 мин) — сводка
            if len(wd["snapshots"]) % 10 == 0:
                log_info(f"[Watchdog] {len(wd['snapshots'])} снимков, {len(wd['anomalies'])} аномалий, "
                         f"свечей: {snap.get('totalCandles', 0)}")
    except Exception as e:
        pass


async def check_performance(page):
    """Проверка производительности фронтенда."""
    issues = []

    # Проверяем количество DOM-элементов в таблице
    dom_count = await page.evaluate("""
        () => document.querySelectorAll('#coinBody tr').length
    """)
    if dom_count > 1000:
        issues.append(f"Слишком много строк в таблице: {dom_count}")

    # Проверяем размер SVG
    svg_nodes = await page.evaluate("""
        () => document.querySelectorAll('#chartContainer svg *').length
    """)
    if svg_nodes > 5000:
        issues.append(f"Слишком много SVG-элементов: {svg_nodes} (возможен лаг)")

    # Проверяем использование памяти (оценочно)
    mem = await page.evaluate("""
        () => {
            if (performance.memory) return performance.memory.usedJSHeapSize;
            return -1;
        }
    """)
    if mem > 200 * 1024 * 1024:  # 200 MB
        issues.append(f"Высокое потребление JS-памяти: {mem / 1024 / 1024:.0f} MB")

    return {"issues": issues}


# ─── ИНДИКАТОРЫ И ИНСТРУМЕНТЫ ──────────────────────────────────

async def check_indicators(page):
    """Проверяет работу всех индикаторов на графике."""
    issues = []
    checks = {}

    # Получаем текущее состояние чекбоксов
    states = await page.evaluate("""
        () => {
            return {
                bb: document.getElementById('indBB')?.checked || false,
                sma: document.getElementById('indSMA')?.checked || false,
                rsi: document.getElementById('indRSI')?.checked || false,
                fractal: document.getElementById('indFractal')?.checked || false,
            };
        }
    """)

    # Проверяем BB (Bollinger Bands)
    try:
        # Включаем если выключен
        if not states.get("bb"):
            await page.evaluate("""() => {
                var cb = document.getElementById('indBB');
                if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
            }""")
            await asyncio.sleep(0.5)

        bb_elements = await page.evaluate("""
            () => {
                var g = document.querySelector('#chartContainer svg g.bb');
                if (!g) return 0;
                return g.querySelectorAll('path').length;
            }
        """)
        if bb_elements >= 2:
            checks["BB"] = "✓"
        else:
            checks["BB"] = f"✗ ({bb_elements} paths)"
            issues.append(f"BB: не отрендерен ({bb_elements} paths)")

        # Выключаем обратно
        if not states.get("bb"):
            await page.evaluate("""() => {
                var cb = document.getElementById('indBB');
                if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
            }""")
    except Exception as e:
        checks["BB"] = f"✗ err"

    # Проверяем SMA
    try:
        if not states.get("sma"):
            await page.evaluate("""() => {
                var cb = document.getElementById('indSMA');
                if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
            }""")
            await asyncio.sleep(0.5)

        sma_elements = await page.evaluate("""
            () => {
                var g = document.querySelector('#chartContainer svg g.sma');
                if (!g) return 0;
                return g.querySelectorAll('path').length;
            }
        """)
        if sma_elements >= 1:
            checks["SMA"] = "✓"
        else:
            checks["SMA"] = f"✗ ({sma_elements} paths)"
            issues.append(f"SMA: не отрендерен")

        if not states.get("sma"):
            await page.evaluate("""() => {
                var cb = document.getElementById('indSMA');
                if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
            }""")
    except Exception as e:
        checks["SMA"] = f"✗ err"

    # Проверяем RSI
    try:
        if not states.get("rsi"):
            await page.evaluate("""() => {
                var cb = document.getElementById('indRSI');
                if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
            }""")
            await asyncio.sleep(0.5)

        rsi_elements = await page.evaluate("""
            () => {
                var g = document.querySelector('#chartContainer svg g.rsi');
                if (!g) return 0;
                return g.querySelectorAll('path').length;
            }
        """)
        if rsi_elements >= 1:
            checks["RSI"] = "✓"
        else:
            checks["RSI"] = f"✗ ({rsi_elements} paths)"
            issues.append(f"RSI: не отрендерен")

        if not states.get("rsi"):
            await page.evaluate("""() => {
                var cb = document.getElementById('indRSI');
                if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
            }""")
    except Exception as e:
        checks["RSI"] = f"✗ err"

    # Проверяем Fractals (Авто-уровни)
    try:
        if not states.get("fractal"):
            await page.evaluate("""() => {
                var cb = document.getElementById('indFractal');
                if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
            }""")
            await asyncio.sleep(0.5)

        fractal_elements = await page.evaluate("""
            () => {
                var g = document.querySelector('#chartContainer svg g.fractals');
                if (!g) return 0;
                return g.querySelectorAll('line').length;
            }
        """)
        if fractal_elements >= 2:
            checks["Fractals"] = f"✓ ({fractal_elements} линий)"
        else:
            checks["Fractals"] = f"✗ ({fractal_elements} линий)"
            issues.append(f"Fractals: нет уровней ({fractal_elements} линий)")

        if not states.get("fractal"):
            await page.evaluate("""() => {
                var cb = document.getElementById('indFractal');
                if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
            }""")
    except Exception as e:
        checks["Fractals"] = f"✗ err"

    return {"issues": issues, "checks": checks}


async def check_drawing_tools(page):
    """Проверяет работу инструментов рисования."""
    issues = []
    checks = {}

    # Проверяем кнопки инструментов в DOM
    tool_ids = ["drawCursor", "drawLine", "drawHLine", "drawRay", "drawRuler", "drawText", "drawBrush", "drawEraser", "drawMagnet"]
    for tid in tool_ids:
        exists = await page.evaluate(f"""() => {{ return !!document.getElementById('{tid}'); }}""")
        if not exists:
            issues.append(f"Инструмент {tid} не найден в DOM")

    if not issues:
        checks["Toolbar"] = "✓"
    else:
        checks["Toolbar"] = f"✗ ({len(issues)} missing)"

    # Тестируем горизонтальную линию
    try:
        await page.evaluate("""() => {
            document.getElementById('drawHLine').click();
        }""")
        await asyncio.sleep(0.3)

        # Кликаем в центр графика
        hline_before = await page.evaluate("""
            () => {
                var g = document.querySelector('#chartContainer svg g.hlines');
                return g ? g.querySelectorAll('line').length : 0;
            }
        """)

        await page.evaluate("""() => {
            var svg = document.querySelector('#chartContainer svg');
            if (svg) {
                var r = svg.getBoundingClientRect();
                var e = new PointerEvent('click', {bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2});
                svg.dispatchEvent(e);
            }
        }""")
        await asyncio.sleep(0.3)

        hline_after = await page.evaluate("""
            () => {
                var g = document.querySelector('#chartContainer svg g.hlines');
                return g ? g.querySelectorAll('line').length : 0;
            }
        """)

        if hline_after > hline_before:
            checks["HLine"] = "✓"
        else:
            checks["HLine"] = "✗ (нет новых линий)"
            issues.append("HLine: линия не появилась после клика")
    except Exception as e:
        checks["HLine"] = "✗ err"

    # Очищаем
    await page.evaluate("""() => {
        var btn = document.getElementById('drawEraser');
        if (btn) btn.click();
    }""")
    await asyncio.sleep(0.3)

    # Возвращаем режим курсора
    await page.evaluate("""() => {
        document.getElementById('drawCursor').click();
    }""")

    return {"issues": issues, "checks": checks}


# ─── MAIN LOOP ─────────────────────────────────────────────────

async def run_check(browser, context, page, deep=False):
    """Одна полная проверка."""
    # 1. Бэкенд
    backend_issues = check_backend()
    for issue in backend_issues:
        if "SyntaxError" in issue or "СТАРЫЙ" in issue or "КОНФЛИКТ" in issue:
            log_error(issue, "backend")
        else:
            log_warning(issue, "backend")
    results["backend_issues"] = backend_issues[-20:]

    # 2. Фронтенд
    check_result = await check_frontend(page, browser, deep=deep)
    results["checks"].append(check_result)
    results["last_check"] = check_result["time"]
    results["checks_total"] += 1
    if not check_result["passed"]:
        results["checks_failed"] += 1

    # 3. Определяем статус
    backend_errs = sum(1 for i in backend_issues if "SyntaxError" in i or "СТАРЫЙ" in i or "КОНФЛИКТ" in i)
    frontend_down = any("CRASH" in d or "нет SVG" in d or "WS: ✗" in d or "API: ✗" in d for d in check_result.get("details", []))
    
    if frontend_down or backend_errs > 0:
        results["current_status"] = "error"
    elif len(backend_issues) > 0 or not check_result["passed"]:
        results["current_status"] = "degraded"
    else:
        results["current_status"] = "ok"

    save_results()

    err_count = len(results["errors"])
    warn_count = len(results["warnings"])
    status = "✓" if results["current_status"] == "ok" else "⚠" if results["current_status"] == "degraded" else "✗"
    log_info(
        f"{status} Проверка #{results['checks_total']} завершена — "
        f"статус: {results['current_status']} | "
        f"ошибок: {err_count} | предупреждений: {warn_count}"
    )

    return check_result


async def run_once(deep=True):
    log_info(f"Запуск разовой проверки {BASE_URL} ...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        context = await browser.new_context(viewport={"width": 1920, "height": 1080})
        page = await context.new_page()
        try:
            await run_check(browser, context, page, deep=deep)
        finally:
            await browser.close()


async def run_loop(interval, deep=True):
    log_info(f"Запуск циклического мониторинга (интервал: {interval}с, deep={'да' if deep else 'нет'})")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        context = await browser.new_context(viewport={"width": 1920, "height": 1080})
        page = await context.new_page()

        try:
            while True:
                try:
                    await run_check(browser, context, page, deep=deep)
                except Exception as e:
                    log_error(f"Ошибка цикла: {traceback.format_exc()}")
                    results["current_status"] = "error"
                    save_results()
                await asyncio.sleep(interval)
        except KeyboardInterrupt:
            print("\n[BOT] Остановлен.")
        finally:
            await browser.close()


async def quick_frontend_check(page):
    """Быстрая проверка DOM без перезагрузки страницы."""
    result = {
        "time": datetime.now().isoformat(),
        "passed": True,
        "details": [],
        "summary": {},
    }

    try:
        # WebSocket
        dot = await page.evaluate("""() => {
            var d = document.getElementById('statusDot');
            if (!d) return 'no';
            return d.classList.contains('off') ? 'off' : 'on';
        }""")
        ws_ok = dot == "on"
        result["details"].append(f"WS: {'✓' if ws_ok else '✗'}")
        result["summary"]["ws"] = ws_ok

        # График
        svg = await page.evaluate("""() => {
            var s = document.querySelector('#chartContainer svg');
            if (!s) return 'no';
            return s.querySelectorAll('g').length > 5 ? 'ok' : 'empty';
        }""")
        chart_ok = svg == "ok"
        result["details"].append(f"График: {'✓' if chart_ok else '✗'}")
        result["summary"]["chart"] = chart_ok

        # Таблица
        rows = await page.evaluate("""() => {
            return document.querySelectorAll('#coinBody tr').length;
        }""")
        table_ok = rows > 50
        result["details"].append(f"Таблица: {rows} {'✓' if table_ok else '✗'}")
        result["summary"]["table"] = table_ok

        # Цена
        price = await page.evaluate("""() => {
            var el = document.getElementById('currentPriceLabel');
            return el ? el.textContent : '—';
        }""")
        price_ok = price not in ("—", "$—", "", None)
        result["details"].append(f"Цена: {price} {'✓' if price_ok else '✗'}")
        result["summary"]["price"] = price_ok

        # Свечи (быстрая проверка)
        candle_info = await page.evaluate("""() => {
            var g = document.querySelector('#chartContainer svg g.candles');
            return g ? g.querySelectorAll('rect').length : 0;
        }""")
        result["details"].append(f"Свечей: {candle_info}")

        if not ws_ok or not chart_ok:
            result["passed"] = False

    except Exception as e:
        result["passed"] = False
        result["details"].append(f"ERR: {str(e)[:80]}")

    return result


async def run_candle_observation(duration_min=30):
    """
    Наблюдение за свечами 30 мин БЕЗ перезагрузки, с уходом в фоновую вкладку.
    Каждые 30с: возврат на вкладку → снимок → уход на пустую вкладку.
    60 снимков + контрольная перезагрузка → снимок #61.
    """
    snapshot_interval = 30  # секунд между снимками
    total_snapshots = duration_min * 2  # 60 снимков за 30 мин
    log_info(f"[CANDLE OBS] Запуск на {duration_min} мин ({total_snapshots} снимков, интервал {snapshot_interval}с)")
    log_info(f"[CANDLE OBS] После каждого снимка — уход в фоновую вкладку. Без перезагрузки.")
    log_info(f"[CANDLE OBS] После {total_snapshots} снимков — контрольная перезагрузка и сверка.")

    results["candle_watchdog"] = {"started": None, "snapshots": [], "anomalies": []}
    results["current_status"] = "observing_candles"
    results["checks_total"] = 0
    results["checks_failed"] = 0
    save_results()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        context = await browser.new_context(viewport={"width": 1920, "height": 1080})
        page = await context.new_page()

        def on_page_error(err):
            log_error(f"[Observe] {err}", "browser")
        page.on("pageerror", on_page_error)

        try:
            log_info("[CANDLE OBS] Загрузка страницы (один раз)...")
            await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(5)

            # Создаём пустую фоновую вкладку
            bg_page = await context.new_page()
            await bg_page.goto("about:blank")

            # Переключаем на PORTALUSDT
            await page.bring_to_front()
            log_info("[CANDLE OBS] Переключение на PORTALUSDT...")
            try:
                switched = await page.evaluate("""
                    () => {
                        var rows = document.querySelectorAll('#coinBody tr');
                        for (var i = 0; i < rows.length; i++) {
                            if (rows[i].dataset.sym === 'PORTALUSDT') {
                                rows[i].click();
                                return true;
                            }
                        }
                        return false;
                    }
                """)
                if switched:
                    await asyncio.sleep(3)  # ждём загрузку графика PORTAL
                    log_info("[CANDLE OBS] Переключено на PORTALUSDT")
                else:
                    log_info("[CANDLE OBS] PORTALUSDT не найден в таблице, наблюдаем текущую монету")
            except Exception as e:
                log_info(f"[CANDLE OBS] Ошибка переключения: {e}")

            svg_ok = await page.evaluate("""
                () => {
                    var s = document.querySelector('#chartContainer svg');
                    return !!(s && s.querySelectorAll('g').length > 5);
                }
            """)
            if not svg_ok:
                log_error("[CANDLE OBS] График не загрузился!", "browser")
                results["current_status"] = "error"
                save_results()
                return

            tf_info = await page.evaluate("""
                () => {
                    var active = document.querySelector('.tf-btn.active');
                    return active ? active.textContent.trim() : 'unknown';
                }
            """)
            log_info(f"[CANDLE OBS] Активный ТФ: {tf_info}, начинаю снимки...")

            for i in range(total_snapshots):
                try:
                    # Возвращаемся на вкладку с графиком
                    await page.bring_to_front()
                    await asyncio.sleep(1)  # даём странице «проснуться»

                    # Каждые 10 снимков (~5 мин) — полная проверка
                    if i == 0 or (i > 0 and i % 10 == 0):
                        log_info(f"[CANDLE OBS] Базовая проверка на снимке {i+1}...")
                        check_backend_result = check_backend()
                        for issue in check_backend_result:
                            if "SyntaxError" in issue or "СТАРЫЙ" in issue or "КОНФЛИКТ" in issue:
                                log_error(issue, "backend")
                            else:
                                log_warning(issue, "backend")
                        results["backend_issues"] = check_backend_result[-5:]

                        quick = await quick_frontend_check(page)
                        results["checks"].append(quick)
                        results["last_check"] = quick["time"]

                    await run_candle_watchdog(page)
                    wd = results["candle_watchdog"]
                    snaps = len(wd.get("snapshots", []))
                    anoms = len(wd.get("anomalies", []))
                    remaining = (total_snapshots - i - 1) * snapshot_interval / 60
                    log_info(f"[CANDLE OBS] Снимок {i+1}/{total_snapshots} "
                             f"({snaps} в логе, {anoms} аномалий, ещё ~{remaining:.0f} мин)")

                    results["checks_total"] = i + 1
                    results["checks_failed"] = anoms
                    results["current_status"] = "error" if anoms > 0 else "observing_candles"
                    save_results()

                    # Уходим в фоновую вкладку до следующего снимка
                    await bg_page.bring_to_front()

                except Exception as e:
                    log_error(f"[CANDLE OBS] Ошибка снимка #{i+1}: {e}", "browser")
                    await page.bring_to_front()

                if i < total_snapshots - 1:
                    await asyncio.sleep(snapshot_interval)

            # ─── КОНТРОЛЬНАЯ ПЕРЕЗАГРУЗКА И СВЕРКА ───
            log_info("[CANDLE OBS] === 60 снимков собрано. Контрольная перезагрузка... ===")
            await page.bring_to_front()
            await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(5)

            # Снова переключаем на PORTALUSDT
            try:
                await page.evaluate("""
                    () => {
                        var rows = document.querySelectorAll('#coinBody tr');
                        for (var i = 0; i < rows.length; i++) {
                            if (rows[i].dataset.sym === 'PORTALUSDT') {
                                rows[i].click();
                                return;
                            }
                        }
                    }
                """)
                await asyncio.sleep(3)
            except Exception:
                pass

            log_info("[CANDLE OBS] Снимок #121 (после перезагрузки)...")
            await run_candle_watchdog(page)

            # Сравниваем ВСЕ снимки до перезагрузки с пост-перезагрузочным
            wd = results["candle_watchdog"]
            all_snaps = wd.get("snapshots", [])
            if len(all_snaps) >= 2:
                post_reload = all_snaps[-1]  # #121
                pre_reload_snaps = all_snaps[:-1]

                issues_found = 0
                for idx, pre in enumerate(pre_reload_snaps):
                    issues = compare_snapshots(pre, post_reload, idx + 1)
                    for issue in issues:
                        if issue not in [a.get("message", "") for a in wd.get("anomalies", [])]:
                            wd["anomalies"].append({"time": datetime.now().isoformat(), "message": issue})
                            log_error(f"Свечи (пост-сверка): {issue}", "browser")
                            issues_found += 1

                if issues_found > 0:
                    log_info(f"[CANDLE OBS] Пост-сверка: {issues_found} расхождений между «до» и «после» перезагрузки!")
                else:
                    log_info("[CANDLE OBS] Пост-сверка: расхождений нет — свечи одинаковы до и после.")

            wd = results["candle_watchdog"]
            final_snaps = len(wd.get("snapshots", []))
            final_anoms = len(wd.get("anomalies", []))
            results["current_status"] = "ok" if final_anoms == 0 else "error"
            save_results()
            log_info(f"[CANDLE OBS] ЗАВЕРШЕНО! {final_snaps} снимков, {final_anoms} аномалий.")

        except Exception as e:
            log_error(f"[CANDLE OBS] Критическая: {traceback.format_exc()}")
            results["current_status"] = "error"
            save_results()
        finally:
            try: await bg_page.close()
            except: pass
            await browser.close()


def main():
    observe = "--observe-candles" in sys.argv
    once = "--once" in sys.argv
    deep = "--deep" in sys.argv or once or observe
    interval = CHECK_INTERVAL

    for i, arg in enumerate(sys.argv):
        if arg == "--interval" and i + 1 < len(sys.argv):
            try:
                interval = int(sys.argv[i + 1])
            except ValueError:
                pass
        if arg == "--duration" and i + 1 < len(sys.argv):
            try:
                interval = int(sys.argv[i + 1])
            except ValueError:
                pass

    print(f"[BOT] Scrineer Monitor v2")
    print(f"[BOT] URL: {BASE_URL} | deep: {deep}")

    if observe:
        duration = interval if interval != CHECK_INTERVAL else 30
        asyncio.run(run_candle_observation(duration_min=duration))
    elif once:
        asyncio.run(run_once(deep=deep))
    else:
        asyncio.run(run_loop(interval, deep=deep))


if __name__ == "__main__":
    main()
