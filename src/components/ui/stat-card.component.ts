import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card-glass p-4 rounded-xl flex flex-col items-start min-w-[140px]">
      <span class="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-1">{{ label }}</span>
      <div class="text-2xl font-bold font-mono" [class]="valueClass">
        {{ value }}
      </div>
      <span *ngIf="subValue" class="text-xs mt-1" [class]="subValueClass">{{ subValue }}</span>
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
