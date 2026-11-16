// Human movement: acceleration toward a wish direction, friction, gravity, crouch, jump and
// a quiet slow-walk — resolved as a standing box by collide.js. The body also carries health,
// armour and the live weapon loadout, so combat can treat the player like any combatant.
import * as THREE from 'three';
import { slideMove, overlapsBox } from './collide.js';

export const RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.14;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.0;
const SLOW_SPEED = 2.7;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 40;
const AIR_ACCEL = 8;
const FRICTION = 10;
const GRAVITY = 22;
const JUMP_SPEED = 6.4;

export function createPlayer(spawn) {
  const body = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_HEIGHT,
    onGround: true,
    crouching: false,
    slowWalking: false,
  };

  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0021) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.5, Math.min(1.5, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.5, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  // One fixed step. `speedMul` lets a heavy weapon slow the walk (the Longwatch is a lump).
  function step(dt, keys, colliders, speedMul = 1) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!crouching && body.crouching &&
               !overlapsBox(colliders, body.position.x, body.position.y, body.position.z, RADIUS, STAND_HEIGHT, 0.04)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    body.slowWalking = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 11);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = (body.crouching ? CROUCH_SPEED : body.slowWalking ? SLOW_SPEED : WALK_SPEED) * speedMul;
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / Math.max(1, speed));
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (keys.has('Space') && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;
    body.velocity.y = Math.max(-30, body.velocity.y);
    slideMove(colliders, body, RADIUS, body.height, dt);
  }

  return {
    body,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    moving() {
      return this.groundSpeed() > 0.6;
    },
    eyePos(out) {
      return out.set(body.position.x, body.position.y + body.eye, body.position.z);
    },
  };
}
