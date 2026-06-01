import { Application, Container, Graphics } from 'pixi.js';
import type { Candle } from '../core/types';
import { COLORS, MARGIN } from '../core/constants';
import { CandleRenderer } from './CandleRenderer';
import { GridRenderer } from './GridRenderer';
import { Crosshair } from './Crosshair';

export class ChartEngine {
  app!: Application;
  chartContainer!: Container;
  axisLayer!: Container;
  gridLayer!: Container;
  candleLayer!: Container;
  overlayLayer!: Container;
  candlestickRenderer!: CandleRenderer;
  gridRenderer!: GridRenderer;
  crosshair!: Crosshair;

  chartWidth = 0;
  chartHeight = 0;
  private candles: Candle[] = [];
  private zoomLevel = 1;
  private offsetX = 0;
  private offsetY = 0;
  private clipMask!: Graphics;

  async init(container: HTMLElement): Promise<void> {
    const rect = container.getBoundingClientRect();
    this.chartWidth = rect.width - MARGIN.left - MARGIN.right;
    this.chartHeight = rect.height - MARGIN.top - MARGIN.bottom;

    this.app = new Application();
    await this.app.init({
      width: rect.width,
      height: rect.height,
      backgroundColor: COLORS.bg,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    container.appendChild(this.app.canvas);

    // Axis layer — NOT clipped, for labels on right/bottom
    this.axisLayer = new Container();
    this.axisLayer.x = MARGIN.left;
    this.axisLayer.y = MARGIN.top;
    this.app.stage.addChild(this.axisLayer);

    // Chart container — clipped to chart area
    this.chartContainer = new Container();
    this.chartContainer.x = MARGIN.left;
    this.chartContainer.y = MARGIN.top;
    this.clipMask = new Graphics();
    this.clipMask.rect(0, 0, this.chartWidth, this.chartHeight).fill(0xFFFFFF);
    this.chartContainer.mask = this.clipMask;
    this.app.stage.addChild(this.chartContainer);

    this.gridLayer = new Container();
    this.candleLayer = new Container();
    this.overlayLayer = new Container();
    this.chartContainer.addChild(this.gridLayer, this.candleLayer, this.overlayLayer);

    this.candlestickRenderer = new CandleRenderer(this);
    this.gridRenderer = new GridRenderer(this);
    this.crosshair = new Crosshair(this, MARGIN);

    // Zoom with mouse wheel
    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.1 : 0.9;
      this.zoomLevel *= delta;
      this.zoomLevel = Math.max(0.5, Math.min(20, this.zoomLevel));
      this.render();
    }, { passive: false });

    window.addEventListener('resize', () => this.resize(container));
  }

  setCandles(data: Candle[]): void {
    this.candles = data;
    this.render();
  }

  getCandles(): Candle[] { return this.candles; }

  render(): void {
    if (this.candles.length === 0) return;
    this.gridLayer.removeChildren();
    this.candleLayer.removeChildren();
    this.axisLayer.removeChildren();
    this.overlayLayer.removeChildren();

    // Apply zoom
    const visLen = Math.max(10, Math.floor(this.candles.length / this.zoomLevel));
    const endIdx = this.candles.length - Math.floor(this.offsetY * this.candles.length / this.chartHeight);
    const startIdx = Math.max(0, endIdx - visLen);
    const visData = this.candles.slice(startIdx, Math.min(this.candles.length, endIdx + 1));

    if (visData.length < 2) return;
    this.gridRenderer.render(visData);
    this.candlestickRenderer.render(visData);
  }

  private resize(container: HTMLElement): void {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0) return;
    this.chartWidth = rect.width - MARGIN.left - MARGIN.right;
    this.chartHeight = rect.height - MARGIN.top - MARGIN.bottom;
    this.app.renderer.resize(rect.width, rect.height);

    this.clipMask.clear().rect(0, 0, this.chartWidth, this.chartHeight).fill(0xFFFFFF);

    if (this.candles.length > 0) this.render();
  }
}
