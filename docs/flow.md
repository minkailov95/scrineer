# Scrineer V2 — Логика работы

## 1. Инициализация (init)

```
1. fetchAllTickers()        → GET /api/tickers
   ↓
2. Выбор activeCoin         → первый в списке (по CH24h ↓)
   ↓
3. fetchKlines()            → GET fapi/v1/klines (200 свечей)
   ↓
4. ChartEngine.init()       → PixiJS Application, сцена, маска
   ↓
5. DrawingManager.init()    → слой для инструментов
   ↓
6. chart.setCandles(data)   → render() → свечи, сетка, оси
   ↓
7. renderCoinTable()        → таблица монет справа
   ↓
8. connectPriceWS()         → !miniTicker@arr
   connectKlineWS()          → @kline_{interval}
```

## 2. Рендер-цикл

```
chart.render()
  ├── gridLayer.removeChildren()
  ├── candleLayer.removeChildren()
  ├── axisLayer.removeChildren()     ← НЕ в маске (оси видимы)
  ├── overlayLayer.removeChildren()
  │
  ├── GridRenderer.render(data)
  │   ├── gridG:  горизонтальные линии (10 шт)
  │   ├── yAxisG: цена справа (fmtNum)
  │   └── xAxisG: время снизу (HH:MM)
  │
  ├── CandleRenderer.render(data)
  │   ├── wickG:  фитили (линии high-low)
  │   ├── candleG: тела (rect open-close)
  │   └── volG:   объёмы (rect внизу)
  │
  └── DrawingManager.render()       ← после chart.render()
      ├── rays (линии вправо)
      ├── rects (прямоугольники)
      ├── texts (текст)
      ├── rulers (линейки с бейджем)
      └── hlines (горизонтальные линии)
```

## 3. WebSocket — поток цен

```
!miniTicker@arr (каждую секунду)
  ↓
WSManager.onmessage
  ├── update coinPrices[sym]
  ├── update changes24h[sym] = (p - o) / o * 100
  ├── если sym === activeCoin:
  │     ├── обновить last.close в klineData
  │     ├── обновить #currentPriceLabel
  │     └── обновить #priceTag (позиция + цвет)
  └── updateCoinValues() → обновить ячейки CH24h в таблице
```

## 4. WebSocket — поток свечей

```
@kline_{symbol}_{interval}
  ↓
WSManager.onmessage
  ├── если k.x === true (свеча закрылась):
  │     ├── push в candles[]
  │     ├── если >500, shift()
  │     └── chart.setCandles()
  │
  └── если k.x === false (обновление):
        ├── last.close = k.c
        ├── if k.h > last.high → last.high = k.h
        ├── if k.l < last.low  → last.low = k.l
        └── chart.setCandles()
```

## 5. Кроссхеир

```
mousemove на canvas
  ↓
Crosshair.move()
  ├── mx/my → пиксели относительно chartContainer
  ├── time = invertX(mx) → секунды
  ├── price = invertY(my) → число
  ├── vertical line (пунктир, полная высота)
  ├── horizontal line (пунктир, полная ширина)
  ├── label (цена, правый верхний угол)
  └── #crosshairInfo (дата + цена)
```

## 6. Инструменты рисования

```
Клик на canvas (drawMode !== 'cursor')
  ↓
DrawingManager.handleClick(time, price, chartX, chartY)
  │
  ├── mode === 'ray'     → добавить ray, переключить в cursor
  ├── mode === 'hline'   → добавить hline
  ├── mode === 'text'    → добавить текст, переключить в cursor
  ├── mode === 'rect'    → по 2 кликам (pendingRect)
  ├── mode === 'ruler'   → по 2 кликам (pendingRuler)
  └── mode === 'eraser'  → очистить всё
```

## 7. Зум

```
wheel на canvas
  ↓
delta = e.deltaY > 0 ? 1.1 : 0.9
zoomLevel *= delta
zoomLevel = clamp(0.5 ... 20)
  ↓
render()
  ├── visLen = candles.length / zoomLevel
  ├── visData = candles.slice(start, end)
  └── GridRenderer.render(visData)
      CandleRenderer.render(visData)
```

## 8. Таблица монет

```
fetchAllTickers() → массив { s, symbol, c, ch, v, natr }
  ↓
renderCoinTable(list)
  ├── фильтр по поиску (coinSearch.value)
  ├── сортировка (ch24/natr/name ↑↓)
  ├── рендер tbody + active-класс
  └── click → activeCoin, fetchKlines, shift
```

## 9. Модульная архитектура

```
main.ts               ← точка входа
  ├── core/
  │   ├── types.ts    ← типы данных
  │   ├── constants.ts ← цвета, TF, палитра
  │   └── utils.ts    ← форматирование, расчёты
  ├── ws/
  │   ├── manager.ts  ← WebSocket (цена + свечи)
  │   └── ring-buffer.ts ← кольцевой буфер
  ├── chart/
  │   ├── ChartEngine.ts ← главный контроллер
  │   ├── CandleRenderer.ts ← свечи + объёмы
  │   ├── GridRenderer.ts   ← сетка + оси
  │   └── Crosshair.ts      ← перекрестие
  └── tools/
      └── DrawingManager.ts ← все инструменты
```
