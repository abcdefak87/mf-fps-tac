// Screenshot staging. The four captures in screenshots/ are real renders of this game's own
// state: runShot puts live agents, a live round and live effects on the board — a Warden mid
// burst, the buy menu open on a freeze, the spike down and burning, the dock seen from above —
// then simulates a few fixed steps so the frame is one the game produced itself. It runs only
// when index.html is opened with ?shot=, and never touches the normal loop.
import * as THREE from 'three';
import { G, PHASE, TEAM_EMBER, TEAM_WARDEN } from './state.js';
import { canSee } from './agents.js';
import { makeInstance } from './weapons.js';

const eye = new THREE.Vector3();
const dir = new THREE.Vector3();

function agentByName(game, name) {
  return game.agents.find((a) => a.name === name);
}

function place(agent, x, z, yaw) {
  agent.body.position.set(x, 0, z);
  agent.body.velocity.set(0, 0, 0);
  agent.yaw = yaw;
  agent.targetYaw = yaw;
  agent.fig.group.position.copy(agent.body.position);
  agent.fig.group.rotation.y = yaw;
}

function faceYaw(fromX, fromZ, toX, toZ) {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

// Force a defender into a burst at a target, so the still holds a tracer and a flash.
function forceEngage(game, name, tx, tz) {
  const a = agentByName(game, name);
  a.state = 'engage';
  a.target = game.playerAgent;
  a.lastSeen.copy(game.playerAgent.body.position);
  a.lastSeenAt = game.ctx.time();
  a.reactAt = 0;
  a.pauseAt = 0;
  a.burstLeft = 5;
  a.shotAt = 0;
  a.yaw = a.targetYaw = faceYaw(a.body.position.x, a.body.position.z, tx, tz);
  return a;
}

function feed(game, killerName, killerTeam, victimName, victimTeam, headshot) {
  G.pendingKillfeed.push({ killerName, killerTeam, victimName, victimTeam, headshot });
}

export function runShot(name, game, done) {
  const { G: g, hud, match, ctx, playerAgent, player } = game;
  g.started = true;
  match.startMatch();
  hud.setBuyVisible(false);
  game.settle(1);

  if (name === 'combat') {
    // Round 2, mid-fight at the A door: the player peeks in, a Warden answers from the site.
    g.phase = PHASE.LIVE;
    g.phaseLeft = 67;
    g.roundWins.ember = 1;
    g.roundWins.warden = 0;
    g.money = 3450;
    ctx.equipPrimary('jackal');
    playerAgent.weapon.mag = 22;
    playerAgent.weapon.reserve = 58;
    playerAgent.health = 78;
    playerAgent.armor = 40;
    playerAgent.slotIndex = 0;
    place(playerAgent, -21.4, -4.2, 0.16);
    player.body.yaw = 0.24;
    player.body.pitch = -0.02;
    place(agentByName(game, 'VOSS'), -24.6, -13.2, faceYaw(-24.6, -13.2, -21.4, -4.2));
    place(agentByName(game, 'SABLE'), -20.2, -16.3, faceYaw(-20.2, -16.3, -21.4, -4.2));
    place(agentByName(game, 'ROOK'), -19.5, -2.0, faceYaw(-19.5, -2, -23, -12));
    place(agentByName(game, 'ASH'), -14, 12, 0);
    agentByName(game, 'ROOK').state = 'route';
    agentByName(game, 'ASH').state = 'route';
    forceEngage(game, 'VOSS', -21.4, -4.2);
    feed(game, 'ROOK', TEAM_EMBER, 'BRIG', TEAM_WARDEN, false);
    feed(game, 'YOU', TEAM_EMBER, 'MARLOW', TEAM_WARDEN, true);
    game.settle(4);
    // the player's own answering round
    player.eyePos(eye);
    dir.set(-23, 1.3, -12).sub(eye).normalize();
    ctx.combat.playerFire(eye, dir);
    game.viewmodel.onFire();
    game.viewmodel.update(0.016, { x: 0, y: 0 }, 0, false);
    hud.update(0.016, 34);
    done();
  }

  if (name === 'buy') {
    // Freeze of round 3: funds are short after a lost round, the menu is open.
    g.round = 2;
    g.phase = PHASE.FREEZE;
    g.phaseLeft = 4;
    g.roundWins.ember = 1;
    g.roundWins.warden = 1;
    g.money = 2400;
    playerAgent.health = 100;
    playerAgent.armor = 0;
    playerAgent.grenades = 1;
    ctx.equipPrimary('wasp');
    place(playerAgent, 1.5, 21, 0);
    player.body.yaw = 0;
    player.body.pitch = 0;
    hud.setBuyVisible(true);
    game.settle(2);
    hud.update(0.016, 0);
    done();
  }

  if (name === 'planted') {
    // Spike down on A, thirty seconds of fuse: the player holds the site as a Warden pushes in.
    g.phase = PHASE.LIVE;
    g.roundWins.ember = 2;
    g.roundWins.warden = 1;
    g.money = 5150;
    ctx.equipPrimary('jackal');
    playerAgent.weapon.mag = 18;
    playerAgent.health = 64;
    playerAgent.armor = 15;
    place(playerAgent, -25.5, -16.2, faceYaw(-25.5, -16.2, -21, -8));
    player.body.yaw = faceYaw(-25.5, -16.2, -20.5, -9);
    player.body.pitch = -0.03;
    const site = game.world.sites[0];
    g.bomb.pos.set(-22.8, 0.14, -13.8);
    g.bomb.state = 'planted';
    g.bomb.plantedByEmber = true;
    g.bomb.site = site;
    g.bomb.fuseLeft = 31;
    match.bombMesh.position.copy(g.bomb.pos);
    match.bombMesh.visible = true;
    g.phase = PHASE.PLANTED;
    g.phaseLeft = 31;
    place(agentByName(game, 'ROOK'), -18.5, -10.5, faceYaw(-18.5, -10.5, -16, -9));
    agentByName(game, 'ROOK').state = 'guard';
    place(agentByName(game, 'VOSS'), -21.2, -8.6, faceYaw(-21.2, -8.6, -25.5, -16.2));
    agentByName(game, 'VOSS').state = 'rotate';
    agentByName(game, 'VOSS').path = null;
    place(agentByName(game, 'SABLE'), -20, -20.5, faceYaw(-20, -20.5, -23, -14));
    agentByName(game, 'SABLE').state = 'rotate';
    feed(game, 'YOU', TEAM_EMBER, 'KESTREL', TEAM_WARDEN, false);
    feed(game, 'VOSS', TEAM_WARDEN, 'ASH', TEAM_EMBER, false);
    g.bomb.beepT = 0;
    game.settle(2);
    hud.update(0.016, 26);
    done();
  }

  if (name === 'overview') {
    // The dock from the crane: both sites, the Gate and all three lanes in one frame.
    g.phase = PHASE.LIVE;
    g.phaseLeft = 74;
    g.roundWins.ember = 1;
    g.roundWins.warden = 1;
    place(playerAgent, -23, 2, 0);
    place(agentByName(game, 'VOSS'), -21, -16.5, Math.PI * 0.45);
    place(agentByName(game, 'SABLE'), -26.3, -9.6, Math.PI * 0.6);
    place(agentByName(game, 'MARLOW'), 21, -16.5, -Math.PI * 0.45);
    place(agentByName(game, 'KESTREL'), 26.3, -9.6, -Math.PI * 0.6);
    place(agentByName(game, 'BRIG'), 0.8, -8.6, 0);
    place(agentByName(game, 'ROOK'), -23.5, 4, 0);
    place(agentByName(game, 'FLINT'), 0, 6, 0);
    place(agentByName(game, 'ASH'), 23.5, 8, 0);
    place(agentByName(game, 'CINDER'), -21, 12, 0);
    game.settle(1);
    game.camera.position.set(30, 26, 30);
    game.camera.lookAt(-5, 0, -7);
    game.camera.fov = 58;
    game.camera.updateProjectionMatrix();
    hud.update(0.016, 0);
    done();
  }
}
