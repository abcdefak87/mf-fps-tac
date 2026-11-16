// Boot and the one loop. A fixed 60 Hz simulation — movement, AI, ballistics, the round
// machine — feeding a render at whatever the display does, so gameplay never depends on frame
// rate. main.js wires the modules through a small ctx (state flows through G alone) and owns
// the parts that are purely the player's: keys to weapons, clicks to shots, death to the
// spectate cam. `?shot=<name>` hands control to shots.js for the screenshot captures.
import * as THREE from 'three';
import { G, PHASE, TEAM_EMBER, TEAM_WARDEN, isCombatPhase } from './state.js';
import { createWorld } from './map.js';
import { createNav } from './nav.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createAgents, stepBots, updateAgentVisuals, canSee } from './agents.js';
import { createEffects } from './effects.js';
import { createViewmodel } from './viewmodel.js';
import { createCombat } from './combat.js';
import { createMatch } from './match.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { makeInstance, stepWeapon, spreadOf, readyToFire, startReload } from './weapons.js';
import { runShot } from './shots.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

// Deterministic when seeded (screenshot staging), lively otherwise.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = shot ? mulberry32(seed) : Math.random;

// ------------------------------------------------------------ renderer & scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.06, 220);
scene.add(camera);

// ------------------------------------------------------------ systems
const world = createWorld(scene);
const nav = createNav(world.bounds, world.colliders);
const effects = createEffects(scene);
const audio = createAudio();
const agents = createAgents(scene, world);
const player = createPlayer(world.emberSpawns[0]);
const viewmodel = createViewmodel(camera);

// the player agent shares the human body so combat and AI see one shape
const playerAgent = G.player;
playerAgent.body = player.body;
playerAgent.isPlayer = true;
playerAgent.primaryKey = null;
playerAgent.slotIndex = 1;               // start on the sidearm
playerAgent.grenades = 0;
playerAgent.lostKit = false;
playerAgent.sidearm = makeInstance('p9');
playerAgent.weapon = playerAgent.sidearm;

// invisible hitboxes so bot rays can find the player, tagged like bot meshes
const hitProxy = [];
{
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const ghost = new THREE.MeshBasicMaterial({ visible: false });
  const mk = (part, y, w, h) => {
    const m = new THREE.Mesh(unitBox, ghost);
    m.userData.part = part;
    m.userData.agent = playerAgent;
    m.userData.offsetY = y;
    m.scale.set(w, h, w);
    scene.add(m);
    hitProxy.push(m);
  };
  mk('head', 1.58, 0.26, 0.26);
  mk('body', 1.02, 0.52, 0.62);
  mk('legs', 0.38, 0.4, 0.78);
}
const sightSet = world.shootables.slice();
for (const a of agents) for (const m of a.fig.hitMeshes) sightSet.push(m);
for (const m of hitProxy) sightSet.push(m);

// ------------------------------------------------------------ wiring (ctx)
let simTime = 0;
let lastFrame = performance.now();
let accumulator = 0;
let frozen = false;
let spectateTarget = null;
let footT = 0;
const eyeV = new THREE.Vector3();
const dirV = new THREE.Vector3();
const camDir = new THREE.Vector3();
const flatDir = new THREE.Vector3();

const ctx = {
  world, nav, effects, audio, sightSet,
  colliders: world.colliders,
  time: () => simTime,
  rand,
  listenerPos: player.body.position,
  playerSpread: () => currentSpread(),
  viewmodelMuzzle: (out) => viewmodel.muzzleWorld(out),
  onKill(killer, victim, headshot) {
    match.awardKill(killer);
    if (victim.isPlayer) {
      spectateTarget = null;
      playerAgent.lostKit = true;
      hud.banner(`DOWN — ${killer ? killer.name : 'the blast'} got you`, 'watching your squad finish the round', 'lose', 3400);
      if (bombCarrierIs(playerAgent)) match.playerDied();
    } else if (killer && killer.isPlayer) {
      hud.hitMarker(true);
      audio.hitmarker(true);
    }
  },
  onPlayerHurt() { hud.damageFlash(); },
  onBlastShake(dmg) { player.recoil(0.03 + dmg * 0.001, (rand() - 0.5) * 0.04); },
  onPlanted(agent, site) {
    hud.banner(`SPIKE PLANTED — SITE ${site.name}`, agent.isPlayer ? '+$800 · hold until it burns' : `${agent.name} put it down — cover the site`, 'win', 2600);
  },
  onRoundEnd(winner, reason, award) {
    const won = winner === TEAM_EMBER;
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', `${reason} · ${won ? '+' : ''}$${award}`, won ? 'win' : 'lose', 3600);
    hud.setScoreboard(false);
  },
  onMatchEnd(winner) {
    hud.showOverlay('matchEnd', { won: winner === TEAM_EMBER });
    input.exitLock();
  },
  onLive() { hud.setBuyVisible(false); hud.bannerOff(); },
  onPlayerRespawn() {
    // died last round: the bought primary and grenades are lost, back to the sidearm
    if (playerAgent.lostKit) {
      playerAgent.primaryKey = null;
      playerAgent.primary = null;
      playerAgent.grenades = 0;
      playerAgent.slotIndex = 1;
      playerAgent.weapon = playerAgent.sidearm;
      playerAgent.armor = 0;
    }
    playerAgent.alive = true;
    playerAgent.sidearm.mag = playerAgent.sidearm.def.mag;
    playerAgent.sidearm.reserve = playerAgent.sidearm.def.reserve;
    if (playerAgent.primary) {
      playerAgent.primary.mag = playerAgent.primary.def.mag;
      playerAgent.primary.reserve = playerAgent.primary.def.reserve;
    }
    playerAgent.health = 100;
    playerAgent.lostKit = false;
    hud.setBuyVisible(true);
    viewmodel.show(currentWeaponKey());
  },
  equipPrimary(key) {
    playerAgent.primary = makeInstance(key);
    playerAgent.primaryKey = key;
    playerAgent.slotIndex = 0;
    playerAgent.weapon = playerAgent.primary;
    viewmodel.show(currentWeaponKey());
  },
};

const combat = createCombat(ctx);
ctx.combat = combat;
const match = createMatch(ctx);
combat.bindMatch(match.api);

const input = createInput(renderer.domElement, onLockChange);
const hud = createHud(world, {
  enemyVisible(agent) {
    if (!agent.alive) return false;
    if (!playerAgent.alive) return false;
    return canSee(playerAgent, agent, ctx);
  },
  equipPrimary: ctx.equipPrimary,
});
ctx.hud = hud;

function bombCarrierIs(agent) {
  return G.bomb && G.bomb.state === 'carried' && G.bomb.carrier === agent;
}

function currentWeaponKey() {
  if (playerAgent.slotIndex === 0 && playerAgent.primary) return playerAgent.primary.def.key;
  if (playerAgent.slotIndex === 2) return 'frag';
  return 'p9';
}
function currentSpread() {
  if (playerAgent.slotIndex === 2) return 0.02;
  return spreadOf(playerAgent.weapon, player.groundSpeed(), player.body.crouching, !player.body.onGround, input.state.scoped);
}

// ------------------------------------------------------------ pointer flow
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    hud.hideOverlay();
    if (!G.started) {
      G.started = true;
      match.startMatch();
    }
  } else if (G.started && G.phase !== PHASE.MATCH_END) {
    hud.showOverlay('paused');
  }
}
hud.onPlay(() => {
  audio.unlock();
  if (G.phase === PHASE.MATCH_END) {
    G.matchOver = false;
    playerAgent.lostKit = true;
    playerAgent.armor = 0;
    match.startMatch();
  }
  input.requestLock();
});
hud.showOverlay('start');

// ------------------------------------------------------------ per-frame input → intent
function pollKeys() {
  const pressed = input.state.pressed;
  const buyOpen = G.phase === PHASE.FREEZE && hud.buyVisible();
  if (buyOpen) {
    // while the shop is up, 1–5 are prices (B closes it first)
    const buyKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
    for (let i = 0; i < buyKeys.length; i++) {
      if (pressed.has(buyKeys[i]) && hud.tryBuy(i)) audio.buy();
    }
  } else {
    if (pressed.has('Digit1')) switchSlot(0);
    if (pressed.has('Digit2')) switchSlot(1);
    if (pressed.has('Digit3')) switchSlot(2);
  }
  if (G.phase === PHASE.FREEZE && pressed.has('KeyB')) hud.setBuyVisible(!hud.buyVisible());
  if (pressed.has('KeyR') && playerAgent.slotIndex !== 2 && playerAgent.alive) {
    if (startReload(playerAgent.weapon)) {
      viewmodel.onReload(playerAgent.weapon.def.reload);
      audio.reload();
    }
  }
  hud.setScoreboard(input.state.keys.has('Tab'));
}

function switchSlot(i) {
  if (!playerAgent.alive) return;
  if (i === 0 && !playerAgent.primary) return;
  if (i === 2 && playerAgent.grenades <= 0) return;
  playerAgent.slotIndex = i;
  playerAgent.weapon = i === 0 ? playerAgent.primary : playerAgent.sidearm;
  viewmodel.show(currentWeaponKey());
}

// ------------------------------------------------------------ the fixed step
function step(dt) {
  simTime += dt;
  match.step(dt);
  const combatNow = isCombatPhase();

  if (playerAgent.alive && combatNow) {
    const speedMul = playerAgent.slotIndex === 2 ? 1 : playerAgent.weapon.def.speedMul;
    player.step(dt, input.state.keys, world.colliders, speedMul);
    // footsteps the Wardens can hear
    footT -= dt;
    if (footT <= 0 && player.body.onGround && player.groundSpeed() > 1.2) {
      footT = player.body.slowWalking ? 0.55 : player.body.crouching ? 0.62 : 0.38;
      const r = player.body.slowWalking ? 3 : player.body.crouching ? 4 : 9;
      combat.noise(player.body.position.x, player.body.position.z, r, TEAM_EMBER, simTime);
      audio.footstep(0.5, player.body.slowWalking);
    }
  }

  // player trigger: auto weapons fire while held, others need a fresh click
  const w = playerAgent.weapon;
  if (playerAgent.alive && combatNow && input.state.firing) {
    if (playerAgent.slotIndex === 2) {
      if (!w.triggerHeld) {
        w.triggerHeld = true;
        camera.getWorldDirection(dirV);
        player.eyePos(eyeV);
        if (combat.throwGrenade(playerAgent, eyeV, dirV)) {
          viewmodel.onFire();
          setTimeout(() => switchSlot(playerAgent.primary ? 0 : 1), 250);
        }
      }
    } else if (w.def.auto || !w.triggerHeld) {
      if (readyToFire(w)) {
        w.triggerHeld = true;
        camera.getWorldDirection(camDir);
        player.eyePos(eyeV);
        const result = combat.playerFire(eyeV, camDir);
        if (result) {
          player.recoil(w.def.recoilPitch * (0.8 + rand() * 0.4), (rand() * 2 - 1) * w.def.recoilYaw);
          viewmodel.onFire();
          effects.shellEject(viewmodel.muzzleWorld(eyeV), flatDir.set(1, 0, 0).applyQuaternion(camera.quaternion), camDir);
          if (result.hitAgent) {
            hud.hitMarker(!result.hitAgent.alive);
            audio.hitmarker(!result.hitAgent.alive);
          }
        }
      } else if (w.mag === 0 && !w.triggerHeld) {
        w.triggerHeld = true;
        audio.dry();
      }
    }
  } else if (!input.state.firing) {
    w.triggerHeld = false;
  }
  stepWeapon(w, dt);
  if (playerAgent.primary && playerAgent.primary !== w) stepWeapon(playerAgent.primary, dt);
  if (playerAgent.sidearm !== w) stepWeapon(playerAgent.sidearm, dt);

  if (combatNow) {
    match.playerPlant(input.state.keys.has('KeyE'), dt);
    combat.stepGrenades(dt);
    stepBots(dt, simTime, ctx);
  }

  // the noise bus: events live 0.35 s so staggered bots still catch them
  for (let i = G.noise.length - 1; i >= 0; i--) {
    if (simTime - G.noise[i].time > 0.35) G.noise.splice(i, 1);
  }

  // sync the player agent + hit proxies with the human body
  playerAgent.yaw = player.body.yaw;
  const hRatio = player.body.height / 1.72;
  for (const m of hitProxy) {
    m.position.set(player.body.position.x, player.body.position.y + m.userData.offsetY * hRatio, player.body.position.z);
  }
}

// ------------------------------------------------------------ camera & spectate
function syncCamera(dt) {
  if (playerAgent.alive) {
    camera.position.set(player.body.position.x, player.body.position.y + player.body.eye, player.body.position.z);
    camera.rotation.set(player.body.pitch, player.body.yaw, 0, 'YXZ');
    hud.spectate(null);
    return;
  }
  // spectate: chase the first living teammate, else orbit the site
  if (!spectateTarget || !spectateTarget.alive) {
    spectateTarget = null;
    for (const a of G.agents) if (a.team === TEAM_EMBER && a.alive && !a.isPlayer) { spectateTarget = a; break; }
  }
  if (spectateTarget) {
    hud.spectate(spectateTarget.name);
    const t = spectateTarget;
    const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
    tmpSpectate(t, fx, fz, dt);
  } else {
    hud.spectate('the dock');
    const s = G.bomb && G.bomb.state === 'planted' ? G.bomb.site : world.sites[0];
    camera.position.lerp(tmpSpectateV.set(s.x, 9, s.z + 8), Math.min(1, dt * 3));
    camera.lookAt(s.x, 0.5, s.z);
  }
}
const tmpSpectateV = new THREE.Vector3();
const tmpSpectateT = new THREE.Vector3();
function tmpSpectate(t, fx, fz, dt) {
  tmpSpectateV.set(t.body.position.x - fx * 3.4, t.body.position.y + 2.1, t.body.position.z - fz * 3.4);
  camera.position.lerp(tmpSpectateV, Math.min(1, dt * 6));
  tmpSpectateT.set(t.body.position.x + fx * 4, t.body.position.y + 1.2, t.body.position.z + fz * 4);
  camera.lookAt(tmpSpectateT);
}

// ------------------------------------------------------------ the frame loop
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (!frozen) {
    const look = input.takeLook();
    const simRunning = G.started && (input.state.locked || (shot !== null));
    if (playerAgent.alive) player.look(look.x, look.y);
    pollKeys();
    if (simRunning) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
    input.endFrame();
    syncCamera(dt);
    viewmodel.update(dt, look, player.groundSpeed(), input.state.scoped && currentWeaponKey() === 'longwatch');
    updateAgentVisuals(dt);
    effects.update(dt, camera);
    hud.update(dt, currentSpread() * 900);
    // ambient site ring pulse
    for (const s of world.sites) {
      s.ring.material.opacity = 1;
      const pulse = G.phase === PHASE.PLANTED && G.bomb.site === s ? 0.5 + Math.abs(Math.sin(simTime * 6)) * 0.5 : 0.55 + Math.sin(simTime * 1.5) * 0.12;
      s.ring.material.transparent = true;
      s.ring.material.opacity = pulse;
    }
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------ shot mode & test handle
window.__game = { G, world, agents, player, playerAgent, combat, match, hud, camera, ctx, step, settle, switchSlot, viewmodel, effects, updateAgentVisuals };

function settle(steps) {
  for (let i = 0; i < steps; i++) step(FIXED_STEP);
  syncCamera(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      frozen = true;
      window.__shotReady = true;
    }
  }
  requestAnimationFrame(paint);
}

syncCamera(0.016);
viewmodel.show(currentWeaponKey());
viewmodel.state.fovT = 74;
if (shot) {
  hud.hideOverlay();
  runShot(shot, window.__game, paintTwiceThenReady);
} else {
  requestAnimationFrame(frame);
}
