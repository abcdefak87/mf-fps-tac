// Keyboard and mouse, and the pointer lock that turns the mouse into look. Plain browser
// APIs only: the game asks the canvas for pointer lock and reads movementX/Y while it holds
// it. Edge presses (keydown this frame) live in `pressed` so systems poll instead of listening.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = {
    keys,
    pressed: new Set(),   // codes that went down since the last frame — cleared by takeLook()
    locked: false,
    firing: false,        // LMB held
    firingPressed: false, // LMB went down this frame (semi-auto weapons)
    scoped: false,        // RMB held — Longwatch scope
    lookX: 0,
    lookY: 0,
  };

  function setKey(event, down) {
    if (down) {
      if (!keys.has(event.code)) state.pressed.add(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => { keys.clear(); state.firing = false; state.scoped = false; });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) { state.firing = true; state.firingPressed = true; }
    if (event.button === 2) state.scoped = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.scoped = false;
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.scoped = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    // Drains the per-frame look delta and the firingPressed edge. Called once a frame; the
    // pressed set is cleared by endFrame() once every system has polled it.
    takeLook() {
      const out = { x: state.lookX, y: state.lookY, firingPressed: state.firingPressed };
      state.lookX = 0;
      state.lookY = 0;
      state.firingPressed = false;
      return out;
    },
    endFrame() {
      state.pressed.clear();
    },
  };
}
