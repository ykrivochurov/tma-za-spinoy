/**
 * Постобработка кадра: свечение, плёночное зерно, помехи от фона.
 *
 * Самый дешёвый способ купить «дорогую» картинку. Ни один из трёх эффектов
 * не знает про игру — они работают с готовым кадром, поэтому включаются
 * и выключаются целиком, не задевая ни физику, ни рендер мира.
 *
 * Зерно берётся из заранее сгенерированных плиток шума и циклится: считать
 * случайные пиксели каждый кадр — самый простой способ уронить fps на ровном месте.
 */

import { POST_BLOOM, POST_BLOOM_BLUR, POST_GRAIN } from './tuning';

const GRAIN_TILES = 4;
const GRAIN_SIZE = 96;

let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;
const grain: HTMLCanvasElement[] = [];

/** Плитки зерна детерминированы — иначе каждый перезапуск шумит по-своему. */
function buildGrain(): void {
  let s = 0x9e3779b9;
  const rand = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = 0; i < GRAIN_TILES; i++) {
    const cv = document.createElement('canvas');
    cv.width = GRAIN_SIZE;
    cv.height = GRAIN_SIZE;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(GRAIN_SIZE, GRAIN_SIZE);
    for (let p = 0; p < img.data.length; p += 4) {
      const v = rand();
      // Редкие яркие крупицы поверх ровного слабого шума — так зерно
      // читается как плёнка, а не как равномерная серая пыль.
      const lum = v > 0.985 ? 255 : v * 90;
      img.data[p] = lum;
      img.data[p + 1] = lum;
      img.data[p + 2] = lum;
      img.data[p + 3] = v > 0.985 ? 150 : 40;
    }
    c.putImageData(img, 0, 0);
    grain.push(cv);
  }
}

function ensure(w: number, h: number): void {
  if (!grain.length) buildGrain();
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratchCtx = scratch.getContext('2d')!;
  }
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
}

/**
 * Применяется к готовому кадру ДО интерфейса: текст и дозиметр должны
 * остаться резкими, иначе игра выглядит расфокусированной, а не атмосферной.
 *
 * `rad` (0..1) подмешивает помехи: чем выше набранный фон, тем сильнее рябь.
 */
export function applyPost(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frame: number,
  rad: number,
): void {
  const w = canvas.width;
  const h = canvas.height;
  ensure(w, h);
  const sc = scratchCtx!;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // --- свечение: размытая копия кадра, наложенная аддитивно.
  //     Светятся только и без того яркие места — фонарь, лампы, арматура.
  if (POST_BLOOM > 0) {
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, w, h);
    sc.filter = `blur(${POST_BLOOM_BLUR}px)`;
    sc.drawImage(canvas, 0, 0);
    sc.filter = 'none';

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = POST_BLOOM;
    ctx.drawImage(scratch!, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  // --- зерно: плитка шума, меняющаяся каждый кадр и сдвигаемая по обеим осям
  const g = grain[frame % GRAIN_TILES];
  const ox = (frame * 37) % GRAIN_SIZE;
  const oy = (frame * 53) % GRAIN_SIZE;
  ctx.globalAlpha = POST_GRAIN + rad * 0.1;
  ctx.globalCompositeOperation = 'lighter';
  for (let y = -oy; y < h; y += GRAIN_SIZE) {
    for (let x = -ox; x < w; x += GRAIN_SIZE) {
      ctx.drawImage(g, x, y);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // --- помехи от фона: горизонтальные разрывы строк, как на убитой плёнке
  if (rad > 0.02) {
    ctx.globalAlpha = rad * 0.4;
    ctx.fillStyle = '#7fd94a';
    const lines = Math.floor(40 * rad);
    for (let i = 0; i < lines; i++) {
      // Псевдослучайно, но детерминированно по кадру: рябь дёргается, а не кипит.
      const k = (i * 2654435761 + frame * 40503) >>> 0;
      const y = (k % h) | 0;
      const x = ((k >>> 8) % w) | 0;
      const len = 4 + ((k >>> 16) % 40);
      ctx.fillRect(x, y, len, 1);
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}
