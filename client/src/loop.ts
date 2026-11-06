export type UpdateFn = (dt: number) => void;
export type RenderFn = (alpha: number) => void;
export type UpdateHudFn = (steps: number, frames: number, frameTime: string) => void;

export function createLoop(update: UpdateFn, render: RenderFn, updateHUD: UpdateHudFn): void {
  const dt = 1000 / 60;
  let accumulator = 0;
  let lastTime = performance.now();

  let steps = 0;
  let frames = 0;
  let lastHudTime = lastTime;

  function frame(currentTime: number): void {
    let frameTime = currentTime - lastTime;
    if (frameTime > 250) frameTime = 250;
    lastTime = currentTime;

    accumulator += frameTime;

    while (accumulator >= dt) {
      update(dt / 1000);
      accumulator -= dt;
      steps++;
    }

    const alpha = accumulator / dt;
    render(alpha);
    frames++;

    if (currentTime - lastHudTime >= 1000) {
      updateHUD(steps, frames, frameTime.toFixed(2));
      steps = 0;
      frames = 0;
      lastHudTime = currentTime;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
