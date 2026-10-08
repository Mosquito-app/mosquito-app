import { useEffect, useRef } from 'react';
import type { FootballState } from '@workspace/api-client-react';

export const PITCH_W = 68;
export const PITCH_H = 105;

/** True when the viewer's team attacks toward +y (south); the view is rotated 180deg so you always attack upward. */
export function viewFlipped(state: FootballState, team: 'home' | 'away' | null) {
  const dir = team === 'away' ? -state.homeDirection : state.homeDirection;
  return dir === 1;
}

export function FootballPitch({ state, team }: { state: FootballState; team: 'home' | 'away' | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ state, team });
  stateRef.current = { state, team };

  useEffect(() => {
    const canvas = ref.current; const wrap = box.current;
    if (!canvas || !wrap) return;
    const draw = () => {
      const { state: s, team: t } = stateRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth; const h = w * PITCH_H / PITCH_W;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.height = `${h}px`; }
      const c = canvas.getContext('2d'); if (!c) return;
      const k = (w * dpr) / PITCH_W;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, canvas.width, canvas.height);
      const flip = viewFlipped(s, t);
      if (flip) c.setTransform(-k, 0, 0, -k, PITCH_W * k, PITCH_H * k); else c.setTransform(k, 0, 0, k, 0, 0);
      for (let i = 0; i < 10; i++) { c.fillStyle = i % 2 ? '#2f6b4f' : '#34755a'; c.fillRect(0, i * 10.5, PITCH_W, 10.5); }
      c.strokeStyle = '#f4efd8'; c.lineWidth = 0.35; c.globalAlpha = 0.85;
      c.strokeRect(1.5, 1.5, PITCH_W - 3, PITCH_H - 3);
      c.beginPath(); c.moveTo(1.5, PITCH_H / 2); c.lineTo(PITCH_W - 1.5, PITCH_H / 2); c.stroke();
      c.beginPath(); c.arc(PITCH_W / 2, PITCH_H / 2, 9.15, 0, Math.PI * 2); c.stroke();
      for (const top of [true, false]) {
        const y0 = top ? 1.5 : PITCH_H - 1.5; const sg = top ? 1 : -1;
        c.strokeRect((PITCH_W - 40.3) / 2, top ? y0 : y0 - 16.5, 40.3, 16.5);
        c.strokeRect((PITCH_W - 18.3) / 2, top ? y0 : y0 - 5.5, 18.3, 5.5);
        c.strokeRect((PITCH_W - 7.3) / 2, top ? y0 - 2 : y0, 7.3, 2);
        c.beginPath(); c.arc(PITCH_W / 2, y0 + sg * 11, 9.15, top ? 0.65 : Math.PI + 0.65, top ? Math.PI - 0.65 : 2 * Math.PI - 0.65); c.stroke();
      }
      c.globalAlpha = 1;
      const ctrl = t === 'home' ? s.controlledHome : t === 'away' ? s.controlledAway : '';
      const ball = s.ball;
      for (const p of s.players) {
        const home = p.team === 'home';
        c.beginPath(); c.arc(p.x, p.y + 0.3, 1.5, 0, Math.PI * 2); c.fillStyle = '#0a2018'; c.globalAlpha = 0.3; c.fill(); c.globalAlpha = 1;
        c.beginPath(); c.arc(p.x, p.y, 1.55, 0, Math.PI * 2);
        c.fillStyle = home ? '#e0643f' : '#f5c94e'; c.fill();
        c.lineWidth = p.role === 'GK' ? 0.5 : 0.25; c.strokeStyle = p.role === 'GK' ? '#18372f' : '#fff8e6'; c.stroke();
        if (p.id === ctrl) { c.beginPath(); c.arc(p.x, p.y, 2.5, 0, Math.PI * 2); c.strokeStyle = '#fff8e6'; c.lineWidth = 0.4; c.setLineDash([0.7, 0.5]); c.stroke(); c.setLineDash([]); }
        c.save(); c.translate(p.x, p.y); if (flip) c.rotate(Math.PI);
        c.fillStyle = home ? '#fff8e6' : '#18372f'; c.font = '700 1.7px Outfit, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(p.number), 0, 0.1); c.restore();
      }
      c.beginPath(); c.arc(ball.x, ball.y, 0.85, 0, Math.PI * 2); c.fillStyle = '#fffaf0'; c.fill(); c.lineWidth = 0.25; c.strokeStyle = '#18372f'; c.stroke();
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(wrap);
    const id = requestAnimationFrame(draw);
    return () => { ro.disconnect(); cancelAnimationFrame(id); };
  }, [state, team]);

  return <div ref={box} className="fb-pitch-wrap" data-testid="canvas-football-pitch"><canvas ref={ref} className="fb-canvas" role="img" aria-label="Football pitch, top-down live view" /></div>;
}
