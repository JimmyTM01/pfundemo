import React from 'react';
import Dashboard from './components/Dashboard';

function App() {
  return (
    <div className="min-h-screen bg-[#020617] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black selection:bg-purple-500/30">
      <nav className="border-b border-white/5 bg-slate-950/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-tr from-purple-500 to-indigo-500 w-9 h-9 rounded-xl flex items-center justify-center font-black text-white shadow-xl shadow-purple-500/20 rotate-3">
                P
              </div>
              <h1 className="text-xl font-black tracking-tight text-white">
                PumpSimulator<span className="text-purple-500">.fun</span>
              </h1>
            </div>
            <div className="hidden md:flex items-center gap-4">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-slate-900/50 px-4 py-2 rounded-full border border-white/5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                Official API Connected
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="py-8">
        <Dashboard />
      </main>

      <footer className="text-center py-12 border-t border-white/5 mt-12 bg-slate-950/30">
        <p className="text-slate-600 text-xs font-medium uppercase tracking-[0.2em]">
          Interactive Demo &bull; No Real Money &bull; AI Powered
        </p>
      </footer>
    </div>
  );
}

export default App;
