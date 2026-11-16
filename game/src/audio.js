// Procedural sound, no assets: a lazy AudioContext (created on the player's first click, as
// autoplay rules demand) and a tiny synth — noise bursts through filters for gunshots and the
// explosion, square blips for the spike's beep, two-note stings for round results. Distance
// scales the gain so a fight two lanes over sounds like it.
export function createAudio() {
  let ac = null;
  let master = null;
  let noiseBuf = null;
  let unlocked = false;   // nothing sounds until the player's first gesture (autoplay rules)

  function ensure() {
    if (ac) return true;
    if (!unlocked) return false;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    ac = new Ctor();
    master = ac.createGain();
    master.gain.value = 0.32;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 1, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  const distGain = (d) => Math.max(0.02, 1 / (1 + d * d * 0.012));

  function shot(kind, dist) {
    if (!ensure()) return;
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = kind === 'longwatch' ? 700 : kind === 'p9' ? 1600 : 1100;
    bp.Q.value = 0.7;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'longwatch' ? 3000 : 5000;
    const g = ac.createGain();
    const vol = (kind === 'longwatch' ? 1.2 : kind === 'p9' ? 0.55 : 0.8) * distGain(dist);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'longwatch' ? 0.4 : 0.18));
    src.connect(bp).connect(lp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.5);
    // low thump under the crack
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(kind === 'longwatch' ? 90 : 140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const og = ac.createGain();
    og.gain.setValueAtTime(vol * 0.7, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(og).connect(master);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  function blip(freq, dur, vol, type = 'square') {
    if (!ensure()) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function sting(freqs, step, dur, vol) {
    if (!ensure()) return;
    freqs.forEach((f, i) => {
      const t = ac.currentTime + i * step;
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }

  return {
    unlock() {
      unlocked = true;
      if (ensure() && ac.state === 'suspended') ac.resume();
    },
    shot,
    dry() { blip(220, 0.05, 0.15); },
    reload() { blip(500, 0.04, 0.12); setTimeout(() => blip(380, 0.05, 0.12), 160); },
    hitmarker(kill) { blip(kill ? 660 : 880, 0.06, 0.16, 'sine'); },
    buy() { blip(920, 0.07, 0.14, 'sine'); blip(1380, 0.1, 0.1, 'sine'); },
    pin() { blip(1400, 0.04, 0.1, 'sine'); },
    beep(dist, urgency) { blip(2400, 0.05, 0.16 * distGain(dist) + urgency * 0.05); },
    plantTick() { blip(900, 0.03, 0.08, 'sine'); },
    plantDone() { sting([520, 780], 0.12, 0.3, 0.16); },
    defuse() { sting([780, 520], 0.12, 0.3, 0.14); },
    explosion(dist) {
      if (!ensure()) return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(80, t + 0.9);
      const g = ac.createGain();
      g.gain.setValueAtTime(1.3 * distGain(dist), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      src.connect(lp).connect(g).connect(master);
      src.start(t);
      src.stop(t + 1.1);
    },
    footstep(dist, slow) {
      if (dist > 14) return;
      blip(90 + Math.random() * 30, 0.03, 0.06 * distGain(dist) * (slow ? 0.3 : 1), 'sine');
    },
    roundStart() { sting([392, 523, 659], 0.09, 0.4, 0.15); },
    roundEnd(win) { sting(win ? [523, 659, 784, 1046] : [392, 330, 262], 0.11, 0.55, 0.16); },
  };
}
