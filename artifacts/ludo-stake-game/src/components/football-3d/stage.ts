import * as THREE from 'three';
import { crowdTexture, grassTile, netTexture, pitchTexture } from './textures';

export function buildStage() {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ map: grassTile() }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.04; g.add(ground);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(90, 125), new THREE.MeshLambertMaterial({ map: pitchTexture() }));
  pitch.rotation.x = -Math.PI / 2; g.add(pitch);

  // goals
  const white = new THREE.MeshLambertMaterial({ color: '#f4f1e6' });
  const netMat = new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false });
  for (const s of [-1, 1]) {
    const z0 = 52.5 * s, d = 2.2 * s;
    const post = (x: number) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.44, 8), white); m.position.set(x, 1.22, z0); g.add(m); };
    // Preserve the server's wide arcade goal mouth, including existing games.
    post(-9); post(9);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 18.14, 8), white); bar.rotation.z = Math.PI / 2; bar.position.set(0, 2.44, z0); g.add(bar);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.44), netMat); back.position.set(0, 1.22, z0 + d); g.add(back);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.2), netMat); top.rotation.x = Math.PI / 2; top.position.set(0, 2.44, z0 + d / 2); g.add(top);
    for (const x of [-9, 9]) { const side = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.44), netMat); side.rotation.y = Math.PI / 2; side.position.set(x, 1.22, z0 + d / 2); g.add(side); }
  }

  // stands + boards
  const crowd = new THREE.MeshLambertMaterial({ map: crowdTexture() });
  const conc = new THREE.MeshLambertMaterial({ color: '#2b3a37' });
  const board = new THREE.MeshLambertMaterial({ color: '#c95e42' });
  const stand = (cx: number, cz: number, w: number, d: number, alongX: boolean, dir: number) => {
    for (let i = 0; i < 4; i++) {
      const h = 2.2 + i * 2.4, off = 3 + i * 3.2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w : 3.2, h, alongX ? 3.2 : d), i % 2 ? crowd : conc);
      m.position.set(cx + (alongX ? 0 : dir * off), h / 2, cz + (alongX ? dir * off : 0)); g.add(m);
    }
    const b = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w : 0.3, 0.9, alongX ? 0.3 : d), board);
    b.position.set(cx + (alongX ? 0 : dir * 0.6), 0.45, cz + (alongX ? dir * 0.6 : 0)); g.add(b);
  };
  for (const s of [-1, 1]) { stand(s * 42, 0, 0, 140, false, s); stand(0, s * 62, 100, 0, true, s); }

  // floodlight towers (functional: each carries a spot light)
  const lamp = new THREE.MeshBasicMaterial({ color: '#fff3cf' });
  const pole = new THREE.MeshLambertMaterial({ color: '#46524f' });
  const lights: THREE.SpotLight[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 56, z = sz * 72;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 32, 6), pole); p.position.set(x, 16, z); g.add(p);
    const head = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 0.6), lamp); head.position.set(x, 33, z); head.lookAt(0, 0, 0); g.add(head);
    const sp = new THREE.SpotLight('#fff0d0', 1.1, 0, 0.9, 0.6, 0); sp.position.set(x, 33, z); sp.target.position.set(sx * -8, 0, sz * -10);
    g.add(sp, sp.target); lights.push(sp);
  }
  g.add(new THREE.HemisphereLight('#a9bfd8', '#26412f', 0.85));
  const sun = new THREE.DirectionalLight('#ffe2b8', 0.35); sun.position.set(-30, 50, 20); g.add(sun);
  return { group: g, lights };
}
