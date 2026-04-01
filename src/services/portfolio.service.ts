import { Injectable, signal, computed, inject, effect, untracked } from '@angular/core';
import { MarketDataService, TokenData } from './market-data.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export interface Position {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  imageUrl: string;
  entryPrice: number;
  currentPrice: number;
  amountTokens: number;
  investedAmount: number;
  entryMcap: number;
  currentMcap: number;
  timestamp: number;
}

export interface TradeHistory {
  id: string;
  type: 'BUY' | 'SELL';
  symbol: string;
  amountUsd: number;
  pnl?: number;
  marketCap: number;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class PortfolioService {
  private marketService = inject(MarketDataService);
  private readonly STORAGE_KEY = 'pump_sim_state_v1';

  // Core State
  readonly cashBalance = signal<number>(100);
  readonly positions = signal<Position[]>([]);
  readonly history = signal<TradeHistory[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly refreshingPositionId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    // 1. Load saved state immediately on startup
    this.loadState();

    // 2. Listen for real-time trade updates from PumpPortal
    this.marketService.tradeUpdates$
      .pipe(takeUntilDestroyed())
      .subscribe(trade => {
        this.updatePositionFromTrade(trade);
      });

    // 3. Auto-save state whenever signals change
    effect(() => {
      const state = {
        cashBalance: this.cashBalance(),
        positions: this.positions(),
        history: this.history()
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    });

    // 4. CONNECTION RECOVERY LOGIC (Crucial for live updates)
    // Whenever the socket connects (initially or after drop), re-subscribe to all held positions.
    effect(() => {
      if (this.marketService.isConnected()) {
        untracked(() => {
          const currentPositions = this.positions();
          if (currentPositions.length > 0) {
            console.log(`Connection restored. Re-subscribing ${currentPositions.length} positions.`);
            currentPositions.forEach(p => this.marketService.subscribeToMint(p.mint));
          }
        });
      }
    });
  }

  // Derived State
  readonly totalPortfolioValue = computed(() => {
    const holdingsValue = this.positions().reduce((acc, pos) => acc + (pos.currentPrice * pos.amountTokens), 0);
    return this.cashBalance() + holdingsValue;
  });

  readonly totalPnL = computed(() => {
    return this.totalPortfolioValue() - 100; // Assuming $100 start
  });

  readonly pnlPercent = computed(() => {
    return (this.totalPnL() / 100) * 100;
  });

  private loadState() {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        this.cashBalance.set(state.cashBalance);
        this.history.set(state.history || []);
        
        const savedPositions: Position[] = state.positions || [];
        this.positions.set(savedPositions);

        // Initial subscription is now handled by the effect above when connection opens
        console.log(`Restored ${savedPositions.length} positions from storage.`);
      } catch (e) {
        console.error('Failed to parse saved state', e);
      }
    }
  }

  private updatePositionFromTrade(trade: any) {
    const { priceUsd, mcapUsd } = this.marketService.convertSolMcapToUsd(trade.marketCapSol);
    
    // Only update if we have a valid price (SOL price might be missing initially)
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
    if (!Number.isFinite(mcapUsd) || mcapUsd <= 0) return;

    this.positions.update(currentPositions => {
      return currentPositions.map(pos => {
        if (pos.mint === trade.mint) {
          return {
            ...pos,
            currentPrice: priceUsd,
            currentMcap: mcapUsd
          };
        }
        return pos;
      });
    });
  }

  async buyToken(mintAddress: string, amountUsd: number) {
    if (amountUsd > this.cashBalance()) {
      this.error.set("Insufficient funds!");
      return;
    }

    // Sanitize Mint Address
    let cleanMint = mintAddress.trim();
    if (cleanMint.includes('/')) {
      const parts = cleanMint.split('/');
      cleanMint = parts.filter(p => p.length > 0).pop() || cleanMint;
    }
    if (cleanMint.includes('?')) {
      cleanMint = cleanMint.split('?')[0];
    }
    
    if (cleanMint.length < 30) {
      this.error.set("Invalid mint address detected.");
      return;
    }

    this.isLoading.set(true);
    this.error.set(null);

    try {
      // Get Initial Data from DexScreener (Metadata + Price)
      const data = await this.marketService.getTokenData(cleanMint);
      
      if (data) {
        const price = parseFloat(data.priceUsd);
        if (!Number.isFinite(price) || price <= 0) {
          this.error.set("Invalid token price received.");
          this.isLoading.set(false);
          return;
        }

        const mcap =
          typeof data.fdv === 'number' && Number.isFinite(data.fdv) && data.fdv > 0
            ? data.fdv
            : price * 1_000_000_000;
        const tokensReceived = amountUsd / price;

        const newPosition: Position = {
          id: crypto.randomUUID(),
          mint: data.baseToken.address,
          symbol: data.baseToken.symbol,
          name: data.baseToken.name,
          // Use seeded image generator if no image is returned, ensuring uniqueness per token
          imageUrl: data.info?.imageUrl || `https://picsum.photos/seed/${data.baseToken.address}/200`,
          entryPrice: price,
          currentPrice: price,
          amountTokens: tokensReceived,
          investedAmount: amountUsd,
          entryMcap: mcap,
          currentMcap: mcap,
          timestamp: Date.now()
        };

        this.cashBalance.update(b => b - amountUsd);
        this.positions.update(p => [newPosition, ...p]);
        this.history.update(h => [{
          id: crypto.randomUUID(),
          type: 'BUY',
          symbol: data.baseToken.symbol,
          amountUsd: amountUsd,
          marketCap: mcap,
          timestamp: Date.now()
        }, ...h]);

        // SUBSCRIBE TO WEBSOCKET FOR UPDATES
        this.marketService.subscribeToMint(data.baseToken.address);
        return;
      }

      // Fallback for fresh Pump.fun tokens that DexScreener hasn't indexed yet.
      const pump = await this.marketService.getPumpTraderToken(cleanMint);
      if (!pump) {
        this.error.set("Token not found yet (try again in a bit).");
        this.isLoading.set(false);
        return;
      }

      const quote = await this.marketService.getBestQuoteUsd(pump.mint);
      if (!quote) {
        this.error.set("Token price unavailable yet.");
        this.isLoading.set(false);
        return;
      }

      const tokensReceived = amountUsd / quote.priceUsd;
      const newPosition: Position = {
        id: crypto.randomUUID(),
        mint: pump.mint,
        symbol: pump.symbol || 'TOKEN',
        name: pump.name || pump.symbol || pump.mint,
        imageUrl: pump.image_uri || `https://picsum.photos/seed/${pump.mint}/200`,
        entryPrice: quote.priceUsd,
        currentPrice: quote.priceUsd,
        amountTokens: tokensReceived,
        investedAmount: amountUsd,
        entryMcap: quote.mcapUsd,
        currentMcap: quote.mcapUsd,
        timestamp: Date.now()
      };

      this.cashBalance.update(b => b - amountUsd);
      this.positions.update(p => [newPosition, ...p]);
      this.history.update(h => [{
        id: crypto.randomUUID(),
        type: 'BUY',
        symbol: newPosition.symbol,
        amountUsd: amountUsd,
        marketCap: quote.mcapUsd,
        timestamp: Date.now()
      }, ...h]);

      // SUBSCRIBE TO WEBSOCKET FOR UPDATES
      this.marketService.subscribeToMint(newPosition.mint);

    } catch (e) {
      this.error.set("Failed to execute buy.");
    } finally {
      this.isLoading.set(false);
    }
  }

  async sellPosition(positionId: string) {
    const pos = this.positions().find(p => p.id === positionId);
    if (!pos) return;

    this.isLoading.set(true);
    this.error.set(null);

    try {
      // Sell using the latest available valuation (DexScreener first, then PumpTrader).
      const latest = await this.marketService.getBestQuoteUsd(pos.mint);
      const executionPrice = latest?.priceUsd ?? pos.currentPrice;
      const executionMcap = latest?.mcapUsd ?? pos.currentMcap;

      const sellValue = pos.amountTokens * executionPrice;
      const pnl = sellValue - pos.investedAmount;

      this.cashBalance.update(b => b + sellValue);
      this.positions.update(p => p.filter(x => x.id !== positionId));
      
      this.history.update(h => [{
        id: crypto.randomUUID(),
        type: 'SELL',
        symbol: pos.symbol,
        amountUsd: sellValue,
        pnl: pnl,
        marketCap: executionMcap,
        timestamp: Date.now()
      }, ...h]);

      // UNSUBSCRIBE FROM WEBSOCKET
      this.marketService.unsubscribeFromMint(pos.mint);

    } catch (e) {
      this.error.set("Failed to execute sell.");
    } finally {
      this.isLoading.set(false);
    }
  }

  async refreshPosition(positionId: string) {
    if (this.isLoading()) return;
    if (this.refreshingPositionId()) return;

    const pos = this.positions().find(p => p.id === positionId);
    if (!pos) return;

    this.refreshingPositionId.set(positionId);
    this.error.set(null);

    try {
      const quote = await this.marketService.getBestQuoteUsd(pos.mint);
      if (!quote) {
        this.error.set('Token not indexed yet. Try again in a bit.');
        return;
      }

      const nextPrice = quote.priceUsd;
      const nextMcap = quote.mcapUsd;

      this.positions.update(currentPositions =>
        currentPositions.map(p =>
          p.id === positionId
            ? {
                ...p,
                currentPrice: nextPrice,
                currentMcap: Number.isFinite(nextMcap) && nextMcap > 0 ? nextMcap : p.currentMcap
              }
            : p
        )
      );
    } catch (e) {
      this.error.set('Failed to refresh token data.');
    } finally {
      this.refreshingPositionId.set(null);
    }
  }

  reset() {
    // Unsubscribe all
    this.positions().forEach(p => {
      this.marketService.unsubscribeFromMint(p.mint);
    });

    this.cashBalance.set(100);
    this.positions.set([]);
    this.history.set([]);
    this.error.set(null);
    localStorage.removeItem(this.STORAGE_KEY);
  }
}
