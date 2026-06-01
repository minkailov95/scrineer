import { Graphics, Text, TextStyle, Container } from 'pixi.js';
import { COLORS } from '../core/constants';
import { fmtNum } from '../core/utils';
import type { ChartEngine } from './ChartEngine';

export class Crosshair {
  private engine: ChartEngine;
  private margin: { top: number; right: number; bottom: number; left: number };
  private g: Graphics;
  private label: Text;
  private visible = false;
  private labelStyle: TextStyle;

  constructor(engine: ChartEngine, margin: { top: number; right: number; bottom: number; left: number }) {
    this.engine = engine;
    this.margin = margin;
    this.g = new Graphics();
    this.labelStyle = new TextStyle({ fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: '700', fill: 0xC8D0D8 });
    this.label = new Text({ text: '', style: this.labelStyle });
    this.label.anchor.set(1, 0);
    engine.overlayLayer.addChild(this.g, this.label);

    const canvas = engine.app.canvas as HTMLCanvasElement;
    canvas.addEventListener('mousemove', (e: MouseEvent) => this.move(e));
    canvas.addEventListener('mouseleave', () => this.hide());
  }

  private move(e: MouseEvent): void {
    const rect = (this.engine.app.canvas as HTMLCanvasElement).getBoundingClientRect();
    const mx = e.clientX - rect.left - this.margin.left;
    const my = e.clientY - rect.top - this.margin.top;
    if (mx < 0 || mx > this.engine.chartWidth || my < 0 || my > this.engine.chartHeight) {
      this.hide(); return;
    }
    const candles = this.engine.getCandles();
    if (candles.length === 0) return;

    const minTime = candles[0].time;
    const maxTime = candles[candles.length - 1].time;
    const timeRange = maxTime - minTime || 1;
    const time = minTime + (mx / this.engine.chartWidth) * timeRange;

    let idx = 0;
    for (let i = 0; i < candles.length; i++) {
      if (candles[i].time <= time) idx = i;
    }
    const d = candles[idx];

    const priceMin = Math.min(...candles.map(c => c.low));
    const priceMax = Math.max(...candles.map(c => c.high));
    const padding = (priceMax - priceMin) * 0.05 || 0.01;
    const minP = priceMin - padding;
    const maxP = priceMax + padding;
    const range = maxP - minP || 1;
    const price = maxP - (my / this.engine.chartHeight) * range;

    this.g.clear();
    const cx = this.margin.left + mx;
    const cy = this.margin.top + my;

    // Vertical line (full height) — dashed via segments
    const dashLen = 6, gapLen = 4;
    const yStart = this.margin.top, yEnd = this.margin.top + this.engine.chartHeight;
    let yPos = yStart;
    let toggle = true;
    while (yPos < yEnd) {
      const next = Math.min(yPos + (toggle ? dashLen : gapLen), yEnd);
      if (toggle) {
        this.g.moveTo(cx, yPos).lineTo(cx, next);
      }
      yPos = next;
      toggle = !toggle;
    }
    this.g.stroke({ width: 1, color: COLORS.crosshair });

    // Horizontal line (full width) — dashed
    const xStart = this.margin.left, xEnd = this.margin.left + this.engine.chartWidth;
    let xPos = xStart;
    toggle = true;
    while (xPos < xEnd) {
      const next = Math.min(xPos + (toggle ? dashLen : gapLen), xEnd);
      if (toggle) {
        this.g.moveTo(xPos, cy).lineTo(next, cy);
      }
      xPos = next;
      toggle = !toggle;
    }
    this.g.stroke({ width: 1, color: COLORS.crosshair });

    this.label.text = fmtNum(price);
    this.label.x = this.margin.left + this.engine.chartWidth - 2;
    this.label.y = cy - 14;

    const info = document.getElementById('crosshairInfo');
    if (info) {
      info.style.display = 'block';
      const date = new Date(d.time * 1000);
      info.textContent = `${date.getDate()}/${date.getMonth() + 1} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} | ${fmtNum(price)}`;
    }

    this.visible = true;
  }

  private hide(): void {
    this.g.clear();
    this.label.text = '';
    const info = document.getElementById('crosshairInfo');
    if (info) info.style.display = 'none';
    this.visible = false;
  }
}
