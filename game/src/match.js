// The match: round phases (freeze → live → planted → over) driven off one clock, the buy
// economy, and the spike — carried, dropped on death, planted on a site, defended, defused or
// detonated. match.step is the only place the clock moves; agents and the HUD read G.phase
// and G.phaseLeft and never touch the flow themselves.
import * as THREE from 'three';
import { G, PHASE, TEAM_EMBER, TEAM_WARDEN, aliveCount } from './state.js';
import { resetAgentsForRound } from './agents.js';
import { WEAPONS } from './weapons.js';

const FREEZE_TIME = 5;
const ROUND_TIME = 95;
const FUSE_TIME = 38;
const OVER_TIME = 4.5;
const PLANT_TIME = 3.2;
const START_MONEY = 800;
const MAX_MONEY = 16000;
const KILL_AWARD = 300;
const PLANT_AWARD = 800;
const WIN_AWARD = 3250;
const DETONATE_AWARD = 3500;
const LOSS_AWARD = 1900;

const bombOffset = new THREE.Vector3();
const _off1 = new THREE.Vector3(1.5, 0.4, 0.5);

export function createMatch(ctx) {
  const { world, effects, combat } = ctx;

  // The spike: a squat dark charge with an amber cap and a pulse light while it's live.
  const bombGroup = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.6 }));
  const bombCap = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.06, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xff9e3d }));
  bombCap.position.y = 0.14;
  const bombLight = new THREE.PointLight(new THREE.Color(0xff9e3d), 0, 9, 1.7);
  bombLight.position.y = 0.5;
  bombGroup.add(bombBody, bombCap, bombLight);
  bombGroup.visible = false;
  world.group.add(bombGroup);

  const bomb = {
    state: 'carried',        // carried | dropped | planted | defused | detonated
    carrier: null,           // agent or null
    pos: new THREE.Vector3(),
    site: null,
    plantedByEmber: false,
    fuseLeft: FUSE_TIME,
    pickupBy: null,          // ember bot designated to fetch a drop
    beepT: 0,
    plantProgress: 0,        // the player's held-E channel, 0..1
  };
  G.bomb = bomb;

  function startMatch() {
    G.round = 0;
    G.roundWins.ember = 0;
    G.roundWins.warden = 0;
    G.money = START_MONEY;
    for (const a of G.agents) { a.stats.kills = 0; a.stats.deaths = 0; }
    startRound();
  }

  function startRound() {
    G.round += 1;
    resetAgentsForRound(world);
    combat.clearGrenades();
    bomb.state = 'carried';
    bomb.carrier = G.player;
    bomb.site = null;
    bomb.fuseLeft = FUSE_TIME;
    bomb.pickupBy = null;
    bomb.plantProgress = 0;
    bombGroup.visible = false;
    ctx.onPlayerRespawn?.();
    G.phase = PHASE.FREEZE;
    G.phaseLeft = FREEZE_TIME;
    G.result = null;
    ctx.audio?.roundStart();
  }

  function endRound(winner, reason) {
    if (G.phase === PHASE.OVER || G.phase === PHASE.MATCH_END) return;
    G.phase = PHASE.OVER;
    G.phaseLeft = OVER_TIME;
    G.result = { winner, reason };
    const playerWon = winner === TEAM_EMBER;
    let award = playerWon ? (reason === 'the spike burned' ? DETONATE_AWARD : WIN_AWARD) : LOSS_AWARD;
    if (!playerWon && bomb.state !== 'carried' && bomb.state !== 'dropped' && bomb.plantedByEmber) award += 800;
    G.money = Math.min(MAX_MONEY, G.money + award);
    G.roundWins[winner] += 1;
    ctx.audio?.roundEnd(playerWon);
    ctx.onRoundEnd?.(winner, reason, award);
    if (G.roundWins[winner] >= G.winsNeeded || G.round >= G.maxRounds) {
      // round nine can only be 4–4 going in, so someone is ahead now
      G.matchOver = true;
    }
  }

  // Bomb transitions -----------------------------------------------------
  function dropBomb(agent) {
    bomb.state = 'dropped';
    bomb.carrier = null;
    bomb.pos.copy(agent.body.position);
    bomb.pos.y = 0.14;
    bombGroup.position.copy(bomb.pos);
    bombGroup.visible = true;
    bombLight.intensity = 6;
    // the nearest living ember bot is nominated to fetch it
    let best = null, bd = Infinity;
    for (const a of G.agents) {
      if (a.team !== TEAM_EMBER || a.isPlayer || !a.alive) continue;
      const d = a.body.position.distanceToSquared(bomb.pos);
      if (d < bd) { bd = d; best = a; }
    }
    bomb.pickupBy = best;
  }

  const api = {
    plantComplete(agent, site) {
      bomb.state = 'planted';
      bomb.plantedByEmber = agent.team === TEAM_EMBER;
      bomb.carrier = null;
      bomb.site = site;
      bomb.pos.copy(agent.body.position);
      bomb.pos.y = 0.14;
      bombGroup.position.copy(bomb.pos);
      bombGroup.visible = true;
      G.phase = PHASE.PLANTED;
      G.phaseLeft = FUSE_TIME;
      if (agent.isPlayer) G.money = Math.min(MAX_MONEY, G.money + PLANT_AWARD);
      combat.noise(bomb.pos.x, bomb.pos.z, 60, TEAM_EMBER, ctx.time());
      ctx.audio?.plantDone();
      ctx.onPlanted?.(agent, site);
    },
    defuseComplete(agent) {
      if (bomb.state !== 'planted') return;
      bomb.state = 'defused';
      bombGroup.visible = false;
      endRound(TEAM_WARDEN, `${agent.name} cut the spike`);
    },
    pickupBomb(agent) {
      if (bomb.state !== 'dropped') return;
      bomb.state = 'carried';
      bomb.carrier = agent;
      bomb.pickupBy = null;
      bombGroup.visible = false;
    },
  };

  function detonate() {
    bomb.state = 'detonated';
    effects.explode(bomb.pos);
    bombOffset.copy(bomb.pos).add(_off1);
    effects.explode(bombOffset);
    ctx.audio?.explosion(bomb.pos.distanceTo(ctx.listenerPos));
    combat.noise(bomb.pos.x, bomb.pos.z, 70, TEAM_EMBER, ctx.time());
    // the blast hurts whoever stands in it — the spike is not ceremonial
    for (const a of G.agents) {
      if (!a.alive) continue;
      const d = a.body.position.distanceTo(bomb.pos);
      if (d < 12) combat.damageAgent(a, Math.round(200 * (1 - d / 12)), null, false);
    }
    bombGroup.visible = false;
    endRound(TEAM_EMBER, 'the spike burned');
  }

  // The player's plant channel: called each fixed step with whether E is held and where.
  function playerPlant(holding, dt) {
    if (!G.player.alive || bomb.state !== 'carried' || bomb.carrier !== G.player || G.phase !== PHASE.LIVE) {
      bomb.plantProgress = 0;
      return;
    }
    const site = combat.siteAt(G.player.body.position);
    if (!site || !holding) { bomb.plantProgress = 0; return; }
    bomb.plantProgress += dt / PLANT_TIME;
    if (bomb.plantProgress >= 1) {
      bomb.plantProgress = 0;
      api.plantComplete(G.player, site);
    }
  }

  // A dropped spike is picked up by walking over it (player), or by the nominated bot.
  function checkPickup() {
    if (bomb.state !== 'dropped' || !G.player.alive) return;
    if (G.player.body.position.distanceTo(bomb.pos) < 1.0) api.pickupBomb(G.player);
  }

  function playerDied() {
    if (bomb.state === 'carried' && bomb.carrier === G.player) dropBomb(G.player);
    else if (bomb.carrier && !bomb.carrier.alive && bomb.state === 'carried') dropBomb(bomb.carrier);
  }

  function step(dt) {
    switch (G.phase) {
      case PHASE.FREEZE:
        G.phaseLeft -= dt;
        if (G.phaseLeft <= 0) {
          G.phase = PHASE.LIVE;
          G.phaseLeft = ROUND_TIME;
          ctx.onLive?.();
        }
        break;
      case PHASE.LIVE: {
        G.phaseLeft -= dt;
        checkPickup();
        // carrier bots that died drop the spike
        if (bomb.state === 'carried' && bomb.carrier && !bomb.carrier.alive) dropBomb(bomb.carrier);
        const embers = aliveCount(TEAM_EMBER);
        const wardens = aliveCount(TEAM_WARDEN);
        if (wardens === 0) endRound(TEAM_EMBER, 'wardens down');
        else if (embers === 0) endRound(TEAM_WARDEN, 'embers wiped');
        else if (G.phaseLeft <= 0) endRound(TEAM_WARDEN, 'time — the spike never fell');
        break;
      }
      case PHASE.PLANTED: {
        bomb.fuseLeft -= dt;
        G.phaseLeft = Math.max(0, bomb.fuseLeft);
        // the beep hurries as the fuse shortens
        bomb.beepT -= dt;
        if (bomb.beepT <= 0) {
          const urgency = 1 - bomb.fuseLeft / FUSE_TIME;
          bomb.beepT = Math.max(0.16, 0.85 - urgency * 0.62);
          bombLight.intensity = 30;
          ctx.audio?.beep(bomb.pos.distanceTo(ctx.listenerPos), urgency);
        }
        bombLight.intensity *= Math.max(0, 1 - dt * 6);
        if (bomb.fuseLeft <= 0) detonate();
        else {
          const embers = aliveCount(TEAM_EMBER);
          const wardens = aliveCount(TEAM_WARDEN);
          if (wardens === 0) endRound(TEAM_EMBER, 'wardens down');
          // embers all dead does NOT end it — the spike still burns (proper rule)
        }
        break;
      }
      case PHASE.OVER:
        G.phaseLeft -= dt;
        if (G.phaseLeft <= 0) {
          if (G.matchOver) {
            G.phase = PHASE.MATCH_END;
            ctx.onMatchEnd?.(G.roundWins.ember > G.roundWins.warden ? TEAM_EMBER : TEAM_WARDEN);
          } else {
            startRound();
          }
        }
        break;
    }
  }

  return {
    api,
    step,
    startMatch,
    endRound,
    playerPlant,
    playerDied,
    awardKill(killer) {
      if (killer && killer.isPlayer) G.money = Math.min(MAX_MONEY, G.money + KILL_AWARD);
    },
    bombMesh: bombGroup,
    get buyTimeLeft() { return G.phase === PHASE.FREEZE ? G.phaseLeft : 0; },
  };
}
