// Combat resolution: the one ray every bullet shares. Player and bots both call fireHitscan —
// the ray meets world surfaces and agent hitboxes, the first thing it hits takes the damage,
// with the head worth most and the legs least (weapons.damageFor). Gunfire posts to the noise
// bus so the other team hears it; grenades fly, bounce and burst here too. The bomb's rules
// live in match.js, which combat calls through a bound interface (no import cycle).
import * as THREE from 'three';
import { G, TEAM_EMBER, TEAM_WARDEN } from './state.js';
import { damageFor, fireRound } from './weapons.js';
import { killAgent } from './agents.js';
import { overlapsBox, segmentBlocked } from './collide.js';

const ray = new THREE.Raycaster();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const FUSE = 1.6;
const BLAST_RADIUS = 9;
const GRENADE_GRAVITY = 18;
const RESTITUTION = 0.45;

export function createCombat(ctx) {
  const { world, effects } = ctx;
  let matchApi = null;
  const grenades = [];

  function noise(x, z, radius, team, time) {
    G.noise.push({ x, z, radius, team, time });
  }

  // The shared ray: first non-dead thing it meets takes the bullet. Returns the outcome for
  // hit markers and kill feed; tracers and impact dressing are emitted here.
  function fireHitscan(shooter, origin, dir, spread, rand) {
    tmpA.copy(dir);
    tmpA.x += (rand() * 2 - 1) * spread;
    tmpA.y += (rand() * 2 - 1) * spread;
    tmpA.z += (rand() * 2 - 1) * spread;
    tmpA.normalize();
    ray.set(origin, tmpA);
    ray.far = 95;
    const hits = ray.intersectObjects(ctx.sightSet, false);
    let end = null;
    let hitAgent = null;
    let part = null;
    for (const h of hits) {
      const a = h.object.userData.agent;
      if (a === shooter || (a && !a.alive)) continue;
      end = h.point;
      if (a) { hitAgent = a; part = h.object.userData.part; }
      else {
        const n = h.face ? tmpB.copy(h.face.normal).transformDirection(h.object.matrixWorld) : tmpB.copy(tmpA).negate();
        effects.impact(h.point, n, false);
      }
      break;
    }
    if (!end) end = tmpC.copy(origin).addScaledVector(tmpA, 95);
    if (hitAgent) {
      effects.impact(end, tmpB.copy(tmpA).negate(), true);
      const dmg = damageFor(shooter.weapon.def, part, origin.distanceTo(end));
      damageAgent(hitAgent, dmg, shooter, part === 'head');
      return { hitAgent, part, point: end };
    }
    return { hitAgent: null, part: null, point: end };
  }

  // Armour soaks roughly half the wound until it runs out.
  function damageAgent(agent, dmg, killer, headshot) {
    if (!agent.alive || G.phase !== 'live' && G.phase !== 'planted') return 0;
    if (agent.armor > 0) {
      const absorbed = Math.min(agent.armor, Math.ceil(dmg * 0.5));
      agent.armor -= absorbed;
      dmg -= absorbed;
    }
    agent.health -= dmg;
    if (agent.isPlayer) ctx.onPlayerHurt?.(dmg, killer);
    if (agent.health <= 0) {
      killAgent(agent, killer, headshot);
      ctx.onKill?.(killer, agent, headshot);
    }
    return dmg;
  }

  // A bot pulls the trigger at its current target. Error is a small cone that tightens the
  // longer it has been on target — bots are dangerous, not aimbots.
  function botFire(bot, target, muzzle) {
    chestOf(target, tmpC);
    tmpC.sub(muzzle).normalize();
    const engageT = Math.max(0, ctx.time() - bot.lastSeenAt);
    const spread = 0.028 + Math.max(0, 0.05 - engageT * 0.04) + bot.body.velocity.length() * 0.004;
    if (fireRound(bot.weapon)) {
      const result = fireHitscan(bot, muzzle, tmpC, spread, ctx.rand);
      muzzleOfEffect(bot, muzzle);
      effects.tracer(muzzle, result.point);
      noise(muzzle.x, muzzle.z, bot.weapon.def.loud, bot.team, ctx.time());
      ctx.audio?.shot(bot.weapon.def.key, muzzle.distanceTo(ctx.listenerPos));
      return result;
    }
    return null;
  }

  function chestOf(agent, out) {
    out.copy(agent.body.position);
    out.y += agent.isPlayer ? agent.body.eye - 0.35 : 1.05;
    return out;
  }

  function muzzleOfEffect(bot, muzzle) {
    effects.flashAt(tmpA.set(muzzle.x, muzzle.y, muzzle.z));
  }

  // Player wrapper — same code path, camera-supplied direction.
  function playerFire(origin, dir) {
    const p = G.player;
    if (fireRound(p.weapon)) {
      const result = fireHitscan(p, origin, dir, ctx.playerSpread(), ctx.rand);
      muzzleWorldInto(tmpB);
      effects.tracer(tmpB, result.point);
      noise(origin.x, origin.z, p.weapon.def.loud, TEAM_EMBER, ctx.time());
      ctx.audio?.shot(p.weapon.def.key, 0.5);
      return result;
    }
    return null;
  }
  function muzzleWorldInto(out) {
    return ctx.viewmodelMuzzle ? ctx.viewmodelMuzzle(out) : out;
  }

  // ------------------------------------------------------------ grenades
  function throwGrenade(agent, origin, dir) {
    if (agent.grenades <= 0) return false;
    agent.grenades -= 1;
    grenades.push({
      pos: origin.clone(),
      vel: dir.clone().multiplyScalar(13).add(tmpA.set(0, 3.4, 0)),
      fuse: FUSE,
      owner: agent,
    });
    ctx.audio?.pin();
    return true;
  }

  function stepGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= GRENADE_GRAVITY * dt;
      // axis-wise bounce against the world boxes
      const p = g.pos;
      const nx = p.x + g.vel.x * dt;
      if (overlapsBox(world.colliders, nx, p.y, p.z, 0.09, 0.18, 0)) g.vel.x *= -RESTITUTION;
      else p.x = nx;
      const nz = p.z + g.vel.z * dt;
      if (overlapsBox(world.colliders, p.x, p.y, nz, 0.09, 0.18, 0)) g.vel.z *= -RESTITUTION;
      else p.z = nz;
      const ny = p.y + g.vel.y * dt;
      if (overlapsBox(world.colliders, p.x, ny, p.z, 0.09, 0.18, 0) || ny < 0) {
        if (ny < 0) p.y = 0;
        g.vel.y *= -RESTITUTION;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      } else p.y = ny;
      effects.grenadeMesh.position.copy(p);
      effects.grenadeMesh.visible = true;
      if (g.fuse <= 0) {
        explode(g);
        grenades.splice(i, 1);
      }
    }
    if (!grenades.length) effects.grenadeMesh.visible = false;
  }

  function explode(g) {
    effects.explode(g.pos);
    noise(g.pos.x, g.pos.z, 60, TEAM_EMBER, ctx.time());
    ctx.audio?.explosion(g.pos.distanceTo(ctx.listenerPos));
    for (const a of G.agents) {
      if (!a.alive) continue;
      tmpB.copy(a.body.position); tmpB.y += 1.0;
      const d = tmpB.distanceTo(g.pos);
      if (d > BLAST_RADIUS) continue;
      if (segmentBlocked(world.colliders, g.pos, tmpB)) continue;
      const dmg = Math.round(96 * Math.max(0.15, 1 - d / BLAST_RADIUS));
      damageAgent(a, dmg, g.owner, false);
      if (a.isPlayer) ctx.onBlastShake?.(dmg);
    }
  }

  // ------------------------------------------------------------ sites & the bomb bridge
  function siteAt(pos) {
    for (const s of world.sites) {
      const dx = pos.x - s.x, dz = pos.z - s.z;
      if (dx * dx + dz * dz < s.r * s.r) return s;
    }
    return null;
  }
  function nearestSite(pos) {
    let best = null, bd = Infinity;
    for (const s of world.sites) {
      const d = (pos.x - s.x) ** 2 + (pos.z - s.z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  const plantComplete = (bot, site) => matchApi?.plantComplete(bot, site);
  const defuseComplete = (bot) => matchApi?.defuseComplete(bot);
  const pickupBomb = (bot) => matchApi?.pickupBomb(bot);

  return {
    noise,
    fireHitscan,
    damageAgent,
    botFire,
    playerFire,
    throwGrenade,
    stepGrenades,
    siteAt,
    nearestSite,
    plantComplete,
    defuseComplete,
    pickupBomb,
    bindMatch(api) { matchApi = api; },
    clearGrenades() { grenades.length = 0; effects.grenadeMesh.visible = false; },
  };
}
