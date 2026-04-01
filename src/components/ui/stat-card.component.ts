import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card-glass p-3 md:p-4 rounded-xl flex flex-col items-start w-full transition-all">
      <span class="text-slate-400 text-[10px] md:text-xs uppercase tracking-wider font-semibold mb-0.5 md:mb-1">{{ label }}</span>
      <div class="text-lg md:text-2xl font-bold font-mono truncate w-full" [class]="valueClass">
        {{ value }}
      </div>
      <span *ngIf="subValue" class="text-[10px] md:text-xs mt-0.5 md:mt-1" [class]="subValueClass">{{ subValue }}</span>
    </div>
  `
})
export class StatCardComponent {
  @Input({ required: true }) label!: string;
  @Input({ required: true }) value!: string;
  @Input() valueClass: string = 'text-white';
  @Input() subValue: string = '';
  @Input() subValueClass: string = 'text-slate-500';
}
