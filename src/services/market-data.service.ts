import { Injectable, signal } from '@angular/core';
import {
  Subject,
  firstValueFrom,
  filter,
  interval,
  map,
  take,
  timeout
} from 'rxjs';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';

export interface QuoteUsd {
  priceUsd: number;
  mcapUsd: number;
  observedAt: number;
}

export interface LiveTradeQuote extends QuoteUsd {
  mint: string;
}

export interface TokenData {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceUsd: string;
  liquidity?: {
    usd: number;
  };
  fdv?: number;
  info?: {
    imageUrl?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

export interface PumpTraderToken {
  mint: string;
  name?: string;
  symbol?: string;
  description?: string;
  image_uri?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  market_cap?: number;
  usd_market_cap?: number;
  virtual_sol_reserves?: number;
  virtual_token_reserves?: number;
  total_supply?: number;
}

@Injectable({
  providedIn: 'root'
})
export class MarketDataService {
  private readonly websocketUrl = 'wss://pumpportal.fun/api/data';
  private readonly liveSessionMs = 3 * 60 * 1000;
  private readonly hotQuoteMaxAgeMs = 8000;

  private solPriceUsd = 150;
  private socket$: WebSocketSubject<unknown> | null = null;
  private activeMint: string | null = null;
  private latestLiveQuote: LiveTradeQuote | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  readonly tradeUpdates$ = new Subject<LiveTradeQuote>();
  readonly isConnected = signal(false);
  readonly trackedMint = signal<string | null>(null);

  constructor() {
    void this.fetchSolPrice();
    interval(60000).subscribe(() => void this.fetchSolPrice());
  }

  private scheduleIdleClose(durationMs = this.liveSessionMs) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      this.stopLiveSession();
    }, durationMs);
  }

  private connectWebSocket() {
    if (this.socket$) return;

    this.socket$ = webSocket({
      url: this.websocketUrl,
      openObserver: {
        next: () => {
          this.isConnected.set(true);

          if (this.activeMint) {
            this.sendSocketMessage({
              method: 'subscribeTokenTrade',
              keys: [this.activeMint]
            });
          }
        }
      },
      closeObserver: {
        next: () => {
          this.isConnected.set(false);
          this.socket$ = null;

          if (this.activeMint) {
            setTimeout(() => this.connectWebSocket(), 1500);
          }
        }
      }
    });

    this.socket$
      .pipe(filter(payload => !!payload && typeof payload === 'object'))
      .subscribe({
        next: payload => void this.handleLivePayload(payload as Record<string, unknown>),
        error: error => {
          console.warn('PumpPortal WS error', error);
        }
      });
  }

  private sendSocketMessage(payload: object) {
    if (!this.socket$ || !this.isConnected()) return;
    this.socket$.next(payload as never);
  }

  private closeSocket() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.socket$) {
      this.socket$.complete();
      this.socket$ = null;
    }

    this.isConnected.set(false);
  }

  startLiveSession(mintAddress: string, durationMs = this.liveSessionMs) {
    const mint = mintAddress.trim();
    if (!mint) return;
    const mintChanged = this.activeMint !== mint;

    if (this.activeMint && mintChanged && this.isConnected()) {
      this.sendSocketMessage({
        method: 'unsubscribeTokenTrade',
        keys: [this.activeMint]
      });
    }

    this.activeMint = mint;
    this.trackedMint.set(mint);
    this.connectWebSocket();

    if (this.isConnected() && mintChanged) {
      this.sendSocketMessage({
        method: 'subscribeTokenTrade',
        keys: [mint]
      });
    }

    this.scheduleIdleClose(durationMs);
  }

  stopLiveSession() {
    const mint = this.activeMint;
    this.activeMint = null;
    this.trackedMint.set(null);
    this.latestLiveQuote = null;

    if (mint && this.isConnected()) {
      this.sendSocketMessage({
        method: 'unsubscribeTokenTrade',
        keys: [mint]
      });
    }

    this.closeSocket();
  }

  private async handleLivePayload(payload: Record<string, unknown>) {
    const mint = typeof payload['mint'] === 'string' ? payload['mint'].trim() : '';
    if (!mint) return;

    const quote = await this.mapLivePayloadToQuote(payload);
    if (!quote) return;

    const next: LiveTradeQuote = {
      mint,
      ...quote
    };

    this.latestLiveQuote = next;
    this.tradeUpdates$.next(next);
  }

  private async mapLivePayloadToQuote(payload: Record<string, unknown>): Promise<QuoteUsd | null> {
    const directPriceUsd =
      this.toNumber(payload['priceUsd']) ??
      this.toNumber(payload['usdPrice']) ??
      this.toNumber(payload['price_usd']);

    let mcapUsd =
      this.toNumber(payload['marketCapUsd']) ??
      this.toNumber(payload['usdMarketCap']) ??
      this.toNumber(payload['usd_market_cap']);

    const marketCapSol =
      this.toNumber(payload['marketCapSol']) ??
      this.toNumber(payload['market_cap_sol']);

    if ((!mcapUsd || mcapUsd <= 0) && marketCapSol && marketCapSol > 0) {
      await this.fetchSolPrice();
      mcapUsd = marketCapSol * this.solPriceUsd;
    }

    const totalSupply =
      this.toNumber(payload['totalSupply']) ??
      this.toNumber(payload['total_supply']) ??
      1_000_000_000;

    if (directPriceUsd && directPriceUsd > 0) {
      const resolvedMcapUsd =
        mcapUsd && mcapUsd > 0 ? mcapUsd : directPriceUsd * totalSupply;

      if (resolvedMcapUsd && resolvedMcapUsd > 0) {
        return {
          priceUsd: directPriceUsd,
          mcapUsd: resolvedMcapUsd,
          observedAt: Date.now()
        };
      }
    }

    if (!mcapUsd || mcapUsd <= 0) return null;

    const priceUsd = mcapUsd / totalSupply;
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;

    return {
      priceUsd,
      mcapUsd,
      observedAt: Date.now()
    };
  }

  async fetchSolPrice() {
    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112?t=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (!response.ok) throw new Error(`SOL price HTTP ${response.status}`);

      const data = await response.json();
      const next = parseFloat(data?.pairs?.[0]?.priceUsd);
      if (!Number.isFinite(next) || next <= 0) throw new Error('Invalid SOL price payload');

      this.solPriceUsd = next;
    } catch (error) {
      console.warn('Failed to fetch SOL price, keeping fallback value', error);
      if (!Number.isFinite(this.solPriceUsd) || this.solPriceUsd <= 0) {
        this.solPriceUsd = 150;
      }
    }
  }

  async getTokenData(mintAddress: string): Promise<TokenData | null> {
    if (!mintAddress || mintAddress.length < 10) return null;

    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}?t=${Date.now()}`,
        { cache: 'no-store' }
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (!data.pairs || data.pairs.length === 0) return null;

      const sortedPairs = data.pairs.sort(
        (a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      );
      return sortedPairs[0] as TokenData;
    } catch (error) {
      console.warn('Error fetching token data:', error);
      return null;
    }
  }

  async getPumpTraderToken(mintAddress: string): Promise<PumpTraderToken | null> {
    if (!mintAddress || mintAddress.length < 10) return null;

    try {
      const response = await fetch(
        `https://pumptrader.fun/tokens/${mintAddress}?t=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (!response.ok) return null;

      const data = await response.json();
      const token = data?.token as PumpTraderToken | undefined;
      if (!token || typeof token.mint !== 'string') return null;
      return token;
    } catch (error) {
      console.warn('Error fetching PumpTrader token data:', error);
      return null;
    }
  }

  private toNumber(value: unknown): number | null {
    const next =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

    if (!Number.isFinite(next)) return null;
    return next;
  }

  private getDexQuoteUsd(token: TokenData | null): QuoteUsd | null {
    const priceUsd = this.toNumber(token?.priceUsd);
    if (!priceUsd || priceUsd <= 0) return null;

    const mcapUsd =
      typeof token?.fdv === 'number' && Number.isFinite(token.fdv) && token.fdv > 0
        ? token.fdv
        : priceUsd * 1_000_000_000;

    if (!Number.isFinite(mcapUsd) || mcapUsd <= 0) return null;
    return {
      priceUsd,
      mcapUsd,
      observedAt: Date.now()
    };
  }

  private async getPumpQuoteUsd(token: PumpTraderToken | null): Promise<QuoteUsd | null> {
    const mcapUsd = this.toNumber(token?.usd_market_cap);
    if (mcapUsd && mcapUsd > 0) {
      return {
        priceUsd: mcapUsd / 1_000_000_000,
        mcapUsd,
        observedAt: Date.now()
      };
    }

    const mcapSol = this.toNumber(token?.market_cap);
    if (!mcapSol || mcapSol <= 0) return null;

    await this.fetchSolPrice();
    const mcapUsdFromSol = mcapSol * this.solPriceUsd;
    if (!Number.isFinite(mcapUsdFromSol) || mcapUsdFromSol <= 0) return null;

    return {
      priceUsd: mcapUsdFromSol / 1_000_000_000,
      mcapUsd: mcapUsdFromSol,
      observedAt: Date.now()
    };
  }

  async getLatestQuoteUsd(mintAddress: string): Promise<QuoteUsd | null> {
    const [dexToken, pumpToken] = await Promise.all([
      this.getTokenData(mintAddress),
      this.getPumpTraderToken(mintAddress)
    ]);

    const [pumpQuote, dexQuote] = await Promise.all([
      this.getPumpQuoteUsd(pumpToken),
      Promise.resolve(this.getDexQuoteUsd(dexToken))
    ]);

    return pumpQuote ?? dexQuote;
  }

  private getCachedLiveQuote(mintAddress: string): QuoteUsd | null {
    if (!this.latestLiveQuote || this.latestLiveQuote.mint !== mintAddress) return null;
    if (Date.now() - this.latestLiveQuote.observedAt > this.hotQuoteMaxAgeMs) return null;
    return this.latestLiveQuote;
  }

  async getLiveQuoteOnce(
    mintAddress: string,
    _previousQuote?: Partial<QuoteUsd>,
    timeoutMs = 1800
  ): Promise<QuoteUsd | null> {
    const mint = mintAddress.trim();
    if (!mint) return null;

    this.startLiveSession(mint);

    const cached = this.getCachedLiveQuote(mint);
    if (cached) return cached;

    try {
      return await firstValueFrom(
        this.tradeUpdates$.pipe(
          filter(update => update.mint === mint),
          map(({ mint: _mint, ...quote }) => quote),
          take(1),
          timeout({
            first: timeoutMs
          })
        )
      );
    } catch {
      return null;
    }
  }

  async getExecutionQuoteUsd(
    mintAddress: string,
    previousQuote?: Partial<QuoteUsd>,
    timeoutMs = 2200
  ): Promise<QuoteUsd | null> {
    const cached = this.getCachedLiveQuote(mintAddress.trim());
    if (cached) {
      this.startLiveSession(mintAddress);
      return cached;
    }

    this.startLiveSession(mintAddress);

    const liveQuote = await this.getLiveQuoteOnce(mintAddress, previousQuote, Math.min(timeoutMs, 1400));
    if (liveQuote) return liveQuote;

    const latestHttpQuote = await this.getLatestQuoteUsd(mintAddress);
    return latestHttpQuote;
  }

  async getTokenSnapshot(
    mintAddress: string,
    options?: { useExecutionQuote?: boolean }
  ): Promise<{
    mint: string;
    symbol: string;
    name: string;
    imageUrl: string;
    quote: QuoteUsd;
  } | null> {
    const cleanMint = mintAddress.trim();
    const [dexToken, pumpToken, quote] = await Promise.all([
      this.getTokenData(cleanMint),
      this.getPumpTraderToken(cleanMint),
      options?.useExecutionQuote
        ? this.getExecutionQuoteUsd(cleanMint)
        : this.getLatestQuoteUsd(cleanMint)
    ]);

    if (!quote) return null;

    const mint = dexToken?.baseToken.address || pumpToken?.mint || cleanMint;
    const symbol = dexToken?.baseToken.symbol || pumpToken?.symbol || 'TOKEN';
    const name = dexToken?.baseToken.name || pumpToken?.name || symbol;
    const imageUrl =
      dexToken?.info?.imageUrl || pumpToken?.image_uri || `https://picsum.photos/seed/${mint}/200`;

    return {
      mint,
      symbol,
      name,
      imageUrl,
      quote
    };
  }
}
