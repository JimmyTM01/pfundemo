import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { useMarketData } from '../hooks/useMarketData';
import {
  TrendingUp,
  Wallet,
  History,
  RefreshCw,
  Trash2,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const formatCurrency = (val: number) => '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMcap = (val: number) => {
  if (val >= 1000000) return '$' + (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return '$' + (val / 1000).toFixed(1) + 'K';
  return '$' + val.toFixed(0);
};

const Dashboard = () => {
  const store = useStore();
  const { getTokenData, getPumpTokenData, subscribeToMint } = useMarketData();
  const [mintInput, setMintInput] = useState('');
  const [buyAmount, setBuyAmount] = useState(2);
  const [autoBuy, setAutoBuy] = useState(false);

  const onBuy = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!mintInput || store.isLoading) return;

    store.setLoading(true);
    store.setError(null);

    const data = await getTokenData(mintInput);
    if (data) {
      store.buyToken(data, buyAmount);
      subscribeToMint(data.baseToken.address);
      setMintInput('');
    } else {
      store.setError('Token not found on Pump.fun or DexScreener.');
    }
    store.setLoading(false);
  };

  const onRefresh = async (pos: any) => {
    store.setRefreshing(pos.id, true);
    const data = await getPumpTokenData(pos.mint);
    if (data) {
      store.updatePosition(pos.mint, parseFloat(data.priceUsd), data.fdv || 0);
      subscribeToMint(pos.mint);
    }
    store.setRefreshing(pos.id, false);
  };

  const onSell = async (pos: any) => {
    store.setLoading(true);
    const data = await getPumpTokenData(pos.mint);
    store.sellPosition(pos.id, data);
    store.setLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6 md:space-y-8 pb-24">

      {/* Stats Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Total Equity"
          value={formatCurrency(store.totalPortfolioValue())}
          trend={store.totalPnL() >= 0 ? 'up' : 'down'}
        />
        <StatCard
          label="Cash"
          value={formatCurrency(store.cashBalance)}
          icon={<Wallet className="w-4 h-4 text-blue-400" />}
        />
        <StatCard
          label="Net P&L"
          value={(store.totalPnL() >= 0 ? '+' : '') + formatCurrency(store.totalPnL())}
          subValue={store.pnlPercent().toFixed(2) + '%'}
          trend={store.totalPnL() >= 0 ? 'up' : 'down'}
        />
        <button
          onClick={store.reset}
          className="card-glass hover:bg-red-900/20 p-3 md:p-4 rounded-xl flex flex-col items-center justify-center transition-all group border-red-500/20"
        >
          <span className="text-red-400 font-bold group-hover:scale-105 transition-transform text-sm md:text-base">RESET</span>
          <span className="text-[10px] text-red-500/50 mt-1 uppercase tracking-tighter">Wipe State</span>
        </button>
      </div>

      {/* Ape Interface */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-glass rounded-2xl p-4 md:p-6 border-t-4 border-t-purple-500"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg md:text-xl font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-500 fill-purple-500" />
            Ape Into Token
          </h2>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={autoBuy}
              onChange={e => setAutoBuy(e.target.checked)}
              className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-xs text-slate-400 group-hover:text-slate-300">Auto-Buy</span>
          </label>
        </div>

        <form onSubmit={onBuy} className="flex flex-col md:flex-row gap-3 md:gap-4 items-end">
          <div className="flex-grow w-full">
            <label className="block text-slate-500 text-[10px] uppercase font-bold mb-1.5 ml-1">Mint Address</label>
            <input
              type="text"
              value={mintInput}
              onChange={e => {
                setMintInput(e.target.value);
                if (autoBuy && e.target.value.length >= 32) onBuy();
              }}
              placeholder="Paste Solana Mint..."
              className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 font-mono text-sm transition-all"
            />
          </div>
          <div className="w-full md:w-32">
            <label className="block text-slate-500 text-[10px] uppercase font-bold mb-1.5 ml-1">Amount ($)</label>
            <input
              type="number"
              value={buyAmount}
              onChange={e => setBuyAmount(Number(e.target.value))}
              className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 font-mono text-sm font-bold text-center"
            />
          </div>
          <button
            type="submit"
            disabled={store.isLoading || !mintInput}
            className="w-full md:w-auto bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold py-3 px-8 rounded-xl transition-all shadow-lg shadow-purple-900/40 whitespace-nowrap"
          >
            {store.isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'BUY NOW'}
          </button>
        </form>
        {store.error && <p className="mt-3 text-red-400 text-xs flex items-center gap-1"><TrendingUp className="w-3 h-3 rotate-180" /> {store.error}</p>}
      </motion.div>

      {/* Bags Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg md:text-xl font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            Your Bags
            <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded-full border border-white/5">{store.positions.length}</span>
          </h2>
          <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-white/5">
             <div className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${store.isConnected || store.isPolling ? 'bg-green-400' : 'bg-red-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${store.isConnected || store.isPolling ? 'bg-green-500' : 'bg-red-500'}`}></span>
             </div>
             <span className={`text-[10px] font-bold tracking-widest ${store.isConnected || store.isPolling ? 'text-green-400' : 'text-red-400'}`}>
               {store.isConnected || store.isPolling ? 'LIVE FEED' : 'OFFLINE'}
             </span>
          </div>
        </div>

        <AnimatePresence mode="popLayout">
          {store.positions.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/20"
            >
              <p className="text-slate-500 text-sm">No active trades. Paste a mint above to start.</p>
            </motion.div>
          ) : (
            store.positions.map((pos) => (
              <BagItem
                key={pos.id}
                pos={pos}
                onRefresh={() => onRefresh(pos)}
                onSell={() => onSell(pos)}
              />
            ))
          )}
        </AnimatePresence>
      </div>

      {/* History */}
      {store.history.length > 0 && (
        <div className="mt-8 pt-8 border-t border-slate-800 space-y-4">
           <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
             <History className="w-3 h-3" /> Recent Activity
           </h3>
           <div className="space-y-2">
             {store.history.slice(0, 5).map(trade => (
               <div key={trade.id} className="flex justify-between items-center text-[10px] md:text-xs p-3 rounded-xl bg-slate-800/30 border border-white/5">
                 <div className="flex items-center gap-3">
                   <span className={`font-bold px-1.5 py-0.5 rounded ${trade.type === 'BUY' ? 'bg-blue-500/10 text-blue-400' : 'bg-orange-500/10 text-orange-400'}`}>{trade.type}</span>
                   <span className="text-slate-300 font-mono font-bold">{trade.symbol}</span>
                   <span className="text-slate-500 hidden md:inline">@ {formatMcap(trade.marketCap)} MC</span>
                 </div>
                 <div className="flex items-center gap-4">
                   <span className="text-slate-400">{formatCurrency(trade.amountUsd)}</span>
                   {trade.pnl !== undefined && (
                     <span className={`font-bold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                       {trade.pnl >= 0 ? '+' : ''}{formatCurrency(trade.pnl)}
                     </span>
                   )}
                 </div>
               </div>
             ))}
           </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, subValue, trend, icon }: any) => (
  <div className="card-glass p-3 md:p-4 rounded-xl flex flex-col items-start w-full relative overflow-hidden group">
    <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-1">{label}</span>
    <div className={`text-lg md:text-2xl font-bold font-mono truncate w-full ${trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-white'}`}>
      {value}
    </div>
    {subValue && <span className={`text-[10px] font-bold ${trend === 'up' ? 'text-green-500/60' : 'text-red-500/60'}`}>{subValue}</span>}
    <div className="absolute top-2 right-2 opacity-20 group-hover:opacity-100 transition-opacity">
      {icon}
    </div>
  </div>
);

const BagItem = ({ pos, onRefresh, onSell }: any) => {
  const pnl = (pos.currentPrice * pos.amountTokens) - pos.investedAmount;
  const pnlPercent = (pnl / pos.investedAmount) * 100;
  const isUpdated = pos.lastUpdate && (Date.now() - pos.lastUpdate < 400);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`card-glass rounded-2xl p-4 md:p-5 border border-white/5 transition-all relative overflow-hidden ${isUpdated ? 'ring-2 ring-purple-500/50 shadow-lg shadow-purple-500/10' : ''}`}
    >
      <div className="relative z-10 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <img src={pos.imageUrl} className="w-10 h-10 md:w-12 md:h-12 rounded-full border-2 border-slate-700 bg-slate-800 object-cover" alt="" />
            <div className="overflow-hidden">
              <div className="font-bold text-base md:text-lg leading-tight truncate">{pos.symbol}</div>
              <div className="flex items-center gap-1.5 text-slate-500">
                <span className="text-[10px] font-mono truncate max-w-[100px]">{pos.mint}</span>
                <a href={`https://pump.fun/${pos.mint}`} target="_blank" rel="noreferrer" className="hover:text-purple-400"><ExternalLink className="w-2.5 h-2.5" /></a>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onRefresh}
              disabled={pos.isRefreshing}
              className="bg-blue-500/10 hover:bg-blue-500 hover:text-white text-blue-400 border border-blue-500/20 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all disabled:opacity-30"
            >
              {pos.isRefreshing ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'REFRESH'}
            </button>
            <button
              onClick={onSell}
              className="bg-red-500/10 hover:bg-red-500 hover:text-white text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all"
            >
              SELL ALL
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 border-t border-white/5 pt-4">
          <GridItem label="Invested" value={formatCurrency(pos.investedAmount)} />
          <GridItem
            label="Current Value"
            value={formatCurrency(pos.amountTokens * pos.currentPrice)}
            highlight={pnl >= 0 ? 'text-green-400' : 'text-red-400'}
          />
          <GridItem
            label="Market Cap"
            value={formatMcap(pos.currentMcap)}
            highlight="text-slate-300"
          />
          <GridItem
            label="P&L"
            value={`${pnl >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`}
            highlight={pnl >= 0 ? 'text-green-400' : 'text-red-400'}
          />
          <div className="hidden lg:block">
            <GridItem label="Entry MC" value={formatMcap(pos.entryMcap)} />
          </div>
        </div>
      </div>

      {/* Background decoration */}
      <div className={`absolute inset-0 opacity-[0.03] pointer-events-none transition-colors duration-700 ${pnl >= 0 ? 'bg-green-500' : 'bg-red-500'}`} />
    </motion.div>
  );
};

const GridItem = ({ label, value, highlight }: any) => (
  <div>
    <div className="text-slate-500 text-[9px] uppercase font-bold tracking-wider mb-0.5">{label}</div>
    <div className={`font-mono text-xs md:text-sm font-bold ${highlight || 'text-slate-200'}`}>{value}</div>
  </div>
);

export default Dashboard;
