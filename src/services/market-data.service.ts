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
  private solPriceUsd = 200; // Better default
  
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

      // Convert pump.fun format to our TokenData format
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
        priceUsd: (parseFloat(data.usd_market_cap) / 1000000000).toString(),
        fdv: parseFloat(data.usd_market_cap),
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

    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`);
      
      if (!response.ok) return this.getPumpTokenData(mintAddress);

      const data = await response.json();
      
      if (!data.pairs || data.pairs.length === 0) {
        // Fallback to pump.fun if DexScreener has no data
        return this.getPumpTokenData(mintAddress);
      }

      const sortedPairs = data.pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      return sortedPairs[0] as TokenData;
    } catch (error) {
      console.warn('Error fetching token data:', error);
      return this.getPumpTokenData(mintAddress);
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

  // Helper to convert SOL market cap to USD price
  // Assumption: Standard Pump.fun token supply is 1 Billion
  convertSolMcapToUsd(mcapSol: number): { priceUsd: number, mcapUsd: number } {
    const safeMcapSol = mcapSol || 0;
    const mcapUsd = safeMcapSol * this.solPriceUsd;
    const priceUsd = mcapUsd / 1_000_000_000; 
    return { priceUsd, mcapUsd };
  }
}
