export const COLORS = {
  bg: 0x080B10, grid: 0x141920,
  candleUp: 0x16C784, candleDown: 0xEA3943,
  wickUp: 0x16C784, wickDown: 0xEA3943,
  volUp: 0x16C784, volDown: 0xEA3943,
  text: 0x5C6570, textBright: 0xC8D0D8,
  gold: 0xF0B90B, purple: 0x7C3AED, orange: 0xF7931A,
  crosshair: 0x5C6570,
};

export const PALETTE = ['#F0B90B', '#22AB94', '#F23645', '#7C3AED', '#CFCFCF'];

export const TF_MAP: Record<string, string> = {
  '1м': '1m', '5м': '5m', '15м': '15m', '30м': '30m',
  '1ч': '1h', '2ч': '2h', '4ч': '4h', '1д': '1d', '1н': '1w', '1М': '1M',
};

export const FRACTAL_TF_MAP: Record<string, string> = {
  '1m': '5m', '5m': '15m', '15m': '30m', '30m': '1h',
  '1h': '2h', '2h': '4h', '4h': '1d', '1d': '1d', '1w': '1w', '1M': '1M',
};

export const MARGIN = { top: 8, right: 65, bottom: 28, left: 5 };
export const API_BASE = 'https://fapi.binance.com';
