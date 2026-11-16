// The single game-state store. Every system reads and writes through G — round phase, score,
// economy, the bomb, the combatant roster and the noise bus bots hear through. Nothing else
// holds match truth: modules keep only view objects and scratch vectors of their own.
export const TEAM_EMBER = 'ember';   // attackers — the player's side
export const TEAM_WARDEN = 'warden'; // defenders — five bots holding the sites

export const PHASE = {
  MENU: 'menu',         // overlay up, nothing simulating
  FREEZE: 'freeze',     // buy window at round start
  LIVE: 'live',         // the round, timer running
  PLANTED: 'planted',   // spike down, its own fuse running
  OVER: 'over',         // result banner, money settling
  MATCH_END: 'matchEnd' // final overlay
};

export const G = {
  phase: PHASE.MENU,
  phaseLeft: 0,        // seconds left in the current phase (round or fuse timer)
  round: 0,            // 1-based once the first freeze starts
  roundWins: { ember: 0, warden: 0 },
  winsNeeded: 5,
  maxRounds: 9,

  player: null,        // the human combatant (agents.js builds the shape)
  agents: [],          // every combatant, player first, then bots
  bomb: null,          // match.js fills: { state, pos, carrier, site, fuseLeft, ... }

  money: 800,          // the player's wallet (bots are issued rifles for free)
  noise: [],           // { x, z, radius, team } transient events, drained by agents each step
  seenByPlayer: [],    // warden agents currently visible to the player (minimap pings)

  pendingKillfeed: [], // { killerName, killerTeam, victimName, victimTeam, headshot } drained by hud
  result: null,        // { winner, reason } set at round end for the banner
  matchOver: false,    // someone reached the wins target
  started: false,      // first deploy clicked
};

export function isCombatPhase() {
  return G.phase === PHASE.LIVE || G.phase === PHASE.PLANTED;
}

export function aliveCount(team) {
  let n = 0;
  for (const a of G.agents) if (a.team === team && a.alive) n++;
  return n;
}
