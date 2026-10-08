import { useCallback, useEffect, useRef, useState } from 'react';

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

/** Landscape gate + fullscreen/orientation-lock attempt. Never fakes rotation. */
export function useMatchDisplay(active: boolean) {
  const [portrait, setPortrait] = useState(false);
  const [entered, setEntered] = useState(false);
  const [note, setNote] = useState('');
  const usedFs = useRef(false);

  useEffect(() => {
    const check = () => setPortrait(window.innerWidth < 900 && window.innerHeight > window.innerWidth);
    check();
    window.addEventListener('resize', check); window.addEventListener('orientationchange', check);
    return () => { window.removeEventListener('resize', check); window.removeEventListener('orientationchange', check); };
  }, []);

  useEffect(() => {
    const onFs = () => { if (usedFs.current && !document.fullscreenElement) { usedFs.current = false; setEntered(false); setNote('Fullscreen ended. Tap Enter Match to resume.'); } };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => { if (!active) setEntered(false); }, [active]);
  useEffect(() => () => {
    if (!usedFs.current) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    try { (screen.orientation as LockableOrientation | undefined)?.unlock?.(); } catch { /* unavailable */ }
  }, []);

  const enter = useCallback(async () => {
    setNote('');
    const notes: string[] = [];
    const el = document.documentElement;
    if (el.requestFullscreen) {
      try { await el.requestFullscreen(); usedFs.current = true; } catch { notes.push('Fullscreen was blocked by this browser.'); }
    } else notes.push('Fullscreen is not supported here (common on iPhone Safari); playing in the browser window.');
    const o = screen.orientation as LockableOrientation | undefined;
    if (o && typeof o.lock === 'function') {
      try { await o.lock('landscape'); } catch { notes.push('This browser would not lock orientation. Rotate your phone to landscape manually, left or right.'); }
    } else notes.push('Orientation lock is not available on this browser. Rotate your phone to landscape manually.');
    setNote(notes.join(' '));
    setEntered(true);
  }, []);

  const leave = useCallback(() => {
    usedFs.current = false; setEntered(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    try { (screen.orientation as LockableOrientation | undefined)?.unlock?.(); } catch { /* ignore */ }
  }, []);

  return { portrait, entered, note, enter, leave, playable: entered && !portrait };
}
