// Axis-aligned collision, shared by the player and every bot. Bodies are standing boxes
// (half-extent radius, full height); the world is a list of THREE.Box3 colliders the map
// built once. Movement resolves one axis at a time so a wall never swallows a body.
import * as THREE from 'three';

const probe = new THREE.Box3();

// Returns the first collider a standing box at (x, y, z) overlaps, or null. `lift` keeps the
// feet and crown out of the horizontal tests, so resting on the floor is not a wall hit.
export function overlapsBox(colliders, x, y, z, radius, height, lift) {
  probe.min.set(x - radius, y + lift, z - radius);
  probe.max.set(x + radius, y + height - lift, z + radius);
  for (const c of colliders) if (probe.intersectsBox(c)) return c;
  return null;
}

// Slides a body of (radius, height) along its velocity for dt seconds against the colliders,
// mutating body.position and zeroing the blocked axis of body.velocity. Sets body.onGround.
export function slideMove(colliders, body, radius, height, dt) {
  const p = body.position;
  const v = body.velocity;

  const nextX = p.x + v.x * dt;
  if (!overlapsBox(colliders, nextX, p.y, p.z, radius, height, 0.06)) p.x = nextX;
  else v.x = 0;

  const nextZ = p.z + v.z * dt;
  if (!overlapsBox(colliders, p.x, p.y, nextZ, radius, height, 0.06)) p.z = nextZ;
  else v.z = 0;

  p.y += v.y * dt;
  body.onGround = false;
  const hit = overlapsBox(colliders, p.x, p.y, p.z, radius, height, 0);
  if (hit && v.y <= 0) {
    p.y = hit.max.y;
    v.y = 0;
    body.onGround = true;
  } else if (hit) {
    p.y = hit.min.y - height;
    v.y = 0;
  }
  if (p.y < 0) { // the floor plane: colliders never cover it, so it is checked directly
    p.y = 0;
    v.y = 0;
    body.onGround = true;
  }
}

// Short segment visibility: is the straight line a→b inside the world (no collider face
// crossed)? Used by grenades and AI sound checks that only need a boolean, cheaply.
const segBox = new THREE.Box3();
export function segmentBlocked(colliders, a, b) {
  const steps = Math.ceil(a.distanceTo(b) / 0.4) + 1;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    segBox.min.set(x - 0.05, y - 0.05, z - 0.05);
    segBox.max.set(x + 0.05, y + 0.05, z + 0.05);
    for (const c of colliders) if (segBox.intersectsBox(c)) return true;
  }
  return false;
}
