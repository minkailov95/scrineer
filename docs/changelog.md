# Changelog

## 2026-06-01 — V2 Migration (TypeScript + PixiJS)
- **Стек**: V1 (D3.js) → V2 (TypeScript + PixiJS v8 + Vite)
- **Графика**: SVG → WebGL (PixiJS) — аппаратное ускорение
- **Сборка**: монолит index.html → Vite + модули
- **Язык**: var/JS → TypeScript
- **Сервер**: background process → tmux-сессия

### V2 готово
- Свечи, объёмы, сетка, оси X/Y
- Кроссхеир (пунктирный)
- Таблица монет (сортировка, поиск, клик)
- WebSocket (цена + свечи)
- Info blocks (объём, изменение, NATR, спред)
- Инструменты (луч, rect, текст, ruler, hline)
- Зум (колёсико)

### V2 не готово (от V1)
- Индикаторы на графике (SMA, BB, RSI)
- Фракталы (авто-уровни)
- Панель настроек инструментов
- Пунктирные линии (PixiJS v8 не поддерживает dash)
- Магнит (snap to OHLC)
- X-axis time label при движении кроссхеира

## 2026-05-31 — Part 5: Tools Interaction & Panel Redesign
## 2026-05-31 — Part 4: UI Fixes & Drawing Tools Refinement
## 2026-05-31 — Part 3: Rendering Fixes & Drawing Tools
## 2026-05-31 — Part 2: Bug Fixes & Monitor Bot
## 2026-05-31 — Part 1: Initial D3.js implementation
