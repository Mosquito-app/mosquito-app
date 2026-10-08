import { useCallback, useEffect, useRef, useState } from 'react';
import type { FootballRoom } from '@workspace/api-client-react';

export type FootballConn = 'connecting' | 'live' | 'reconnecting';
export type FootballAction = 'pass' | 'shoot' | 'tackle' | 'switch';

export function useFootballRealtime(enabled: boolean, roomId: string, onReconnect: () => void, onSnapshot?: (room: FootballRoom) => void) {
  const [conn, setConn] = useState<FootballConn>('connecting');
  const [snapshot, setSnapshot] = useState<FootballRoom | null>(null);
  const [error, setError] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const seq = useRef(0);
  const vec = useRef({ x: 0, y: 0 });
  const lastSent = useRef({ x: 0, y: 0 });
  const reconnectRef = useRef(onReconnect); reconnectRef.current = onReconnect;
  const snapRef = useRef(onSnapshot); snapRef.current = onSnapshot;

  const raw = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); return true; }
    return false;
  }, []);
  const sendInput = useCallback((moveX: number, moveY: number, action?: FootballAction) => {
    const ok = raw({ type: 'football.input', roomId, seq: ++seq.current, moveX, moveY, ...(action ? { action } : {}) });
    if (ok) lastSent.current = { x: moveX, y: moveY };
  }, [raw, roomId]);
  const setMove = useCallback((x: number, y: number) => {
    vec.current = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
    if (x === 0 && y === 0 && (lastSent.current.x !== 0 || lastSent.current.y !== 0)) sendInput(0, 0);
  }, [sendInput]);
  const sendAction = useCallback((a: FootballAction) => sendInput(vec.current.x, vec.current.y, a), [sendInput]);

  useEffect(() => {
    if (!enabled || !roomId) return;
    let closed = false; let timer = 0; let first = true;
    const connect = () => {
      setConn(first ? 'connecting' : 'reconnecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
      wsRef.current = ws; seq.current = 0; lastSent.current = { x: 0, y: 0 };
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'football.subscribe', roomId }));
        setConn('live'); setError('');
        if (!first) reconnectRef.current();
        first = false;
      };
      ws.onmessage = ev => {
        try {
          const m = JSON.parse(String(ev.data));
          if (m.type === 'football.snapshot' && m.room?.id === roomId) { setSnapshot(m.room); snapRef.current?.(m.room); }
          else if (m.type === 'football.error') setError(String(m.message || 'Match connection error'));
        } catch { /* ignore */ }
      };
      ws.onclose = () => { if (wsRef.current === ws) wsRef.current = null; if (!closed) { setConn('reconnecting'); timer = window.setTimeout(connect, 1500); } };
      ws.onerror = () => ws.close();
    };
    connect();
    const tick = window.setInterval(() => {
      const v = vec.current;
      if ((v.x !== 0 || v.y !== 0) || lastSent.current.x !== v.x || lastSent.current.y !== v.y) sendInput(v.x, v.y);
    }, 50);
    const release = () => { vec.current = { x: 0, y: 0 }; if (lastSent.current.x !== 0 || lastSent.current.y !== 0) sendInput(0, 0); };
    const vis = () => { if (document.hidden) release(); };
    window.addEventListener('blur', release); document.addEventListener('visibilitychange', vis);
    return () => {
      closed = true; window.clearTimeout(timer); window.clearInterval(tick);
      window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', vis);
      release(); wsRef.current?.close(); wsRef.current = null;
    };
  }, [enabled, roomId, sendInput]);

  return { conn, snapshot, error, setMove, sendAction };
}
