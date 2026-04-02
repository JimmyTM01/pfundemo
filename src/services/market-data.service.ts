import { Injectable, signal } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { filter, retry } from 'rxjs/operators';
import { Subject, interval } from 'rxjs';

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

export interface PumpPortalTrade {
  signature: string;
  mint: string;
  traderPublicKey: string;
  txType: 'buy' | 'sell' | 'create';
  tokenAmount: number;
  solAmount: number;
  newTokenBalance: number;
  bondingCurveKey: string;
  vTokensInBondingCurve: number;
  vSolInBondingCurve: number;
  marketCapSol: number;
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
  market_cap?: number; // Usually in SOL
  usd_market_cap?: number;
  virtual_sol_reserves?: number;
  virtual_token_reserves?: number;
  total_supply?: number;
}

@Injectable({
  providedIn: 'root'
})
export class MarketDataService {
  
  // SOL Price for conversions (PumpPortal gives data in SOL)
  // Default to a reasonable value so live updates still work if the HTTP fetch is blocked/rate-limited.
  private solPriceUsd = 150;
  private lastTradeByMint = new Map<string, PumpPortalTrade>();
  private lastTradeAtByMint = new Map<string, number>();
  
  // WebSocket State
  private socket$: WebSocketSubject<any> | null = null;
  public readonly tradeUpdates$ = new Subject<PumpPortalTrade>();
  public readonly isConnected = signal<boolean>(false);

  constructor() {
    this.fetchSolPrice();
    this.connectWebSocket();
    
    // Refresh SOL price every 60 seconds to keep USD valuations accurate
    interval(60000).subscribe(() => this.fetchSolPrice());
  }

  // --- Initial Data Fetching (HTTP) ---

  async fetchSolPrice() {
    try {
      // Fetch SOL price from DexScreener (using Wrapped SOL address)
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112?t=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (!response.ok) throw new Error(`SOL price HTTP ${response.status}`);

      const data = await response.json();
      const next = parseFloat(data?.pairs?.[0]?.priceUsd);
      if (!Number.isFinite(next) || next <= 0) throw new Error('Invalid SOL price payload');

      this.solPriceUsd = next;
    } catch (e) {
      console.warn('Failed to fetch SOL price, defaulting to 150', e);
      // Keep existing value if already set; otherwise use fallback.
      if (!Number.isFinite(this.solPriceUsd) || this.solPriceUsd <= 0) this.solPriceUsd = 150;
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

      const sortedPairs = data.pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      return sortedPairs[0] as TokenData;
    } catch (error) {
      console.warn('Error fetching token data:', error);
      return null;
    }
  }

  async getPumpTraderToken(mintAddress: string): Promise<PumpTraderToken | null> {
    if (!mintAddress || mintAddress.length < 10) return null;

    try {
      const response = await fetch(`https://pumptrader.fun/tokens/${mintAddress}?t=${Date.now()}`, { cache: 'no-store' });
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

  private toNumber(val: unknown): number | null {
    const n = typeof val === 'number' ? val : typeof val === 'string' ? Number(val) : NaN;
    if (!Number.isFinite(n)) return null;
    return n;
  }

  // Single helper used by manual updates and sell execution:
  // DexScreener first (best for graduated tokens), then PumpTrader (best for fresh Pump.fun tokens).
  async getBestQuoteUsd(mintAddress: string): Promise<{ priceUsd: number; mcapUsd: number } | null> {
    const ds = await this.getTokenData(mintAddress);
    const dsPrice = this.toNumber(ds?.priceUsd);
    if (ds && dsPrice && dsPrice > 0) {
      const dsMcap =
        typeof ds.fdv === 'number' && Number.isFinite(ds.fdv) && ds.fdv > 0 ? ds.fdv : dsPrice * 1_000_000_000;
      return { priceUsd: dsPrice, mcapUsd: dsMcap };
    }

    const pump = await this.getPumpTraderToken(mintAddress);
    const mcapUsd = this.toNumber(pump?.usd_market_cap);
    if (mcapUsd && mcapUsd > 0) {
      return { priceUsd: mcapUsd / 1_000_000_000, mcapUsd };
    }

    const mcapSol = this.toNumber(pump?.market_cap);
    if (mcapSol && mcapSol > 0) {
      const mcapUsdFromSol = mcapSol * (this.solPriceUsd || 0);
      if (Number.isFinite(mcapUsdFromSol) && mcapUsdFromSol > 0) {
        return { priceUsd: mcapUsdFromSol / 1_000_000_000, mcapUsd: mcapUsdFromSol };
      }
    }

    return null;
  }

  private waitForConnected(timeoutMs: number): Promise<boolean> {
    if (this.isConnected()) return Promise.resolve(true);

    return new Promise(resolve => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (this.isConnected()) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, 200);
    });
  }

  private waitForNextTrade(mint: string, timeoutMs: number): Promise<PumpPortalTrade | null> {
    return new Promise(resolve => {
      const sub = this.tradeUpdates$.subscribe(trade => {
        if (trade?.mint === mint) {
          cleanup();
          resolve(trade);
        }
      });
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        sub.unsubscribe();
      };
    });
  }

  // "Current" valuation for actions: WS trade update first (freshest), then HTTP fallbacks.
  // This intentionally bypasses browser caches and may wait a bit for a new trade tick.
  async getLatestQuoteUsd(
    mintAddress: string,
    opts?: { timeoutMs?: number; maxAgeMs?: number; waitForConnectionMs?: number }
  ): Promise<{ priceUsd: number; mcapUsd: number } | null> {
    const timeoutMs = opts?.timeoutMs ?? 15000;
    const maxAgeMs = opts?.maxAgeMs ?? 8000;
    const waitForConnectionMs = opts?.waitForConnectionMs ?? 5000;

    const lastTrade = this.lastTradeByMint.get(mintAddress);
    const lastAt = this.lastTradeAtByMint.get(mintAddress);
    if (lastTrade && typeof lastAt === 'number' && Date.now() - lastAt <= maxAgeMs) {
      await this.fetchSolPrice();
      const { priceUsd, mcapUsd } = this.convertSolMcapToUsd(lastTrade.marketCapSol);
      if (Number.isFinite(priceUsd) && priceUsd > 0 && Number.isFinite(mcapUsd) && mcapUsd > 0) {
        return { priceUsd, mcapUsd };
      }
    }

    const connected = this.isConnected() || (await this.waitForConnected(waitForConnectionMs));
    if (connected) {
      await this.fetchSolPrice();
      this.subscribeToMint(mintAddress);

      const trade = await this.waitForNextTrade(mintAddress, timeoutMs);
      if (trade) {
        const { priceUsd, mcapUsd } = this.convertSolMcapToUsd(trade.marketCapSol);
        if (Number.isFinite(priceUsd) && priceUsd > 0 && Number.isFinite(mcapUsd) && mcapUsd > 0) {
          return { priceUsd, mcapUsd };
        }
      }
    }

    const httpQuote = await this.getBestQuoteUsd(mintAddress);
    if (httpQuote) return httpQuote;

    // If all HTTP sources fail, fall back to the last WS trade we have (even if older).
    if (lastTrade) {
      await this.fetchSolPrice();
      const { priceUsd, mcapUsd } = this.convertSolMcapToUsd(lastTrade.marketCapSol);
      if (Number.isFinite(priceUsd) && priceUsd > 0 && Number.isFinite(mcapUsd) && mcapUsd > 0) {
        return { priceUsd, mcapUsd };
      }
    }

    return null;
  }

  // --- WebSocket Logic (Real-time) ---

  private connectWebSocket() {
    if (this.socket$) return;

    this.socket$ = webSocket({
      url: 'wss://pumpportal.fun/api/data',
      openObserver: {
        next: () => {
          console.log('PumpPortal WS Connected');
          this.isConnected.set(true);
        }
      },
      closeObserver: {
        next: () => {
          console.log('PumpPortal WS Closed');
          this.isConnected.set(false);
          this.socket$ = null;
          // Simple reconnect logic via timeout
          setTimeout(() => this.connectWebSocket(), 3000);
        }
      }
    });

    this.socket$.pipe(
      retry({ delay: 3000 }), // Retry connection if it fails
      filter(msg => msg && msg.mint) // Only pass valid trade messages
    ).subscribe({
      next: (msg: PumpPortalTrade) => {
        this.lastTradeByMint.set(msg.mint, msg);
        this.lastTradeAtByMint.set(msg.mint, Date.now());
        this.tradeUpdates$.next(msg);
      },
      error: (err) => console.error('WS Error:', err)
    });
  }

  subscribeToMint(mint: string) {
    if (this.socket$ && this.isConnected()) {
      this.socket$.next({
        method: "subscribeTokenTrade",
        keys: [mint]
      });
    }
    // Removed the recursive setTimeout logic here as it causes issues.
    // Re-subscription is now handled reactively in PortfolioService.
  }

  unsubscribeFromMint(mint: string) {
    if (this.socket$ && this.isConnected()) {
      this.socket$.next({
        method: "unsubscribeTokenTrade",
        keys: [mint]
      });
    }
  }

  // Helper to convert SOL market cap to USD price
  // Assumption: Standard Pump.fun token supply is 1 Billion
  convertSolMcapToUsd(mcapSol: number): { priceUsd: number, mcapUsd: number } {
    const mcapUsd = mcapSol * (this.solPriceUsd || 0);
    const priceUsd = mcapUsd / 1_000_000_000; 
    return { priceUsd, mcapUsd };
  }
}
