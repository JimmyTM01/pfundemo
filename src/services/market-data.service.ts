import { Injectable } from '@angular/core';
import { interval } from 'rxjs';

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
  // SOL price is only needed when PumpTrader gives market cap in SOL instead of USD.
  private solPriceUsd = 150;

  constructor() {
    this.fetchSolPrice();
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

  private getDexQuoteUsd(token: TokenData | null): { priceUsd: number; mcapUsd: number } | null {
    const priceUsd = this.toNumber(token?.priceUsd);
    if (!priceUsd || priceUsd <= 0) return null;

    const mcapUsd =
      typeof token?.fdv === 'number' && Number.isFinite(token.fdv) && token.fdv > 0
        ? token.fdv
        : priceUsd * 1_000_000_000;

    if (!Number.isFinite(mcapUsd) || mcapUsd <= 0) return null;
    return { priceUsd, mcapUsd };
  }

  private async getPumpQuoteUsd(token: PumpTraderToken | null): Promise<{ priceUsd: number; mcapUsd: number } | null> {
    const mcapUsd = this.toNumber(token?.usd_market_cap);
    if (mcapUsd && mcapUsd > 0) {
      return { priceUsd: mcapUsd / 1_000_000_000, mcapUsd };
    }

    const mcapSol = this.toNumber(token?.market_cap);
    if (!mcapSol || mcapSol <= 0) return null;

    await this.fetchSolPrice();
    const mcapUsdFromSol = mcapSol * this.solPriceUsd;
    if (!Number.isFinite(mcapUsdFromSol) || mcapUsdFromSol <= 0) return null;

    return { priceUsd: mcapUsdFromSol / 1_000_000_000, mcapUsd: mcapUsdFromSol };
  }

  async getLatestQuoteUsd(mintAddress: string): Promise<{ priceUsd: number; mcapUsd: number } | null> {
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

  async getTokenSnapshot(mintAddress: string): Promise<{
    mint: string;
    symbol: string;
    name: string;
    imageUrl: string;
    quote: { priceUsd: number; mcapUsd: number };
  } | null> {
    const [dexToken, pumpToken] = await Promise.all([
      this.getTokenData(mintAddress),
      this.getPumpTraderToken(mintAddress)
    ]);

    const [pumpQuote, dexQuote] = await Promise.all([
      this.getPumpQuoteUsd(pumpToken),
      Promise.resolve(this.getDexQuoteUsd(dexToken))
    ]);

    const quote = pumpQuote ?? dexQuote;
    if (!quote) return null;

    const mint = dexToken?.baseToken.address || pumpToken?.mint || mintAddress;
    const symbol = dexToken?.baseToken.symbol || pumpToken?.symbol || 'TOKEN';
    const name = dexToken?.baseToken.name || pumpToken?.name || symbol;
    const imageUrl =
      dexToken?.info?.imageUrl || pumpToken?.image_uri || `https://picsum.photos/seed/${mint}/200`;

    return { mint, symbol, name, imageUrl, quote };
  }
}
