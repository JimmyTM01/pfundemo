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
  lastUpdate?: number; // For visual feedback
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
          console.log(`Connected. Subscribing to all pump.fun trades and ${currentPositions.length} specific tokens.`);

          // Double subscription strategy for maximum reliability
          this.marketService.subscribeAllTokenTrades();

          if (currentPositions.length > 0) {
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

        console.log(`Restored ${savedPositions.length} positions from storage.`);
      } catch (e) {
        console.error('Failed to parse saved state', e);
      }
    }
  }

  private updatePositionFromTrade(trade: any) {
    // Robust mint matching
    const mint = trade.mint;
    if (!mint) return;

    const hasPosition = this.positions().some(p => p.mint === mint);
    if (!hasPosition) return;

    // PumpPortal often provides marketCapSol, but sometimes it might be differently named in 'subscribeAll'
    const mcapSol = trade.marketCapSol || trade.vSolInBondingCurve; // Fallback to vSol if mcapSol missing
    if (!mcapSol) return;

    const { priceUsd, mcapUsd } = this.marketService.convertSolMcapToUsd(mcapSol);
    
    // Only update if we have a valid price
    if (priceUsd <= 0) return;

    this.positions.update(currentPositions => {
      return currentPositions.map(pos => {
        if (pos.mint === mint) {
          return {
            ...pos,
            currentPrice: priceUsd,
            currentMcap: mcapUsd,
            lastUpdate: Date.now()
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
      // Get Initial Data
      const data = await this.marketService.getTokenData(cleanMint);
      
      if (!data) {
        this.error.set("Token not found or no liquidity.");
        this.isLoading.set(false);
        return;
      }

      const price = parseFloat(data.priceUsd);
      const mcap = data.fdv || 0;
      const tokensReceived = amountUsd / price;
      
      const newPosition: Position = {
        id: crypto.randomUUID(),
        mint: data.baseToken.address,
        symbol: data.baseToken.symbol,
        name: data.baseToken.name,
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

      // Subscribe specifically to this token for better reliability
      this.marketService.subscribeToMint(data.baseToken.address);

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

    try {
      // Use current price from signal (which is updated via WS) for execution
      const executionPrice = pos.currentPrice;
      const executionMcap = pos.currentMcap;

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

      // No need to unsubscribe if we use 'subscribeAll' for others, but good for cleanliness
      this.marketService.unsubscribeFromMint(pos.mint);

    } catch (e) {
      this.error.set("Failed to execute sell.");
    } finally {
      this.isLoading.set(false);
    }
  }

  reset() {
    // Clean up all subscriptions
    this.positions().forEach(p => this.marketService.unsubscribeFromMint(p.mint));

    this.cashBalance.set(100);
    this.positions.set([]);
    this.history.set([]);
    this.error.set(null);
    localStorage.removeItem(this.STORAGE_KEY);
  }
}
