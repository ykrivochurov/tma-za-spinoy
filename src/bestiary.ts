/**
 * Бестиарий: три твари, у каждой свой силуэт и своя пластика.
 *
 * Как и герой, они не хранят ни одного кадра — поза считается из `phase`,
 * `facing` и `pitch`, которые ведёт `entities.ts`. Разными их делает не только
 * рисунок: множители повадки живут в `CREATURE_KINDS` в tuning.ts, так что
 * «горбун тяжелее» — это одновременно и про картинку, и про правила.
 *
 * Во тьме от любой твари видно только глаза: рисунок тела идёт лишь в `lit`-проходе.
 */

import { CREATURE_KINDS } from './tuning';
import { bone, disc, ik2, limb, pt, spine, type Pt } from './rig';
import { COLORS } from './palette';
import type { Creature } from './entities';

export function drawCreature(ctx: CanvasRenderingContext2D, c: Creature, lit: boolean): void {
  if (c.gone) return;

  // Ожог 0..1. Он рисуется ВСЕГДА, даже в тёмном проходе: игрок обязан видеть,
  // что луч работает, иначе непонятно, добиваешь ты тварь или зря светишь.
  const heat = Math.min(1, c.burn / CREATURE_KINDS[c.kind].hp);

  if (lit || heat > 0.05 || c.dying > 0) {
    ctx.save();
    ctx.globalAlpha = c.alpha * (lit ? 1 : Math.max(heat, c.dying > 0 ? 1 : 0));
    // Раскаляется от собственной породы к белому: сначала тлеет, потом слепит.
    ctx.strokeStyle = heat > 0 ? mixHeat(heat) : COLORS.creature;
    ctx.fillStyle = ctx.strokeStyle;
    if (heat > 0.15) {
      ctx.shadowColor = COLORS.creatureEye;
      ctx.shadowBlur = 3 + heat * 12;
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (c.kind === 'brute') drawBrute(ctx, c);
    else if (c.kind === 'bat') drawBat(ctx, c);
    else drawGhoul(ctx, c);

    ctx.restore();
  }

  if (c.dying <= 0) drawEyes(ctx, c, lit);
}

/** Цвет тела по мере прогорания: тёмная порода → уголь → раскалённое. */
function mixHeat(t: number): string {
  const from = [28, 36, 57];
  const to = [255, 196, 128];
  const c = from.map((v, i) => Math.round(v + (to[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Глаза горят всегда — единственное, что выдаёт тварь в темноте. */
function drawEyes(ctx: CanvasRenderingContext2D, c: Creature, lit: boolean): void {
  const f = c.facing >= 0 ? 1 : -1;
  const h = headPoint(c);
  const s = lit ? 1.7 : 2.3;
  const gap = c.kind === 'brute' ? 2.6 : c.kind === 'bat' ? 1.7 : 2.2;

  ctx.save();
  if (lit) {
    ctx.shadowColor = COLORS.creatureEye;
    ctx.shadowBlur = 6;
  }
  ctx.fillStyle = COLORS.creatureEye;
  // Ближний глаз крупнее дальнего: пара одинаковых точек читается как «морда в упор».
  ctx.fillRect(h.x + f * gap * 0.9 - s / 2, h.y - s / 2, s, s);
  ctx.globalAlpha *= 0.6;
  ctx.fillRect(h.x - f * gap * 0.2 - s * 0.4, h.y - s * 0.4, s * 0.8, s * 0.8);
  ctx.restore();
}

/** Где у твари голова — нужно и глазам, и разным позам. */
function headPoint(c: Creature): Pt {
  const f = c.facing >= 0 ? 1 : -1;
  const breathe = Math.sin(c.phase * 0.5) * 0.6;
  if (c.kind === 'brute') return pt(c.x + f * 6.5, c.y - 1.5 + breathe);
  if (c.kind === 'bat') return pt(c.x + f * 3.4, c.y + c.pitch * 2.0);
  return pt(c.x + f * 7.5, c.y - 2.0 + breathe + c.pitch * 1.5);
}

// ------------------------------------------------------------------------ упырь

/**
 * Упырь: вытянутый, суставчатый, идёт на четырёх. Длинные передние лапы
 * загребают воздух впереди корпуса — отсюда ощущение, что он не бежит, а лезет.
 */
function drawGhoul(ctx: CanvasRenderingContext2D, c: Creature): void {
  const f = c.facing >= 0 ? 1 : -1;
  const p = c.phase;
  const head = headPoint(c);

  const pelvis = pt(c.x - f * 6.0, c.y + 1.0 + c.pitch * 1.2);
  const withers = pt(c.x + f * 3.0, c.y - 3.4 + c.pitch * 1.4);

  // Хребет горбом: одна дуга задаёт всю осанку.
  spine(ctx, pelvis, pt(c.x - f * 1.0, c.y - 6.4), withers, 4.6);
  bone(ctx, withers, head, 3.0);

  // Четыре конечности, диагональными парами — походка, а не шевеление.
  const gait = [0, Math.PI, Math.PI * 0.6, Math.PI * 1.6];
  const roots = [withers, withers, pelvis, pelvis];
  const reach = [8.5, 8.5, 6.5, 6.5];
  const side = [1, -1, 1, -1];

  for (let i = 0; i < 4; i++) {
    const a = p + gait[i];
    const swing = Math.sin(a);
    const lift = Math.max(0, Math.cos(a));
    const root = roots[i];
    const far = side[i] < 0;

    const target = pt(
      root.x + f * (reach[i] * 0.55 + swing * 4.2),
      root.y + 8.0 - lift * 4.6,
    );
    const l1 = i < 2 ? 5.4 : 4.6;
    const l2 = i < 2 ? 5.6 : 4.8;
    const joint = ik2(root, target, l1, l2, i < 2 ? (f > 0 ? 1 : -1) : (f > 0 ? -1 : 1));

    ctx.globalAlpha = far ? c.alpha * 0.5 : c.alpha;
    limb(ctx, root, joint, target, i < 2 ? 2.2 : 2.6, 1.5);
  }
  ctx.globalAlpha = c.alpha;

  // Голова-клин: узкая морда вперёд.
  ctx.beginPath();
  ctx.moveTo(head.x - f * 3.0, head.y - 2.4);
  ctx.lineTo(head.x + f * 3.6, head.y + 0.2);
  ctx.lineTo(head.x - f * 3.0, head.y + 2.4);
  ctx.closePath();
  ctx.fill();

  // Кромка хребта: единственная светлая линия на всей твари.
  ctx.strokeStyle = COLORS.creatureRim;
  ctx.globalAlpha = c.alpha * 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pelvis.x, pelvis.y - 2.2);
  ctx.quadraticCurveTo(c.x - f * 1.0, c.y - 8.6, withers.x, withers.y - 2.0);
  ctx.lineTo(head.x - f * 1.0, head.y - 2.0);
  ctx.stroke();
}

// ----------------------------------------------------------------------- горбун

/**
 * Горбун: массивный, с огромной спиной и короткими ногами. Руки волочатся
 * почти по земле. Раскачивается медленно и всем телом — противоположность упырю.
 */
function drawBrute(ctx: CanvasRenderingContext2D, c: Creature): void {
  const f = c.facing >= 0 ? 1 : -1;
  const p = c.phase;
  const sway = Math.sin(p) * 1.6;
  const head = headPoint(c);

  const pelvis = pt(c.x - f * 4.5 + sway * 0.4, c.y + 3.0);
  const hump = pt(c.x - f * 1.0, c.y - 7.5);
  const shoulder = pt(c.x + f * 3.2, c.y - 3.0 + sway * 0.5);

  // Горб — сплошная масса, а не линия: это главный опознавательный знак вида.
  ctx.beginPath();
  ctx.moveTo(pelvis.x, pelvis.y);
  ctx.quadraticCurveTo(hump.x - f * 3.0, hump.y - 2.0, hump.x + f * 2.0, hump.y);
  ctx.quadraticCurveTo(shoulder.x + f * 3.0, shoulder.y - 2.0, shoulder.x + f * 1.5, shoulder.y + 2.5);
  ctx.quadraticCurveTo(c.x, c.y + 4.0, pelvis.x, pelvis.y);
  ctx.fill();

  bone(ctx, shoulder, head, 4.2);

  // Ноги: короткие, широко расставленные, шаг тяжёлый и редкий.
  for (let i = 0; i < 2; i++) {
    const a = p + i * Math.PI;
    const swing = Math.sin(a) * 2.6;
    const lift = Math.max(0, Math.cos(a)) * 2.0;
    const hip = pt(pelvis.x + f * (i === 0 ? 1.2 : -1.2), pelvis.y);
    const foot = pt(hip.x + f * swing, hip.y + 8.5 - lift);
    const knee = ik2(hip, foot, 4.6, 4.8, f > 0 ? -1 : 1);
    ctx.globalAlpha = i === 1 ? c.alpha * 0.5 : c.alpha;
    limb(ctx, hip, knee, foot, 4.0, 3.0);
  }

  // Руки: длиннее ног, идут маятником в противофазе, кисти почти у пола.
  for (let i = 0; i < 2; i++) {
    const a = p + i * Math.PI + Math.PI;
    const swing = Math.sin(a) * 4.0;
    const sh = pt(shoulder.x + f * (i === 0 ? 1.0 : -1.6), shoulder.y + 0.5);
    const hand = pt(sh.x + f * (2.0 + swing), sh.y + 10.5 - Math.abs(swing) * 0.3);
    const elbow = ik2(sh, hand, 5.6, 5.8, f > 0 ? 1 : -1);
    ctx.globalAlpha = i === 1 ? c.alpha * 0.5 : c.alpha;
    limb(ctx, sh, elbow, hand, 3.4, 2.4);
    // Кисть-култышка: без неё длинная рука выглядит обрубленной.
    disc(ctx, hand, 1.8);
  }
  ctx.globalAlpha = c.alpha;

  // Голова вжата в плечи — почти без шеи.
  disc(ctx, head, 3.2);

  // Кромка горба — то, по чему горбуна узнаёшь раньше, чем разглядишь.
  ctx.strokeStyle = COLORS.creatureRim;
  ctx.globalAlpha = c.alpha * 0.5;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(pelvis.x, pelvis.y - 1.0);
  ctx.quadraticCurveTo(hump.x - f * 3.0, hump.y - 2.6, hump.x + f * 2.0, hump.y - 0.6);
  ctx.quadraticCurveTo(shoulder.x + f * 2.6, shoulder.y - 2.4, head.x - f * 1.6, head.y - 2.4);
  ctx.stroke();
}

// --------------------------------------------------------------------- нетопырь

/**
 * Нетопырь: тело-веретено и перепончатые крылья. Читаемость даёт не тело,
 * а размах и частота взмаха, поэтому крыло рисуется заливкой с «пальцами».
 */
function drawBat(ctx: CanvasRenderingContext2D, c: Creature): void {
  const f = c.facing >= 0 ? 1 : -1;
  const flap = Math.sin(c.phase);
  const body = pt(c.x, c.y + c.pitch * 1.2);
  const head = headPoint(c);
  const tail = pt(body.x - f * 5.5, body.y + 2.2 - flap * 1.0);

  // Крылья: ближнее раскрыто шире дальнего — иначе силуэт плоский, как бабочка.
  for (const near of [false, true]) {
    const k = near ? 1 : 0.72;
    const up = flap * (near ? 1 : 0.85);
    ctx.globalAlpha = near ? c.alpha : c.alpha * 0.45;

    const shoulder = pt(body.x + f * 0.5, body.y - 1.0);
    const tip = pt(shoulder.x - f * 10.5 * k, shoulder.y - up * 9.5 * k - 1.5);
    const mid = pt(shoulder.x - f * 4.5 * k, shoulder.y - up * 5.0 * k - 4.0 * k);

    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.quadraticCurveTo(mid.x, mid.y - 2.0, tip.x, tip.y);
    // Задняя кромка провисает — так перепонка читается как ткань, а не как лопасть.
    ctx.quadraticCurveTo(
      shoulder.x - f * 5.5 * k, shoulder.y - up * 2.0 + 4.5,
      shoulder.x, shoulder.y + 1.5,
    );
    ctx.closePath();
    ctx.fill();

    // Пальцы-рёбра перепонки.
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(mid.x - f * 1.0, mid.y + 3.5);
    ctx.stroke();

    // Передняя кромка ближнего крыла ловит луч — по ней и читается взмах.
    if (near) {
      ctx.strokeStyle = COLORS.creatureRim;
      ctx.globalAlpha = c.alpha * 0.6;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.quadraticCurveTo(mid.x, mid.y - 2.0, tip.x, tip.y);
      ctx.stroke();
      ctx.strokeStyle = COLORS.creature;
      ctx.globalAlpha = c.alpha;
    }
  }
  ctx.globalAlpha = c.alpha;

  // Тело-веретено и короткий хвост.
  spine(ctx, tail, body, head, 3.6);
  disc(ctx, head, 2.4);
  // Уши — короткие клинья вверх, добивают узнаваемость силуэта.
  bone(ctx, pt(head.x - f * 0.6, head.y - 1.6), pt(head.x - f * 2.2, head.y - 4.6), 1.2);
  bone(ctx, pt(head.x + f * 0.8, head.y - 1.6), pt(head.x + f * 0.4, head.y - 4.8), 1.2);
}
