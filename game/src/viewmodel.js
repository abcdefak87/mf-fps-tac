// The first-person weapon. Each catalogue gun gets its own box-built silhouette — stubby
// sidearm, fat SMG, railed rifle, long bolt gun — swapped in when the slot changes. One job:
// look like a held weapon. Sway and bob come from look/move, kick from recoil, the reload
// dips the model, the muzzle flash is a quad + a light, and the Longwatch scopes the camera.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const unitBox = new THREE.BoxGeometry(1, 1, 1);

function gunPart(group, material, w, h, d, x, y, z) {
  const m = new THREE.Mesh(unitBox, material);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

export function createViewmodel(camera) {
  const metal = new THREE.MeshStandardMaterial({ color: PALETTE.hairline, roughness: 0.55, metalness: 0.4, emissive: 0x11141a });
  const dark = new THREE.MeshStandardMaterial({ color: PALETTE.canvas, roughness: 0.7, metalness: 0.25, emissive: 0x0d0f14 });
  const glove = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember).multiplyScalar(0.55), roughness: 0.9, emissive: 0x1a120a });
  const bright = new THREE.MeshStandardMaterial({ color: PALETTE.muted, roughness: 0.5, metalness: 0.35, emissive: 0x11141a });
  const emberMark = new THREE.MeshBasicMaterial({ color: PALETTE.ember });
  const grenadeMat = new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.45, metalness: 0.3 });

  function buildP9() {
    const g = new THREE.Group();
    gunPart(g, metal, 0.07, 0.09, 0.3, 0, 0, -0.05);       // slide
    gunPart(g, dark, 0.065, 0.13, 0.09, 0, -0.1, 0.06);    // grip
    gunPart(g, glove, 0.075, 0.1, 0.1, 0, -0.13, 0.07);    // hand
    gunPart(g, bright, 0.02, 0.02, 0.05, 0, 0.045, -0.19); // sight
    return { group: g, muzzle: new THREE.Vector3(0, 0.01, -0.3) };
  }
  function buildWasp() {
    const g = new THREE.Group();
    gunPart(g, dark, 0.08, 0.11, 0.42, 0, 0, -0.08);        // body
    gunPart(g, metal, 0.05, 0.05, 0.3, 0, 0.02, -0.42);     // barrel shroud
    gunPart(g, dark, 0.06, 0.2, 0.09, 0, -0.14, -0.02);     // mag (raked)
    g.children[2].rotation.x = 0.22;
    gunPart(g, dark, 0.06, 0.12, 0.08, 0, -0.09, 0.14);     // grip
    gunPart(g, metal, 0.05, 0.05, 0.22, 0, -0.01, 0.24);    // wire stock
    gunPart(g, emberMark, 0.082, 0.02, 0.1, 0, 0.05, -0.1); // team stripe
    gunPart(g, glove, 0.08, 0.1, 0.1, 0, -0.1, 0.13);
    return { group: g, muzzle: new THREE.Vector3(0, 0.02, -0.6) };
  }
  function buildJackal() {
    const g = new THREE.Group();
    gunPart(g, metal, 0.08, 0.1, 0.5, 0, 0, -0.16);          // receiver + rail
    gunPart(g, dark, 0.045, 0.05, 0.4, 0, 0.015, -0.55);     // barrel
    gunPart(g, dark, 0.06, 0.16, 0.1, 0, -0.12, -0.06);      // mag
    gunPart(g, dark, 0.06, 0.11, 0.08, 0, -0.09, 0.12);      // grip
    gunPart(g, dark, 0.07, 0.08, 0.24, 0, -0.02, 0.32);      // stock
    gunPart(g, bright, 0.03, 0.03, 0.34, 0, 0.07, -0.3);     // top rail
    gunPart(g, emberMark, 0.082, 0.018, 0.08, 0, 0.045, -0.02);
    gunPart(g, glove, 0.08, 0.1, 0.1, 0, -0.1, 0.1);
    return { group: g, muzzle: new THREE.Vector3(0, 0.015, -0.78) };
  }
  function buildLongwatch() {
    const g = new THREE.Group();
    gunPart(g, dark, 0.07, 0.09, 0.62, 0, 0, -0.2);          // long receiver
    gunPart(g, metal, 0.04, 0.04, 0.55, 0, 0.02, -0.68);     // heavy barrel
    gunPart(g, metal, 0.06, 0.06, 0.2, 0, 0.09, -0.28);      // scope tube
    gunPart(g, dark, 0.07, 0.12, 0.3, 0, -0.08, 0.26);       // thumbhole stock
    gunPart(g, dark, 0.05, 0.1, 0.09, 0, -0.1, -0.04);       // mag
    gunPart(g, bright, 0.03, 0.03, 0.14, 0.05, 0.02, -0.1);  // bolt
    gunPart(g, glove, 0.08, 0.1, 0.1, 0, -0.1, 0.16);
    return { group: g, muzzle: new THREE.Vector3(0, 0.02, -0.98) };
  }
  function buildFrag() {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), grenadeMat);
    g.add(ball);
    gunPart(g, dark, 0.02, 0.05, 0.05, 0, 0.08, 0);          // spoon
    gunPart(g, glove, 0.09, 0.1, 0.11, 0, -0.08, 0.04);
    return { group: g, muzzle: new THREE.Vector3(0, 0, -0.1) };
  }

  const builds = { p9: buildP9, wasp: buildWasp, jackal: buildJackal, longwatch: buildLongwatch, frag: buildFrag };
  const models = {};
  for (const key of Object.keys(builds)) {
    models[key] = builds[key]();
    models[key].group.visible = false;
    camera.add(models[key].group);
  }

  // Muzzle flash: a quad + a real light pinned ahead of the barrel.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6, 1.8);
  camera.add(flashLight);

  const REST = new THREE.Vector3(0.26, -0.23, -0.46);
  const state = {
    current: null,
    kick: 0,          // recoil push-back, eases to zero
    flashT: 0,
    reloadDip: 0,     // 0..1 while reloading
    swayX: 0, swayY: 0,
    bobT: 0,
    drawT: 0,         // draw/equip animation
    fovT: 0,
  };

  function show(key) {
    if (state.current === key) return;
    if (state.current) models[state.current].group.visible = false;
    state.current = key;
    if (key) {
      models[key].group.visible = true;
      state.drawT = 0.16;
    }
  }

  return {
    state,
    show,
    muzzleWorld(out) {
      const m = state.current ? models[state.current] : null;
      if (m) out.copy(m.muzzle).applyQuaternion(m.group.quaternion).add(m.group.position);
      else out.copy(REST);
      return camera.localToWorld(out);
    },
    onFire() {
      state.kick = 1;
      state.flashT = 0.05;
    },
    onReload(duration) {
      state.reloadDip = Math.max(state.reloadDip, duration);
    },
    // dt in real seconds; look is this frame's mouse delta; speed is ground speed.
    update(dt, look, speed, scoped) {
      state.kick *= Math.max(0, 1 - dt * 11);
      state.flashT = Math.max(0, state.flashT - dt);
      state.reloadDip = Math.max(0, state.reloadDip - dt);
      state.drawT = Math.max(0, state.drawT - dt);
      state.swayX += (-look.x * 0.0011 - state.swayX) * Math.min(1, dt * 9);
      state.swayY += (look.y * 0.0011 - state.swayY) * Math.min(1, dt * 9);
      state.bobT += dt * (4 + speed * 1.4) * Math.min(1, speed / 4);
      const m = state.current ? models[state.current] : null;
      if (m) {
        const g = m.group;
        const dip = Math.min(1, state.reloadDip * 2.4);
        const draw = state.drawT > 0 ? state.drawT / 0.16 : 0;
        g.position.set(
          REST.x + state.swayX + Math.sin(state.bobT * 2) * 0.006 * Math.min(1, speed / 3),
          REST.y + state.swayY - dip * 0.22 - draw * 0.3 + Math.abs(Math.cos(state.bobT * 2)) * 0.008 * Math.min(1, speed / 3),
          REST.z + state.kick * 0.06);
        g.rotation.set(state.kick * 0.12 - dip * 0.7 + state.swayY * 1.6, state.swayX * 2.2, 0);
        flash.position.copy(m.muzzle).applyQuaternion(g.quaternion).add(g.position);
        flashLight.position.copy(flash.position).z += 0.1;
      }
      flash.visible = state.flashT > 0;
      if (flash.visible) {
        flash.material.opacity = state.flashT / 0.05;
        flash.rotation.z = state.flashT * 71;
        flash.scale.setScalar(0.8 + state.flashT * 6);
      }
      flashLight.intensity = state.flashT > 0 ? 22 : 0;
      const wantFov = scoped ? 74 / 3.4 : 74;
      state.fovT += (wantFov - state.fovT) * Math.min(1, dt * 14);
      if (Math.abs(camera.fov - state.fovT) > 0.05) {
        camera.fov = state.fovT;
        camera.updateProjectionMatrix();
      }
      return state.current;
    },
  };
}
