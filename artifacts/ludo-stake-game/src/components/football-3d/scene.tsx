import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { clubById } from './clubs';
import { createRig, pose } from './rig';
import type { Rig } from './rig';
import { buildStage } from './stage';
import { ballTexture } from './textures';
import type { CameraMode, ControlBasis, XState } from './types';

export interface Sim { state: XState; offset: number; team: 'home' | 'away' | null; mode: CameraMode; onControlBasis?: (b: ControlBasis) => void }
const AX = 34, AZ = 52.5;
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function attackDir(s: XState, team: 'home' | 'away' | null) { return (team === 'away' ? -s.homeDirection : s.homeDirection) as number; }

export function Scene({ sim }: { sim: MutableRefObject<Sim> }) {
  const stage = useMemo(buildStage, []);
  const holder = useMemo(() => new THREE.Group(), []);
  const rigs = useRef(new Map<string, Rig>()); const clubKey = useRef('');
  const ball = useMemo(() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), new THREE.MeshLambertMaterial({ map: ballTexture() }));
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.4, 12), new THREE.MeshBasicMaterial({ color: '#06150d', transparent: true, opacity: 0.4, depthWrite: false })); sh.rotation.x = -Math.PI / 2;
    return { m, sh, x: 0, z: 0, y: 0.34, init: false };
  }, []);
  const cam = useRef({ look: new THREE.Vector3(), pos: new THREE.Vector3(), init: false });
  const clock = useRef(0);
  useEffect(() => () => { stage.group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); }); }, [stage]);

  useFrame((fs, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1); clock.current += dt;
    const { state: s, offset, team, mode } = sim.current; if (!s) return;
    const key = `${s.homeClub}|${s.awayClub}`;
    if (clubKey.current !== key) {
      clubKey.current = key; rigs.current.clear(); holder.clear();
      const hc = clubById(s.homeClub), ac = clubById(s.awayClub);
      const redClash = ['liverpool', 'man_utd'].includes(hc.id) && ['liverpool', 'man_utd'].includes(ac.id);
      s.players.forEach((p, i) => { const r = createRig(p.team === 'home' ? hc.home : (ac.id === hc.id || redClash ? ac.away : ac.home), p.number, p.role === 'GK', i); rigs.current.set(p.id, r); holder.add(r.root); });
    }
    const now = Date.now() + offset;
    const ctrlId = team === 'home' ? s.controlledHome : team === 'away' ? s.controlledAway : '';
    let cx = 0, cz = 0, have = false;
    const posedKinds = new Set<string>();
    for (const p of s.players) {
      const r = rigs.current.get(p.id); if (!r) continue;
      const tx = p.x - AX, tz = p.y - AZ;
      if (!r.init) { r.x = tx; r.z = tz; r.lastX = tx; r.lastZ = tz; r.face = p.facing ?? 0; r.init = true; }
      const k = damp(16, dt); r.x += (tx - r.x) * k; r.z += (tz - r.z) * k;
      const sp = Math.hypot(r.x - r.lastX, r.z - r.lastZ) / Math.max(dt, 1e-3); r.speed += (sp - r.speed) * damp(8, dt); r.lastX = r.x; r.lastZ = r.z;
      const face = p.facing ?? (sp > 0.5 ? Math.atan2(tx - r.x, tz - r.z) : r.face);
      r.face += angDiff(r.face, face) * damp(14, dt);
      let kind = p.animation ?? 'idle'; let prog = 0;
      const a0 = p.animationStartedAt ?? 0, a1 = p.animationUntil ?? 0;
      if (kind !== 'idle' && kind !== 'run') { if (a1 > a0 && now <= a1 + 120) prog = Math.min(1, Math.max(0, (now - a0) / (a1 - a0))); else kind = r.speed > 1 ? 'run' : 'idle'; }
      if (kind === 'idle' && r.speed > 1.2 && !p.animation) kind = 'run';
      if (kind === 'run') r.runPhase += dt * (6 + Math.min(r.speed, 9) * 0.8);
      r.root.position.set(r.x, p.z ?? 0, r.z); r.root.rotation.y = r.face;
      pose(r, kind, prog, clock.current, r.speed);
      posedKinds.add(kind);
      r.ring.visible = p.id === ctrlId;
      if (p.id === ctrlId) { cx = r.x; cz = r.z; have = true; }
    }
    const b = s.ball; const bx = b.x - AX, bz = b.y - AZ, by = 0.34 + Math.max(0, (b.z ?? 0.22) - 0.22);
    if (!ball.init) { ball.x = bx; ball.z = bz; ball.y = by; ball.init = true; }
    const kb = damp(22, dt); const ox = ball.x, oz = ball.z;
    ball.x += (bx - ball.x) * kb; ball.z += (bz - ball.z) * kb; ball.y += (by - ball.y) * kb;
    ball.m.position.set(ball.x, ball.y, ball.z); ball.sh.position.set(ball.x, 0.04, ball.z);
    const mx = ball.x - ox, mz = ball.z - oz, ml = Math.hypot(mx, mz);
    if (ml > 1e-4) ball.m.rotateOnWorldAxis(new THREE.Vector3(mz, 0, -mx).normalize(), ml / 0.34);

    if (!have) { cx = ball.x; cz = ball.z; }
    const fx = cx * 0.55 + ball.x * 0.45, fz = cz * 0.55 + ball.z * 0.45;
    const c = cam.current; const camera = fs.camera as THREE.PerspectiveCamera;
    const d = attackDir(s, team);
    const desiredPos = new THREE.Vector3(); const desiredLook = new THREE.Vector3();
    {
      // Close chase: behind the controlled player, biased toward the ball, looking down-pitch.
      const tx = cx * 0.7 + ball.x * 0.3, tz = cz * 0.7 + ball.z * 0.3;
      const far = Math.min(Math.hypot(cx - ball.x, cz - ball.z), 30);
      desiredPos.set(tx * 0.97, 3.6 + far * 0.1, tz - d * (7.5 + far * 0.2));
      desiredLook.set(tx, 1.0, tz + d * (9 + far * 0.15));
      if (camera.fov !== 62) { camera.fov = 62; camera.updateProjectionMatrix(); }
    }
    if (!c.init) { c.pos.copy(desiredPos); c.look.copy(desiredLook); c.init = true; }
    c.pos.lerp(desiredPos, damp(4, dt)); c.look.lerp(desiredLook, damp(5, dt));
    camera.position.copy(c.pos); camera.lookAt(c.look);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const len = Math.hypot(forward.x, forward.z) || 1;
    sim.current.onControlBasis?.({ forwardX: forward.x / len, forwardY: forward.z / len, rightX: -forward.z / len, rightY: forward.x / len });
    // Observable rendering diagnostics, not client-authoritative gameplay.
    fs.gl.domElement.dataset.playerCount = String(rigs.current.size);
    fs.gl.domElement.dataset.animationKinds = [...posedKinds].join(',');
    fs.gl.domElement.dataset.cameraMode = mode;
  });

  return <>
    <primitive object={stage.group} />
    <primitive object={holder} />
    <primitive object={ball.m} /><primitive object={ball.sh} />
  </>;
}
