# EMBERLINE — threejs-fps-01 entry notes

## Concept
CS-style tactical FPS: player attacks with 4 EMBER bot teammates vs 5 WARDEN defender bots
on an original dusk-industrial map "Foundry Docks". Bomb plant/defuse, buy menu, economy,
first to 5 rounds (max 9). Fixed-step 60Hz sim, pooled effects, single state store `G`.

## Architecture (game/src/, all ES modules, importmap "three" -> vendored 0.187.0)
- palette.js   — 6-color dusk palette + team tints (EMBER amber / WARDEN slate)
- state.js     — the one game-state store G (phase, round, money, teams, bomb, noise bus)
- input.js     — pointer lock, keys, mouse, edge-pressed helper
- collide.js   — swept AABB vs world colliders, shared by player and bots
- nav.js       — walkable grid from colliders + A* pathfinding for bots
- map.js       — Foundry Docks geometry: 2 sites + mid + 2 mains, cover, lights, minimap data
- player.js    — WASD accel/friction, crouch, jump, slow-walk, HP/armor
- weapons.js   — weapon defs (P9/Wasp/Jackal/Longwatch) + frag grenade; fire/reload/spread/recoil
- viewmodel.js — first-person gun models, sway/bob/recoil/reload dip, muzzle flash, zoom
- combat.js    — hitscan resolution vs world+agents, headshot multiplier, grenades, noise
- agents.js    — bot visuals + AI: FOV+LOS see, hear noise, routes/posts, engage, plant/defuse
- effects.js   — pooled tracers, impacts, decals, shells, explosion, death anim
- bomb.js      — folded into match.js
- match.js     — round phase machine (freeze/live/planted/over/matchEnd), economy, bomb entity
- audio.js     — procedural WebAudio sfx (shots, beeps, stings), lazy AudioContext
- hud.js       — DOM HUD: health/armor/ammo/timer/score/money, crosshair spread, killfeed,
                 minimap canvas, buy menu, scoreboard, banners, plant/defuse progress
- main.js      — boot, fixed-step loop, render, shot-mode harness (?shot=)
- shots.js     — deterministic screenshot staging (window.__game + __shotReady)

## Map layout (x east, z south; WARDEN north z<0, EMBER south z>0)
- A site x[-28,-16] z[-19,-7] (plant ~(-23,-14)); heaven door to CT lane, door to A main, hut gap to A short
- B site x[+16,+28] z[-19,-7] mirror
- mid x[-5,+5] z[-19,+14], gate wall at z=-6.3 with center gap (sniper lane)
- A short x[-16,-5] z[-13,-6], B short mirror
- A main x[-28,-19] z[-6,+19], B main mirror
- plaza x[-28,+28] z[+14,+24] (EMBER spawn center), CT lane x[-28,+28] z[-23,-19] (WARDEN spawn)
- Solids: forge block x[-19,-6]z[-6,+14], press block x[+6,+19]z[-6,+14],
  A-tower x[-16,-5]z[-19,-13], B-tower x[+5,+16]z[-19,-13]

## Screenshots (real renders via ?shot= staging, playwright capture)
1. 1-combat.png   — firefight at A door: HUD+weapon+enemy muzzle/tracer+killfeed+minimap (cover)
2. 2-buy.png      — freeze phase buy menu, money, score, timer
3. 3-planted.png  — bomb planted defense at site, beeping bomb, CT pushing in
4. 4-overview.png — high aerial over map showing lanes/sites/bots

## Rules checklist
- pointer lock look + WASD; fires/reloads/ammo-out; bots move/see/shoot; rounds end W/L + restart;
  HUD: health, ammo, timer, score ✓
- headshot x4 (legs x0.75), recoil+spread vs move speed, crouch+jump, AABB collision ✓
- bomb plant at A/B, defuse by WARDEN, money+ buy menu (5 items), 4 weapons + frag grenade,
  bots follow routes/hold posts/react to sight+sound, converge on plant, retrieve dropped bomb ✓
- original map w/ lanes/sightlines, dusk palette, canvas-texture signage, fog+key light ✓
- modules one-job, fixed 60Hz step vs render, pooled effects/no hot-loop allocs, G store ✓
- gates: vendored three byte-identical; all refs relative inside game/; no <img>/<link>;
  source text << 160KiB; 4 PNG ≤256KiB, ≤1280 long side, ≥480 short ✓

## Verification (done)
- `node main.ts` twice → byte-identical /output (dossier.json 973KB, text 150,788B ≤163,840)
- game/: 21 files ≤993, 2.28MB ≤48MiB; index.html 15KB ≤1MiB; 4 shots ≤193KB each, 1280×720
- vendored three.module.min.js + three.core.min.js md5-identical to kit starter
- playwright: menu → Deploy → freeze → live, bots path, bomb carried, zero console errors
- shot staging (?shot=combat|buy|planted|overview&seed=1): all render, __shotReady, no errors
- fixed: #buymenu/#scoreboard needed position:fixed (children of body, not #hud);
  player.body.yaw must be set explicitly in shots (place() only sets agent.yaw);
  muzzle flash quad now applies group quaternion so it tracks the barrel tip
