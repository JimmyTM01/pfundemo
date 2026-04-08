import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { interval } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, map } from 'rxjs/operators';
import { PortfolioService, Position } from '../../services/portfolio.service';
import { MarketDataService } from '../../services/market-data.service';
import { StatCardComponent } from '../ui/stat-card.component';
import { BagPositionRowComponent } from './bag-position-row.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, StatCardComponent, BagPositionRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-4xl mx-auto p-4 md:p-6 space-y-8 pb-24">
      
      <!-- Header Stats -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <app-stat-card 
          label="Total Equity" 
          [value]="'$' + portfolio.totalPortfolioValue().toFixed(2)"
          [valueClass]="portfolio.totalPnL() >= 0 ? 'text-green-400' : 'text-red-400'"
        ></app-stat-card>
        <app-stat-card 
          label="Cash Balance" 
          [value]="'$' + portfolio.cashBalance().toFixed(2)"
          valueClass="text-blue-300"
        ></app-stat-card>
        <app-stat-card 
          label="Net P&L" 
          [value]="(portfolio.totalPnL() >= 0 ? '+' : '') + '$' + portfolio.totalPnL().toFixed(2)"
          [valueClass]="portfolio.totalPnL() >= 0 ? 'text-green-400' : 'text-red-400'"
          [subValue]="portfolio.pnlPercent().toFixed(2) + '%'"
          [subValueClass]="portfolio.pnlPercent() >= 0 ? 'text-green-500/80' : 'text-red-500/80'"
        ></app-stat-card>
        <button (click)="portfolio.reset()" class="card-glass hover:bg-red-900/20 p-4 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer group border-red-500/20">
          <span class="text-red-400 font-bold group-hover:scale-105 transition-transform">RESET DEMO</span>
          <span class="text-xs text-red-500/50 mt-1">Wipe Everything</span>
        </button>
      </div>

      <!-- Trading Interface -->
      <div class="card-glass rounded-2xl p-6 border-t-4 border-t-purple-500">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold flex items-center gap-2">
            <span class="bg-purple-500 w-2 h-6 rounded-sm"></span>
            Ape Into New Token
          </h2>
          
          <!-- Auto Buy Toggle -->
          <div class="flex items-center gap-2" [formGroup]="buyForm">
            <label class="relative inline-flex items-center cursor-pointer group">
              <input type="checkbox" formControlName="autoBuy" class="sr-only peer">
              <div class="w-11 h-6 bg-slate-700/50 border border-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-slate-300 after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600 peer-checked:border-purple-500 peer-checked:after:bg-white"></div>
              <span class="ms-3 text-sm font-medium text-slate-400 group-hover:text-slate-300 transition-colors">Auto-Buy</span>
            </label>
          </div>
        </div>
        
        <form [formGroup]="buyForm" (ngSubmit)="onBuy()" class="flex flex-col md:flex-row gap-4 items-end">
          <div class="flex-grow w-full">
            <label class="block text-slate-400 text-sm mb-2">Token Mint Address</label>
            <input 
              type="text" 
              formControlName="mint"
              placeholder="e.g. 7EYnhQoR9YM3N..." 
              class="w-full bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 font-mono text-sm transition-colors"
            >
          </div>
          
          <div class="w-full md:w-32">
            <label class="block text-slate-400 text-sm mb-2">Amount ($)</label>
            <input 
              type="number" 
              formControlName="amount"
              step="0.01"
              inputmode="decimal"
              class="w-full bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 font-mono text-sm font-bold text-center"
            >
          </div>

          <button 
            type="submit" 
            [disabled]="buyForm.invalid || portfolio.isLoading() || portfolio.positions().length > 0"
            class="w-full md:w-auto bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-8 rounded-lg transition-all shadow-lg shadow-purple-900/20 whitespace-nowrap"
          >
            <ng-container *ngIf="portfolio.isLoading(); else buyNowLabel">Processing...</ng-container>
            <ng-template #buyNowLabel>BUY NOW</ng-template>
          </button>

          <button
            type="button"
            (click)="onPasteAndBuy()"
            [disabled]="portfolio.isLoading() || portfolio.positions().length > 0"
            class="w-full md:w-auto bg-slate-800/70 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-100 font-bold py-3 px-6 rounded-lg transition-all border border-slate-600 whitespace-nowrap"
          >
            PASTE + BUY
          </button>
        </form>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            *ngFor="let preset of amountPresets"
            (click)="setAmountPreset(preset)"
            class="text-xs font-mono px-3 py-1.5 rounded-full border transition-all"
            [ngClass]="getAmountPresetClasses(preset)"
          >
            {{ '$' + preset }}
          </button>
        </div>

        <div *ngIf="portfolio.positions().length > 0" class="mt-4 bg-slate-800/40 text-slate-300 px-4 py-3 rounded-lg border border-slate-700 text-sm">
          Single-token mode is on. Sell the current bag before opening a new trade.
        </div>

        <div *ngIf="portfolio.error()" class="mt-4 bg-red-900/30 text-red-400 px-4 py-3 rounded-lg border border-red-900/50 text-sm flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
          {{ portfolio.error() }}
        </div>
      </div>

      <!-- Portfolio Section -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-xl font-bold flex items-center gap-2">
            <span class="bg-blue-500 w-2 h-6 rounded-sm"></span>
            Active Bag
            <span class="bg-slate-700 text-slate-300 text-xs px-2 py-1 rounded-full">{{ portfolio.positions().length }}</span>
          </h2>

          <div class="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-white/5">
             <span
               class="inline-flex rounded-full h-2 w-2"
               [class.bg-green-400]="hasLiveBag()"
               [class.bg-amber-400]="!hasLiveBag()"
             ></span>
             <span
               class="text-xs font-mono font-bold"
               [class.text-green-300]="hasLiveBag()"
               [class.text-amber-300]="!hasLiveBag()"
             >
               {{ getFeedBadgeLabel() }}
             </span>
          </div>
        </div>

        <div *ngIf="portfolio.positions().length === 0" class="text-center py-12 border-2 border-dashed border-slate-700 rounded-xl bg-slate-800/20">
          <p class="text-slate-500 mb-2">No active trades.</p>
          <p class="text-slate-600 text-sm">Paste a mint address above to start losing (or winning) money.</p>
        </div>

        <app-bag-position-row
          *ngFor="let pos of portfolio.positions(); trackBy: trackByPositionId"
          [position]="pos"
          [isLoading]="portfolio.isLoading()"
          [isRefreshing]="portfolio.refreshingPositionId() === pos.id"
          [isSelling]="portfolio.sellingPositionId() === pos.id"
          [isFeedActive]="isFeedActive(pos)"
          [isHot]="isLivePosition(pos)"
          (refresh)="onRefreshPosition($event)"
          (sell)="onSellPosition($event)"
        ></app-bag-position-row>
      </div>

      <!-- Trade History -->
      <div *ngIf="portfolio.history().length > 0" class="mt-8 pt-8 border-t border-slate-800">
         <h3 class="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Recent Activity</h3>
         <div class="space-y-2">
           <div *ngFor="let trade of portfolio.history(); trackBy: trackByTradeId" class="flex justify-between items-center text-sm p-3 rounded-lg bg-slate-800/30">
             <div class="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
               <div class="flex items-center gap-2">
                 <span class="font-bold" [class]="trade.type === 'BUY' ? 'text-blue-400' : 'text-orange-400'">{{ trade.type }}</span>
                 <span class="text-slate-300 font-mono">{{ trade.symbol }}</span>
               </div>
               <!-- Show MC at time of trade -->
               <span class="text-xs text-slate-500 font-mono bg-black/20 px-1.5 py-0.5 rounded">
                 &#64; {{ formatMcap(trade.marketCap) }} MC
               </span>
             </div>
             
             <div class="flex items-center gap-4">
               <span class="text-slate-400">{{ formatCurrency(trade.amountUsd) }}</span>
               <span *ngIf="trade.type === 'SELL' && trade.pnl !== undefined" class="font-mono" [class]="trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'">
                 {{ trade.pnl >= 0 ? '+' : '' }}{{ formatCurrency(trade.pnl) }}
               </span>
               <span class="text-slate-600 text-xs hidden sm:inline">{{ formatDate(trade.timestamp) }}</span>
             </div>
           </div>
         </div>
      </div>
    </div>
  `
})
export class DashboardComponent {
  portfolio = inject(PortfolioService);
  market = inject(MarketDataService);
  fb = inject(FormBuilder);
  now = signal(Date.now());
  private lastAutoBuySignature: string | null = null;
  readonly amountPresets = [1, 2, 5, 10];
  
  buyForm = this.fb.nonNullable.group({
    mint: ['', [Validators.required, Validators.minLength(32)]],
    amount: [2, [Validators.required, Validators.min(0.01), Validators.max(1000)]],
    autoBuy: [false]
  });

  constructor() {
    interval(3000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.now.set(Date.now()));

    this.buyForm.controls.mint.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(value => {
        if (!this.normalizeMint(value)) {
          this.lastAutoBuySignature = null;
        }
      });

    // Auto-buy should use the latest amount value, not the initial default.
    this.buyForm.valueChanges
      .pipe(
        takeUntilDestroyed(),
        debounceTime(450),
        map(() => {
          const mint = this.normalizeMint(this.buyForm.controls.mint.getRawValue());
          const amount = Number(this.buyForm.controls.amount.getRawValue());
          const autoBuy = this.buyForm.controls.autoBuy.getRawValue();
          return { mint, amount, autoBuy };
        }),
        filter(
          ({ mint, amount, autoBuy }) =>
            autoBuy && mint.length >= 32 && Number.isFinite(amount) && amount >= 0.01
        ),
        distinctUntilChanged(
          (prev, curr) =>
            prev.mint === curr.mint &&
            prev.amount === curr.amount &&
            prev.autoBuy === curr.autoBuy
        )
      )
      .subscribe(({ mint, amount }) => {
        if (this.portfolio.isLoading() || this.portfolio.positions().length > 0) return;

        const signature = `${mint}:${amount}`;
        if (signature === this.lastAutoBuySignature) return;

        this.lastAutoBuySignature = signature;
        void this.onBuy(mint, amount);
      });
  }

  async onBuy(mintOverride?: string, amountOverride?: number) {
    const mint = this.normalizeMint(mintOverride ?? this.buyForm.controls.mint.getRawValue());
    const amount = Number(amountOverride ?? this.buyForm.controls.amount.getRawValue());

    if (!mint || !Number.isFinite(amount) || amount < 0.01) {
      this.buyForm.markAllAsTouched();
      return;
    }

    const didBuy = await this.portfolio.buyToken(mint, amount);
    if (!didBuy) {
      this.lastAutoBuySignature = null;
      return;
    }

    this.buyForm.controls.mint.setValue('');
  }

  async onPasteAndBuy() {
    if (this.portfolio.isLoading() || this.portfolio.positions().length > 0) return;

    try {
      const text = await navigator.clipboard.readText();
      const mint = this.normalizeMint(text);

      if (!mint) {
        this.portfolio.error.set('Clipboard is empty.');
        return;
      }

      this.buyForm.controls.mint.setValue(mint);
      await this.onBuy(mint);
    } catch {
      this.portfolio.error.set('Clipboard access failed. Paste the mint manually.');
    }
  }

  setAmountPreset(amount: number) {
    this.buyForm.controls.amount.setValue(amount);
  }

  onRefreshPosition(positionId: string) {
    void this.portfolio.refreshPosition(positionId);
  }

  onSellPosition(positionId: string) {
    void this.portfolio.sellPosition(positionId);
  }

  private normalizeMint(value: string | null | undefined): string {
    return (value ?? '').trim();
  }

  hasLiveBag(): boolean {
    const active = this.portfolio.positions()[0];
    return active ? this.market.isTrackingMint(active.mint) : false;
  }

  isFeedActive(pos: Position): boolean {
    return this.market.isTrackingMint(pos.mint);
  }

  isLivePosition(pos: Position): boolean {
    return this.market.isHotForMint(pos.mint);
  }

  getAmountPresetClasses(preset: number): string {
    return this.buyForm.controls.amount.getRawValue() === preset
      ? 'bg-purple-600 text-white border-purple-500'
      : 'bg-slate-800/60 text-slate-300 border-slate-600 hover:border-slate-500';
  }

  getFeedBadgeLabel(): string {
    const active = this.portfolio.positions()[0];
    if (!active || !this.isFeedActive(active)) return 'IDLE FEED';

    const expiresAt = this.market.sessionExpiresAt();
    if (!expiresAt) return 'LIVE FEED';

    const secondsLeft = Math.max(0, Math.ceil((expiresAt - this.now()) / 1000));
    return `LIVE FEED ${secondsLeft}s`;
  }

  formatCurrency(val: number): string {
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatMcap(val: number): string {
    if (val >= 1000000) return '$' + (val / 1000000).toFixed(1) + 'M';
    if (val >= 1000) return '$' + (val / 1000).toFixed(1) + 'K';
    return '$' + val.toFixed(0);
  }

  formatDate(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }

  trackByPositionId(_: number, pos: Position) {
    return pos.id;
  }

  trackByTradeId(_: number, trade: { id: string }) {
    return trade.id;
  }
}
