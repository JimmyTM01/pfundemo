import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { debounceTime, filter } from 'rxjs/operators';
import { PortfolioService, Position } from '../../services/portfolio.service';
import { MarketDataService } from '../../services/market-data.service';
import { StatCardComponent } from '../ui/stat-card.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, StatCardComponent],
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
              class="w-full bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 font-mono text-sm font-bold text-center"
            >
          </div>

          <button 
            type="submit" 
            [disabled]="buyForm.invalid || portfolio.isLoading()"
            class="w-full md:w-auto bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-8 rounded-lg transition-all shadow-lg shadow-purple-900/20 whitespace-nowrap"
          >
            <ng-container *ngIf="portfolio.isLoading(); else buyNowLabel">Processing...</ng-container>
            <ng-template #buyNowLabel>BUY NOW</ng-template>
          </button>
        </form>

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
            Your Bags
            <span class="bg-slate-700 text-slate-300 text-xs px-2 py-1 rounded-full">{{ portfolio.positions().length }}</span>
          </h2>

          <div class="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-white/5">
             <div class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" 
                      [class]="marketService.isConnected() ? 'bg-green-400' : 'bg-red-400'"></span>
                <span class="relative inline-flex rounded-full h-2 w-2"
                      [class]="marketService.isConnected() ? 'bg-green-500' : 'bg-red-500'"></span>
             </div>
             <span class="text-xs font-mono font-bold" [class]="marketService.isConnected() ? 'text-green-400' : 'text-red-400'">
               {{ marketService.isConnected() ? 'LIVE FEED' : 'CONNECTING...' }}
             </span>
          </div>
        </div>

        <div *ngIf="portfolio.positions().length === 0" class="text-center py-12 border-2 border-dashed border-slate-700 rounded-xl bg-slate-800/20">
          <p class="text-slate-500 mb-2">No active trades.</p>
          <p class="text-slate-600 text-sm">Paste a mint address above to start losing (or winning) money.</p>
        </div>

        <div *ngFor="let pos of portfolio.positions(); trackBy: trackByPositionId" class="card-glass rounded-xl p-4 md:p-6 transition-all hover:border-slate-500/50 group relative overflow-hidden">
            <!-- Background Gradient based on PnL -->
            <div class="absolute inset-0 opacity-10 pointer-events-none transition-colors duration-500"
                 [class.bg-green-500]="getPnl(pos) >= 0"
                 [class.bg-red-500]="getPnl(pos) < 0">
            </div>

            <div class="relative z-10 flex flex-col md:flex-row gap-4 md:items-center justify-between">
              <!-- Token Info -->
              <div class="flex items-center gap-4 min-w-[30%]">
                <img [src]="pos.imageUrl" class="w-12 h-12 rounded-full border-2 border-slate-600 bg-slate-800 object-cover" alt="Token">
                <div>
                  <div class="font-bold text-lg leading-none mb-1">{{ pos.symbol }}</div>
                  <div class="text-xs text-slate-400 font-mono truncate max-w-[150px]">{{ pos.mint }}</div>
                  <div class="text-xs text-slate-500 mt-1">{{ pos.name }}</div>
                </div>
              </div>

              <!-- Stats Grid -->
              <div class="grid grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-8 flex-grow">
                <div>
                  <div class="text-slate-500 text-xs">Invested</div>
                  <div class="font-mono text-sm">{{ formatCurrency(pos.investedAmount) }}</div>
                </div>
                <div>
                  <div class="text-slate-500 text-xs">Current Value</div>
                  <div class="font-mono text-sm font-bold" [class]="getPnl(pos) >= 0 ? 'text-green-400' : 'text-red-400'">
                    {{ formatCurrency(pos.amountTokens * pos.currentPrice) }}
                  </div>
                </div>
                
                <!-- Swapped Price for Market Cap as primary display -->
                <div>
                  <div class="text-slate-500 text-xs">Current MC</div>
                  <div class="font-mono text-sm text-slate-300" [class]="pos.currentMcap > pos.entryMcap ? 'text-green-400' : 'text-red-400'">{{ formatMcap(pos.currentMcap) }}</div>
                </div>
                
                <div>
                  <div class="text-slate-500 text-xs">P&L</div>
                  <div class="font-mono text-sm font-bold" [class]="getPnl(pos) >= 0 ? 'text-green-400' : 'text-red-400'">
                    {{ (getPnl(pos) >= 0 ? '+' : '') }}{{ getPnlPercent(pos).toFixed(2) }}%
                  </div>
                </div>

                 <!-- Entry MC - Made visible on all screens as requested -->
                <div>
                  <div class="text-slate-500 text-xs">Bought &#64; MC</div>
                  <div class="font-mono text-sm text-slate-300">{{ formatMcap(pos.entryMcap) }}</div>
                </div>
                
                <!-- Swapped Cur. MC for Price (Hidden on mobile) -->
                <div class="hidden md:block">
                   <div class="text-slate-500 text-xs">Price</div>
                   <div class="font-mono text-sm text-slate-500">{{ formatPrice(pos.currentPrice) }}</div>
                </div>
              </div>

              <!-- Action -->
              <div class="flex flex-col gap-2 items-end md:min-w-[120px]">
                 <button (click)="portfolio.refreshPosition(pos.id)"
                    [disabled]="portfolio.isLoading() || portfolio.refreshingPositionId() === pos.id"
                    class="w-full bg-slate-500/10 hover:bg-slate-500/20 text-slate-300 border border-slate-500/30 py-2 px-4 rounded-lg font-bold text-sm transition-all disabled:opacity-50">
                   {{ portfolio.refreshingPositionId() === pos.id ? 'UPDATING...' : 'UPDATE' }}
                 </button>
                 <button (click)="portfolio.sellPosition(pos.id)" 
                    [disabled]="portfolio.isLoading()"
                    class="w-full bg-red-500/10 hover:bg-red-500 hover:text-white text-red-400 border border-red-500/30 py-2 px-4 rounded-lg font-bold text-sm transition-all disabled:opacity-50">
                   <ng-container *ngIf="portfolio.isLoading(); else sellLabel">SELLING...</ng-container>
                   <ng-template #sellLabel>SELL ALL</ng-template>
                 </button>
          </div>
        </div>
      </div>
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
  marketService = inject(MarketDataService);
  fb = inject(FormBuilder);
  
  buyForm = this.fb.group({
    mint: ['', [Validators.required, Validators.minLength(32)]],
    amount: [2, [Validators.required, Validators.min(0.01), Validators.max(1000)]],
    autoBuy: [false]
  });

  constructor() {
    // Auto-buy logic
    this.buyForm.controls.mint.valueChanges.pipe(
      takeUntilDestroyed(),
      debounceTime(300), 
      filter(val => !!val && val.length >= 32 && (this.buyForm.get('autoBuy')?.value ?? false))
    ).subscribe(() => {
      if (this.buyForm.valid && !this.portfolio.isLoading()) {
        this.onBuy();
      }
    });
  }

  onBuy() {
    if (this.buyForm.valid) {
      const { mint, amount } = this.buyForm.value;
      this.portfolio.buyToken(mint!, amount!);
      this.buyForm.get('mint')?.reset(); 
    }
  }

  // Helpers
  getPnl(pos: Position): number {
    return (pos.currentPrice * pos.amountTokens) - pos.investedAmount;
  }

  getPnlPercent(pos: Position): number {
    const pnl = this.getPnl(pos);
    if (pos.investedAmount === 0) return 0;
    return (pnl / pos.investedAmount) * 100;
  }

  formatCurrency(val: number): string {
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatPrice(val: number): string {
    if (val < 0.01) return '$' + val.toExponential(2);
    return '$' + val.toFixed(4);
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
