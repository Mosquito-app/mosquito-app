import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetLobbyQueryKey, getGetRoomQueryKey, getGetWalletQueryKey } from '@workspace/api-client-react';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

export function useRealtime(enabled: boolean, roomId?: string): ConnectionState {
  const qc = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');
  const roomRef = useRef(roomId);
  roomRef.current = roomId;
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let closed = false; let attempt = 0; let timer: number | undefined;
    const refresh = (id?: string) => {
      if (id) void qc.invalidateQueries({ queryKey: getGetRoomQueryKey(id) });
      void qc.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
    };
    const connect = () => {
      setState(attempt === 0 ? 'connecting' : 'reconnecting');
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws`);
      socketRef.current = ws;
      ws.onmessage = event => {
        let msg: { type?: string; roomId?: string } = {};
        try { msg = JSON.parse(String(event.data)); } catch { return; }
        if (msg.type === 'connected') {
          attempt = 0; setState('live');
          if (roomRef.current) ws.send(JSON.stringify({ type: 'subscribe', roomId: roomRef.current }));
          refresh(roomRef.current);
        } else if (msg.type === 'room.updated') refresh(msg.roomId || roomRef.current);
      };
      ws.onclose = () => {
        if (closed) return;
        setState('reconnecting'); attempt += 1;
        timer = window.setTimeout(connect, Math.min(1000 * 2 ** attempt, 10000));
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { closed = true; window.clearTimeout(timer); socketRef.current?.close(); };
  }, [enabled, qc]);

  useEffect(() => {
    const ws = socketRef.current;
    if (roomId && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribe', roomId }));
  }, [roomId]);

  return state;
}
