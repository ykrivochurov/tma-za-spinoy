/**
 * Герой: человек в противогазе, нарисованный целиком процедурно.
 *
 * Ни одного кадра анимации не хранится. Поза каждый кадр собирается заново из
 * состояния физики (`vx`, `vy`, `onGround`, `wallDir`, `dashing`) и одной
 * накопленной величины — фазы шага. Дальше положение стоп и кистей задаётся
 * явно, а колени и локти доводит IK из `rig.ts`.
 *
 * Правая рука всегда держит фонарь и смотрит туда же, куда светит луч
 * (`light.dirX/dirY`), — поэтому свет читается как предмет в руке, а не как
 * эффект вокруг персонажа.
 *
 * Анимация — не симуляция: фаза шага живёт от реального dt и обновляется
 * в `updateHero()` из игрового цикла, а не из фиксированного шага физики.
 */

import {
  HERO_ARM_REACH, HERO_BOB, HERO_CHEST_W, HERO_CHEST_Y, HERO_FOOT, HERO_FOREARM,
  HERO_HEAD_R, HERO_HEAD_Y, HERO_HIP_Y, HERO_LEAN, HERO_MAX_CYCLES, HERO_SHIN,
  HERO_SHOULDER_Y, HERO_STEP_LIFT, HERO_STRIDE, HERO_THIGH, HERO_UPPER_ARM,
  HERO_WAIST_W, HERO_WALK_SCALE, MAX_RUN,
} from './tuning';
import {
  approach, bone, clamp, disc, ik2, limb, lerp, pt, rot, spine, stepCycle,
  taper, type Pt,
} from './rig';
import { COLORS } from './palette';
import { sfx } from './audio';
import { light } from './lighting';
import type { Player } from './player';

const TAU = Math.PI * 2;

/** Живое состояние анимации. Копится между кадрами, физику не трогает. */
const anim = {
  phase: 0,
  /** Сглаженный «сколько мы бежим», 0..1 — гасит дрожь позы на границе покоя. */
  runAmount: 0,
  /** Сглаженный наклон корпуса. */
  lean: 0,
  /** Сглаженное приседание: растёт при приземлении и в подкате. */
  crouch: 0,
  breath: 0,
  /** Полупериод шага на прошлом кадре: по его смене и щёлкает шаг. */
  half: 0,
};

export function resetHeroAnim(): void {
  anim.phase = 0;
  anim.runAmount = 0;
  anim.lean = 0;
  anim.crouch = 0;
}

export function updateHero(p: Player, dt: number): void {
  const speed = Math.abs(p.vx);
  const moving = p.onGround && speed > 12;

  // Частота шага растёт со скоростью, но упирается в потолок: на 180 px/s
  // «реалистичный» шаг превратился бы в мельтешение.
  const cycles = Math.min(speed * HERO_WALK_SCALE, HERO_MAX_CYCLES);
  if (moving) anim.phase = (anim.phase + TAU * cycles * dt) % TAU;
  else anim.phase = approach(anim.phase, Math.round(anim.phase / TAU) * TAU, 8, dt);

  // Шаг звучит В МОМЕНТ ОПОРЫ, а не по таймеру: опорная фаза начинается
  // на 0 и на π, поэтому щёлкаем ровно на смене полупериода.
  const half = Math.floor(anim.phase / Math.PI);
  if (moving && half !== anim.half) sfx.step(speed / MAX_RUN);
  anim.half = half;

  anim.runAmount = approach(anim.runAmount, moving ? 1 : 0, 14, dt);
  anim.lean = approach(anim.lean, clamp(p.vx / MAX_RUN, -1.4, 1.4) * HERO_LEAN, 10, dt);
  anim.crouch = approach(anim.crouch, p.onGround ? 1 - p.squashY : 0, 16, dt);
  anim.breath = (anim.breath + dt * 1.7) % TAU;
}

// ------------------------------------------------------------------------ поза

interface Pose {
  hip: Pt;
  chest: Pt;
  head: Pt;
  legs: [Pt, Pt][]; // [колено, стопа]
  hips: Pt[];
  arms: [Pt, Pt][]; // [локоть, кисть]
  shoulders: Pt[];
  /** Куда смотрит противогаз. */
  faceX: number;
  faceY: number;
}

/**
 * Собирает позу в мировых координатах: `ox` — центр по горизонтали,
 * `oy` — линия стоп (низ хитбокса). Ось Y вниз, поэтому «выше» — меньше.
 */
function buildPose(p: Player, ox: number, oy: number): Pose {
  const f = p.facing;
  const run = anim.runAmount;
  const airborne = !p.onGround && !p.dashing;

  // --- таз и корпус
  const bob = -HERO_BOB * Math.abs(Math.sin(anim.phase)) * run;
  const crouch = anim.crouch * 2.2;
  const breathe = Math.sin(anim.breath) * 0.25 * (1 - run);

  let hip = pt(ox, oy + HERO_HIP_Y + bob + crouch);
  let chest = pt(ox, oy + HERO_CHEST_Y + bob * 0.6 + crouch * 0.7 + breathe);
  let shoulderY = oy + HERO_SHOULDER_Y + bob * 0.6 + crouch * 0.7 + breathe;
  let head = pt(ox, oy + HERO_HEAD_Y + bob * 0.5 + crouch * 0.6 + breathe);

  // Наклон корпуса вокруг таза: на бегу вперёд, в дэше — почти горизонтально.
  let lean = anim.lean;
  if (p.dashing) lean = f * 0.85 + (p.vy > 0 ? 0.15 : -0.15);
  else if (airborne) lean += clamp(p.vx / MAX_RUN, -1, 1) * 0.1;

  const rotate = (q: Pt): Pt => rot(q, hip.x, hip.y, lean);
  chest = rotate(chest);
  head = rotate(head);
  const shoulderPivot = rotate(pt(ox, shoulderY));

  // --- ноги
  const legs: [Pt, Pt][] = [];
  const hips: Pt[] = [];
  const dir = Math.sign(p.vx) || f;

  const footTargets: Pt[] = [];
  if (p.dashing) {
    // В рывке ноги вытянуты назад в одну линию — читается как «выстрел телом».
    footTargets.push(pt(ox - f * 7.5, oy - 5.5), pt(ox - f * 5.5, oy - 2.0));
  } else if (p.wallDir !== 0 && airborne) {
    // Скольжение по стене: ноги согнуты и упёрты в стену, корпус чуть отвёрнут.
    const w = p.wallDir;
    footTargets.push(pt(ox + w * 4.0, oy - 1.0), pt(ox + w * 1.5, oy - 4.5));
  } else if (airborne) {
    // Взлёт — колени подобраны, падение — ноги раскрыты и готовы принять удар.
    const t = clamp(p.vy / 220, -1, 1);
    footTargets.push(
      pt(ox + f * lerp(2.6, 3.4, (t + 1) / 2), oy + lerp(-4.2, 1.2, (t + 1) / 2)),
      pt(ox - f * lerp(1.2, 2.8, (t + 1) / 2), oy + lerp(-2.4, -0.6, (t + 1) / 2)),
    );
  } else {
    // Земля: шаговый цикл, ослабленный в покое до лёгкой стойки.
    const a = stepCycle(anim.phase, HERO_STRIDE, HERO_STEP_LIFT);
    const b = stepCycle(anim.phase + Math.PI, HERO_STRIDE, HERO_STEP_LIFT);
    footTargets.push(
      pt(ox + a.x * dir * run + f * 1.1 * (1 - run), oy + a.y * run),
      pt(ox + b.x * dir * run - f * 1.4 * (1 - run), oy + b.y * run),
    );
  }

  for (let i = 0; i < 2; i++) {
    // Дальняя нога смещена вглубь: без этого силуэт плоский, как ножницы.
    const h = pt(hip.x - f * (i === 0 ? 0.5 : -0.5), hip.y);
    const foot = footTargets[i];
    const knee = ik2(h, foot, HERO_THIGH, HERO_SHIN, f >= 0 ? -1 : 1);
    hips.push(h);
    legs.push([knee, foot]);
  }

  // --- руки
  const arms: [Pt, Pt][] = [];
  const shoulders: Pt[] = [];

  // Ведущая рука держит фонарь: кисть уходит точно по направлению луча.
  const sLead = pt(shoulderPivot.x + f * 0.8, shoulderPivot.y);
  const handLead = pt(
    sLead.x + light.dirX * HERO_ARM_REACH,
    sLead.y + light.dirY * HERO_ARM_REACH,
  );
  const elbowLead = ik2(sLead, handLead, HERO_UPPER_ARM, HERO_FOREARM, f >= 0 ? 1 : -1);
  shoulders.push(sLead);
  arms.push([elbowLead, handLead]);

  // Вторая рука балансирует: на земле — противоходом к ногам, в воздухе — разведена.
  const sFree = pt(shoulderPivot.x - f * 0.8, shoulderPivot.y);
  let handFree: Pt;
  if (p.dashing) {
    handFree = pt(sFree.x - f * 5.5, sFree.y + 1.5);
  } else if (p.wallDir !== 0 && airborne) {
    handFree = pt(sFree.x + p.wallDir * 4.2, sFree.y - 3.0);
  } else if (airborne) {
    handFree = pt(sFree.x - f * 4.2, sFree.y - clamp(-p.vy / 90, -2.5, 2.5) - 1.0);
  } else {
    const s = stepCycle(anim.phase + Math.PI, HERO_STRIDE * 0.62, 0);
    handFree = pt(sFree.x + s.x * dir * run - f * 2.6, sFree.y + 4.4 - Math.abs(s.x) * 0.25);
  }
  const elbowFree = ik2(sFree, handFree, HERO_UPPER_ARM, HERO_FOREARM, f >= 0 ? -1 : 1);
  shoulders.push(sFree);
  arms.push([elbowFree, handFree]);

  // Голова смотрит вдоль луча, но не выворачивается за плечо.
  const faceX = f >= 0 ? Math.max(light.dirX, 0.35) : Math.min(light.dirX, -0.35);
  const faceY = clamp(light.dirY, -0.6, 0.6);

  return { hip, chest, head, legs, hips, arms, shoulders, faceX, faceY };
}

// -------------------------------------------------------------------- рисование

export function drawHero(ctx: CanvasRenderingContext2D, p: Player): void {
  // Шлейф рывка — тот же силуэт, но одним тоном: цветной призрак читался бы
  // как второй персонаж, а не как след.
  for (const t of p.trail) {
    ctx.globalAlpha = (t.life / 0.22) * 0.3;
    ctx.save();
    ctx.translate(t.x + p.w / 2, t.y + p.h);
    ctx.scale(t.sx, t.sy);
    ctx.translate(-(t.x + p.w / 2), -(t.y + p.h));
    silhouette(ctx, p, t.x + p.w / 2, t.y + p.h, false, COLORS.dash);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  if (p.dead) return;

  const ox = p.cx;
  const oy = p.y + p.h;

  // Squash сжимает фигуру к полу, а не к центру: приземление должно выглядеть
  // как присед на ногах, а не как сплющенный по талии предмет.
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(p.squashX, p.squashY);
  ctx.translate(-ox, -oy);

  ctx.save();
  // Ореол только на рывке. В покое он склеивает проработанные конечности
  // в светящийся кокон, а постобработка его ещё и усиливает.
  ctx.shadowColor = accent(p);
  ctx.shadowBlur = p.dashing ? 10 : 0;
  silhouette(ctx, p, ox, oy, true);
  ctx.restore();

  ctx.restore();
}

/** Цвет индикатора рывка: голубой — есть, розовый — израсходован. */
function accent(p: Player): string {
  return p.dashes > 0 ? COLORS.dash : COLORS.playerNoDash;
}

/** Ступня: короткий клин от щиколотки вперёд по направлению взгляда. */
function foot(ctx: CanvasRenderingContext2D, ankle: Pt, facing: number): void {
  taper(ctx, ankle, pt(ankle.x + facing * HERO_FOOT, ankle.y + 0.4), 1.1, 0.75);
}

/** Красит и обводку, и заливку: почти всё тело рисуется тем и другим вперемешку. */
function use(ctx: CanvasRenderingContext2D, color: string, mono?: string): void {
  const c = mono ?? color;
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
}

/**
 * Герой одет, а не залит одним тоном: куртка, штаны, сапоги, перчатки и резина
 * маски — разные материалы и разные цвета. `mono` заливает всё одним цветом —
 * это нужно шлейфу рывка.
 */
function silhouette(
  ctx: CanvasRenderingContext2D,
  p: Player,
  ox: number,
  oy: number,
  detail: boolean,
  mono?: string,
): void {
  const pose = buildPose(p, ox, oy);
  const a = ctx.globalAlpha;

  // --- дальняя нога и рука: приглушены, это единственный способ дать объём силуэту
  ctx.globalAlpha = a * 0.5;
  use(ctx, COLORS.heroPants, mono);
  limb(ctx, pose.hips[1], pose.legs[1][0], pose.legs[1][1], 2.4, 1.8);
  use(ctx, COLORS.heroBoot, mono);
  foot(ctx, pose.legs[1][1], p.facing);
  use(ctx, COLORS.heroCoatDark, mono);
  limb(ctx, pose.shoulders[1], pose.arms[1][0], pose.arms[1][1], 1.9, 1.5);
  // Кисть рисуем здесь же: на полной непрозрачности она отрывается от своей
  // приглушённой руки и висит в воздухе отдельной точкой.
  use(ctx, COLORS.heroGlove, mono);
  disc(ctx, pose.arms[1][1], 0.9);
  ctx.globalAlpha = a;

  // --- куртка: корпус клином, узкая талия и широкие плечи
  use(ctx, COLORS.heroCoat, mono);
  taper(ctx, pose.hip, pose.chest, HERO_WAIST_W, HERO_CHEST_W);
  // Плечи отдельной перекладиной, чтобы руки росли из точки, а не из воздуха рядом.
  bone(ctx, pose.shoulders[0], pose.shoulders[1], 2.4);
  // Шея: без зазора между плечами и головой фигура читается как снеговик.
  use(ctx, COLORS.heroMaskDark, mono);
  bone(ctx, pose.chest, pt(pose.head.x, pose.head.y + HERO_HEAD_R * 0.7), 1.5);

  // --- ближние нога и рука
  use(ctx, COLORS.heroPants, mono);
  limb(ctx, pose.hips[0], pose.legs[0][0], pose.legs[0][1], 2.6, 1.9);
  use(ctx, COLORS.heroBoot, mono);
  foot(ctx, pose.legs[0][1], p.facing);
  use(ctx, COLORS.heroCoat, mono);
  limb(ctx, pose.shoulders[0], pose.arms[0][0], pose.arms[0][1], 2.0, 1.6);

  // --- голова в противогазе
  const h = pose.head;
  const fx = pose.faceX;
  const fy = pose.faceY;
  use(ctx, COLORS.heroMask, mono);
  disc(ctx, h, HERO_HEAD_R);
  // Фильтр-«хобот» по направлению взгляда — то, что делает силуэт узнаваемым.
  const snout = pt(h.x + fx * 2.3, h.y + fy * 2.0 + 0.5);
  use(ctx, COLORS.heroMaskDark, mono);
  bone(ctx, pt(h.x + fx * 0.6, h.y + 0.5), snout, 2.0);
  // Гофрированный шланг от фильтра к груди.
  spine(ctx, snout, pt(h.x + fx * 2.2, h.y + 4.4), pose.chest, 1.0);

  if (!detail) return;

  // Стекло маски: тёмное пятно, ловящее блик. Читается как «на нас не смотрят».
  ctx.fillStyle = COLORS.maskGlass;
  ctx.beginPath();
  ctx.ellipse(h.x + fx * 1.3, h.y + fy * 1.0 - 0.3, 1.05, 0.85, Math.atan2(fy, fx), 0, TAU);
  ctx.fill();
  ctx.fillStyle = COLORS.beam;
  ctx.globalAlpha = a * 0.75;
  ctx.fillRect(h.x + fx * 1.6 - 0.4, h.y + fy * 1.2 - 1.1, 0.9, 0.9);
  ctx.globalAlpha = a;

  // Лампа на груди — индикатор рывка. Раньше о нехватке рывка сообщал цвет всей
  // фигуры; с одеждой так уже не скажешь, а знать это игрок обязан всегда.
  ctx.save();
  ctx.fillStyle = accent(p);
  ctx.shadowColor = accent(p);
  ctx.shadowBlur = 5;
  disc(ctx, pt(pose.chest.x - p.facing * 0.6, pose.chest.y + 1.6), 0.85);
  ctx.restore();

  // Фонарь в кисти ведущей руки: короткий корпус вдоль луча и горячая точка.
  const hand = pose.arms[0][1];
  ctx.strokeStyle = COLORS.maskGlass;
  bone(ctx, hand, pt(hand.x + light.dirX * 2.3, hand.y + light.dirY * 2.3), 1.7);
  ctx.fillStyle = COLORS.lampCore;
  disc(ctx, pt(hand.x + light.dirX * 3.2, hand.y + light.dirY * 3.2), 1.1);
}
