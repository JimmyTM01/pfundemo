import { Component } from '@angular/core';
import { DashboardComponent } from './components/dashboard/dashboard.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DashboardComponent],
  template: `
    <div class="min-h-screen bg-slate-900 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-black">
      <nav class="border-b border-white/5 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-center justify-between h-16">
            <div class="flex items-center gap-3">
              <div class="bg-gradient-to-tr from-purple-500 to-blue-500 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-purple-500/20">
                P
              </div>
              <h1 class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                PumpSimulator<span class="text-purple-400">.fun</span>
              </h1>
            </div>
            <div class="flex items-center gap-4">
              <div class="hidden md:flex items-center gap-2 text-xs text-slate-500 bg-slate-800/50 px-3 py-1.5 rounded-full border border-white/5">
                <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                Solana Mainnet Data
              </div>
            </div>
          </div>
        </div>
      </nav>
      
      <main>
        <app-dashboard></app-dashboard>
      </main>

      <footer class="text-center py-6 text-slate-600 text-sm">
        <p>Built for demos. Not financial advice. You will lose fake money here.</p>
      </footer>
    </div>
  `
})
export class AppComponent {}
