import { Graphics, Text, TextStyle, Container } from 'pixi.js';
import { COLORS } from '../core/constants';
import { fmtNum } from '../core/utils';
import type { RayData, RectData, TextData, RulerData, DrawMode } from '../core/types';
import { PALETTE } from '../core/constants';

interface ToolSettings {
  color: string;
  width: number;
  text: string;
  style: 'solid' | 'dashed';
  fontSize: number;
}

export class DrawingManager {
  layer!: Container;
  private rays: RayData[] = [];
  private rects: RectData[] = [];
  private texts: TextData[] = [];
  private rulers: RulerData[] = [];
  private hlines: { price: number; color: string; width: number }[] = [];
  private mode: DrawMode = 'cursor';
  private magnet = false;
  private pendingRuler: { price1: number; time1: number; x1: number; y1: number } | null = null;
  private pendingRect: { price1: number; time1: number } | null = null;
  private previewG!: Graphics;
  private textStyle!: TextStyle;

  private settingsPanel: HTMLDivElement | null = null;
  private selectedType: string | null = null;
  private selectedIdx = -1;

  init(container: Container, chartContainer: HTMLElement): void {
    this.layer = new Container();
    container.addChild(this.layer);
    this.previewG = new Graphics();
    this.layer.addChild(this.previewG);
    this.textStyle = new TextStyle({ fontFamily: 'JetBrains Mono', fontSize: 10, fill: COLORS.orange });
    this.createSettingsPanel(chartContainer);
  }

  private createSettingsPanel(parent: HTMLElement): void {
    const panel = document.createElement('div');
    panel.id = 'toolSettings';
    panel.style.cssText = `
      position:absolute; z-index:100; background:#1E1E1E; border:1px solid #06B6D4;
      border-radius:12px; padding:6px 10px; display:none; align-items:center; gap:6px;
      font-size:11px; min-width:320px; pointer-events:auto;
    `;

    panel.innerHTML = `
      <span id="tsHandle" style="cursor:grab;font-size:10px;font-weight:600;color:#06B6D4;text-transform:uppercase;user-select:none;">⊙</span>
      <div class="sep" style="width:1px;height:22px;background:#333;"></div>
      <div id="tsSwatches" style="display:flex;gap:3px;"></div>
      <div class="sep" style="width:1px;height:22px;background:#333;"></div>
      <input type="color" id="tsColor" value="#06B6D4" style="width:20px;height:20px;border-radius:50%;padding:0;border:2px solid #555;cursor:pointer;">
      <div class="sep" style="width:1px;height:22px;background:#333;"></div>
      <input type="number" id="tsWidth" value="1" min="1" max="10" style="width:32px;background:rgba(0,0,0,0.3);color:#E2E8F0;border:1px solid rgba(255,255,255,0.06);border-radius:4px;padding:2px 4px;font-size:11px;font-family:'JetBrains Mono',monospace;">
      <div class="sep" style="width:1px;height:22px;background:#333;"></div>
      <select id="tsStyle" style="background:rgba(0,0,0,0.3);color:#06B6D4;border:1px solid #06B6D444;border-radius:4px;padding:2px 4px;font-size:10px;font-family:'JetBrains Mono',monospace;">
        <option value="solid">—</option>
        <option value="dashed">--</option>
      </select>
      <div class="sep" style="width:1px;height:22px;background:#333;"></div>
      <input type="text" id="tsText" placeholder="Текст" style="background:rgba(0,0,0,0.3);color:#E2E8F0;border:1px solid rgba(255,255,255,0.06);border-radius:4px;padding:2px 6px;font-size:11px;min-width:60px;">
      <button id="tsDel" style="background:transparent;border:none;color:#FC8181;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px;">🗑</button>
    `;
    parent.appendChild(panel);
    this.settingsPanel = panel;

    // Swatches
    const swatchContainer = panel.querySelector('#tsSwatches')!;
    PALETTE.forEach(c => {
      const sw = document.createElement('span');
      sw.style.cssText = `width:14px;height:14px;border-radius:50%;background:${c};border:2px solid transparent;cursor:pointer;`;
      sw.addEventListener('click', () => {
        (panel.querySelector('#tsColor') as HTMLInputElement).value = c;
        swatchContainer.querySelectorAll('span').forEach(s => s.style.borderColor = 'transparent');
        sw.style.borderColor = '#06B6D4';
        this.applySettingsFromPanel();
      });
      swatchContainer.appendChild(sw);
    });

    // Events
    panel.querySelector('#tsColor')?.addEventListener('input', () => this.applySettingsFromPanel());
    panel.querySelector('#tsWidth')?.addEventListener('input', () => this.applySettingsFromPanel());
    panel.querySelector('#tsStyle')?.addEventListener('change', () => this.applySettingsFromPanel());
    panel.querySelector('#tsText')?.addEventListener('input', () => this.applySettingsFromPanel());
    panel.querySelector('#tsDel')?.addEventListener('click', () => this.deleteSelected());

    // Drag handle
    const handle = panel.querySelector('#tsHandle') as HTMLElement;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const ox = e.clientX - panel.offsetLeft;
      const oy = e.clientY - panel.offsetTop;
      const move = (ev: MouseEvent) => { panel.style.left = (ev.clientX - ox) + 'px'; panel.style.top = (ev.clientY - oy) + 'px'; };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', () => document.removeEventListener('mousemove', move), { once: true });
    });

    document.addEventListener('contextmenu', (e) => {
      if (!e.target || !(e.target as HTMLElement).closest?.('#toolSettings')) {
        panel.style.display = 'none';
        this.selectedType = null;
      }
    });
  }

  private applySettingsFromPanel(): void {
    if (!this.settingsPanel || !this.selectedType) return;
    const color = (this.settingsPanel.querySelector('#tsColor') as HTMLInputElement).value;
    const width = parseInt((this.settingsPanel.querySelector('#tsWidth') as HTMLInputElement).value) || 1;
    const style = (this.settingsPanel.querySelector('#tsStyle') as HTMLSelectElement).value as 'solid' | 'dashed';
    const text = (this.settingsPanel.querySelector('#tsText') as HTMLInputElement).value;

    if (this.selectedType === 'ray' && this.rays[this.selectedIdx]) {
      this.rays[this.selectedIdx].color = color;
      this.rays[this.selectedIdx].width = width;
      this.rays[this.selectedIdx].style = style;
      this.rays[this.selectedIdx].text = text;
    }
  }

  private deleteSelected(): void {
    if (this.selectedType === 'ray' && this.rays[this.selectedIdx]) {
      this.rays.splice(this.selectedIdx, 1);
    }
    if (this.settingsPanel) this.settingsPanel.style.display = 'none';
    this.selectedType = null;
  }

  setMode(mode: DrawMode): void {
    this.mode = mode;
    if (mode === 'ray') this.magnet = true;
    if (mode === 'eraser') this.clearAll();
  }

  private clearAll(): void {
    this.rays = []; this.rects = []; this.texts = []; this.rulers = []; this.hlines = [];
  }

  handleClick(time: number, price: number, chartX: number, chartY: number): void {
    if (this.mode === 'ray') {
      this.rays.push({ time, price, color: '#06B6D4', width: 1, text: '', style: 'solid' });
      this.mode = 'cursor';
    } else if (this.mode === 'hline') {
      this.hlines.push({ price, color: '#7C3AED', width: 1 });
    } else if (this.mode === 'text') {
      this.texts.push({ time, price, text: 'Метка', color: '#F0B90B', fontSize: 12 });
      this.mode = 'cursor';
    } else if (this.mode === 'rect') {
      if (!this.pendingRect) {
        this.pendingRect = { price1: price, time1: time };
      } else {
        this.rects.push({ price1: this.pendingRect.price1, time1: this.pendingRect.time1, price2: price, time2: time });
        this.pendingRect = null;
      }
    } else if (this.mode === 'ruler') {
      if (!this.pendingRuler) {
        this.pendingRuler = { price1: price, time1: time, x1: chartX, y1: chartY };
      } else {
        const barIdx1 = 0; // simplified
        const barIdx2 = 0;
        this.rulers.push({ price1: this.pendingRuler.price1, price2: price, time1: this.pendingRuler.time1, time2: time, bars: Math.abs(barIdx2 - barIdx1) });
        this.pendingRuler = null;
        this.mode = 'cursor';
      }
    }
  }

  render(chartWidth: number, chartHeight: number, minTime: number, maxTime: number, minPrice: number, maxPrice: number): void {
    this.layer.removeChildren();
    this.layer.addChild(this.previewG);
    this.previewG.clear();

    const xScale = (t: number) => (t - minTime) / (maxTime - minTime || 1) * chartWidth;
    const yScale = (p: number) => chartHeight - (p - minPrice) / (maxPrice - minPrice || 1) * chartHeight;

    const g = new Graphics();

    // Rays
    for (const r of this.rays) {
      const x = xScale(r.time);
      const y = yScale(r.price);
      g.moveTo(x, y).lineTo(chartWidth, y)
        .stroke({ width: r.width, color: r.color });
      if (r.text) {
        const txt = new Text({ text: r.text, style: new TextStyle({ fontFamily: 'JetBrains Mono', fontSize: 10, fill: r.color }) });
        txt.x = x + 4; txt.y = y - 4;
        this.layer.addChild(txt);
      }
    }

    // Rects
    for (const r of this.rects) {
      const x1 = xScale(r.time1), x2 = xScale(r.time2);
      const y1 = yScale(r.price1), y2 = yScale(r.price2);
      g.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
        .fill({ color: 0xF0B90B, alpha: 0.1 }).stroke({ width: 1, color: 0xF0B90B });
    }

    // Texts
    for (const t of this.texts) {
      const txt = new Text({ text: t.text, style: new TextStyle({ fontFamily: 'Inter', fontSize: t.fontSize, fill: t.color }) });
      txt.anchor.set(0.5, 0.5);
      txt.x = xScale(t.time); txt.y = yScale(t.price);
      this.layer.addChild(txt);
    }

    // Rulers
    for (const r of this.rulers) {
      const x1 = xScale(r.time1), x2 = xScale(r.time2);
      const y1 = yScale(r.price1), y2 = yScale(r.price2);
      g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 1.5, color: 0xF0B90B });
      g.circle(x1, y1, 4).fill(0xF0B90B);
      g.circle(x2, y2, 4).fill(0xF0B90B);
    }

    // Hlines
    for (const h of this.hlines) {
      const y = yScale(h.price);
      g.moveTo(0, y).lineTo(chartWidth, y).stroke({ width: 1, color: h.color });
    }

    this.layer.addChild(g);
  }

  getRays(): RayData[] { return this.rays; }
  getRects(): RectData[] { return this.rects; }
  getTexts(): TextData[] { return this.texts; }
  getRulers(): RulerData[] { return this.rulers; }
  getHlines(): { price: number; color: string; width: number }[] { return this.hlines; }
  getMode(): DrawMode { return this.mode; }
  isMagnet(): boolean { return this.magnet; }
}
