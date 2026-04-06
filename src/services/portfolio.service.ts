import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  lastQuoteAt: number;
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
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  // Core State
  readonly cashBalance = signal<number>(100);
  readonly positions = signal<Position[]>([]);
  readonly history = signal<TradeHistory[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly refreshingPositionId = signal<string | null>(null);
  readonly sellingPositionId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    this.loadState();

    this.marketService.tradeUpdates$
      .pipe(takeUntilDestroyed())
      .subscribe(update => {
        this.positions.update(currentPositions =>
          currentPositions.map(position =>
            position.mint === update.mint
              ? {
                  ...position,
                  currentPrice: update.priceUsd,
                  currentMcap: update.mcapUsd,
                  lastQuoteAt: update.observedAt
                }
              : position
          )
        );
      });

    effect(() => {
      const state = {
        cashBalance: this.cashBalance(),
        positions: this.positions(),
        history: this.history()
      };

      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
      }

      this.persistTimer = setTimeout(() => {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
      }, 150);
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
        
        const savedPositions: Position[] = (state.positions || []).map((position: Partial<Position>) => ({
          ...position,
          lastQuoteAt:
            typeof position.lastQuoteAt === 'number' && Number.isFinite(position.lastQuoteAt)
              ? position.lastQuoteAt
              : typeof position.timestamp === 'number'
                ? position.timestamp
                : Date.now()
        })) as Position[];
        const singlePosition = savedPositions.slice(0, 1);
        this.positions.set(singlePosition);

        if (singlePosition.length > 0) {
          this.marketService.startLiveSession(singlePosition[0].mint);
        }

        console.log(`Restored ${singlePosition.length} active position from storage.`);
      } catch (e) {
        console.error('Failed to parse saved state', e);
      }
    }
  }

  async buyToken(mintAddress: string, amountUsd: number): Promise<boolean> {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      this.error.set("Invalid buy amount.");
      return false;
    }

    if (this.positions().length > 0) {
      this.error.set("Only one active token is allowed. Sell the current bag first.");
      return false;
    }

    if (amountUsd > this.cashBalance()) {
      this.error.set("Insufficient funds!");
      return false;
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
      return false;
    }

    this.isLoading.set(true);
    this.error.set(null);

    try {
      const snapshot = await this.marketService.getTokenSnapshot(cleanMint, {
        useExecutionQuote: true
      });
      if (!snapshot) {
        this.error.set("Unable to fetch current token price. Try again.");
        return false;
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
        lastQuoteAt: snapshot.quote.observedAt,
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

      this.marketService.startLiveSession(snapshot.mint);

      return true;

    } catch (e) {
      this.error.set("Failed to execute buy.");
      return false;
    } finally {
      this.isLoading.set(false);
    }
  }

  async sellPosition(positionId: string): Promise<boolean> {
    const pos = this.positions().find(p => p.id === positionId);
    if (!pos) return false;

    this.sellingPositionId.set(positionId);
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const latest = await this.marketService.getExecutionQuoteUsd(
        pos.mint,
        {
          priceUsd: pos.currentPrice,
          mcapUsd: pos.currentMcap,
          observedAt: pos.lastQuoteAt
        }
      );
      if (!latest) {
        this.error.set("No live quote available right now. Click update or try again in a moment.");
        return false;
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

      this.marketService.stopLiveSession();

      return true;

    } catch (e) {
      this.error.set("Failed to execute sell.");
      return false;
    } finally {
      this.isLoading.set(false);
      this.sellingPositionId.set(null);
    }
  }

  async refreshPosition(positionId: string): Promise<boolean> {
    if (this.isLoading()) return false;
    if (this.refreshingPositionId()) return false;

    const pos = this.positions().find(p => p.id === positionId);
    if (!pos) return false;

    this.refreshingPositionId.set(positionId);
    this.error.set(null);

    try {
      const quote = await this.marketService.getExecutionQuoteUsd(
        pos.mint,
        {
          priceUsd: pos.currentPrice,
          mcapUsd: pos.currentMcap,
          observedAt: pos.lastQuoteAt
        },
        2000
      );
      if (!quote) {
        this.error.set('Unable to fetch current token price. Try again.');
        return false;
      }

      const nextPrice = quote.priceUsd;
      const nextMcap = quote.mcapUsd;

      this.positions.update(currentPositions =>
        currentPositions.map(p =>
          p.id === positionId
            ? {
                ...p,
                currentPrice: nextPrice,
                currentMcap: Number.isFinite(nextMcap) && nextMcap > 0 ? nextMcap : p.currentMcap,
                lastQuoteAt: quote.observedAt
              }
            : p
        )
      );
      return true;
    } catch (e) {
      this.error.set('Failed to refresh token data.');
      return false;
    } finally {
      this.refreshingPositionId.set(null);
    }
  }

  reset() {
    this.cashBalance.set(100);
    this.positions.set([]);
    this.history.set([]);
    this.error.set(null);
    this.marketService.stopLiveSession();
    localStorage.removeItem(this.STORAGE_KEY);
  }
}
