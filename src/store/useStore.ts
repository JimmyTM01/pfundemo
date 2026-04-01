import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  timestamp: number;
  lastUpdate?: number;
  isRefreshing?: boolean;
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

interface AppState {
  cashBalance: number;
  positions: Position[];
  history: TradeHistory[];
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  isPolling: boolean;

  // Derived
  totalPortfolioValue: () => number;
  totalPnL: () => number;
  pnlPercent: () => number;

  // Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setConnected: (status: boolean) => void;
  setPolling: (status: boolean) => void;

  buyToken: (data: any, amountUsd: number) => void;
  sellPosition: (id: string, latestData?: any) => void;
  updatePosition: (mint: string, price: number, mcap: number) => void;
  setRefreshing: (id: string, status: boolean) => void;
  reset: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      cashBalance: 100,
      positions: [],
      history: [],
      isLoading: false,
      error: null,
      isConnected: false,
      isPolling: false,

      totalPortfolioValue: () => {
        const state = get();
        const holdings = state.positions.reduce((acc, pos) => acc + (pos.currentPrice * pos.amountTokens), 0);
        return state.cashBalance + holdings;
      },

      totalPnL: () => get().totalPortfolioValue() - 100,
      pnlPercent: () => (get().totalPnL() / 100) * 100,

      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setConnected: (isConnected) => set({ isConnected }),
      setPolling: (isPolling) => set({ isPolling }),

      buyToken: (data, amountUsd) => set((state) => {
        const price = parseFloat(data.priceUsd);
        const mcap = data.fdv || 0;
        const tokensReceived = amountUsd / price;

        const newPosition: Position = {
          id: crypto.randomUUID(),
          mint: data.baseToken.address,
          symbol: data.baseToken.symbol,
          name: data.baseToken.name,
          imageUrl: data.info?.imageUrl || `https://picsum.photos/seed/${data.baseToken.address}/200`,
          entryPrice: price,
          currentPrice: price,
          amountTokens: tokensReceived,
          investedAmount: amountUsd,
          entryMcap: mcap,
          currentMcap: mcap,
          timestamp: Date.now()
        };

        return {
          cashBalance: state.cashBalance - amountUsd,
          positions: [newPosition, ...state.positions],
          history: [{
            id: crypto.randomUUID(),
            type: 'BUY',
            symbol: data.baseToken.symbol,
            amountUsd: amountUsd,
            marketCap: mcap,
            timestamp: Date.now()
          }, ...state.history]
        };
      }),

      sellPosition: (id, latestData) => set((state) => {
        const pos = state.positions.find(p => p.id === id);
        if (!pos) return state;

        const executionPrice = latestData ? parseFloat(latestData.priceUsd) : pos.currentPrice;
        const executionMcap = latestData ? latestData.fdv : pos.currentMcap;

        const sellValue = pos.amountTokens * executionPrice;
        const pnl = sellValue - pos.investedAmount;

        return {
          cashBalance: state.cashBalance + sellValue,
          positions: state.positions.filter(p => p.id !== id),
          history: [{
            id: crypto.randomUUID(),
            type: 'SELL',
            symbol: pos.symbol,
            amountUsd: sellValue,
            pnl: pnl,
            marketCap: executionMcap,
            timestamp: Date.now()
          }, ...state.history]
        };
      }),

      updatePosition: (mint, price, mcap) => set((state) => ({
        positions: state.positions.map(p => p.mint === mint ? {
          ...p,
          currentPrice: price,
          currentMcap: mcap,
          lastUpdate: Date.now()
        } : p)
      })),

      setRefreshing: (id, status) => set((state) => ({
        positions: state.positions.map(p => p.id === id ? { ...p, isRefreshing: status } : p)
      })),

      reset: () => set({
        cashBalance: 100,
        positions: [],
        history: [],
        error: null
      })
    }),
    {
      name: 'pump-sim-state-react-v1',
      partialize: (state) => ({
        cashBalance: state.cashBalance,
        positions: state.positions,
        history: state.history
      })
    }
  )
);
