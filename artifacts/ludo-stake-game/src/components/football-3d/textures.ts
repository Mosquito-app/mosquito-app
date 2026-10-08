import * as THREE from 'three';
import type { Kit } from './clubs';

const cache = new Map<string, THREE.CanvasTexture>();
function make(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const hit = cache.get(key); if (hit) return hit;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  cache.set(key, t); return t;
}

export function shirtTexture(kit: Kit, number: number | null, gk = false) {
  const a = gk ? '#e8b923' : kit.a; const b = gk ? '#1b1b1b' : kit.b; const pat = gk ? 'hoops' : kit.pattern;
  return make(`shirt:${a}${b}${pat}:${number}:${kit.num}`, 128, 128, c => {
    c.fillStyle = a; c.fillRect(0, 0, 128, 128);
    c.fillStyle = b;
    if (pat === 'stripes') for (let i = 0; i < 8; i += 2) c.fillRect(i * 16, 0, 16, 128);
    if (pat === 'hoops') for (let i = 1; i < 8; i += 2) c.fillRect(0, i * 16, 128, 16);
    if (pat === 'halves') c.fillRect(64, 0, 64, 128);
    if (number !== null) { c.fillStyle = gk ? '#f6efe0' : kit.num; c.font = '800 70px Outfit, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(number), 64, 70); }
  });
}

export function pitchTexture() {
  const S = 10, W = 90, H = 125;
  return make('pitch', W * S, H * S, c => {
    for (let i = 0; i < 25; i++) { c.fillStyle = i % 2 ? '#2f7a4a' : '#368653'; c.fillRect(0, i * 5 * S, W * S, 5 * S); }
    for (let i = 0; i < 16000; i++) { c.fillStyle = Math.random() > .5 ? 'rgba(20,70,35,.18)' : 'rgba(120,190,100,.12)'; c.fillRect(Math.random() * W * S, Math.random() * H * S, 2, 4 + Math.random() * 5); }
    const ox = (W - 68) / 2 * S, oy = (H - 105) / 2 * S, m = (v: number) => v * S;
    c.strokeStyle = 'rgba(245,242,225,.92)'; c.lineWidth = 12; c.fillStyle = 'rgba(245,242,225,.92)';
    c.strokeRect(ox, oy, m(68), m(105));
    c.beginPath(); c.moveTo(ox, oy + m(52.5)); c.lineTo(ox + m(68), oy + m(52.5)); c.stroke();
    c.beginPath(); c.arc(ox + m(34), oy + m(52.5), m(9.15), 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(ox + m(34), oy + m(52.5), 6, 0, Math.PI * 2); c.fill();
    for (const top of [true, false]) {
      const y0 = top ? oy : oy + m(105); const sg = top ? 1 : -1;
      c.strokeRect(ox + m(13.84), top ? y0 : y0 - m(16.5), m(40.32), m(16.5));
      c.strokeRect(ox + m(24.84), top ? y0 : y0 - m(5.5), m(18.32), m(5.5));
      c.beginPath(); c.arc(ox + m(34), y0 + sg * m(11), 6, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(ox + m(34), y0 + sg * m(11), m(9.15), top ? 0.93 : Math.PI + 0.93, top ? Math.PI - 0.93 : 2 * Math.PI - 0.93); c.stroke();
    }
  });
}
export function grassTile() {
  return make('grass', 256, 256, c => {
    c.fillStyle = '#1f5a38'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) { c.fillStyle = Math.random() > .5 ? '#276a42' : '#17492d'; c.fillRect(Math.random() * 256, Math.random() * 256, 2, 5); }
  }, [40, 40]);
}
export function crowdTexture() {
  const cols = ['#c8553d', '#f0c24a', '#e9e2cf', '#3f7f9a', '#233a34', '#8e5a8a', '#d98e5b'];
  return make('crowd', 256, 64, c => {
    c.fillStyle = '#1b2a28'; c.fillRect(0, 0, 256, 64);
    for (let y = 2; y < 64; y += 6) for (let x = 2; x < 256; x += 5) { c.fillStyle = cols[(Math.random() * cols.length) | 0]; c.fillRect(x, y, 3, 4); }
  }, [14, 1]);
}
export function netTexture() {
  return make('net', 64, 64, c => { c.clearRect(0, 0, 64, 64); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 2; for (let i = 0; i <= 64; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 64); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(64, i); c.stroke(); } }, [6, 2]);
}
export function ballTexture() {
  return make('ball', 128, 64, c => {
    c.fillStyle = '#f7f3e8'; c.fillRect(0, 0, 128, 64); c.fillStyle = '#1d2b27';
    for (let i = 0; i < 12; i++) { c.beginPath(); c.arc((i % 6) * 22 + 10 + (i > 5 ? 11 : 0), i > 5 ? 44 : 18, 7, 0, Math.PI * 2); c.fill(); }
  });
}
