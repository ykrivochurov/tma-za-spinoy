/**
 * Пул частиц фиксированного размера — никаких аллокаций в игровом цикле.
 */

const MAX = 512;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  drag: number;
  gravity: number;
  color: string;
  square: boolean;
}

const pool: Particle[] = Array.from({ length: MAX }, () => ({
  x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, drag: 0, gravity: 0,
  color: '#fff', square: false,
}));
let cursor = 0;

function spawn(): Particle {
  // Кольцевой буфер: самые старые частицы вытесняются, счётчик никогда не переполняется.
  const p = pool[cursor];
  cursor = (cursor + 1) % MAX;
  return p;
}

export function burst(
  x: number, y: number, count: number,
  opts: { speed?: number; spread?: number; angle?: number; life?: number; size?: number;
          color?: string; gravity?: number; drag?: number; square?: boolean } = {},
): void {
  const speed = opts.speed ?? 120;
  const spread = opts.spread ?? Math.PI * 2;
  const angle = opts.angle ?? 0;
  const life = opts.life ?? 0.4;

  for (let i = 0; i < count; i++) {
    const p = spawn();
    const a = angle + (Math.random() - 0.5) * spread;
    const s = speed * (0.4 + Math.random() * 0.6);
    p.x = x;
    p.y = y;
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
    p.maxLife = life * (0.6 + Math.random() * 0.7);
    p.life = p.maxLife;
    p.size = opts.size ?? 2.5;
    p.color = opts.color ?? '#ffffff';
    p.gravity = opts.gravity ?? 0;
    p.drag = opts.drag ?? 3;
    p.square = opts.square ?? true;
  }
}

export function updateParticles(dt: number): void {
  for (const p of pool) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.vx -= p.vx * p.drag * dt;
    p.vy -= p.vy * p.drag * dt;
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

export function drawParticles(ctx: CanvasRenderingContext2D): void {
  for (const p of pool) {
    if (p.life <= 0) continue;
    const t = p.life / p.maxLife;
    ctx.globalAlpha = Math.min(1, t * 1.6);
    ctx.fillStyle = p.color;
    const s = p.size * (0.35 + t * 0.65);
    if (p.square) {
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export function clearParticles(): void {
  for (const p of pool) p.life = 0;
}
