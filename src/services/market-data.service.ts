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

@Injectable({
  providedIn: 'root'
})
export class MarketDataService {
  
  // SOL Price for conversions (PumpPortal gives data in SOL)
  private solPriceUsd = 0;
  
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
      const response = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
      if (response.ok) {
        const data = await response.json();
        if (data.pairs && data.pairs.length > 0) {
          this.solPriceUsd = parseFloat(data.pairs[0].priceUsd);
          // console.log('SOL Price updated:', this.solPriceUsd);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch SOL price, defaulting to 150', e);
      if (this.solPriceUsd === 0) this.solPriceUsd = 150; // Fallback only if never set
    }
  }

  async getTokenData(mintAddress: string): Promise<TokenData | null> {
    if (!mintAddress || mintAddress.length < 10) return null;

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
      next: (msg: PumpPortalTrade) => this.tradeUpdates$.next(msg),
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
