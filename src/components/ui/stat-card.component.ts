import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stat-card',
  standalone: true, // Optional in v19+ but good for clarity
  imports: [CommonModule],
  template: `
    <div class="card-glass p-4 rounded-xl flex flex-col items-start min-w-[140px]">
      <span class="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-1">{{ label() }}</span>
      <div class="text-2xl font-bold font-mono" [class]="valueClass()">
        {{ value() }}
      </div>
      @if (subValue()) {
        <span class="text-xs mt-1" [class]="subValueClass()">{{ subValue() }}</span>
      }
    </div>
  `
})
export class StatCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly valueClass = input<string>('text-white');
  readonly subValue = input<string>('');
  readonly subValueClass = input<string>('text-slate-500');
}