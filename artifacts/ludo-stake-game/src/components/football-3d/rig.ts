import * as THREE from 'three';
import type { Kit } from './clubs';
import { shirtTexture } from './textures';
import type { AnimKind } from './types';

const G = {
  torso: new THREE.BoxGeometry(0.42, 0.55, 0.24), shorts: new THREE.BoxGeometry(0.44, 0.24, 0.27),
  head: new THREE.SphereGeometry(0.115, 12, 10), hair: new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
  neck: new THREE.CylinderGeometry(0.045, 0.05, 0.08, 6),
  thigh: new THREE.CylinderGeometry(0.085, 0.07, 0.45, 8), shin: new THREE.CylinderGeometry(0.065, 0.05, 0.42, 8),
  boot: new THREE.BoxGeometry(0.11, 0.07, 0.26), upperArm: new THREE.CylinderGeometry(0.05, 0.045, 0.3, 6), foreArm: new THREE.CylinderGeometry(0.042, 0.035, 0.28, 6),
  hand: new THREE.SphereGeometry(0.04, 6, 5), sleeve: new THREE.CylinderGeometry(0.058, 0.055, 0.14, 6),
  ring: new THREE.RingGeometry(0.75, 0.95, 28), shadow: new THREE.CircleGeometry(0.55, 16),
};
const skins = ['#8a5a3c', '#6b4129', '#a8714a', '#4d2e1e'].map(c => new THREE.MeshLambertMaterial({ color: c }));
const hairMat = new THREE.MeshLambertMaterial({ color: '#16110e' });
const bootMat = new THREE.MeshLambertMaterial({ color: '#17191c' });
const glove = new THREE.MeshLambertMaterial({ color: '#f1f1f1' });
const shadowMat = new THREE.MeshBasicMaterial({ color: '#06150d', transparent: true, opacity: 0.35, depthWrite: false });
const ringMat = new THREE.MeshBasicMaterial({ color: '#f5c94e', side: THREE.DoubleSide, transparent: true, opacity: 0.95 });

export interface Rig {
  root: THREE.Group; hips: THREE.Group; ring: THREE.Mesh;
  thL: THREE.Group; thR: THREE.Group; shL: THREE.Group; shR: THREE.Group; arL: THREE.Group; arR: THREE.Group; foL: THREE.Group; foR: THREE.Group;
  runPhase: number; x: number; z: number; face: number; init: boolean; lastX: number; lastZ: number; speed: number;
}
const grp = (p: THREE.Object3D, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; };
const mesh = (p: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); p.add(m); return m; };

export function createRig(kit: Kit, number: number, gk: boolean, seed: number): Rig {
  const root = new THREE.Group(); root.scale.setScalar(1.12);
  const prim = gk ? '#e8b923' : kit.a;
  const base = new THREE.MeshLambertMaterial({ map: shirtTexture(kit, null, gk) });
  const numTex = new THREE.MeshLambertMaterial({ map: shirtTexture(kit, number, gk) });
  const shirt = [base, base, base, base, numTex, numTex];
  const shortsM = new THREE.MeshLambertMaterial({ color: gk ? '#1b1b1b' : kit.shorts });
  const sock = new THREE.MeshLambertMaterial({ color: gk ? '#1b1b1b' : kit.socks });
  const sleeve = new THREE.MeshLambertMaterial({ color: prim });
  const skin = skins[seed % skins.length];
  const hips = grp(root, 0, 0.95, 0);
  mesh(hips, G.shorts, shortsM, 0, 0.02, 0); mesh(hips, G.torso, shirt, 0, 0.4, 0);
  mesh(hips, G.neck, skin, 0, 0.7, 0); mesh(hips, G.head, skin, 0, 0.82, 0); const h = mesh(hips, G.hair, hairMat, 0, 0.83, -0.005); h.rotation.x = -0.15;
  const leg = (s: number) => {
    const th = grp(hips, 0.11 * s, -0.04, 0); mesh(th, G.thigh, skin, 0, -0.22, 0);
    mesh(th, G.thigh, shortsM, 0, -0.1, 0).scale.set(1.12, 0.45, 1.12);
    const sh = grp(th, 0, -0.45, 0); mesh(sh, G.shin, sock, 0, -0.2, 0); mesh(sh, G.boot, bootMat, 0, -0.42, 0.06);
    return [th, sh] as const;
  };
  const [thL, shL] = leg(-1); const [thR, shR] = leg(1);
  const arm = (s: number) => {
    const ar = grp(hips, 0.27 * s, 0.62, 0); mesh(ar, G.sleeve, sleeve, 0, -0.04, 0); mesh(ar, G.upperArm, skin, 0, -0.17, 0).scale.set(1, 0.85, 1);
    const fo = grp(ar, 0, -0.3, 0); mesh(fo, G.foreArm, skin, 0, -0.14, 0); mesh(fo, G.hand, gk ? glove : skin, 0, -0.3, 0);
    return [ar, fo] as const;
  };
  const [arL, foL] = arm(-1); const [arR, foR] = arm(1);
  const shadow = mesh(root, G.shadow, shadowMat, 0, 0.03, 0); shadow.rotation.x = -Math.PI / 2;
  const ring = new THREE.Mesh(G.ring, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.visible = false; root.add(ring);
  return { root, hips, ring, thL, thR, shL, shR, arL, arR, foL, foR, runPhase: seed, x: 0, z: 0, face: 0, init: false, lastX: 0, lastZ: 0, speed: 0 };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function pose(r: Rig, kind: AnimKind, prog: number, t: number, speed: number) {
  const hp = r.hips;
  hp.position.y = 0.95; hp.rotation.set(0, 0, 0);
  r.thL.rotation.set(0, 0, 0); r.thR.rotation.set(0, 0, 0); r.shL.rotation.set(0, 0, 0); r.shR.rotation.set(0, 0, 0);
  r.arL.rotation.set(0, 0, 0.12); r.arR.rotation.set(0, 0, -0.12); r.foL.rotation.set(0, 0, 0); r.foR.rotation.set(0, 0, 0);
  if (kind === 'run') {
    const s = Math.sin(r.runPhase), c = Math.cos(r.runPhase), k = Math.min(1, 0.45 + speed / 8);
    r.thL.rotation.x = -s * 0.95 * k; r.thR.rotation.x = s * 0.95 * k;
    r.shL.rotation.x = Math.max(0, c * s > -2 ? Math.sin(r.runPhase + 1.2) : 0) * 1.1 * k + 0.1; r.shR.rotation.x = Math.max(0, Math.sin(r.runPhase + 1.2 + Math.PI)) * 1.1 * k + 0.1;
    r.arL.rotation.x = s * 0.9 * k; r.arR.rotation.x = -s * 0.9 * k; r.foL.rotation.x = -1.0; r.foR.rotation.x = -1.0;
    hp.rotation.x = 0.16 * k; hp.position.y = 0.95 + Math.abs(c) * 0.04;
  } else if (kind === 'kick') {
    const w = Math.min(1, prog / 0.4), f = Math.max(0, (prog - 0.4) / 0.6);
    const th = prog < 0.4 ? lerp(0, 0.9, w) : lerp(0.9, -1.5, Math.min(1, f * 1.6)); const sh = prog < 0.4 ? lerp(0.2, 1.3, w) : lerp(1.3, 0.05, Math.min(1, f * 1.6));
    r.thR.rotation.x = th; r.shR.rotation.x = sh; r.thL.rotation.x = -0.15; r.shL.rotation.x = 0.25;
    r.arL.rotation.x = -th * 0.5; r.arR.rotation.x = th * 0.4; r.arL.rotation.z = 0.7; r.arR.rotation.z = -0.7; hp.rotation.x = prog < 0.4 ? 0.05 : -0.12 * f + 0.05;
  } else if (kind === 'slide') {
    const d = Math.sin(Math.min(1, prog) * Math.PI);
    hp.position.y = lerp(0.95, 0.32, Math.min(1, d * 2.2)); hp.rotation.x = -lerp(0, 1.25, Math.min(1, d * 2.2));
    r.thR.rotation.x = -1.35 * Math.min(1, d * 2); r.shR.rotation.x = 0.05; r.thL.rotation.x = -0.4; r.shL.rotation.x = 1.9;
    r.arL.rotation.x = 0.9; r.arR.rotation.x = 0.7; r.arL.rotation.z = 0.8; r.arR.rotation.z = -0.8;
  } else if (kind === 'dive') {
    const a = Math.sin(Math.min(1, prog) * Math.PI);
    hp.position.y = 0.95 + a * 0.45 - Math.min(1, prog) * 0.2; hp.rotation.z = -1.3 * Math.min(1, a * 2.2);
    r.arL.rotation.set(-3.0 * Math.min(1, a * 2), 0, 0.1); r.arR.rotation.set(-3.0 * Math.min(1, a * 2), 0, -0.1);
    r.thL.rotation.set(0.2, 0, 0.25); r.thR.rotation.set(-0.15, 0, -0.2); r.shL.rotation.x = 0.5;
  } else {
    const b = Math.sin(t * 2 + r.runPhase) * 0.012; hp.position.y = 0.95 + b; r.arL.rotation.x = Math.sin(t * 1.6 + r.runPhase) * 0.05; r.arR.rotation.x = -r.arL.rotation.x;
    r.thL.rotation.x = -0.04; r.thR.rotation.x = 0.04;
  }
}
