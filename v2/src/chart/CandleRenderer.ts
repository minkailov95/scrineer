import { Graphics } from 'pixi.js';
import type { Candle } from '../core/types';
import { COLORS } from '../core/constants';
import type { ChartEngine } from './ChartEngine';

export class CandleRenderer {
  private engine: ChartEngine;
  private candleW = 0;

  constructor(engine: ChartEngine) {
    this.engine = engine;
  }

  render(data: Candle[]): void {
    if (data.length < 2) return;
    const { chartWidth, chartHeight } = this.engine;
    const maxVol = Math.max(...data.map(d => d.volume));
    const minTime = data[0].time;
    const maxTime = data[data.length - 1].time;
    const timeRange = maxTime - minTime || 1;
    const xScale = (t: number) => (t - minTime) / timeRange * chartWidth;
    const priceMin = Math.min(...data.map(d => d.low));
    const priceMax = Math.max(...data.map(d => d.high));
    const priceRange = priceMax - priceMin || 1;
    const yScale = (p: number) => (priceMax - p) / priceRange * chartHeight;

    this.candleW = Math.max(1, xScale(data[1].time) - xScale(data[0].time));

    const bodyW = Math.max(1, Math.min(this.candleW * 0.7, 20));
    const volG = new Graphics();
    const candleG = new Graphics();
    const wickG = new Graphics();

    for (const d of data) {
      const x = xScale(d.time);
      const up = d.close >= d.open;
      const yHigh = yScale(d.high);
      const yLow = yScale(d.low);
      const yOpen = yScale(d.open);
      const yClose = yScale(d.close);

      // Volume
      volG.rect(x - bodyW / 2, chartHeight - (d.volume / maxVol) * chartHeight * 0.2, bodyW, (d.volume / maxVol) * chartHeight * 0.2)
        .fill(up ? COLORS.volUp : COLORS.volDown);

      // Wick
      wickG.moveTo(x, yHigh).lineTo(x, yLow).stroke({ width: 1, color: up ? COLORS.wickUp : COLORS.wickDown });

      // Body
      candleG.rect(x - bodyW / 2, Math.min(yOpen, yClose), bodyW, Math.max(1, Math.abs(yClose - yOpen)))
        .fill(up ? COLORS.candleUp : COLORS.candleDown);
    }

    this.engine.candleLayer.addChild(wickG, candleG, volG);
  }
}
