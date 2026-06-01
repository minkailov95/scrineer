import type { Candle } from './types';

export function fmtNum(v: number, maxDec = 6): string {
  return v.toFixed(maxDec).replace(/(\.\d*?)0+$/, '$1');
}

export function getDec(p: number): number {
  if (p < 0.01) return 6; if (p < 1) return 4; if (p < 100) return 3; return 2;
}

export function calcSMA(data: Candle[], period: number): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
    out.push({ time: data[i].time, value: sum / period });
  }
  return out;
}

export function calcBB(data: Candle[], period = 20, mult = 2) {
  const sma = calcSMA(data, period);
  return sma.map((d, idx) => {
    const start = Math.max(0, idx * period);
    const end = start + period;
    const variance = data.slice(start, end).reduce((sum, c) => sum + Math.pow(c.close - d.value, 2), 0) / period;
    const std = Math.sqrt(variance);
    return { time: d.time, upper: d.value + mult * std, mid: d.value, lower: d.value - mult * std };
  });
}

export function calcRSI(data: Candle[], period = 14): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = [];
  let gains = 0, losses = 0;
  for (let i = 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff >= 0) gains += diff; else losses -= diff;
    if (i >= period) {
      const ag = gains / period, al = losses / period;
      const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
      out.push({ time: data[i].time, value: rsi });
      gains *= (period - 1) / period;
      losses *= (period - 1) / period;
    }
  }
  return out;
}

export function calcNATR(klines: Candle[], nPeriod = 14): number {
  if (klines.length < nPeriod + 1) return -1;
  let trSum = 0;
  for (let i = klines.length - nPeriod; i < klines.length; i++) {
    const h = klines[i].high, l = klines[i].low, pc = klines[i - 1].close;
    trSum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return (trSum / nPeriod) / klines[klines.length - 1].close * 100;
}

export function calcFractals(data: Candle[]) {
  if (data.length < 7) return { highs: [] as { time: number; value: number }[], lows: [] as { time: number; value: number }[] };
  const highs: { time: number; value: number }[] = [], lows: { time: number; value: number }[] = [];
  for (let i = 3; i < data.length - 3; i++) {
    const d = data[i];
    if (d.high >= data[i-1].high && d.high >= data[i-2].high && d.high >= data[i-3].high &&
        d.high >= data[i+1].high && d.high >= data[i+2].high && d.high >= data[i+3].high) {
      let touched = false;
      for (let j = i + 1; j < data.length; j++)
        if (data[j].high >= d.high || data[j].close >= d.high) { touched = true; break; }
      if (!touched) highs.push({ time: d.time, value: d.high });
    }
    if (d.low <= data[i-1].low && d.low <= data[i-2].low && d.low <= data[i-3].low &&
        d.low <= data[i+1].low && d.low <= data[i+2].low && d.low <= data[i+3].low) {
      let touched = false;
      for (let j = i + 1; j < data.length; j++)
        if (data[j].low <= d.low || data[j].close <= d.low) { touched = true; break; }
      if (!touched) lows.push({ time: d.time, value: d.low });
    }
  }
  return { highs, lows };
}
