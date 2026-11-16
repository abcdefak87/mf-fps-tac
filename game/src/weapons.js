// The arsenal. WEAPONS is the catalogue (names and prices are original); makeInstance gives a
// combatant a live gun — magazine, cooldown, reload timer — and spreadOf turns stance and
// foot speed into the cone a shot can leave in, so standing still to aim is what pays.
// Bots run the same numbers; they simply never see a viewmodel.

export const WEAPONS = {
  p9: {
    key: 'p9', name: 'P9 SIDEKICK', slot: 'sidearm', price: 0,
    damage: 28, headMul: 3.2, legMul: 0.75, interval: 0.16, auto: false,
    mag: 12, reserve: 48, reload: 1.55,
    spreadBase: 0.006, spreadMove: 0.05, recoilPitch: 0.014, recoilYaw: 0.005,
    speedMul: 1.0, loud: 40, blurb: 'Standard-issue sidearm. Honest at short range.',
  },
  wasp: {
    key: 'wasp', name: 'WASP-9', slot: 'primary', price: 1500,
    damage: 24, headMul: 2.8, legMul: 0.75, interval: 0.078, auto: true,
    mag: 32, reserve: 96, reload: 1.9,
    spreadBase: 0.008, spreadMove: 0.055, recoilPitch: 0.009, recoilYaw: 0.004,
    speedMul: 1.04, loud: 44, blurb: 'Featherweight SMG — spray up close, runs fast.',
  },
  jackal: {
    key: 'jackal', name: 'MK4 JACKAL', slot: 'primary', price: 3100,
    damage: 33, headMul: 4.0, legMul: 0.75, interval: 0.1, auto: true,
    mag: 30, reserve: 90, reload: 2.15,
    spreadBase: 0.006, spreadMove: 0.062, recoilPitch: 0.012, recoilYaw: 0.005,
    speedMul: 0.98, loud: 48, blurb: 'The workhorse rifle. Burst two, head taps for four.',
  },
  longwatch: {
    key: 'longwatch', name: 'LONGWATCH', slot: 'primary', price: 4750,
    damage: 96, headMul: 2.0, legMul: 0.8, interval: 1.45, auto: false,
    mag: 5, reserve: 15, reload: 3.1,
    spreadBase: 0.0011, spreadMove: 0.1, recoilPitch: 0.05, recoilYaw: 0.012,
    speedMul: 0.9, loud: 60, blurb: 'Bolt-action overwatch. One breath, one body. RMB scopes.',
    zoom: 3.4,
  },
};

export const GEAR = {
  frag: { key: 'frag', name: 'FRAG GRENADE', price: 300, blurb: 'Cooks off on a 1.6 s fuse. Slot 3, click to throw.' },
  armor: { key: 'armor', name: 'COMPOSITE VEST', price: 650, blurb: 'Cuts incoming damage nearly in half.' },
};

// The buy menu (1–5), in order.
export const BUY_LIST = [
  { kind: 'weapon', key: 'wasp' },
  { kind: 'weapon', key: 'jackal' },
  { kind: 'weapon', key: 'longwatch' },
  { kind: 'gear', key: 'frag' },
  { kind: 'gear', key: 'armor' },
];

export function makeInstance(key) {
  const def = WEAPONS[key];
  return { def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, triggerHeld: false };
}

export function stepWeapon(inst, dt) {
  inst.cooldown = Math.max(0, inst.cooldown - dt);
  if (inst.reloadLeft > 0) {
    inst.reloadLeft = Math.max(0, inst.reloadLeft - dt);
    if (inst.reloadLeft === 0) {
      const take = Math.min(inst.def.mag - inst.mag, inst.reserve);
      inst.mag += take;
      inst.reserve -= take;
    }
  }
}

export function readyToFire(inst) {
  return inst.cooldown === 0 && inst.reloadLeft === 0 && inst.mag > 0;
}

// Spends one round if the weapon may fire; the caller applies spread/recoil/damage.
export function fireRound(inst) {
  if (!readyToFire(inst)) return false;
  inst.mag -= 1;
  inst.cooldown = inst.def.interval;
  return true;
}

export function startReload(inst) {
  if (inst.reloadLeft > 0 || inst.mag === inst.def.mag || inst.reserve === 0) return false;
  inst.reloadLeft = inst.def.reload;
  return true;
}

// The firing cone in radians: baseline for the weapon, swollen by foot speed, eased by the
// crouch, ruined by being airborne. A scoped Longwatch is only honest when the shooter is still.
export function spreadOf(inst, moveSpeed, crouching, airborne, scoped) {
  const d = inst.def;
  const move = Math.min(1, moveSpeed / 5.0);
  let s = d.spreadBase + move * move * d.spreadMove;
  if (crouching) s *= 0.72;
  if (airborne) s += 0.06;
  if (scoped && d.zoom) s = move > 0.05 ? d.spreadMove * 0.4 : 0.0004;
  return s;
}

// What a hit is worth, by the body part the ray tagged (agents mark 'head', 'body', 'legs').
export function damageFor(def, part, dist) {
  const mul = part === 'head' ? def.headMul : part === 'legs' ? def.legMul : 1;
  const falloff = dist > 30 ? Math.max(0.6, 1 - (dist - 30) * 0.012) : 1;
  return Math.round(def.damage * mul * falloff);
}
