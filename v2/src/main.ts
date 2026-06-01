import { ChartEngine } from './chart/index';
import { DrawingManager } from './tools/DrawingManager';
import { WSManager } from './ws/manager';
import { fmtNum, getDec } from './core/utils';
import { TF_MAP, API_BASE } from './core/constants';
import type { Candle, DrawMode } from './core/types';

// ── State ──
let activeCoin = 'BTCUSDT';
let activeInterval = '5m';
let candles: Candle[] = [];
let allTickers: any[] = [];
let coinPrices: Record<string, number> = {};
let changes24h: Record<string, number> = {};
let natrData: Record<string, number> = {};
let sortColumn = 'ch24';
let sortDirection: 'asc' | 'desc' = 'desc';

const $ = (id: string) => document.getElementById(id);
const ws = new WSManager();

// ── API ──
async function fetchKlines(sym: string, interval: string, limit = 200): Promise<Candle[]> {
  const r = await fetch(`${API_BASE}/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);
  const data = await r.json();
  return data.map((k: any) => ({
    time: Math.floor(k[0] / 1000),
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

async function fetchAllTickers() {
  const r = await fetch('/api/tickers');
  const data = await r.json();
  data.forEach((t: any) => {
    coinPrices[t.symbol] = t.c;
    if (changes24h[t.symbol] == null) changes24h[t.symbol] = t.ch;
    natrData[t.symbol] = t.natr;
  });
  return data;
}

async function fetch24hrTicker(sym: string) {
  const r = await fetch(`${API_BASE}/fapi/v1/ticker/24hr?symbol=${sym}`);
  return r.json();
}

// ── Coin Table ──
function renderCoinTable(list: any[]) {
  const tbody = $('coinBody');
  if (!tbody || list.length === 0) return;

  const searchQ = ($('coinSearch') as HTMLInputElement)?.value?.toLowerCase().replace('usdt', '') || '';

  let filtered = list;
  if (searchQ) filtered = list.filter((t: any) => t.s?.toLowerCase().includes(searchQ));

  filtered.sort((a: any, b: any) => {
    let vA: any, vB: any;
    if (sortColumn === 'name') {
      vA = a.s; vB = b.s;
      return sortDirection === 'asc' ? vA?.localeCompare(vB) : vB?.localeCompare(vA);
    } else if (sortColumn === 'ch24') {
      vA = changes24h[a.symbol] ?? a.ch ?? 0;
      vB = changes24h[b.symbol] ?? b.ch ?? 0;
    } else {
      vA = natrData[a.symbol] ?? -1;
      vB = natrData[b.symbol] ?? -1;
    }
    return sortDirection === 'asc' ? vA - vB : vB - vA;
  });

  tbody.innerHTML = filtered.map((t: any) => {
    const ch = changes24h[t.symbol] ?? t.ch;
    const chStr = ch != null ? (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%' : '...';
    const chClass = ch >= 0 ? 'text-g' : 'text-r';
    const natr = natrData[t.symbol] != null ? natrData[t.symbol].toFixed(2) : '...';
    const active = t.symbol === activeCoin ? ' class="active"' : '';
    return `<tr${active} data-sym="${t.symbol}"><td>${t.s} <span style="font-size:8px;color:var(--textFaint);">USDT</span></td><td class="val-natr">${natr}</td><td class="val-ch ${chClass}">${chStr}</td><td>—</td></tr>`;
  }).join('');

  tbody.querySelectorAll('tr').forEach((row) => {
    row.addEventListener('click', async () => {
      activeCoin = (row as HTMLElement).dataset.sym || 'BTCUSDT';
      $('symDisplay')!.textContent = activeCoin;
      $('navSym')!.textContent = activeCoin;
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      ws.connectKline(activeCoin, activeInterval);
      try { candles = await fetchKlines(activeCoin, activeInterval); (window as any).chart?.setCandles(candles); } catch {}
      updateInfoBlocks();
    });
  });
}

// ── Info Blocks ──
async function updateInfoBlocks() {
  try {
    const t = await fetch24hrTicker(activeCoin);
    const v = +t.quoteVolume;
    $('infoVol')!.textContent = v > 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : '$' + (v / 1e6).toFixed(0) + 'M';
    const ch = +t.priceChangePercent;
    const el = $('infoChg')!;
    el.textContent = ch >= 0 ? '+' + ch.toFixed(2) + '%' : ch.toFixed(2) + '%';
    (el as HTMLElement).style.color = ch >= 0 ? '#16C784' : '#EA3943';
  } catch {}

  $('infoNatr')!.textContent = natrData[activeCoin] != null && natrData[activeCoin] >= 0 ? natrData[activeCoin].toFixed(2) : '...';

  try {
    const r = await fetch(`${API_BASE}/fapi/v1/ticker/bookTicker?symbol=${activeCoin}`);
    const bt = await r.json();
    const spread = ((+bt.askPrice - +bt.bidPrice) / +bt.askPrice * 100);
    $('infoSpread')!.textContent = spread.toFixed(4) + '%';
  } catch { $('infoSpread')!.textContent = '—'; }

  $('updateTime')!.textContent = new Date().toLocaleTimeString();
}

// ── Init ──
async function init() {
  const tickers = await fetchAllTickers().catch(() => []);
  allTickers = tickers;

  if (tickers.length > 0) {
    tickers.sort((a: any, b: any) => (b.ch || 0) - (a.ch || 0));
    activeCoin = tickers[0]?.symbol || 'BTCUSDT';
  }

  $('symDisplay')!.textContent = activeCoin;
  $('navSym')!.textContent = activeCoin;

  candles = await fetchKlines(activeCoin, activeInterval).catch(() => []);

  const container = $('chartContainer')!;
  const chart = new ChartEngine();
  await chart.init(container);
  (window as any).chart = chart;

  const drawTools = new DrawingManager();
  drawTools.init(chart.overlayLayer, $('chartArea')!);

  if (candles.length > 0) chart.setCandles(candles);

  renderCoinTable(tickers);
  updateInfoBlocks();

  // WS prices
  ws.onPrice((data: any[]) => {
    data.forEach((t: any) => {
      const sym = t.s, p = +t.c, o = +t.o;
      coinPrices[sym] = p;
      if (o > 0) changes24h[sym] = ((p - o) / o * 100);
      if (sym === activeCoin) {
        const last = candles[candles.length - 1];
        if (last) { last.close = p; if (p > last.high) last.high = p; if (p < last.low) last.low = p; }
        $('currentPriceLabel')!.textContent = '$' + fmtNum(p);
        const ch = changes24h[sym];
        ($('currentPriceLabel') as HTMLElement).style.color = ch != null && ch >= 0 ? '#16C784' : '#EA3943';
      }
    });
    updateCoinValues();
  });

  // WS kline
  ws.onKline((k: any) => {
    const t = Math.floor(k.t / 1000);
    if (candles.length === 0) return;
    const last = candles[candles.length - 1];
    if (k.x) {
      candles.push({ time: t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
      if (candles.length > 500) candles.shift();
    } else {
      last.close = +k.c;
      if (+k.h > last.high) last.high = +k.h;
      if (+k.l < last.low) last.low = +k.l;
    }
    chart.setCandles(candles);
  });

  ws.connectPrice();
  ws.connectKline(activeCoin, activeInterval);
  $('statusText')!.textContent = `V2 · ${activeCoin} · ${candles.length} св.`;

  // TF buttons
  document.querySelectorAll('.tf-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeInterval = TF_MAP[btn.textContent!.trim()] || '5m';
      ws.connectKline(activeCoin, activeInterval);
      candles = await fetchKlines(activeCoin, activeInterval).catch(() => candles);
      chart.setCandles(candles);
    });
  });

  // Draw tool buttons
  document.querySelectorAll('.draw-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-tool') as string;
      if (tool === 'magnet') return;
      if (tool === 'eraser') { drawTools.setMode('eraser'); drawTools.render(0,0,0,0,0,0); return; }
      document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      drawTools.setMode(tool as DrawMode);
    });
  });

  // Settings panel close on right-click
  document.addEventListener('contextmenu', (e) => {
    const panel = document.getElementById('toolSettings');
    if (panel && !(e.target as HTMLElement).closest?.('#toolSettings')) panel.style.display = 'none';
  });

  // Chart click for drawing tools
  const canvas = chart.app.canvas as HTMLCanvasElement;
  canvas.addEventListener('click', (e: MouseEvent) => {
    const mode = drawTools.getMode();
    if (mode === 'cursor') return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - 5;
    const my = e.clientY - rect.top - 8;
    if (mx < 0 || mx > chart.chartWidth || my < 0 || my > chart.chartHeight) return;
    if (candles.length < 2) return;
    const minT = candles[0].time, maxT = candles[candles.length - 1].time;
    const time = minT + (mx / chart.chartWidth) * (maxT - minT);
    const minP = Math.min(...candles.map(c => c.low));
    const maxP = Math.max(...candles.map(c => c.high));
    const pad = (maxP - minP) * 0.05 || 0.01;
    const price = maxP + pad - (my / chart.chartHeight) * ((maxP + pad) - (minP - pad));
    drawTools.handleClick(time, price, mx + 5, my + 8);
    chart.render();
  });

  // Render drawings on chart render
  const origRender = chart.render.bind(chart);
  chart.render = () => {
    origRender();
    if (candles.length > 0) {
      const minT = candles[0].time, maxT = candles[candles.length - 1].time;
      const vis = candles; // simplified for now
      const minP = Math.min(...vis.map(c => c.low));
      const maxP = Math.max(...vis.map(c => c.high));
      const pad = (maxP - minP) * 0.05 || 0.01;
      drawTools.render(chart.chartWidth, chart.chartHeight, minT, maxT, minP - pad, maxP + pad);
    }
  };

  // Sort headers
  document.querySelectorAll('.sort-header').forEach((th) => {
    th.addEventListener('click', () => {
      const col = (th as HTMLElement).dataset.sort || 'ch24';
      if (sortColumn === col) sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
      else { sortColumn = col; sortDirection = col === 'name' ? 'asc' : 'desc'; }
      renderCoinTable(allTickers);
    });
  });

  // Search
  $('coinSearch')?.addEventListener('input', () => renderCoinTable(allTickers));

  // TF default highlight
  document.querySelectorAll('.tf-btn').forEach(b => {
    if (b.textContent!.trim() === '5м') b.classList.add('active');
  });

  $('statusText')!.textContent = `V2 · ${activeCoin} · ${candles.length} св.`;
  console.log('[V2] Init complete');
}

function updateCoinValues() {
  const rows = $('coinBody')?.querySelectorAll('tr');
  if (!rows) return;
  rows.forEach((row) => {
    const sym = (row as HTMLElement).dataset.sym;
    if (!sym) return;
    const chEl = row.querySelector('.val-ch');
    const ch = changes24h[sym];
    if (chEl && ch != null) {
      chEl.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%';
      chEl.className = 'val-ch ' + (ch >= 0 ? 'text-g' : 'text-r');
    }
    const natrEl = row.querySelector('.val-natr');
    const n = natrData[sym];
    if (natrEl && n != null) natrEl.textContent = n >= 0 ? n.toFixed(2) : '...';
  });
}

init().catch(console.error);
