import type { Candle } from '../core/types';

type WSMessageHandler = (data: any) => void;

export class WSManager {
  private priceWS: WebSocket | null = null;
  private klineWS: WebSocket | null = null;
  private onPriceHandlers: WSMessageHandler[] = [];
  private onKlineHandlers: WSMessageHandler[] = [];
  private reconnectTimer: number | null = null;
  private activeCoin = '';
  private activeInterval = '';

  private readonly WS_BASE = 'wss://fstream.binance.com/market/stream?streams=';
  private readonly WS_SINGLE = 'wss://fstream.binance.com/market/ws/';

  onPrice(handler: WSMessageHandler): void { this.onPriceHandlers.push(handler); }
  onKline(handler: WSMessageHandler): void { this.onKlineHandlers.push(handler); }

  connectPrice(): void {
    if (this.priceWS) { try { this.priceWS.onclose = null; this.priceWS.close(); } catch {} }
    this.priceWS = new WebSocket(this.WS_BASE + '!miniTicker@arr');
    this.priceWS.onopen = () => console.log('[WS] Prices connected');
    this.priceWS.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.data && Array.isArray(msg.data))
          this.onPriceHandlers.forEach(h => h(msg.data));
      } catch {}
    };
    this.priceWS.onclose = () => setTimeout(() => this.connectPrice(), 3000);
    this.priceWS.onerror = () => {};
  }

  connectKline(symbol: string, interval: string): void {
    this.activeCoin = symbol;
    this.activeInterval = interval;
    if (this.klineWS) { try { this.klineWS.onclose = null; this.klineWS.close(); } catch {} }
    const url = this.WS_SINGLE + symbol.toLowerCase() + '@kline_' + interval;
    this.klineWS = new WebSocket(url);
    this.klineWS.onopen = () => console.log('[WS] Kline connected:', symbol, interval);
    this.klineWS.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.k) this.onKlineHandlers.forEach(h => h(msg.k));
      } catch {}
    };
    this.klineWS.onclose = () => {
      if (this.activeCoin)
        setTimeout(() => this.connectKline(this.activeCoin, this.activeInterval), 3000);
    };
  }

  disconnect(): void {
    if (this.priceWS) { this.priceWS.onclose = null; this.priceWS.close(); this.priceWS = null; }
    if (this.klineWS) { this.klineWS.onclose = null; this.klineWS.close(); this.klineWS = null; }
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }
}
