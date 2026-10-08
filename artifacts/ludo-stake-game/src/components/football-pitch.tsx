import { Component, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import type { FootballState } from '@workspace/api-client-react';
import { Scene } from './football-3d/scene';
import type { Sim } from './football-3d/scene';
import { WEBGL_MSG, hasWebGL2 } from './football-3d/clubs';
import { xs } from './football-3d/types';
import type { CameraMode, ControlBasis } from './football-3d/types';

export const PITCH_W = 68;
export const PITCH_H = 105;

class Boundary extends Component<{ children: ReactNode }, { err: string }> {
  state = { err: '' };
  static getDerivedStateFromError(e: Error) { return { err: e.message || 'Renderer error' }; }
  render() { return this.state.err ? <div className="fb-gl-error" data-testid="text-football-render-error"><b>The 3D pitch stopped rendering.</b><span>{this.state.err}</span><button className="quiet-btn" onClick={() => this.setState({ err: '' })}>Retry renderer</button></div> : this.props.children; }
}

export function FootballPitch({ state, team, onControlBasis }: { state: FootballState; team: 'home' | 'away' | null; onControlBasis?: (b: ControlBasis) => void }) {
  const [mode, setMode] = useState<CameraMode>('follow');
  const [gl2] = useState(hasWebGL2);
  const x = xs(state);
  const sim = useRef<Sim>({ state: x, offset: 0, team, mode, onControlBasis });
  sim.current.state = x; sim.current.team = team; sim.current.mode = mode;
  sim.current.onControlBasis = onControlBasis;
  useEffect(() => { const t = Date.parse(state.serverTimeAt); if (Number.isFinite(t)) sim.current.offset = t - Date.now(); }, [state]);

  return <div className="fb-pitch-wrap" data-testid="canvas-football-pitch">
    {gl2 ? <Boundary><Canvas className="fb-canvas" dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }} camera={{ fov: 58, near: 0.5, far: 500, position: [0, 12, -20] }} aria-label="Football pitch, 3D live view"><Scene sim={sim} /></Canvas></Boundary>
      : <div className="fb-gl-error" data-testid="text-football-webgl-error"><b>WebGL2 unavailable.</b><span>{WEBGL_MSG}</span></div>}
    <div className="fb-cam" role="group" aria-label="Camera mode">
      <button className={mode === 'follow' ? 'on' : ''} onClick={() => setMode('follow')} data-testid="button-camera-follow" aria-pressed={mode === 'follow'}>Follow</button>
      <button className={mode === 'tv' ? 'on' : ''} onClick={() => setMode('tv')} data-testid="button-camera-tv" aria-pressed={mode === 'tv'}>Side TV</button>
    </div>
  </div>;
}
