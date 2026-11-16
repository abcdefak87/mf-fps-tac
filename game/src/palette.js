// The look plan, in one place. Six base colours and two team tints; the same names are the
// CSS custom properties in index.html, so the HUD and the world share one palette and no
// other colour appears anywhere. Dusk-industrial: cold blue-grey masses, warm ember light.
export const PALETTE = {
  canvas: '#10131a',   // night-sky base, deepest shadow
  surface: '#191f2a',  // concrete / steel masses
  hairline: '#2a3140', // edges, crates, trim
  ink: '#ece7db',      // light paint, signs, HUD text
  muted: '#8f99a8',    // dust, distant fill
  accent: '#ff9e3d',   // the setting sun, muzzle fire, EMBER light
  ember: '#ffb14e',    // attackers
  warden: '#5ec8f2',   // defenders
  danger: '#ff5348',   // damage, timers running out
};

// Sky gradient stops for the dusk dome (top to horizon).
export const SKY_TOP = '#1a2233';
export const SKY_HORIZON = '#c96a35';
