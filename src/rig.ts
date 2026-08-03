/**
 * Математика процедурной анимации — общая для героя и для тварей.
 *
 * Ни одного покадрового спрайта: поза целиком считается из состояния физики.
 * Скелет задан точками-суставами, конечности доводятся до цели двухзвенной IK,
 * а рисуется всё толстыми линиями с круглыми торцами — получается силуэт.
 *
 * Почему IK, а не «угол бедра = sin(фазы)»: при заданных углах стопа гуляет
 * по высоте и персонаж «плывёт» над землёй. Задавая траекторию СТОПЫ и решая
 * колено обратной задачей, мы получаем контакт с полом бесплатно.
 */

export interface Pt {
  x: number;
  y: number;
}

const TAU = Math.PI * 2;

export function pt(x: number, y: number): Pt {
  return { x, y };
}

/**
 * Двухзвенная обратная кинематика на плоскости.
 * По корню (бедро/плечо) и цели (стопа/кисть) находит средний сустав.
 *
 * `bend` = +1 / -1 — в какую сторону выгибается сустав (колено вперёд, локоть назад).
 * Если цель дальше вытянутой конечности, она подтягивается на предел: так конечность
 * распрямляется, но не рвётся.
 */
export function ik2(root: Pt, target: Pt, l1: number, l2: number, bend: number): Pt {
  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let d = Math.hypot(dx, dy);

  const max = (l1 + l2) * 0.999;
  const min = Math.abs(l1 - l2) * 1.001 + 0.001;
  if (d > max) {
    const k = max / (d || 1);
    dx *= k;
    dy *= k;
    d = max;
  } else if (d < min) {
    const k = min / (d || 1);
    dx *= k;
    dy *= k;
    d = min;
  }

  // Проекция среднего сустава на линию «корень → цель» и отступ по нормали.
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d;
  const uy = dy / d;

  return {
    x: root.x + ux * a - uy * h * bend,
    y: root.y + uy * a + ux * h * bend,
  };
}

/** Поворот точки вокруг центра — общий для наклона корпуса и разворота твари. */
export function rot(p: Pt, cx: number, cy: number, ang: number): Pt {
  const s = Math.sin(ang);
  const c = Math.cos(ang);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Экспоненциальная доводка, независимая от частоты кадров. */
export function approach(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/**
 * Траектория стопы в цикле шага, в локальных координатах бедра.
 * Возвращает смещение относительно точки покоя: вперёд-назад и вверх.
 *
 * Полцикла стопа стоит на земле и уезжает назад (опорная фаза),
 * полцикла летит вперёд по дуге (маховая). Именно этот разрыв читается
 * глазом как «шаг», а не как «болтающиеся ноги».
 */
export function stepCycle(phase: number, stride: number, lift: number): Pt {
  const p = ((phase % TAU) + TAU) % TAU;
  if (p < Math.PI) {
    // Опорная: стопа прижата к земле, тело проезжает над ней.
    const t = p / Math.PI;
    return { x: stride * (0.5 - t), y: 0 };
  }
  // Маховая: стопа поднимается и обгоняет корпус.
  const t = (p - Math.PI) / Math.PI;
  return { x: stride * (t - 0.5), y: -lift * Math.sin(t * Math.PI) };
}

// ------------------------------------------------------------------- рисование

/**
 * Конечность с утолщением к корню: бедро толще голени, плечо толще предплечья.
 * Рисуется двумя отрезками, потому что один линейный путь с переменной толщиной
 * в Canvas2D не выражается.
 */
export function limb(
  ctx: CanvasRenderingContext2D,
  a: Pt, b: Pt, c: Pt,
  wRoot: number, wTip: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.lineWidth = wRoot;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  ctx.lineWidth = wTip;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
}

/** Отрезок постоянной толщины — шея, хвост, лапа твари. */
export function bone(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, w: number): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Кривая через три точки — сгорбленный хребет, провисающий кабель, хвост. */
export function spine(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, c: Pt, w: number): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(b.x, b.y, c.x, c.y);
  ctx.stroke();
}

export function disc(ctx: CanvasRenderingContext2D, p: Pt, r: number): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, TAU);
  ctx.fill();
}

/**
 * Клин с разной шириной у концов: торс от таза к груди, пола шинели, лапа.
 *
 * Именно этим корпус отличается от «капсулы»: линия постоянной толщины с круглыми
 * торцами читается как мешок, а сужение к талии и расширение к плечам — как человек.
 */
export function taper(
  ctx: CanvasRenderingContext2D,
  a: Pt, b: Pt, wa: number, wb: number,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * wa, a.y + ny * wa);
  ctx.lineTo(b.x + nx * wb, b.y + ny * wb);
  ctx.lineTo(b.x - nx * wb, b.y - ny * wb);
  ctx.lineTo(a.x - nx * wa, a.y - ny * wa);
  ctx.closePath();
  ctx.fill();
}

