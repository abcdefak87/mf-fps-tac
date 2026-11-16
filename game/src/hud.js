// The DOM HUD: health and armour bars, the ammo readout, round timer and team scores, money,
// a live minimap drawn from the map's own floor plan, the kill feed, the buy menu, the
// scoreboard, banners and the plant ring. hud.update pulls everything from the G store each
// frame and writes the DOM only when a value actually changed.
import { G, PHASE, TEAM_EMBER, TEAM_WARDEN, aliveCount } from './state.js';
import { BUY_LIST, WEAPONS, GEAR } from './weapons.js';
import { PALETTE } from './palette.js';

const $ = (id) => document.getElementById(id);

export function createHud(world, hooks) {
  const el = {
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), dmgflash: $('dmgflash'),
    timer: $('timer'), phaseLabel: $('phase-label'),
    scoreEmber: $('score-ember'), scoreWarden: $('score-warden'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    hpfill: $('hpfill'), hpnum: $('hpnum'), arfill: $('arfill'), arnum: $('arnum'), money: $('money'),
    ammoName: $('ammo-name'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'),
    slots: [$('slot-1'), $('slot-2'), $('slot-3')],
    minimap: $('minimap'), feed: $('feed'),
    channel: $('channel'), channelRing: $('channel-ring'), channelText: $('channel-text'),
    spectate: $('spectate'), spectateName: $('spectate-name'), hint: $('hint'),
    buymenu: $('buymenu'), buyclock: $('buyclock'), buyfunds: $('buyfunds'), buyrows: $('buyrows'),
    scoreboard: $('scoreboard'), sbTable: $('sb-table'), sbTitle: $('sb-title'),
    overlay: $('overlay'), overlayKicker: $('overlay-kicker'), overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'), play: $('play'),
  };

  // ------------------------------------------------------------ minimap base
  // The floor plan drawn once to an offscreen canvas: districts light, walls ink.
  const mapScale = 336 / 64;
  const mapOff = { x: 32, z: 24 };
  const mm = el.minimap.getContext('2d');
  const base = document.createElement('canvas');
  base.width = 336; base.height = 252;
  {
    const b = base.getContext('2d');
    b.fillStyle = '#141a24';
    b.fillRect(0, 0, 336, 252);
    b.fillStyle = '#232c3b';
    for (const [x0, z0, x1, z1] of world.mini.floors) {
      b.fillRect((x0 + mapOff.x) * mapScale, (z0 + mapOff.z) * mapScale, (x1 - x0) * mapScale, (z1 - z0) * mapScale);
    }
    b.fillStyle = '#0c0f15';
    for (const [x0, z0, x1, z1] of world.mini.walls) {
      b.fillRect((x0 + mapOff.x) * mapScale, (z0 + mapOff.z) * mapScale, (x1 - x0) * mapScale, (z1 - z0) * mapScale);
    }
    b.strokeStyle = PALETTE.accent;
    b.setLineDash([4, 3]);
    for (const s of world.mini.sites) {
      b.beginPath();
      b.arc((s.x + mapOff.x) * mapScale, (s.z + mapOff.z) * mapScale, s.r * mapScale, 0, 6.3);
      b.stroke();
    }
    b.setLineDash([]);
    b.font = '600 15px system-ui';
    b.textAlign = 'center';
    b.fillStyle = PALETTE.accent;
    b.fillText('A', (-23 + mapOff.x) * mapScale, (-14 + mapOff.z) * mapScale - 12);
    b.fillStyle = PALETTE.warden;
    b.fillText('B', (23 + mapOff.x) * mapScale, (-14 + mapOff.z) * mapScale - 12);
  }
  const px = (x) => (x + mapOff.x) * mapScale;
  const pz = (z) => (z + mapOff.z) * mapScale;
  let mmTick = 0;

  function drawMinimap() {
    mm.clearRect(0, 0, 336, 252);
    mm.drawImage(base, 0, 0);
    for (const a of G.agents) {
      if (!a.alive) continue;
      if (a.isPlayer) {
        // the player: a wedge pointing where they look
        mm.save();
        mm.translate(px(a.body.position.x), pz(a.body.position.z));
        mm.rotate(-a.yaw + Math.PI);
        mm.fillStyle = PALETTE.ink;
        mm.beginPath();
        mm.moveTo(0, -7); mm.lineTo(4.4, 5); mm.lineTo(-4.4, 5);
        mm.fill();
        mm.restore();
      } else if (a.team === TEAM_EMBER) {
        mm.fillStyle = PALETTE.ember;
        mm.beginPath();
        mm.arc(px(a.body.position.x), pz(a.body.position.z), 4, 0, 6.3);
        mm.fill();
      } else if (hooks.enemyVisible(a)) {
        mm.fillStyle = PALETTE.danger;
        mm.beginPath();
        mm.arc(px(a.body.position.x), pz(a.body.position.z), 4, 0, 6.3);
        mm.fill();
      }
    }
    if (G.bomb && (G.bomb.state === 'dropped' || G.bomb.state === 'planted')) {
      mm.fillStyle = PALETTE.accent;
      mm.fillRect(px(G.bomb.pos.x) - 4, pz(G.bomb.pos.z) - 4, 8, 8);
    }
  }

  // ------------------------------------------------------------ buy menu
  const buyRows = [];
  BUY_LIST.forEach((item, i) => {
    const def = item.kind === 'weapon' ? WEAPONS[item.key] : GEAR[item.key];
    const row = document.createElement('div');
    row.className = 'buyrow';
    row.innerHTML = `<kbd>${i + 1}</kbd><span class="wn">${def.name}</span><span class="wd">${def.blurb}</span><span class="wp">$${def.price}</span>`;
    el.buyrows.appendChild(row);
    buyRows.push({ row, item, def });
  });

  function refreshBuy() {
    const p = G.player;
    buyRows.forEach(({ row, item, def }) => {
      const owned = item.kind === 'weapon' && p.primaryKey === item.key;
      const afford = G.money >= def.price;
      row.classList.toggle('cant', !afford && !owned);
      row.classList.toggle('owned', !!owned);
      row.querySelector('.wp').textContent = owned ? 'OWNED' : `$${def.price}`;
    });
    el.buyfunds.textContent = `$${G.money}`;
    el.buyclock.textContent = `0:0${Math.max(0, Math.ceil(G.phaseLeft))}`;
  }

  function tryBuy(index) {
    const entry = buyRows[index];
    if (!entry || G.phase !== PHASE.FREEZE) return false;
    const { item, def } = entry;
    const p = G.player;
    if (G.money < def.price) return false;
    if (item.kind === 'weapon') {
      if (p.primaryKey === item.key) return false;
      G.money -= def.price;
      p.primaryKey = item.key;
      hooks.equipPrimary(item.key);
    } else if (item.key === 'frag') {
      if (p.grenades >= 2) return false;
      G.money -= def.price;
      p.grenades += 1;
    } else if (item.key === 'armor') {
      if (p.armor >= 100) return false;
      G.money -= def.price;
      p.armor = 100;
    }
    entry.row.classList.add('flash');
    setTimeout(() => entry.row.classList.remove('flash'), 220);
    refreshBuy();
    return true;
  }

  // ------------------------------------------------------------ scoreboard
  function drawScoreboard() {
    el.sbTitle.textContent = `ROUND ${G.round} — EMBER ${G.roundWins.ember} : ${G.roundWins.warden} WARDEN`;
    let html = '<tr><th>PLAYER</th><th class="r">K</th><th class="r">D</th><th>STATUS</th></tr>';
    for (const team of [TEAM_EMBER, TEAM_WARDEN]) {
      for (const a of G.agents) {
        if (a.team !== team) continue;
        const cls = `${a.isPlayer ? 'me ' : ''}${team}${a.alive ? '' : ' dead'}`;
        const status = a.alive ? 'in play' : 'down';
        html += `<tr class="${cls}"><td>${a.name}</td><td class="r">${a.stats.kills}</td><td class="r">${a.stats.deaths}</td><td>${status}</td></tr>`;
      }
    }
    el.sbTable.innerHTML = html;
  }

  // ------------------------------------------------------------ misc widgets
  let hitTimer = 0;
  let bannerTimer = null;
  const last = { hp: -1, ar: -1, money: -1, mag: -1, res: -1, timer: '', phase: '', se: -1, sw: -1, name: '', gap: -1 };

  const PHASE_TEXT = {
    freeze: 'buy phase — spend or save',
    live: 'spike on you — take a site',
    planted: 'the spike burns — hold the site',
    over: '',
    matchEnd: '',
    menu: '',
  };

  return {
    tryBuy,
    refreshBuy,

    setBuyVisible(v) {
      el.buymenu.classList.toggle('show', v);
      if (v) refreshBuy();
    },
    buyVisible() { return el.buymenu.classList.contains('show'); },

    setScoreboard(v) {
      el.scoreboard.classList.toggle('show', v);
      if (v) drawScoreboard();
    },

    banner(title, sub, cls = 'info', hold = 2400) {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub;
      el.banner.className = `show ${cls}`;
      clearTimeout(bannerTimer);
      if (hold > 0) bannerTimer = setTimeout(() => el.banner.classList.remove('show'), hold);
    },
    bannerOff() { el.banner.classList.remove('show'); },

    hitMarker(killed) {
      el.hitmarker.classList.remove('off');
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        el.hitmarker.classList.add('off');
        el.hitmarker.classList.remove('on', 'kill');
      }, 110);
    },

    damageFlash() {
      el.dmgflash.style.opacity = 1;
    },

    feed(entry) {
      const div = document.createElement('div');
      const k = `<span class="${entry.killerTeam}${entry.killerName === 'YOU' ? ' you' : ''}">${entry.killerName}</span>`;
      const v = `<span class="${entry.victimTeam}">${entry.victimName}</span>`;
      div.innerHTML = `${k} ${entry.headshot ? '◈' : '▸'} ${v}`;
      el.feed.prepend(div);
      while (el.feed.children.length > 5) el.feed.lastChild.remove();
      setTimeout(() => div.remove(), 5200);
    },

    hint(text) {
      el.hint.innerHTML = text;
    },

    spectate(name) {
      el.spectate.classList.toggle('show', !!name);
      if (name) el.spectateName.textContent = name;
    },

    showOverlay(mode, data) {
      const copy = {
        start: ['tactical fps · single-player vs bots', 'EMBERLINE',
          'Dusk on the Foundry Docks. You are <b>EMBER</b>: carry the spike into site A or B, plant it, and hold until it burns — or wipe the <b>WARDEN</b> watch. Buy between rounds, stand still to shoot straight, and listen: the bots do.', 'Deploy — round 1'],
        paused: ['paused', 'EMBERLINE', 'Pointer lock released. Click to pick the rifle back up.', 'Resume'],
        matchEnd: ['match over', data?.won ? 'EMBER TAKES THE DOCK' : 'THE DOCK HOLDS',
          `${data?.won ? 'Your squad burned it down.' : 'Warden held the line.'} Final score <b>EMBER ${G.roundWins.ember} : ${G.roundWins.warden} WARDEN</b> across ${G.round} rounds.`,
          'Run it back'],
      }[mode];
      el.overlayKicker.textContent = copy[0];
      el.overlayTitle.textContent = copy[1];
      el.overlayCopy.innerHTML = copy[2];
      el.play.textContent = copy[3];
      el.overlay.hidden = false;
    },
    hideOverlay() { el.overlay.hidden = true; },
    onPlay(handler) { el.play.addEventListener('click', handler); },

    setCrosshair(spreadPx) {
      const gap = Math.round(4 + spreadPx);
      if (gap === last.gap) return;
      last.gap = gap;
      el.crosshair.style.setProperty('--gap', `${gap}px`);
    },

    // The per-frame pull from G. DOM writes happen only on change.
    update(dt, spreadPx) {
      const p = G.player;
      if (!p) return;
      // vitals
      const hp = Math.max(0, Math.ceil(p.health));
      if (hp !== last.hp) {
        last.hp = hp;
        el.hpnum.textContent = hp;
        el.hpfill.style.width = `${Math.max(0, hp)}%`;
        el.hpfill.classList.toggle('low', hp <= 30);
      }
      const ar = Math.ceil(p.armor);
      if (ar !== last.ar) {
        last.ar = ar;
        el.arnum.textContent = ar;
        el.arfill.style.width = `${Math.min(100, ar)}%`;
      }
      if (G.money !== last.money) {
        last.money = G.money;
        el.money.textContent = String(G.money);
        if (el.buymenu.classList.contains('show')) refreshBuy();
      }
      // ammo
      const w = p.weapon;
      if (w.def.name !== last.name) { last.name = w.def.name; el.ammoName.textContent = w.def.name; }
      if (w.mag !== last.mag) {
        last.mag = w.mag;
        el.ammoMag.textContent = w.mag;
        el.ammoMag.className = w.mag === 0 ? 'dry' : w.mag <= w.def.mag * 0.25 ? 'low' : '';
        el.ammoMag.id = 'ammo-mag';
      }
      if (w.reserve !== last.res) { last.res = w.reserve; el.ammoRes.textContent = `/ ${w.reserve}`; }
      // slots: 1 primary, 2 sidearm, 3 frag
      const slotText = [p.primaryKey ? WEAPONS[p.primaryKey].name.split(' ')[0] : '—', 'P9', p.grenades > 0 ? `×${p.grenades}` : '—'];
      for (let i = 0; i < 3; i++) {
        const t = `${i + 1} ${slotText[i]}`;
        if (el.slots[i].textContent !== t) el.slots[i].textContent = t;
        el.slots[i].classList.toggle('on', p.slotIndex === i);
      }
      // timer + score
      const t = Math.max(0, G.phaseLeft);
      const timerText = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      if (timerText !== last.timer) {
        last.timer = timerText;
        el.timer.textContent = timerText;
        el.timer.classList.toggle('hot', G.phase === PHASE.PLANTED || (G.phase === PHASE.LIVE && t < 15));
      }
      if (G.roundWins.ember !== last.se) { last.se = G.roundWins.ember; el.scoreEmber.textContent = G.roundWins.ember; }
      if (G.roundWins.warden !== last.sw) { last.sw = G.roundWins.warden; el.scoreWarden.textContent = G.roundWins.warden; }
      const phaseText = PHASE_TEXT[G.phase] ?? '';
      if (phaseText !== last.phase) { last.phase = phaseText; el.phaseLabel.textContent = phaseText; }
      // crosshair
      this.setCrosshair(spreadPx);
      // plant channel ring
      const prog = G.bomb ? G.bomb.plantProgress : 0;
      el.channel.classList.toggle('show', prog > 0.01);
      if (prog > 0.01) {
        el.channelRing.style.strokeDashoffset = String(163.4 * (1 - prog));
        el.channelText.textContent = 'planting the spike';
      }
      // damage vignette fade
      const cur = parseFloat(el.dmgflash.style.opacity || '0');
      if (cur > 0) el.dmgflash.style.opacity = Math.max(0, cur - dt * 2.4);
      // feed + minimap cadence
      while (G.pendingKillfeed.length) this.feed(G.pendingKillfeed.shift());
      mmTick -= dt;
      if (mmTick <= 0) { mmTick = 0.12; drawMinimap(); }
      if (el.buymenu.classList.contains('show')) el.buyclock.textContent = `0:0${Math.max(0, Math.ceil(G.phaseLeft))}`;
    },
  };
}
