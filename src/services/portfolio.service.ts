import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { MarketDataService } from './market-data.service';

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
    this.loadState();

    effect(() => {
      const state = {
        cashBalance: this.cashBalance(),
        positions: this.positions(),
        history: this.history()
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
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
      const snapshot = await this.marketService.getTokenSnapshot(cleanMint);
      if (!snapshot) {
        this.error.set("Unable to fetch current token price. Try again.");
        return;
      }
      const tokensReceived = amountUsd / snapshot.quote.priceUsd;
      const newPosition: Position = {
        id: crypto.randomUUID(),
        mint: snapshot.mint,
        symbol: snapshot.symbol,
        name: snapshot.name,
        imageUrl: snapshot.imageUrl,
        entryPrice: snapshot.quote.priceUsd,
        currentPrice: snapshot.quote.priceUsd,
        amountTokens: tokensReceived,
        investedAmount: amountUsd,
        entryMcap: snapshot.quote.mcapUsd,
        currentMcap: snapshot.quote.mcapUsd,
        timestamp: Date.now()
      };

      this.cashBalance.update(b => b - amountUsd);
      this.positions.update(p => [newPosition, ...p]);
      this.history.update(h => [{
        id: crypto.randomUUID(),
        type: 'BUY',
        symbol: snapshot.symbol,
        amountUsd: amountUsd,
        marketCap: snapshot.quote.mcapUsd,
        timestamp: Date.now()
      }, ...h]);

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
      const latest = await this.marketService.getLatestQuoteUsd(pos.mint);
      if (!latest) {
        this.error.set("Unable to fetch current token price. Try again.");
        return;
      }
      const executionPrice = latest.priceUsd;
      const executionMcap = latest.mcapUsd;

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
      const quote = await this.marketService.getLatestQuoteUsd(pos.mint);
      if (!quote) {
        this.error.set('Unable to fetch current token price. Try again.');
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
    this.cashBalance.set(100);
    this.positions.set([]);
    this.history.set([]);
    this.error.set(null);
    localStorage.removeItem(this.STORAGE_KEY);
  }
}
