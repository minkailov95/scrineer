# Scrineer — Architecture & Key Decisions

## Стек
- **Язык**: TypeScript
- **Сборка**: Vite (без React)
- **Графика**: PixiJS v8 (WebGL/Canvas)
- **Сервер**: Python (server.py, порт 5000)
- **Данные**: WebSocket → RAM-буферы

## Файловая структура V2
```
v2/
├── index.html          — скелет HTML
├── vite.config.ts      — Vite + прокси на :5000
├── tsconfig.json
├── src/
│   ├── main.ts         — точка входа, API, таблица, init
│   ├── styles.css
│   ├── core/
│   │   ├── types.ts    — все TS-интерфейсы (Candle, RayData, и т.д.)
│   │   ├── constants.ts — COLORS, PALETTE, TF_MAP, MARGIN
│   │   ├── utils.ts    — fmtNum, calcSMA, calcBB, calcRSI, calcFractals
│   ├── ws/
│   │   ├── manager.ts  — WSManager (price + kline WebSocket)
│   │   ├── ring-buffer.ts — кольцевой буфер для цен
│   ├── chart/
│   │   ├── ChartEngine.ts — главный контроллер графика (init, render, zoom)
│   │   ├── CandleRenderer.ts — рендер свечей через PixiJS Graphics
│   │   ├── GridRenderer.ts   — сетка, ось Y (цены), ось X (время)
│   │   ├── Crosshair.ts      — перекрестие + цена в углу
│   │   ├── index.ts          — barrel export
│   ├── tools/
│   │   ├── DrawingManager.ts  — все инструменты (луч, rect, текст, ruler, hline)
```

## V1 (старый)
- `index.html` — монолит 2000 строк HTML+CSS+JS (D3.js)
- server.py раздаёт `v2/dist/` сейчас

## Принципиальные решения
1. **PixiJS вместо D3.js** — WebGL, GPU-ускорение, тысячи свечей без лагов
2. **TypeScript вместо var** — автокомплит, типы, ошибки до рантайма
3. **Vite вместо самодельного** — HMR, быстрая сборка, прокси
4. **Маска (clip) отдельно** — axisLayer вне маски для видимости осей
5. **Canvas вместо SVG** — перетаскивание, зум, анимации без лагов
