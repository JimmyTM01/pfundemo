import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

export const useMarketData = () => {
  const { updatePosition, setConnected, setPolling, positions } = useStore();
  const socketRef = useRef<WebSocket | null>(null);
  const solPriceRef = useRef<number>(200);

  const fetchSolPrice = async () => {
    try {
      const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
      const data = await res.json();
      if (data.pairs?.[0]?.priceUsd) {
        solPriceRef.current = parseFloat(data.pairs[0].priceUsd);
      }
    } catch (e) {
      console.warn('SOL price fetch error', e);
    }
  };

  const getPumpTokenData = async (mint: string) => {
    try {
      const res = await fetch(`https://frontend-api.pump.fun/coins/${mint}`);
      if (!res.ok) return null;
      const data = await res.json();
      const mcapUsd = parseFloat(data.usd_market_cap) || 0;
      return {
        chainId: 'solana',
        baseToken: { address: data.mint, name: data.name, symbol: data.symbol },
        priceUsd: (mcapUsd / 1_000_000_000).toString(),
        fdv: mcapUsd,
        info: { imageUrl: data.image_uri }
      };
    } catch (e) {
      return null;
    }
  };

  const getTokenData = async (mint: string) => {
    const pumpData = await getPumpTokenData(mint);
    if (pumpData) return pumpData;

    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      const data = await res.json();
      if (!data.pairs?.[0]) return null;
      const p = data.pairs[0];
      return {
        chainId: 'solana',
        baseToken: { address: p.baseToken.address, name: p.baseToken.name, symbol: p.baseToken.symbol },
        priceUsd: p.priceUsd,
        fdv: p.fdv,
        info: { imageUrl: p.info?.imageUrl }
      };
    } catch (e) {
      return null;
    }
  };

  const subscribeToMint = (mint: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
    }
  };

  useEffect(() => {
    fetchSolPrice();
    const solInterval = setInterval(fetchSolPrice, 60000);

    // High-frequency polling for bag positions as requested
    const bagInterval = setInterval(async () => {
      const currentPositions = useStore.getState().positions;
      if (currentPositions.length > 0) {
        setPolling(true);
        for (const pos of currentPositions) {
          const data = await getPumpTokenData(pos.mint);
          if (data) {
            updatePosition(pos.mint, parseFloat(data.priceUsd), data.fdv || 0);
          }
        }
      } else {
        setPolling(false);
      }
    }, 2000);

    const connectWS = () => {
      const ws = new WebSocket('wss://pumpportal.fun/api/data');
      socketRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ method: "subscribeAllTokenTrades" }));
        const currentPositions = useStore.getState().positions;
        currentPositions.forEach(p => subscribeToMint(p.mint));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.mint) {
          const mcapSol = data.marketCapSol || data.vSolInBondingCurve;
          if (mcapSol) {
            const mcapUsd = mcapSol * solPriceRef.current;
            const priceUsd = mcapUsd / 1_000_000_000;
            updatePosition(data.mint, priceUsd, mcapUsd);
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setTimeout(connectWS, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connectWS();

    return () => {
      clearInterval(solInterval);
      clearInterval(bagInterval);
      socketRef.current?.close();
    };
  }, []);

  return { getTokenData, getPumpTokenData, subscribeToMint };
};
