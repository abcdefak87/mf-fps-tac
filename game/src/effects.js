// Visual effects, all pooled. Tracers, impact dust, wall decals, ejected shells and the
// grenade explosion each draw from a fixed set of meshes created at boot — nothing in the
// hot loop allocates, it only reuses and fades. Agents' muzzle flashes live here too.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_POOL = 28;
const PUFF_POOL = 24;
const DECAL_POOL = 36;
const SHELL_POOL = 18;
const FLASH_POOL = 10;
const TRACER_LIFE = 0.09;
const PUFF_LIFE = 0.4;
const DECAL_LIFE = 14;
const SHELL_LIFE = 1.1;

function dustTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(220,220,220,0.5)');
  g.addColorStop(1, 'rgba(200,200,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createEffects(scene) {
  const dust = dustTexture();
  const up = new THREE.Vector3(0, 1, 0);
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();

  // ---- tracers: a thin stretched unit cylinder per shot ----
  const tracerGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 5, 1, true);
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i++) {
    const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
      color: PALETTE.accent, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }

  // ---- dust puffs: camera-facing sprites that swell and fade ----
  const puffs = [];
  for (let i = 0; i < PUFF_POOL; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dust, color: PALETTE.muted, transparent: true, opacity: 0, depthWrite: false }));
    s.visible = false;
    scene.add(s);
    puffs.push({ s, life: 0, grow: 1 });
  }

  // ---- decals: dark impact circles parked just off the hit face ----
  const decalGeo = new THREE.PlaneGeometry(0.16, 0.16);
  const decals = [];
  for (let i = 0; i < DECAL_POOL; i++) {
    const mesh = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
      color: PALETTE.canvas, transparent: true, opacity: 0, depthWrite: false }));
    mesh.visible = false;
    scene.add(mesh);
    decals.push({ mesh, life: 0 });
  }
  let decalNext = 0;

  // ---- shells: little brass boxes the player's gun ejects ----
  const shellGeo = new THREE.BoxGeometry(0.02, 0.02, 0.05);
  const shellMat = new THREE.MeshBasicMaterial({ color: PALETTE.accent });
  const shells = [];
  for (let i = 0; i < SHELL_POOL; i++) {
    const mesh = new THREE.Mesh(shellGeo, shellMat);
    mesh.visible = false;
    scene.add(mesh);
    shells.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
  }

  // ---- muzzle flash quads for bots (the player's lives on the viewmodel) ----
  const flashGeo = new THREE.PlaneGeometry(0.42, 0.42);
  const flashes = [];
  for (let i = 0; i < FLASH_POOL; i++) {
    const mesh = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({
      color: PALETTE.accent, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    mesh.visible = false;
    scene.add(mesh);
    flashes.push({ mesh, life: 0 });
  }

  // ---- the explosion: one emissive sphere + a light + a ring of dust ----
  const blast = {
    sphere: new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0, fog: false })),
    light: new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 22, 1.6),
    life: 0,
    max: 0.55,
  };
  blast.sphere.visible = false;
  scene.add(blast.sphere, blast.light);

  const grenade = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.5 }));
  grenade.visible = false;
  grenade.castShadow = true;
  scene.add(grenade);

  let rng = 0.5;
  const rand = () => (rng = (rng * 9301 + 0.211) % 1);

  function firstDead(pool, key) {
    for (const p of pool) if (p.life <= 0) return p;
    return null;
  }

  return {
    grenadeMesh: grenade,

    tracer(from, to) {
      const t = firstDead(tracers);
      if (!t) return;
      tmpA.copy(from); tmpB.copy(to);
      const len = tmpA.distanceTo(tmpB);
      if (len < 0.1) return;
      t.mesh.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
      tmpC.copy(tmpB).sub(tmpA).normalize();
      tmpQ.setFromUnitVectors(up, tmpC);
      t.mesh.quaternion.copy(tmpQ);
      t.mesh.scale.set(1, len, 1);
      t.mesh.material.opacity = 0.85;
      t.mesh.visible = true;
      t.life = TRACER_LIFE;
    },

    impact(point, normal, onAgent) {
      const p = firstDead(puffs);
      if (p) {
        p.s.position.copy(point).addScaledVector(normal, 0.08);
        p.s.material.color.set(onAgent ? '#7e3b30' : PALETTE.muted);
        p.s.material.opacity = 0.85;
        p.s.scale.setScalar(0.3);
        p.s.visible = true;
        p.grow = onAgent ? 0.9 : 1.5;
        p.life = PUFF_LIFE;
      }
      if (!onAgent) {
        const d = decals[decalNext];
        decalNext = (decalNext + 1) % DECAL_POOL;
        d.mesh.position.copy(point).addScaledVector(normal, 0.012);
        d.mesh.lookAt(tmpA.copy(point).add(normal));
        d.mesh.material.opacity = 0.75;
        d.mesh.visible = true;
        d.life = DECAL_LIFE;
      }
    },

    flashAt(point) {
      const f = firstDead(flashes);
      if (!f) return;
      f.mesh.position.copy(point);
      f.mesh.rotation.set(rand() * 6.28, rand() * 6.28, rand() * 6.28);
      f.mesh.material.opacity = 0.95;
      f.mesh.scale.setScalar(0.7 + rand() * 0.6);
      f.mesh.visible = true;
      f.life = 0.05;
    },

    shellEject(from, right, forward) {
      const s = firstDead(shells);
      if (!s) return;
      s.mesh.position.copy(from);
      s.vel.copy(right).multiplyScalar(1.3 + rand()).addScaledVector(up, 1.6 + rand() * 0.7);
      s.spin.set(rand() * 12 - 6, rand() * 12 - 6, rand() * 12 - 6);
      s.mesh.visible = true;
      s.life = SHELL_LIFE;
    },

    explode(point) {
      blast.life = blast.max;
      blast.sphere.position.copy(point);
      blast.sphere.scale.setScalar(0.3);
      blast.sphere.material.opacity = 0.9;
      blast.sphere.visible = true;
      blast.light.position.copy(point).add(tmpC.set(0, 0.6, 0));
      blast.light.intensity = 90;
      for (let i = 0; i < 10; i++) {
        const p = puffs[(Math.abs(Math.sin(i * 97 + point.x)) * PUFF_POOL) | 0];
        const a = (i / 10) * Math.PI * 2;
        p.s.position.set(point.x + Math.cos(a) * 1.2, point.y + 0.4 + (i % 3) * 0.4, point.z + Math.sin(a) * 1.2);
        p.s.material.color.set(PALETTE.canvas);
        p.s.material.opacity = 0.9;
        p.s.scale.setScalar(0.8);
        p.grow = 4;
        p.life = PUFF_LIFE * 2.4;
        p.s.visible = true;
      }
    },

    update(dt, camera) {
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life / TRACER_LIFE) * 0.85;
        if (t.life <= 0) t.mesh.visible = false;
      }
      for (const p of puffs) {
        if (p.life <= 0) continue;
        p.life -= dt;
        p.s.scale.addScalar(p.grow * dt);
        p.s.material.opacity = Math.max(0, p.life / PUFF_LIFE) * 0.7;
        if (p.life <= 0) p.s.visible = false;
      }
      for (const d of decals) {
        if (d.life <= 0) continue;
        d.life -= dt;
        if (d.life < 2) d.mesh.material.opacity = Math.max(0, d.life / 2) * 0.75;
        if (d.life <= 0) d.mesh.visible = false;
      }
      for (const s of shells) {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.vel.y -= 9.8 * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        if (s.mesh.position.y < 0.02) { s.mesh.position.y = 0.02; s.vel.multiplyScalar(0.3); s.vel.y = Math.abs(s.vel.y) * 0.4; }
        s.mesh.rotation.x += s.spin.x * dt;
        s.mesh.rotation.y += s.spin.y * dt;
        s.mesh.rotation.z += s.spin.z * dt;
        if (s.life <= 0) s.mesh.visible = false;
      }
      for (const f of flashes) {
        if (f.life <= 0) continue;
        f.life -= dt;
        if (f.life <= 0) f.mesh.visible = false;
        else {
          f.mesh.material.opacity = f.life / 0.05;
          f.mesh.lookAt(camera.position);
        }
      }
      if (blast.life > 0) {
        blast.life -= dt;
        const t = 1 - blast.life / blast.max;
        blast.sphere.scale.setScalar(0.3 + t * 7);
        blast.sphere.material.opacity = Math.max(0, 0.9 - t * 1.6);
        blast.light.intensity = Math.max(0, 90 * (1 - t * 1.8));
        if (blast.life <= 0) blast.sphere.visible = false;
      }
    },
  };
}
