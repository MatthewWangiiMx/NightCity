import {
  CanvasTexture,
  Sprite,
  SpriteMaterial,
} from 'three';

/** Neon HUD nameplate that floats above a building. */
export function createFuturisticSign(name: string, kind = 'STRUCTURE'): Sprite {
  const w = 768;
  const h = 192;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, w, h);

  // Soft outer glow
  ctx.fillStyle = 'rgba(34, 211, 238, 0.12)';
  roundRect(ctx, 8, 8, w - 16, h - 16, 18);
  ctx.fill();

  // Panel
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(6, 18, 28, 0.92)');
  grad.addColorStop(1, 'rgba(8, 28, 40, 0.88)');
  ctx.fillStyle = grad;
  roundRect(ctx, 24, 28, w - 48, h - 56, 14);
  ctx.fill();

  // Cyan border
  ctx.strokeStyle = 'rgba(103, 232, 249, 0.95)';
  ctx.lineWidth = 3;
  roundRect(ctx, 24, 28, w - 48, h - 56, 14);
  ctx.stroke();

  // Corner brackets
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.95)';
  ctx.lineWidth = 2.5;
  bracket(ctx, 24, 28, 28);
  bracket(ctx, w - 24, 28, 28, true);
  bracket(ctx, 24, h - 28, 28, false, true);
  bracket(ctx, w - 24, h - 28, 28, true, true);

  // Kind chip
  ctx.fillStyle = 'rgba(34, 211, 238, 0.18)';
  roundRect(ctx, 44, 42, 160, 28, 6);
  ctx.fill();
  ctx.fillStyle = '#67e8f9';
  ctx.font = '600 18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(kind.toUpperCase().slice(0, 14), 56, 56);

  // Name
  ctx.fillStyle = '#e8f7ff';
  ctx.font = '700 44px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(truncate(name, 28), 44, 118);

  // Scanline accent
  ctx.fillStyle = 'rgba(125, 211, 252, 0.15)';
  ctx.fillRect(44, h - 48, w - 88, 2);

  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;

  const mat = new SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0.96,
  });
  const sprite = new Sprite(mat);
  sprite.scale.set(42, 10.5, 1);
  sprite.userData.baseScale = { x: 42, y: 10.5 };
  return sprite;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bracket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  flipX = false,
  flipY = false,
) {
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(x, y + sy * len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + sx * len, y);
  ctx.stroke();
}
