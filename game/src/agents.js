// The bots: nine low-poly combatants — four EMBER teammates pushing lanes and five WARDEN
// defenders holding posts — plus the record shape the player shares so combat treats every
// combatant alike. Each bot runs a small state machine (route / hold / engage / seek /
// plant / defuse) over a staggered perception tick: a vision cone plus a raycast to see, the
// shared noise bus to hear. Firing goes through combat.fireHitscan like the player's shots.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { G, TEAM_EMBER, TEAM_WARDEN, isCombatPhase } from './state.js';
import { slideMove } from './collide.js';
import { makeInstance, stepWeapon, fireRound, readyToFire, startReload, WEAPONS } from './weapons.js';

export const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const EYE = 1.55;
const WALK = 4.5;
const ENGAGE_WALK = 1.6;
const ACCEL = 26;
const FOV_COS = Math.cos(1.1);         // ~126° cone
const VIEW_DIST = 42;
const HEAR_RADIUS_SCALE = 1.0;
const REACTION = 0.34;                  // seconds between seeing and shooting
const LOSE_SIGHT = 1.4;                 // seconds of no-LOS before giving chase
const PERCEPTION_STEP = 0.15;
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5.0;
const BOT_NAMES = {
  ember: ['ROOK', 'FLINT', 'ASH', 'CINDER'],
  warden: ['VOSS', 'SABLE', 'MARLOW', 'KESTREL', 'BRIG'],
};

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const ray = new THREE.Raycaster();
const eyeV = new THREE.Vector3();
const chestV = new THREE.Vector3();
const dirV = new THREE.Vector3();
const muzzleV = new THREE.Vector3();
const flatA = new THREE.Vector3();
const flatB = new THREE.Vector3();

// ------------------------------------------------------------ figure
// A two-part combatant: legs and torso in team colours, a head worth more to hit, a gun that
// aims where the body faces. Hit meshes are tagged for combat's raycast.
function buildFigure(team) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(team === 'ember' ? PALETTE.ember : PALETTE.warden).multiplyScalar(0.75), roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: PALETTE.canvas, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.7 });
  const teamTint = new THREE.MeshStandardMaterial({ color: team === 'ember' ? PALETTE.ember : PALETTE.warden, roughness: 0.6 });

  const legL = new THREE.Mesh(unitBox, dark); legL.scale.set(0.16, 0.78, 0.2); legL.position.set(-0.11, 0.39, 0);
  const legR = new THREE.Mesh(unitBox, dark); legR.scale.set(0.16, 0.78, 0.2); legR.position.set(0.11, 0.39, 0);
  const torso = new THREE.Mesh(unitBox, suit); torso.scale.set(0.52, 0.62, 0.3); torso.position.y = 1.05;
  const vest = new THREE.Mesh(unitBox, dark); vest.scale.set(0.54, 0.36, 0.32); vest.position.y = 1.08;
  const head = new THREE.Mesh(unitBox, skin); head.scale.set(0.24, 0.24, 0.24); head.position.y = 1.58;
  const helmet = new THREE.Mesh(unitBox, teamTint); helmet.scale.set(0.28, 0.13, 0.28); helmet.position.y = 1.72;
  const arm = new THREE.Mesh(unitBox, suit); arm.scale.set(0.09, 0.09, 0.38); arm.position.set(0.2, 1.18, -0.2);
  const gun = new THREE.Mesh(unitBox, dark); gun.scale.set(0.06, 0.1, 0.62); gun.position.set(0.2, 1.14, -0.44);
  group.add(legL, legR, torso, vest, head, helmet, arm, gun);
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } });

  legL.userData.part = 'legs'; legR.userData.part = 'legs';
  torso.userData.part = 'body'; vest.userData.part = 'body';
  head.userData.part = 'head'; helmet.userData.part = 'head';
  const hitMeshes = [legL, legR, torso, vest, head, helmet];
  return { group, hitMeshes, gun };
}

// ------------------------------------------------------------ agents
export function createAgents(scene, world) {
  const figures = [];

  function spawn(name, team, point, isPlayer) {
    const fig = buildFigure(team);
    scene.add(fig.group);
    const agent = {
      name, team, isPlayer: !!isPlayer,
      alive: true, health: 100, armor: 0,
      body: { position: new THREE.Vector3(point.x, 0, point.z), velocity: new THREE.Vector3(), onGround: true },
      yaw: point.yaw ?? 0, targetYaw: point.yaw ?? 0,
      height: BOT_HEIGHT,
      weapon: makeInstance(team === 'ember' ? 'wasp' : 'jackal'),
      grenades: 0,
      stats: { kills: 0, deaths: 0 },
      // bot brain
      state: 'hold', post: null, route: null, routeI: 0,
      path: null, pathI: 0, repathAt: 0, stuckT: 0,
      target: null, lastSeen: new THREE.Vector3(), lastSeenAt: -9, reactAt: 0,
      burstLeft: 0, shotAt: 0, pauseAt: 0,
      perceiveAt: Math.random() * PERCEPTION_STEP,
      alertPoint: new THREE.Vector3(), alertAt: -9,
      channelT: 0, channelKind: null,
      deathT: 0, heard: false,
      fig,
    };
    for (const m of fig.hitMeshes) m.userData.agent = agent;
    figures.push(agent);
    return agent;
  }

  const playerAgent = spawn('YOU', TEAM_EMBER, world.emberSpawns[0], true);
  for (let i = 1; i < world.emberSpawns.length; i++) {
    const a = spawn(BOT_NAMES.ember[i - 1], TEAM_EMBER, world.emberSpawns[i]);
    a.route = world.emberRoutes[i - 1];
    a.weapon = makeInstance(i % 2 ? 'jackal' : 'wasp');
  }
  for (let i = 0; i < world.wardenSpawns.length; i++) {
    const a = spawn(BOT_NAMES.warden[i], TEAM_WARDEN, world.wardenSpawns[i]);
    a.post = world.wardenPosts[i];
    a.weapon = makeInstance('jackal');
  }
  G.agents = figures;
  G.player = playerAgent;
  return figures;
}

// ------------------------------------------------------------ perception
// Can `viewer` see `target` right now? Cone check first (cheap), then one ray that counts the
// target's own hitboxes as proof of sight — anything else arriving first blocks the view.
// ctx.sightSet is world shootables + every agent's hit meshes, built once by main.js.
export function canSee(viewer, target, ctx) {
  const vp = viewer.body.position, tp = target.body.position;
  flatA.set(tp.x - vp.x, 0, tp.z - vp.z);
  const dist = flatA.length();
  if (dist > VIEW_DIST) return false;
  if (dist > 2.5) {
    flatA.normalize();
    const fwdX = -Math.sin(viewer.yaw), fwdZ = -Math.cos(viewer.yaw);
    if (flatA.x * fwdX + flatA.z * fwdZ < FOV_COS) return false;
  }
  eyeV.set(vp.x, vp.y + EYE, vp.z);
  chestV.set(tp.x, tp.y + 1.05, tp.z);
  dirV.copy(chestV).sub(eyeV);
  const d = dirV.length();
  dirV.normalize();
  ray.set(eyeV, dirV);
  ray.far = d - 0.05;
  const hits = ray.intersectObjects(ctx.sightSet, false);
  for (const h of hits) {
    const a = h.object.userData.agent;
    if (a === viewer) continue;
    if (a === target) return true;         // the first thing the eye meets is the target
    if (a && !a.alive) continue;           // the dead block nothing
    return false;                          // wall or another body blocks
  }
  return false;
}

function hear(agent, noise) {
  if (!noise.length) return false;
  let heard = false;
  const p = agent.body.position;
  for (const n of noise) {
    if (n.time <= agent.alertAt) continue;   // already reacted to this one
    const dx = n.x - p.x, dz = n.z - p.z;
    if (dx * dx + dz * dz < n.radius * n.radius * HEAR_RADIUS_SCALE) {
      agent.alertPoint.set(n.x, 0, n.z);
      agent.alertAt = n.time;
      heard = true;
    }
  }
  return heard;
}

// ------------------------------------------------------------ shooting
function muzzleOf(agent, out) {
  const fwdX = -Math.sin(agent.yaw), fwdZ = -Math.cos(agent.yaw);
  return out.set(
    agent.body.position.x + fwdX * 0.6 - fwdZ * 0.18,
    agent.body.position.y + 1.2,
    agent.body.position.z + fwdZ * 0.6 + fwdX * 0.18);
}

// Move along path; returns true while still travelling.
function followPath(agent, dt, colliders) {
  const path = agent.path;
  if (!path || agent.pathI >= path.length) {
    agent.body.velocity.x *= Math.max(0, 1 - 9 * dt);
    agent.body.velocity.z *= Math.max(0, 1 - 9 * dt);
    slideMove(colliders, agent.body, BOT_RADIUS, agent.height, dt);
    return false;
  }
  const p = agent.body.position;
  const wp = path[agent.pathI];
  flatB.set(wp.x - p.x, 0, wp.z - p.z);
  const d = flatB.length();
  if (d < 0.55) { agent.pathI += 1; return followPath(agent, dt, colliders); }
  flatB.normalize();
  const speed = agent.state === 'engage' ? ENGAGE_WALK : WALK;
  agent.body.velocity.x += (flatB.x * speed - agent.body.velocity.x) * Math.min(1, ACCEL * dt / speed);
  agent.body.velocity.z += (flatB.z * speed - agent.body.velocity.z) * Math.min(1, ACCEL * dt / speed);
  // gentle separation so two bots never occupy the same square metre
  for (const other of G.agents) {
    if (other === agent || !other.alive) continue;
    const ox = p.x - other.body.position.x, oz = p.z - other.body.position.z;
    const od = ox * ox + oz * oz;
    if (od < 0.64 && od > 0.0001) {
      const push = 1.4 * dt / Math.sqrt(od);
      agent.body.velocity.x += ox * push;
      agent.body.velocity.z += oz * push;
    }
  }
  slideMove(colliders, agent.body, BOT_RADIUS, agent.height, dt);
  if (agent.state !== 'engage') agent.targetYaw = Math.atan2(-agent.body.velocity.x, -agent.body.velocity.z);
  return true;
}

function setDestination(agent, nav, x, z, time) {
  agent.path = nav.findPath(agent.body.position.x, agent.body.position.z, x, z);
  agent.pathI = 0;
  agent.repathAt = time + 1.4;
}

// ------------------------------------------------------------ per-bot brain
function think(bot, dt, time, ctx) {
  const { nav, colliders, world, combat, effects, audio } = ctx;

  // --- senses, on a staggered cadence ---
  bot.perceiveAt -= dt;
  if (bot.perceiveAt <= 0) {
    bot.perceiveAt = PERCEPTION_STEP;
    let best = null, bestD = Infinity;
    for (const other of G.agents) {
      if (other.team === bot.team || !other.alive) continue;
      const d = bot.body.position.distanceToSquared(other.body.position);
      if (d < bestD && canSee(bot, other, ctx)) { best = other; bestD = d; }
    }
    if (best) {
      if (bot.target !== best) bot.reactAt = time + REACTION;
      bot.target = best;
      bot.lastSeen.copy(best.body.position);
      bot.lastSeenAt = time;
    } else if (bot.target && (time - bot.lastSeenAt > LOSE_SIGHT || !bot.target.alive)) {
      bot.target = null;
    }
    if (hear(bot, G.noise) && !bot.target && bot.state !== 'plant' && bot.state !== 'defuse') {
      bot.state = 'seek';
      setDestination(bot, nav, bot.alertPoint.x, bot.alertPoint.z, time);
    }
  }

  // --- decide ---
  const bomb = G.bomb;
  switch (bot.state) {
    case 'route': {
      // an ember escort pushes its lane until the site, then holds with the pack
      if (bomb && bomb.state === 'planted') { bot.state = 'guard'; break; }
      if (bomb && bomb.state === 'dropped' && bomb.pickupBy === bot) { bot.state = 'fetch'; break; }
      if (!bot.path || bot.pathI >= bot.path.length) {
        if (bot.route && bot.routeI < bot.route.length) {
          const wp = bot.route[bot.routeI++];
          setDestination(bot, nav, wp.x, wp.z, time);
        } else {
          bot.state = 'hold';
          bot.post = { x: bot.body.position.x, z: bot.body.position.z, face: bot.yaw, tag: 'site' };
        }
      }
      break;
    }
    case 'hold': {
      if (bomb && bomb.state === 'planted' && bot.team === TEAM_WARDEN) { bot.state = 'rotate'; break; }
      if (bomb && bomb.state === 'planted' && bot.team === TEAM_EMBER) { bot.state = 'guard'; break; }
      if (bomb && bomb.state === 'dropped' && bomb.pickupBy === bot) { bot.state = 'fetch'; break; }
      // drift back to the post, scan around its facing
      if (bot.post) {
        const dx = bot.post.x - bot.body.position.x, dz = bot.post.z - bot.body.position.z;
        if (dx * dx + dz * dz > 1.4) setDestination(bot, nav, bot.post.x, bot.post.z, time);
        else bot.targetYaw = bot.post.face + Math.sin(time * 0.5 + bot.body.position.x) * 0.7;
      }
      break;
    }
    case 'seek': {
      if (!bot.path || bot.pathI >= bot.path.length) {
        bot.state = bot.team === TEAM_WARDEN ? 'hold' : 'route';
      }
      break;
    }
    case 'rotate': {
      // converge on the planted site; the closest warden defuses once the area looks safe
      if (!bomb || bomb.state !== 'planted') { bot.state = 'hold'; break; }
      const d = bot.body.position.distanceTo(bomb.pos);
      if (d < 1.6) { bot.state = 'defuse'; bot.channelT = 0; bot.path = null; break; }
      if (!bot.path || time > bot.repathAt) setDestination(bot, nav, bomb.pos.x, bomb.pos.z, time);
      break;
    }
    case 'defuse': {
      if (!bomb || bomb.state !== 'planted' || bot.target) { bot.state = 'rotate'; break; }
      bot.channelT += dt;
      bot.targetYaw = Math.atan2(-(bomb.pos.x - bot.body.position.x), -(bomb.pos.z - bot.body.position.z));
      if (bot.channelT >= DEFUSE_TIME) combat.defuseComplete(bot);
      break;
    }
    case 'fetch': {
      if (!bomb || bomb.state !== 'dropped') { bot.state = 'route'; break; }
      const d = bot.body.position.distanceTo(bomb.pos);
      if (d < 1.0) { combat.pickupBomb(bot); bot.state = 'route'; break; }
      if (!bot.path || time > bot.repathAt) setDestination(bot, nav, bomb.pos.x, bomb.pos.z, time);
      break;
    }
    case 'plant': {
      if (!bomb || bomb.carrier !== bot || bomb.state !== 'carried') { bot.state = 'route'; break; }
      const site = combat.siteAt(bot.body.position);
      if (!site || bot.target) { bot.state = 'route'; break; }
      bot.channelT += dt;
      if (bot.channelT >= PLANT_TIME) combat.plantComplete(bot, site);
      break;
    }
    case 'guard': {
      if (!bomb || bomb.state !== 'planted') { bot.state = bot.team === TEAM_WARDEN ? 'hold' : 'route'; break; }
      // ember escorts ring the planted spike, facing outward
      if (bot.team === TEAM_EMBER) {
        const d = bot.body.position.distanceTo(bomb.pos);
        if (d > 6 && (!bot.path || time > bot.repathAt)) {
          const a = Math.atan2(bot.body.position.x - bomb.pos.x, bot.body.position.z - bomb.pos.z);
          setDestination(bot, nav, bomb.pos.x + Math.sin(a) * 4, bomb.pos.z + Math.cos(a) * 4, time);
        } else if (d <= 6) {
          bot.targetYaw = Math.atan2(-(bot.body.position.x - bomb.pos.x), -(bot.body.position.z - bomb.pos.z));
        }
      }
      break;
    }
    case 'engage': break;
  }

  // --- engage overrides everything except an active channel ---
  if (bot.target && bot.target.alive && bot.state !== 'plant' && bot.state !== 'defuse') {
    const p = bot.body.position, tp = bot.target.body.position;
    const want = Math.atan2(-(tp.x - p.x), -(tp.z - p.z));
    bot.targetYaw = want;
    bot.state = bot.state === 'rotate' || bot.state === 'guard' ? bot.state : 'engage';
    // shoot when aimed, reacted and in sight; burst of 3–5, then breathe
    if (time >= bot.reactAt && time >= bot.pauseAt) {
      const yawErr = Math.abs(((want - bot.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (yawErr < 0.09 && canSee(bot, bot.target, ctx)) {
        if (bot.burstLeft <= 0) bot.burstLeft = 3 + ((time * 7 + bot.body.position.x) & 2);
        if (time >= bot.shotAt && readyToFire(bot.weapon)) {
          combat.botFire(bot, bot.target, muzzleOf(bot, muzzleV));
          bot.burstLeft -= 1;
          bot.shotAt = time + bot.weapon.def.interval * 1.15;
          if (bot.burstLeft <= 0) bot.pauseAt = time + 0.5;
        } else if (bot.weapon.mag === 0 && bot.weapon.reserve > 0 && bot.weapon.reloadLeft === 0) {
          startReload(bot.weapon);
          bot.pauseAt = time + bot.weapon.def.reload + 0.2;
        }
      }
    }
  } else if (bot.state === 'engage' && !bot.target) {
    // chase the last known spot for a beat, then give up
    if (time - bot.lastSeenAt < 4) {
      setDestination(bot, nav, bot.lastSeen.x, bot.lastSeen.z, time);
      bot.state = 'seek';
    } else {
      bot.state = bot.team === TEAM_WARDEN ? 'hold' : 'route';
    }
  }

  // ember with the bomb: head for the nearer site and plant inside it
  if (bomb && bomb.state === 'carried' && bomb.carrier === bot && !bot.target && bot.state !== 'plant') {
    const site = combat.siteAt(bot.body.position) || combat.nearestSite(bot.body.position);
    if (combat.siteAt(bot.body.position)) {
      bot.state = 'plant';
      bot.channelT = 0;
      bot.path = null;
    } else if (!bot.path || time > bot.repathAt) {
      setDestination(bot, nav, site.x, site.z, time);
    }
  }

  // --- act ---
  if (bot.target) {
    // engaged: plant feet and shoot — a little sidestep weave is the only movement
    const weave = Math.sin(time * 2.6 + bot.body.position.z * 3) * 0.9;
    const fwdX = -Math.sin(bot.yaw), fwdZ = -Math.cos(bot.yaw);
    bot.body.velocity.x += (fwdZ * weave - bot.body.velocity.x) * Math.min(1, dt * 6);
    bot.body.velocity.z += (-fwdX * weave - bot.body.velocity.z) * Math.min(1, dt * 6);
    slideMove(colliders, bot.body, BOT_RADIUS, bot.height, dt);
  } else if (bot.state !== 'defuse' && bot.state !== 'plant') {
    followPath(bot, dt, colliders);
  } else { // channelled: stand still
    bot.body.velocity.x = 0; bot.body.velocity.z = 0;
    slideMove(colliders, bot.body, BOT_RADIUS, bot.height, dt);
  }

  // yaw eases toward targetYaw; the figure follows
  let dy = ((bot.targetYaw - bot.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  bot.yaw += dy * Math.min(1, dt * 9);
  bot.fig.group.position.copy(bot.body.position);
  bot.fig.group.rotation.y = bot.yaw;
  stepWeapon(bot.weapon, dt);
}

// ------------------------------------------------------------ public step
export function stepBots(dt, time, ctx) {
  if (!isCombatPhase()) return;
  for (const bot of G.agents) {
    if (bot.isPlayer || !bot.alive) continue;
    think(bot, dt, time, ctx);
  }
}

// ------------------------------------------------------------ death & reset
export function killAgent(agent, killer, headshot) {
  if (!agent.alive) return;
  agent.alive = false;
  agent.stats.deaths += 1;
  if (killer) killer.stats.kills += 1;
  agent.deathT = 0;
  for (const m of agent.fig.hitMeshes) m.userData.dead = true;
  G.pendingKillfeed.push({
    killerName: killer ? killer.name : '—',
    killerTeam: killer ? killer.team : agent.team === TEAM_EMBER ? TEAM_WARDEN : TEAM_EMBER,
    victimName: agent.name,
    victimTeam: agent.team,
    headshot: !!headshot,
  });
}

// Ragdoll-lite: keel over, then sink. Render-side, called from main's frame loop.
export function updateAgentVisuals(dt) {
  for (const a of G.agents) {
    if (a.isPlayer) continue;
    if (!a.alive) {
      a.deathT += dt;
      const f = Math.min(1, a.deathT * 2.6);
      a.fig.group.rotation.z = f * Math.PI / 2;
      if (a.deathT > 2.4) a.fig.group.position.y = -(a.deathT - 2.4) * 0.7;
      continue;
    }
    // light idle: scan sway on hold; plant/defuse crouch pose
    const crouchPose = a.state === 'defuse' || a.state === 'plant' ? 0.72 : 1;
    a.fig.group.scale.y += (crouchPose - a.fig.group.scale.y) * Math.min(1, dt * 8);
  }
}

// Back to spawn, full health, fresh magazine — used by match.js between rounds.
export function resetAgentsForRound(world) {
  const embers = G.agents.filter((a) => a.team === TEAM_EMBER);
  const wardens = G.agents.filter((a) => a.team === TEAM_WARDEN);
  embers.forEach((a, i) => {
    const s = world.emberSpawns[i] ?? world.emberSpawns[0];
    a.body.position.set(s.x, 0, s.z);
    a.body.velocity.set(0, 0, 0);
    a.yaw = s.yaw; a.targetYaw = s.yaw;
  });
  wardens.forEach((a, i) => {
    const s = world.wardenSpawns[i] ?? world.wardenSpawns[0];
    a.body.position.set(s.x, 0, s.z);
    a.body.velocity.set(0, 0, 0);
    a.yaw = s.yaw; a.targetYaw = s.yaw;
  });
  for (const a of G.agents) {
    a.alive = true;
    a.health = 100;
    a.armor = a.isPlayer ? a.armor : 0;
    a.target = null;
    a.lastSeenAt = -9;
    a.alertAt = -9;
    a.path = null; a.pathI = 0;
    a.channelT = 0;
    a.pauseAt = 0; a.burstLeft = 0;
    a.fig.group.rotation.z = 0;
    a.fig.group.position.copy(a.body.position);
    a.fig.group.scale.y = 1;
    a.fig.group.visible = true;
    for (const m of a.fig.hitMeshes) m.userData.dead = false;
    a.weapon.mag = a.weapon.def.mag;
    a.weapon.reserve = a.weapon.def.reserve;
    a.weapon.cooldown = 0;
    a.weapon.reloadLeft = 0;
    if (!a.isPlayer) {
      a.state = a.team === TEAM_WARDEN ? 'hold' : 'route';
      if (a.team === TEAM_WARDEN) a.routeI = 0;
      else { const idx = G.agents.indexOf(a) - 1; a.route = world.emberRoutes[idx]; a.routeI = 0; }
    }
  }
}
