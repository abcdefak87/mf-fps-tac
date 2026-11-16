// Foundry Docks — the original map, built from boxes at dusk. Two sites (A west, B east) fed
// by a pair of outer mains and a centre mid cut by the Gate; a raised connector ("short")
// joins each site to top-mid, and the Warden lane runs behind both sites. Every solid box is
// a movement collider and a bullet surface; the nav grid is rasterised from these colliders
// and the minimap is drawn from the same floor plan, so the three never disagree.
import * as THREE from 'three';
import { PALETTE, SKY_TOP, SKY_HORIZON } from './palette.js';

// World bounds the playable rectangle sits inside.
export const BOUNDS = { minX: -31.5, maxX: 31.5, minZ: -23.5, maxZ: 23.5 };

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 14);

// ---------------------------------------------------------------- canvas art
// Small runtime-painted textures: the only "art assets", generated at boot, which keeps the
// game self-contained while lifting it out of greybox. Signs are unlit so they read at dusk.
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function letterSign(letter, glow) {
  const tex = canvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.font = '600 104px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(letter, 64, 70);
  });
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true });
}

function hazardMat() {
  const tex = canvasTexture(128, 32, (ctx) => {
    ctx.fillStyle = PALETTE.accent;
    ctx.fillRect(0, 0, 128, 32);
    ctx.fillStyle = PALETTE.canvas;
    for (let x = -32; x < 160; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 32); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 16, 32);
      ctx.fill();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
}

function muralMat() {
  const tex = canvasTexture(512, 96, (ctx) => {
    ctx.fillStyle = PALETTE.surface;
    ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = PALETTE.hairline;
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 84);
    ctx.font = '600 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText('FOUNDRY DOCK · BERTH 7', 256, 44);
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillStyle = PALETTE.accent;
    ctx.fillText('EMBER LINE TRANSIT AUTHORITY', 256, 76);
  });
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
}

function skyTexture() {
  const tex = canvasTexture(16, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.0, SKY_TOP);
    g.addColorStop(0.55, '#3a3850');
    g.addColorStop(0.78, SKY_HORIZON);
    g.addColorStop(1.0, '#191410');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

// ---------------------------------------------------------------- the world
export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mat = {
    floor: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas).multiplyScalar(3.1), roughness: 0.96 }),
    pad: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface).multiplyScalar(2.6), roughness: 0.92 }),
    mass: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface).multiplyScalar(2.1), roughness: 0.94 }),
    trim: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline).multiplyScalar(2.0), roughness: 0.9 }),
    crate: new THREE.MeshStandardMaterial({ color: PALETTE.muted, roughness: 0.88 }),
    crateDark: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline).multiplyScalar(1.25), roughness: 0.85 }),
    paint: new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.8 }),
    glow: new THREE.MeshBasicMaterial({ color: PALETTE.accent }),
    glowEmber: new THREE.MeshBasicMaterial({ color: PALETTE.ember }),
    glowWarden: new THREE.MeshBasicMaterial({ color: PALETTE.warden }),
    hazard: hazardMat(),
    mural: muralMat(),
  };

  const colliders = [];
  const shootables = [];
  const miniWalls = [];

  // box(): one scaled unit cube — shared geometry, no per-instance allocation. Flags choose
  // whether it blocks bodies (collider), stops bullets (shootable) and draws on the minimap.
  function box(w, h, d, x, y, z, material, opts = {}) {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (opts.collide !== false) colliders.push(new THREE.Box3().setFromObject(mesh));
    if (opts.shoot !== false) shootables.push(mesh);
    if (opts.mini !== false) miniWalls.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
    return mesh;
  }

  function cyl(r, h, x, y, z, material) {
    const mesh = new THREE.Mesh(unitCyl, material);
    mesh.scale.set(r, h, r);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // A conservative square collider: barrels are cover, exact cylinders are not needed.
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - r * 0.8, y - h / 2, z - r * 0.8),
      new THREE.Vector3(x + r * 0.8, y + h / 2, z + r * 0.8)));
    shootables.push(mesh);
    miniWalls.push([x - r * 0.8, z - r * 0.8, x + r * 0.8, z + r * 0.8]);
    return mesh;
  }

  // sign(): an unlit canvas plane floating just off a wall face.
  function sign(w, h, x, y, z, rotY, material) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    group.add(mesh);
    return mesh;
  }

  // ------------------------------------------------------------ the floor plan
  // One continuous slab (visual + bullet surface, never a collider — the ground plane is
  // handled in code) tinted per district so zones read at a glance on the minimap.
  box(64, 0.4, 48, 0, -0.2, 0, mat.floor, { collide: false, cast: false, mini: false });
  const pads = [
    // site pads get a lighter poured-concrete pad so the plant zones read from range
    [-28, -19, -16, -7, 'pad'], [16, -19, 28, -7, 'pad'],
    // mains get worn asphalt
    [-28, -6, -19, 19, 'trim'], [19, -6, 28, 19, 'trim'],
    // mid and the plaza/CT lane keep the base slab
  ];
  for (const [x0, z0, x1, z1, m] of pads) {
    box(x1 - x0, 0.04, z1 - z0, (x0 + x1) / 2, 0.021, (z0 + z1) / 2, mat[m], { collide: false, cast: false, mini: false });
  }
  const miniFloors = [
    [-28, -19, -16, -7], [16, -19, 28, -7],        // sites
    [-28, -19, 28, -16],                          // warden lane (z -19..-16 shared edge)
    [-5, -19, 5, 14],                             // mid
    [-16, -13, -5, -6], [5, -13, 16, -6],         // shorts
    [-28, -6, -19, 19], [19, -6, 28, 19],         // mains
    [-28, 14, 28, 23.5],                          // plaza
    [-28, -23.5, 28, -19],                        // warden lane proper
  ];

  // ------------------------------------------------------------ buildings & walls
  // The four masses that carve the lanes.
  box(13, 4.8, 20, -12.5, 2.4, 4, mat.mass);   // forge hall — between A main and mid
  box(13, 5.4, 20, 12.5, 2.7, 4, mat.mass);    // press hall — between mid and B main
  box(11, 6.2, 6, -10.5, 3.1, -16, mat.mass);  // A tower — behind A short
  box(11, 5.6, 6, 10.5, 2.8, -16, mat.mass);   // B tower — behind B short

  const W = 0.6, WH = 4.2; // wall thickness / height
  const wallBox = (w, h, d, x, y, z) => box(w, h, d, x, y, z, mat.trim);
  wallBox(W, 4.8, 48.8, -32.4, 2.4, 0);
  wallBox(W, 4.8, 48.8, 32.4, 2.4, 0);
  wallBox(64.8, 4.8, W, 0, 2.4, -24.4);
  wallBox(64.8, 4.8, W, 0, 2.4, 24.4);
  // inner side walls: close the void strips outside the mains and the sites' outer edge
  wallBox(0.7, WH, 48, -28.35, 2.1, 0);
  wallBox(0.7, WH, 48, 28.35, 2.1, 0);
  // A-main door into site A: two stubs leaving a 3.5 m gap
  wallBox(5, WH, 0.7, -25.5, 2.1, -7);
  wallBox(3.5, WH, 0.7, -17.75, 2.1, -7);
  // B-main door: mirrored
  wallBox(3.5, WH, 0.7, 17.75, 2.1, -7);
  wallBox(5, WH, 0.7, 25.5, 2.1, -7);
  // hut walls: site east edge, leaving a 3.5 m gap to each short
  wallBox(0.6, 3.4, 3.5, -16, 1.7, -11.25);
  wallBox(0.6, 3.4, 3.5, 16, 1.7, -11.25);
  // short mouths into mid: partial walls x = ±5 over z[-8,-6]
  wallBox(0.6, 3.4, 2, -5, 1.7, -7);
  wallBox(0.6, 3.4, 2, 5, 1.7, -7);
  // the Gate: mid's chokepoint at z = -6.3, a 2.8 m centre gap
  wallBox(3.6, 3.8, 0.7, -3.2, 1.9, -6.3);
  wallBox(3.6, 3.8, 0.7, 3.2, 1.9, -6.3);
  // site north walls to the warden lane, with a 3 m "heaven" gap each
  wallBox(6, WH, 0.7, -25, 2.1, -19.4);
  wallBox(3, WH, 0.7, -17.5, 2.1, -19.4);
  wallBox(3, WH, 0.7, 17.5, 2.1, -19.4);
  wallBox(6, WH, 0.7, 25, 2.1, -19.4);

  // ------------------------------------------------------------ cover & props
  const crate = (x, z, s = 1.3, h = 1.3, m = mat.crate) => box(s, h, s, x, h / 2, z, m);
  // site A — the default box, a low bench, a barrel triad
  crate(-24, -11.2, 1.9, 1.5, mat.crateDark); crate(-22.2, -10.6);
  box(2.2, 0.9, 1.1, -26, 0.45, -12.5, mat.crate);
  cyl(0.45, 1.1, -26.2, 0.55, -16.4, mat.trim); cyl(0.45, 1.1, -25.2, 0.55, -15.8, mat.trim); cyl(0.45, 1.1, -26.1, 0.55, -15.1, mat.trim);
  // site B — a taller stack, single drum
  crate(23, -11.2, 1.9, 1.9, mat.crateDark); crate(21.2, -10.8, 1.3, 1.0);
  box(2.2, 0.9, 1.1, 25.8, 0.45, -13, mat.crate);
  cyl(0.5, 1.3, 26.2, 0.65, -16, mat.trim);
  // A main — a mid-lane crate and the sandbag half-wall
  crate(-24, 1, 1.4); box(2.4, 1.0, 0.8, -21, 0.5, 7.5, mat.crateDark);
  crate(-26.4, 13, 1.5);
  // B main — staggered cover
  crate(24, 3, 1.4); box(2.4, 1.0, 0.8, 21, 0.5, 9.5, mat.crateDark);
  crate(26.4, 14, 1.5);
  // mid — the mid box and a lone drum by the gate
  crate(0, 2.5, 1.5, 1.4, mat.crateDark); cyl(0.45, 1.1, -3, 0.55, -2, mat.trim);
  crate(3.5, 9, 1.3);
  // shorts
  crate(-11, -10, 1.3); crate(11, -10, 1.3);
  // warden lane cover
  crate(-14, -21.4, 1.4); crate(14, -21.4, 1.4);
  // plaza — the flatbed and crate scatter
  box(5.4, 2.0, 2.4, 12, 1.0, 18.6, mat.crateDark);
  crate(-14, 17.5, 1.5); crate(-16.5, 18.4, 1.2, 1.0); crate(-5, 15.5, 1.2, 1.0);
  cyl(0.5, 1.2, 21, 0.6, 21.5, mat.trim); cyl(0.5, 1.2, 22.1, 0.6, 21, mat.trim);

  // ------------------------------------------------------------ signs & dressing
  const signA = letterSign('A', PALETTE.accent);
  const signB = letterSign('B', PALETTE.warden);
  sign(3.4, 3.4, -20.5, 3.0, -18.98, 0, signA);            // A sign on the heaven wall
  sign(3.4, 3.4, 20.5, 3.0, -18.98, 0, signB);             // B sign
  sign(9, 1.7, -12.5, 3.4, 14.06, 0, mat.mural);           // mural on the forge's south face
  sign(9, 1.7, 12.5, 3.2, 14.06, 0, mat.mural.clone());
  // hazard stripes at the mains' doors
  sign(5.2, 0.42, -24.6, 0.9, -6.6, 0, mat.hazard);
  sign(5.2, 0.42, 24.6, 0.9, -6.6, 0, mat.hazard);
  // emissive strip windows on the big halls — fake lit interiors, no extra lights
  const strips = [
    [-12.5, 3.6, -6.06, 8], [-12.5, 3.0, -6.06, 5], [12.5, 3.6, -6.06, 8],
    [-6.06, 3.4, 6, 6], [6.06, 3.4, 6, 6], [-19.06, 3.2, 8, 7], [19.06, 3.2, 8, 7],
  ];
  for (const [x, y, z, w] of strips) {
    const s = box(w, 0.12, 0.1, x, y, z, mat.glow, { collide: false, shoot: false, cast: false, mini: false });
    if (Math.abs(x) === 6.06 || Math.abs(x) === 19.06) s.rotation.y = Math.PI / 2;
  }

  // ------------------------------------------------------------ the plant zones
  // A glowing ring per site; match.js pulses them while a plant is possible, and the bomb
  // entity is the same amber once planted.
  const sites = [
    { name: 'A', x: -23, z: -14, r: 3.2 },
    { name: 'B', x: 23, z: -14, r: 3.2 },
  ];
  const ringGeo = new THREE.RingGeometry(1, 1.08, 48);
  for (const s of sites) {
    const ring = new THREE.Mesh(ringGeo, mat.glow);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(s.r);
    ring.position.set(s.x, 0.06, s.z);
    group.add(ring);
    s.ring = ring;
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 26, 16, 1.8);
    lamp.position.set(s.x, 3.4, s.z);
    group.add(lamp);
  }

  // ------------------------------------------------------------ spawns, posts, routes
  const emberSpawns = [
    { x: 0, z: 22, yaw: 0 },
    { x: -3.5, z: 21.5, yaw: 0 },
    { x: 3.5, z: 21.5, yaw: 0 },
    { x: -7, z: 20.5, yaw: 0 },
    { x: 7, z: 20.5, yaw: 0 },
  ];
  const wardenSpawns = [
    { x: -4, z: -21, yaw: Math.PI }, { x: -1.5, z: -21.5, yaw: Math.PI }, { x: 1.5, z: -21.5, yaw: Math.PI },
    { x: 4, z: -21, yaw: Math.PI }, { x: 7, z: -20.5, yaw: Math.PI },
  ];
  // Defensive posts: two per site watching the doors, one on the Gate. `face` is the yaw the
  // bot scans around while holding.
  const wardenPosts = [
    { x: -21, z: -16.5, face: Math.PI * 0.45, tag: 'A heaven' },
    { x: -26.3, z: -9.6, face: Math.PI * 0.62, tag: 'A bench' },
    { x: 21, z: -16.5, face: -Math.PI * 0.45, tag: 'B heaven' },
    { x: 26.3, z: -9.6, face: -Math.PI * 0.62, tag: 'B drums' },
    { x: 0.8, z: -8.6, face: 0, tag: 'gate' },
  ];
  // Ember attack lanes for the four bot teammates: each a waypoint chain the bot pushes down.
  const emberRoutes = [
    [{ x: -23.5, z: 16 }, { x: -23.5, z: 4 }, { x: -21.5, z: -4.5 }, { x: -23, z: -11 }],                 // A main
    [{ x: -21, z: 16 }, { x: -21, z: 6 }, { x: -20.8, z: -4.2 }, { x: -25, z: -9.5 }],                   // A main, wide angle
    [{ x: 0, z: 12 }, { x: 0, z: -2 }, { x: 0.6, z: -6.6 }, { x: -8, z: -9.5 }, { x: -19, z: -11 }],     // mid → A short
    [{ x: 23.5, z: 16 }, { x: 24, z: 4 }, { x: 21.5, z: -4.5 }, { x: 23, z: -11 }],                      // B main
  ];

  // ------------------------------------------------------------ light & air
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(95, 24, 14),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }));
  group.add(sky);
  scene.fog = new THREE.Fog(new THREE.Color('#3b3644'), 52, 155);
  scene.background = null; // the dome is the background

  const hemi = new THREE.HemisphereLight(new THREE.Color('#5b6f96'), new THREE.Color('#242028'), 1.9);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(new THREE.Color(PALETTE.muted), 0.65);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.accent), 2.8);
  sun.position.set(-30, 22, 24);
  sun.target.position.set(6, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -42; sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 36; sun.shadow.camera.bottom = -36;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0007;
  scene.add(sun, sun.target);
  const bounce = new THREE.DirectionalLight(new THREE.Color(PALETTE.warden), 0.35);
  bounce.position.set(30, 20, -18);
  scene.add(bounce);
  const midGlow = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 14, 1.9);
  midGlow.position.set(0, 3.4, -6.3);
  scene.add(midGlow);

  return {
    group, colliders, shootables, sites,
    emberSpawns, wardenSpawns, wardenPosts, emberRoutes,
    bounds: BOUNDS,
    mini: { floors: miniFloors, walls: miniWalls, sites },
  };
}
