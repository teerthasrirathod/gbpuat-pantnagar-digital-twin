// A thumb stick for walking on touch screens: drag the knob, and the walker goes that way (past the edge, it runs).
// It only appears on devices whose main pointer is a finger.

export interface Joystick {
  element: HTMLElement;
  /** show or hide, for example when the view is not street level */
  setVisible(v: boolean): void;
}

export function createJoystick(parent: HTMLElement, onAxis: (forward: number, sideways: number, run: boolean) => void): Joystick | null {
  if (!window.matchMedia?.("(pointer: coarse)").matches) return null;
  const pad = document.createElement("div");
  pad.className = "stick";
  pad.setAttribute("aria-label", "Walking stick: drag to walk");
  const knob = document.createElement("div");
  knob.className = "knob";
  pad.append(knob);
  parent.append(pad);

  let id: number | null = null;
  const RADIUS = 46;
  const move = (e: PointerEvent): void => {
    const r = pad.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    const run = len > RADIUS * 1.15;
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // a small dead zone keeps the walker still when the thumb rests
    const f = Math.abs(dy) < 6 ? 0 : -dy / RADIUS;
    const s = Math.abs(dx) < 6 ? 0 : dx / RADIUS;
    onAxis(f, s, run);
  };
  const end = (): void => {
    id = null;
    knob.style.transform = "translate(0, 0)";
    onAxis(0, 0, false);
  };
  pad.addEventListener("pointerdown", (e) => {
    id = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    move(e);
    e.stopPropagation();
  });
  pad.addEventListener("pointermove", (e) => {
    if (e.pointerId === id) move(e);
  });
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointercancel", end);
  return {
    element: pad,
    setVisible(v) {
      pad.hidden = !v;
    },
  };
}
