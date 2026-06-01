import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Candle } from '../core/types';
import { COLORS } from '../core/constants';
import { fmtNum } from '../core/utils';
import type { ChartEngine } from './ChartEngine';

export class GridRenderer {
  private engine: ChartEngine;
  private labelStyle: TextStyle;

  constructor(engine: ChartEngine) {
    this.engine = engine;
    this.labelStyle = new TextStyle({
      fontFamily: 'JetBrains Mono',
      fontSize: 10,
      fill: COLORS.text,
    });
  }

  render(data: Candle[]): void {
    const { chartWidth, chartHeight } = this.engine;
    const priceMin = Math.min(...data.map(d => d.low));
    const priceMax = Math.max(...data.map(d => d.high));
    const padding = (priceMax - priceMin) * 0.05 || priceMax * 0.01 || 0.01;
    const minP = priceMin - padding;
    const maxP = priceMax + padding;
    const range = maxP - minP || 1;

    const gridG = new Graphics();
    const yAxisG = new Container();
    const xAxisG = new Container();

    // Y-axis grid lines + price labels
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const p = minP + (range * i) / steps;
      const y = chartHeight - (i / steps) * chartHeight;
      gridG.moveTo(0, y).lineTo(chartWidth, y).stroke({ width: 0.5, color: COLORS.grid });

      const lbl = new Text({ text: fmtNum(p), style: this.labelStyle });
      lbl.x = chartWidth + 4;
      lbl.y = y - 6;
      yAxisG.addChild(lbl);
    }

    // X-axis time labels
    const minTime = data[0].time;
    const maxTime = data[data.length - 1].time;
    const xTimeRange = maxTime - minTime || 1;
    const xSteps = Math.min(10, data.length);
    for (let i = 0; i <= xSteps; i++) {
      const idx = Math.floor((data.length - 1) * i / xSteps);
      const d = data[idx];
      if (!d) continue;
      const x = ((d.time - minTime) / xTimeRange) * chartWidth;
      const date = new Date(d.time * 1000);
      const lbl = new Text({
        text: String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0'),
        style: new TextStyle({ fontFamily: 'JetBrains Mono', fontSize: 9, fill: COLORS.text }),
      });
      lbl.x = x - lbl.width / 2;
      lbl.y = chartHeight + 4;
      xAxisG.addChild(lbl);
    }

    this.engine.gridLayer.addChild(gridG);
    this.engine.axisLayer.addChild(yAxisG, xAxisG);
  }
}
