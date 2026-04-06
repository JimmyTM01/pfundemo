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

  // SOL price is only needed when live/PumpTrader market cap is in SOL.
  private solPriceUsd = 150;
  private socket$: WebSocketSubject<unknown> | null = null;
  private readonly liveMintRefs = new Map<string, number>();

  readonly tradeUpdates$ = new Subject<LiveTradeQuote>();
  readonly isConnected = signal(false);

  constructor() {
    void this.fetchSolPrice();
    interval(60000).subscribe(() => void this.fetchSolPrice());
  }

  private connectWebSocket() {
    if (this.socket$) return;

    this.socket$ = webSocket({
      url: this.websocketUrl,
      openObserver: {
        next: () => {
          this.isConnected.set(true);
          this.resubscribeLiveMints();
        }
      },
      closeObserver: {
        next: () => {
          this.isConnected.set(false);
          this.socket$ = null;

          // Reconnect only if some mint still needs live updates.
          if (this.liveMintRefs.size > 0) {
            setTimeout(() => this.connectWebSocket(), 2000);
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

  private resubscribeLiveMints() {
    for (const mint of this.liveMintRefs.keys()) {
      this.sendSocketMessage({
        method: 'subscribeTokenTrade',
        keys: [mint]
      });
    }
  }

  private sendSocketMessage(payload: object) {
    if (!this.socket$ || !this.isConnected()) return;
    this.socket$.next(payload as never);
  }

  private retainLiveMint(mintAddress: string) {
    const mint = mintAddress.trim();
    if (!mint) return;

    const nextCount = (this.liveMintRefs.get(mint) ?? 0) + 1;
    this.liveMintRefs.set(mint, nextCount);

    this.connectWebSocket();
    if (nextCount === 1) {
      this.sendSocketMessage({
        method: 'subscribeTokenTrade',
        keys: [mint]
      });
    }
  }

  private releaseLiveMint(mintAddress: string) {
    const mint = mintAddress.trim();
    if (!mint) return;

    const currentCount = this.liveMintRefs.get(mint);
    if (!currentCount) return;

    if (currentCount <= 1) {
      this.liveMintRefs.delete(mint);
      this.sendSocketMessage({
        method: 'unsubscribeTokenTrade',
        keys: [mint]
      });

      if (this.liveMintRefs.size === 0 && this.socket$) {
        setTimeout(() => {
          if (this.liveMintRefs.size > 0 || !this.socket$) return;
          this.socket$.complete();
          this.socket$ = null;
          this.isConnected.set(false);
        }, 250);
      }
      return;
    }

    this.liveMintRefs.set(mint, currentCount - 1);
  }

  watchMint(mintAddress: string): () => void {
    this.retainLiveMint(mintAddress);
    return () => this.releaseLiveMint(mintAddress);
  }

  private async handleLivePayload(payload: Record<string, unknown>) {
    const mint = typeof payload['mint'] === 'string' ? payload['mint'].trim() : '';
    if (!mint) return;

    const quote = await this.mapLivePayloadToQuote(payload);
    if (!quote) return;

    this.tradeUpdates$.next({
      mint,
      ...quote
    });
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
          mcapUsd: resolvedMcapUsd
        };
      }
    }

    if (!mcapUsd || mcapUsd <= 0) return null;

    const priceUsd = mcapUsd / totalSupply;
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;

    return {
      priceUsd,
      mcapUsd
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
    return { priceUsd, mcapUsd };
  }

  private async getPumpQuoteUsd(token: PumpTraderToken | null): Promise<QuoteUsd | null> {
    const mcapUsd = this.toNumber(token?.usd_market_cap);
    if (mcapUsd && mcapUsd > 0) {
      return {
        priceUsd: mcapUsd / 1_000_000_000,
        mcapUsd
      };
    }

    const mcapSol = this.toNumber(token?.market_cap);
    if (!mcapSol || mcapSol <= 0) return null;

    await this.fetchSolPrice();
    const mcapUsdFromSol = mcapSol * this.solPriceUsd;
    if (!Number.isFinite(mcapUsdFromSol) || mcapUsdFromSol <= 0) return null;

    return {
      priceUsd: mcapUsdFromSol / 1_000_000_000,
      mcapUsd: mcapUsdFromSol
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

    // Prefer PumpTrader for fresh Pump.fun tokens, then DexScreener for graduated pairs.
    return pumpQuote ?? dexQuote;
  }

  async getLiveQuoteOnce(mintAddress: string, timeoutMs = 1800): Promise<QuoteUsd | null> {
    const mint = mintAddress.trim();
    if (!mint) return null;

    this.retainLiveMint(mint);

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
    } finally {
      this.releaseLiveMint(mint);
    }
  }

  private hasMeaningfulQuoteChange(nextQuote: QuoteUsd, previousQuote?: Partial<QuoteUsd>): boolean {
    if (!previousQuote) return true;

    const previousPrice = this.toNumber(previousQuote.priceUsd);
    const previousMcap = this.toNumber(previousQuote.mcapUsd);

    if (!previousPrice || !previousMcap) return true;

    const priceDelta = Math.abs(nextQuote.priceUsd - previousPrice);
    const mcapDelta = Math.abs(nextQuote.mcapUsd - previousMcap);

    return priceDelta > 0 || mcapDelta > 0;
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getExecutionQuoteUsd(
    mintAddress: string,
    previousQuote?: Partial<QuoteUsd>,
    timeoutMs = 2400
  ): Promise<QuoteUsd | null> {
    const livePromise = this.getLiveQuoteOnce(mintAddress, Math.min(timeoutMs, 1800));
    let latestHttpQuote = await this.getLatestQuoteUsd(mintAddress);

    if (!previousQuote) {
      const liveQuote = await Promise.race([
        livePromise,
        this.delay(350).then(() => null)
      ]);
      return liveQuote ?? latestHttpQuote;
    }

    const deadline = Date.now() + timeoutMs;
    const firstLiveQuote = await Promise.race([
      livePromise,
      this.delay(900).then(() => null)
    ]);

    if (firstLiveQuote && this.hasMeaningfulQuoteChange(firstLiveQuote, previousQuote)) {
      return firstLiveQuote;
    }

    if (latestHttpQuote && this.hasMeaningfulQuoteChange(latestHttpQuote, previousQuote)) {
      return latestHttpQuote;
    }

    while (Date.now() < deadline) {
      await this.delay(400);
      latestHttpQuote = await this.getLatestQuoteUsd(mintAddress);

      if (latestHttpQuote && this.hasMeaningfulQuoteChange(latestHttpQuote, previousQuote)) {
        return latestHttpQuote;
      }
    }

    return latestHttpQuote ?? firstLiveQuote;
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
    const [dexToken, pumpToken, quote] = await Promise.all([
      this.getTokenData(mintAddress),
      this.getPumpTraderToken(mintAddress),
      options?.useExecutionQuote
        ? this.getExecutionQuoteUsd(mintAddress)
        : this.getLatestQuoteUsd(mintAddress)
    ]);

    if (!quote) return null;

    const mint = dexToken?.baseToken.address || pumpToken?.mint || mintAddress;
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
