import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { Position } from '../../services/portfolio.service';

@Component({
  selector: 'app-bag-position-row',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card-glass rounded-xl p-4 md:p-6 transition-all hover:border-slate-500/50 group relative overflow-hidden">
      <div
        class="absolute inset-0 opacity-10 pointer-events-none transition-colors duration-500"
        [class.bg-green-500]="getPnl() >= 0"
        [class.bg-red-500]="getPnl() < 0"
      ></div>

      <div class="relative z-10 flex flex-col md:flex-row gap-4 md:items-center justify-between">
        <div class="flex items-center gap-4 min-w-[30%]">
          <img
            [src]="position.imageUrl"
            class="w-12 h-12 rounded-full border-2 border-slate-600 bg-slate-800 object-cover"
            alt="Token"
          />
          <div>
            <div class="font-bold text-lg leading-none mb-1">{{ position.symbol }}</div>
            <div class="text-xs text-slate-400 font-mono truncate max-w-[150px]">{{ position.mint }}</div>
            <div class="flex items-center gap-2 mt-1">
              <span class="text-xs text-slate-500">{{ position.name }}</span>
              <span
                class="text-[10px] font-mono px-1.5 py-0.5 rounded border"
                [ngClass]="getPositionStatusClasses()"
              >
                {{ isFeedActive ? 'LIVE' : 'IDLE' }}
              </span>
              <span class="text-[10px] text-slate-500 font-mono">
                {{ getTickAgeLabel() }}
              </span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-8 flex-grow">
          <div>
            <div class="text-slate-500 text-xs">Invested</div>
            <div class="font-mono text-sm">{{ formatCurrency(position.investedAmount) }}</div>
          </div>
          <div>
            <div class="text-slate-500 text-xs">Current Value</div>
            <div
              class="font-mono text-sm font-bold"
              [class]="getPnl() >= 0 ? 'text-green-400' : 'text-red-400'"
            >
              {{ formatCurrency(position.amountTokens * position.currentPrice) }}
            </div>
          </div>

          <div>
            <div class="text-slate-500 text-xs">Current MC</div>
            <div
              class="font-mono text-sm text-slate-300"
              [class]="position.currentMcap > position.entryMcap ? 'text-green-400' : 'text-red-400'"
            >
              {{ formatMcap(position.currentMcap) }}
            </div>
          </div>

          <div>
            <div class="text-slate-500 text-xs">P&L</div>
            <div
              class="font-mono text-sm font-bold"
              [class]="getPnl() >= 0 ? 'text-green-400' : 'text-red-400'"
            >
              {{ (getPnl() >= 0 ? '+' : '') }}{{ getPnlPercent().toFixed(2) }}%
            </div>
          </div>

          <div>
            <div class="text-slate-500 text-xs">Bought &#64; MC</div>
            <div class="font-mono text-sm text-slate-300">{{ formatMcap(position.entryMcap) }}</div>
          </div>

          <div class="hidden md:block">
            <div class="text-slate-500 text-xs">Price</div>
            <div class="font-mono text-sm text-slate-500">{{ formatPrice(position.currentPrice) }}</div>
          </div>
        </div>

        <div class="flex flex-col gap-2 items-end md:min-w-[120px]">
          <button
            (click)="onRefresh()"
            [disabled]="isLoading || isRefreshing"
            class="w-full bg-slate-500/10 hover:bg-slate-500/20 text-slate-300 border border-slate-500/30 py-2 px-4 rounded-lg font-bold text-sm transition-all disabled:opacity-50"
          >
            {{ isRefreshing ? 'SYNCING...' : getUpdateLabel() }}
          </button>
          <button
            (click)="onSell()"
            [disabled]="isLoading"
            class="w-full bg-red-500/10 hover:bg-red-500 hover:text-white text-red-400 border border-red-500/30 py-2 px-4 rounded-lg font-bold text-sm transition-all disabled:opacity-50"
          >
            <ng-container *ngIf="isSelling; else sellLabel">WAITING PRICE...</ng-container>
            <ng-template #sellLabel>{{ getSellLabel() }}</ng-template>
          </button>
        </div>
      </div>
    </div>
  `
})
export class BagPositionRowComponent {
  @Input({ required: true }) position!: Position;
  @Input() isLoading = false;
  @Input() isRefreshing = false;
  @Input() isSelling = false;
  @Input() isFeedActive = false;
  @Input() isHot = false;

  @Output() refresh = new EventEmitter<string>();
  @Output() sell = new EventEmitter<string>();

  readonly now = signal(Date.now());

  constructor() {
    interval(3000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.now.set(Date.now()));
  }

  onRefresh() {
    this.refresh.emit(this.position.id);
  }

  onSell() {
    this.sell.emit(this.position.id);
  }

  getUpdateLabel(): string {
    return this.isHot ? 'SYNC NOW' : 'WAKE FEED';
  }

  getSellLabel(): string {
    return this.isHot ? 'SELL NOW' : 'WAKE + SELL';
  }

  getPositionStatusClasses(): string {
    return this.isFeedActive
      ? 'text-green-300 border-green-500/30 bg-green-500/10'
      : 'text-slate-400 border-slate-600 bg-slate-800/70';
  }

  getTickAgeLabel(): string {
    const deltaMs = Math.max(0, this.now() - this.position.lastQuoteAt);

    if (deltaMs < 3000) return 'tick now';
    if (deltaMs < 60_000) return `tick ${Math.round(deltaMs / 1000)}s ago`;

    const minutes = Math.floor(deltaMs / 60_000);
    return `tick ${minutes}m ago`;
  }

  getPnl(): number {
    return this.position.currentPrice * this.position.amountTokens - this.position.investedAmount;
  }

  getPnlPercent(): number {
    const pnl = this.getPnl();
    if (this.position.investedAmount === 0) return 0;
    return (pnl / this.position.investedAmount) * 100;
  }

  formatCurrency(val: number): string {
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatPrice(val: number): string {
    if (val < 0.01) return '$' + val.toExponential(2);
    return '$' + val.toFixed(4);
  }

  formatMcap(val: number): string {
    if (val >= 1_000_000) return '$' + (val / 1_000_000).toFixed(1) + 'M';
    if (val >= 1000) return '$' + (val / 1000).toFixed(1) + 'K';
    return '$' + val.toFixed(0);
  }
}
