# Scrineer — Техническая документация

> **Последнее обновление:** 2026-05-31
> **Файлы:** `index.html`, `server.py`, `monitor.py`, `monitor.html`
> **GitHub:** https://github.com/minkailov95/scrineer

---

## 1. Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│  Браузер (index.html)                                       │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ Правая   │  │ D3.js График │  │ Панель инструментов   │ │
│  │ панель   │  │ (SVG)        │  │ (рисование/магнит)    │ │
│  │ монет    │  │ свечи/линия  │  │                       │ │
│  └──────────┘  └──────────────┘  └───────────────────────┘ │
│       ▲              ▲                    ▲                 │
│       │              │                    │                 │
│  /api/tickers   /fapi/v1/klines    WebSocket @kline         │
│       │              │                    │                 │
├───────┼──────────────┼────────────────────┼─────────────────┤
│  server.py (порт 5000)                    │                 │
│  ┌──────────┐  ┌──────────────┐           │                 │
│  │ PRICE_   │  │ NATR_        │           │                 │
│  │ BUFFER   │  │ BUFFER       │           │                 │
│  │ (RAM)    │  │ (RAM)        │           │                 │
│  └──────────┘  └──────────────┘           │                 │
│       ▲              ▲                    │                 │
│       │              │                    │                 │
│  !miniTicker     /fapi/v1/klines          │                 │
│  @arr (WS)       (HTTP)                   │                 │
├───────┼──────────────┼────────────────────┼─────────────────┤
│  Binance Futures API                      │                 │
│  REST: fapi.binance.com                   │                 │
│  WS:   fstream.binance.com/market/        │                 │
└─────────────────────────────────────────────────────────────┘
```

### Потоки данных

| Данные | Источник | Метод | Куда |
|:---|:---|:---|:---|
| Список монет + NATR | server.py RAM | HTTP `GET /api/tickers` (каждые 2с) | Правая панель |
| Онлайн-цены (все пары) | Binance | WebSocket `!miniTicker@arr` | `coinPrices{}`, правая панель |
| Свечи графика | Binance | REST `/klines` + WebSocket `@kline` | D3.js график |
| 24ч статистика | Binance | REST `/ticker/24hr`, `/bookTicker` | Инфо-блоки |

---

## 2. Критические URL (НЕ МЕНЯТЬ)

Binance Futures обновил API в апреле/мае 2025:
```
❌ СТАРЫЕ (не работают):  wss://fstream.binance.com/ws/...
❌ СТАРЫЕ (не работают):  wss://fstream.binance.com/stream?streams=...

✅ НОВЫЕ (рабочие):        wss://fstream.binance.com/market/ws/...
✅ НОВЫЕ (рабочие):        wss://fstream.binance.com/market/stream?streams=...
```

**Где прописаны URL в коде:**
- `server.py` строка 15: `BINANCE_WS` — сбор цен с сервера
- `index.html` строка ~311: `BINANCE_WS` — сбор цен с фронтенда
- `index.html` строка ~312: `BINANCE_WS_SINGLE` — свечи графика

---

## 3. Server.py — Детали

### RAM-буферы
- **`BASE_TICKERS`** — 587 USDT-пар, загружается один раз при старте. Содержит: `symbol`, `s` (имя без USDT), `c` (lastPrice), `ch` (priceChangePercent), `v` (quoteVolume).
- **`PRICE_BUFFER`** — `{symbol: {p: цена, t: timestamp}}`. Наполняется через `ws_price_collector()`. Очистка: данные старше 30 минут удаляются `price_buffer_cleaner()`.
- **`NATR_BUFFER`** — `{symbol: natr_float}`. Наполняется через `natr_background_worker()`. Полный цикл ~60 секунд.

### Кэш
- **`TICKERS_CACHE`** — 1-секундный микрокэш для `/api/tickers`, предотвращает таймауты при высокой нагрузке.

### Эндпоинты
| Путь | Назначение |
|:---|:---|
| `GET /api/tickers` | Объединённые данные: BASE_TICKERS + PRICE_BUFFER + NATR_BUFFER |
| `GET /api/prices` | Сырой PRICE_BUFFER |
| `GET /api/natr` | Сырой NATR_BUFFER |
| `GET /api/*` | Прокси на Binance REST API |
| `GET /*` | Статические файлы (index.html, monitor.html и др.) |

### Потоки (threads)
1. `ws_price_collector` — WebSocket → Binance, наполняет PRICE_BUFFER
2. `price_buffer_cleaner` — каждую секунду чистит устаревшие цены (>30мин)
3. `natr_background_worker` — каждые 60с пересчитывает NATR для всех 587 пар

---

## 4. Index.html — Детали

### Состояние (state)
```javascript
activeCoin       = 'BTCUSDT'     // текущая монета
activeInterval   = '5m'          // текущий таймфрейм
klineData[]      = [...]         // свечи для D3 (200 шт)
tickersData[]    = [...]         // все тикеры для правой панели
coinPrices{}     = {sym: price}  // онлайн-цены
changes24h{}     = {sym: ch%}    // 24ч изменение
natrData{}       = {sym: natr}   // NATR значения
chartReady       = false         // флаг готовности D3
renderPending    = false         // флаг ожидания render-a
```

### Инициализация (init)
1. `fetchExchangeInfo()` — загружает список всех USDT-пар с Binance
2. `fetchAllTickers()` → `GET /api/tickers` — загружает цены + NATR
3. Сортирует по CH24h ↓, выбирает топ-мувер как `activeCoin`
4. `loadChartData()` → `fetchKlines()` → `initChart()` или `setChartData()`
5. `connectPriceWS()` — WebSocket `!miniTicker@arr`
6. `connectKlineWS()` — WebSocket `@kline_{interval}`
7. `renderCoinTable()` — строит таблицу монет
8. `setInterval(fetchAllTickers, 2000)` — обновление таблицы каждые 2с
9. `setInterval(..., 30000)` — полное обновление каждые 30с

### Рендер-цикл (D3)
```
scheduleRender()
  → requestAnimationFrame()
    → renderAll()
      → обновить домены xScale, yScale
      → renderGrid()       — линии сетки
      → renderVolumes()    — гистограмма объёмов
      → renderCandles()    — свечи/линия
      → renderAxes()       — оси X/Y
      → renderIndicators() — SMA, BB, RSI
      → renderFractals()   — авто-уровни
      → renderRays()       — лучи
      → renderPriceLines() — гор. линии
      → renderCurrentPriceLine() — пунктир текущей цены
      → renderRulers()     — линейка
      → updatePriceTag()   — плавающий тег цены
```

### Триггеры рендера
- `connectKlineWS().onmessage` — каждое обновление свечи
- `updatePriceFromTicker()` — каждое обновление цены из `!miniTicker`
- Пользователь: зум, скролл Y-оси, смена таймфрейма, рисование

### Инструменты рисования
- **Горизонтальная линия** — клик → фиолетовая пунктирная линия + метка
- **Луч** — два клика → две оранжевые линии
- **Линейка** — клик A → drag (превью %) → клик B → линия + бейдж (разница, %, бары)
- **Магнит** — привязка кроссхеира/кликов к OHLC
- **Ластик** — очищает все нарисованные объекты

### Форматирование цены (fmtNum)
```javascript
function fmtNum(v, maxDec) {
  maxDec = maxDec || 6;
  return v.toFixed(maxDec).replace(/(\.\d*?)0+$/, '$10');
}
```
Убирает trailing zeros, но оставляет минимум один знак после точки.

---

## 5. Протокол WebSocket-подключений

### Важно: защита от рекурсивного переподключения
```javascript
// Перед закрытием — отключаем обработчик
if (priceWS) { try { priceWS.onclose = null; priceWS.close(); } catch(e) {} }
```

### Поток цен (priceWS)
- URL: `wss://fstream.binance.com/market/stream?streams=!miniTicker@arr`
- Частота: ~1000 мс
- Данные: `{data: [{s: "BTCUSDT", c: "60000.00", o: "59500.00"}, ...]}`

### Поток свечей (klineWS)
- URL: `wss://fstream.binance.com/market/ws/{symbol}@kline_{interval}`
- `k.x === true` → свеча закрылась → добавляем новую в `klineData`
- `k.x === false` → обновляем последнюю свечу
- Переподключение при смене таймфрейма/монеты через 3 секунды

### Статус-бар
- Зелёная точка: WebSocket цен подключён
- Красная точка: отключён / переподключение

---

## 6. Известные проблемы

| # | Проблема | Статус |
|:---|:---|:---|
| 1 | График «замирает» — причину выясняем | 🔴 Открыто |
| 2 | Лучи рисуются от левого края SVG, а не от точки клика | 🟡 Известно |
| 3 | OI5m всегда «—» (нет данных Open Interest) | 🟡 Известно |
| 4 | При клике на монету в правой панели активная строка не всегда переподсвечивается | 🟡 Известно |
| 5 | Нет инструментов: прямоугольник, текст, кисть | 🟡 Известно |
| 6 | Загрузка NATR для ВСЕХ монет с фронтенда (медленно) → вынесено на сервер | ✅ Решено |
| 7 | WebSocket уходил в рекурсивный цикл переподключения | ✅ Решено (onclose = null) |
| 8 | Таймауты `/api/tickers` при большой нагрузке | ✅ Решено (микрокэш 1с) |

---

## 7. Журнал изменений

### 2026-05-31
- [x] Миграция с Lightweight Charts на D3.js v7
- [x] `fmtNum()` — единый формат цен
- [x] Линейка с превью и бейджем
- [x] Серверный NATR с RAM-буферами
- [x] Фикс WebSocket URL (market/ws/)
- [x] Фикс рекурсивного переподключения
- [x] Микрокэш `/api/tickers`
- [x] Сортировка по CH24h по умолчанию
- [x] Таймфрейм 5м по умолчанию
- [ ] Выяснить причину «замирания» графика
- [ ] Инструменты: прямоугольник, текст, кисть
- [ ] Heikin Ashi
- [ ] Логарифмическая шкала
- [ ] Бот-тестировщик + страница мониторинга
