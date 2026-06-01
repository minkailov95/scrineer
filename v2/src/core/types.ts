export interface Candle {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}

export interface TickerData {
  s: string; symbol: string; c: number; ch: number; v: number;
}

export interface TickerResponse {
  symbol: string; s: string; c: number; ch: number; v: number; natr: number;
}

export interface RayData {
  time: number; price: number; color: string; width: number; text: string; style: 'solid' | 'dashed';
}

export interface RectData {
  time1: number; price1: number; time2: number; price2: number;
}

export interface TextData {
  time: number; price: number; text: string; color: string; fontSize: number;
}

export interface RulerData {
  price1: number; price2: number; time1: number; time2: number; bars: number;
}

export interface FractalLine {
  time: number; value: number; isHigh: boolean;
}

export type DrawMode = 'cursor' | 'hline' | 'ray' | 'rect' | 'ruler' | 'text' | 'eraser';
export type TimeFrame = '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d' | '1w' | '1M';

export interface PricePoint {
  time: number; price: number;
}
