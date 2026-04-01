import { Injectable, signal } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { filter, retry } from 'rxjs/operators';
import { Subject, interval } from 'rxjs';

export interface TokenData {
  isPump?: boolean;
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

@Injectable({
  providedIn: 'root'
})
export class MarketDataService {
  
  // SOL Price for conversions (PumpPortal gives data in SOL)
  private solPriceUsd = 200;
  
  // WebSocket State
  private socket$: WebSocketSubject<any> | null = null;
  public readonly tradeUpdates$ = new Subject<PumpPortalTrade>();
  public readonly isConnected = signal<boolean>(false);
  public readonly isPollingActive = signal<boolean>(false);

  constructor() {
    this.fetchSolPrice();
    this.connectWebSocket();
    this.startGlobalTradePolling();
    interval(60000).subscribe(() => this.fetchSolPrice());
  }

  // --- Initial Data Fetching (HTTP) ---

  async fetchSolPrice() {
    try {
      const response = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
      if (response.ok) {
        const data = await response.json();
        if (data.pairs && data.pairs.length > 0) {
          const price = parseFloat(data.pairs[0].priceUsd);
          if (price > 0) {
            this.solPriceUsd = price;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch SOL price, using fallback', e);
    }
  }

  async getPumpTokenData(mintAddress: string): Promise<TokenData | null> {
    try {
      const response = await fetch(`https://frontend-api.pump.fun/coins/${mintAddress}`);
      if (!response.ok) return null;
      const data = await response.json();

      const mcapUsd = parseFloat(data.usd_market_cap) || 0;
      const priceUsd = mcapUsd / 1_000_000_000;

      return {
        chainId: 'solana',
        dexId: 'pumpfun',
        url: `https://pump.fun/${mintAddress}`,
        pairAddress: data.raydium_pool || '',
        baseToken: {
          address: data.mint,
          name: data.name,
          symbol: data.symbol
        },
        priceUsd: priceUsd.toString(),
        fdv: mcapUsd,
        isPump: true,
        info: {
          imageUrl: data.image_uri
        }
      };
    } catch (e) {
      console.warn('Pump.fun API error:', e);
      return null;
    }
  }

  async getTokenData(mintAddress: string): Promise<TokenData | null> {
    if (!mintAddress || mintAddress.length < 10) return null;

    const pumpData = await this.getPumpTokenData(mintAddress);
    if (pumpData) return pumpData;

    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`);
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

  // --- Official API Global Polling ---

  private startGlobalTradePolling() {
    // Poll all latest trades from official pump.fun API
    interval(1500).subscribe(async () => {
      try {
        const response = await fetch('https://frontend-api.pump.fun/trades/all?limit=50');
        if (response.ok) {
          const trades = await response.json();
          this.isPollingActive.set(true);

          trades.forEach((t: any) => {
            // Map official trade to our PumpPortalTrade format for consistency
            const mappedTrade: PumpPortalTrade = {
              signature: t.signature,
              mint: t.mint,
              traderPublicKey: t.user,
              txType: t.is_buy ? 'buy' : 'sell',
              tokenAmount: parseFloat(t.token_amount),
              solAmount: parseFloat(t.sol_amount) / 1e9,
              newTokenBalance: 0,
              bondingCurveKey: '',
              vTokensInBondingCurve: 0,
              vSolInBondingCurve: 0,
              marketCapSol: parseFloat(t.market_cap) / 1e9 // Assuming market_cap is in lamports
            };
            this.tradeUpdates$.next(mappedTrade);
          });
        }
      } catch (e) {
        console.warn('Global trade polling error:', e);
        this.isPollingActive.set(false);
      }
    });
  }

  // --- WebSocket Logic (Real-time fallback/speed) ---

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
          setTimeout(() => this.connectWebSocket(), 3000);
        }
      }
    });

    this.socket$.pipe(
      retry({ delay: 3000 }),
      filter(msg => msg && msg.mint)
    ).subscribe({
      next: (msg: PumpPortalTrade) => this.tradeUpdates$.next(msg),
      error: (err) => {
        console.error('WS Error:', err);
        this.isConnected.set(false);
      }
    });
  }

  subscribeToMint(mint: string) {
    if (this.socket$ && this.isConnected()) {
      this.socket$.next({
        method: "subscribeTokenTrade",
        keys: [mint]
      });
    }
  }

  subscribeAllTokenTrades() {
    if (this.socket$ && this.isConnected()) {
      this.socket$.next({
        method: "subscribeAllTokenTrades"
      });
    }
  }

  unsubscribeFromMint(mint: string) {
    if (this.socket$ && this.isConnected()) {
      this.socket$.next({
        method: "unsubscribeTokenTrade",
        keys: [mint]
      });
    }
  }

  convertSolMcapToUsd(mcapSol: number): { priceUsd: number, mcapUsd: number } {
    const safeMcapSol = mcapSol || 0;
    const mcapUsd = safeMcapSol * this.solPriceUsd;
    const priceUsd = mcapUsd / 1_000_000_000; 
    return { priceUsd, mcapUsd };
  }
}
