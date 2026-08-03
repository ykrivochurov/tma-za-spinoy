/**
 * Атрибутика метро: путь, подвижной состав, светофоры.
 *
 * Всё это рисуется поверх обычной геометрии и НЕ участвует в физике — кроме
 * вагона, который является твёрдым тайлом `T` и потому живёт как часть карты.
 * Габариты вагонов считает `level.ts` при сборке комнаты.
 *
 * Принцип тот же, что у остального арта: никаких файлов, только процедура.
 * Узнаваемость метро держится на трёх вещах, и их стоит беречь при любых правках:
 *   1. ПУТЬ — две нитки рельса с отполированной головкой, шпалы, щебень.
 *   2. КОНТАКТНЫЙ РЕЛЬС под деревянным коробом сбоку от пути.
 *   3. ВАГОН — не коробка, а полоса окон между дверьми, юбка и тележки.
 */

import { TILE } from './tuning';
import { COLORS } from './palette';
import type { TrainCar } from './level';

// ------------------------------------------------------------------- путь

/**
 * Путь по открытой верхней грани породы. `x` — левый край тайла.
 *
 * Рисуется в два яруса: на самой поверхности — рельсы, ниже, в теле породы, —
 * торцы шпал и щебень. Тело блока под кромкой у нас видно всегда, и это
 * единственное место, где балластной призме есть где поместиться.
 */
export function drawTrack(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Балласт: редкие камни в теле насыпи.
  ctx.fillStyle = COLORS.ballast;
  for (let i = 0; i < 5; i++) {
    const px = x + ((i * 7 + (x / TILE) * 3) % (TILE - 2)) + 1;
    const py = y + 8 + ((i * 5 + x) % 6);
    ctx.fillRect(px, py, 2, 1.5);
  }

  // Торцы шпал: короткие тёмные бруски поперёк насыпи.
  ctx.fillStyle = COLORS.sleeper2;
  ctx.fillRect(x + 1, y + 6.5, 6, 2.5);
  ctx.fillRect(x + 9, y + 6.5, 6, 2.5);

  // Две нитки рельса. Ближняя ниже и ярче, дальняя выше и глуше —
  // этим и читается колея, хотя вид строго сбоку.
  ctx.strokeStyle = COLORS.rail;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 3.5);
  ctx.lineTo(x + TILE, y + 3.5);
  ctx.stroke();

  ctx.strokeStyle = COLORS.railHead;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y + 5.5);
  ctx.lineTo(x + TILE, y + 5.5);
  ctx.stroke();
}

/**
 * Контактный рельс: короб на изоляторах вдоль пути.
 *
 * Рисуется НИЖЕ уровня ног, в теле насыпи, а не над полом. Над полом он был бы
 * похож на уступ, на который можно запрыгнуть, и врал бы игроку про геометрию.
 */
export function drawThirdRail(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const ry = y + 12;
  // Изолятор.
  ctx.fillStyle = COLORS.rail;
  ctx.fillRect(x + 4, ry - 2, 2, 3);
  ctx.fillRect(x + 12, ry - 2, 2, 3);
  // Сам рельс и деревянный короб над ним.
  ctx.fillStyle = COLORS.thirdRail;
  ctx.fillRect(x, ry + 1, TILE, 2.5);
  ctx.fillStyle = COLORS.thirdRailCap;
  ctx.fillRect(x, ry, TILE, 1);
}

// ----------------------------------------------------------------- вагон

/**
 * Вагон метро. Не коробка: узнаваемость держится на пропорции «полоса окон
 * между дверьми», юбке над тележками и скруглённой крыше.
 */
export function drawTrainCar(ctx: CanvasRenderingContext2D, car: TrainCar, lit: boolean): void {
  const { x, y, w, h } = car;
  const r = Math.min(7, h * 0.22);

  // --- кузов
  ctx.fillStyle = lit ? COLORS.carBody : '#05070c';
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();

  if (!lit) {
    // В темноте от состава виден только контур крыши — как и от всей геометрии.
    ctx.strokeStyle = COLORS.massEdgeDim;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return;
  }

  ctx.save();
  ctx.clip();

  // --- юбка под окнами и тёмный низ
  ctx.fillStyle = COLORS.carBodyDark;
  ctx.fillRect(x, y + h * 0.62, w, h * 0.38);
  // Красная полоса по борту — то, что делает вагон вагоном, а не контейнером.
  ctx.fillStyle = COLORS.carStripe;
  ctx.fillRect(x, y + h * 0.585, w, 1.6);

  // --- двери и окна чередуются по длине
  const winTop = y + h * 0.20;
  const winH = Math.max(5, h * 0.34);
  let px = x + 5;
  let slot = 0;
  while (px < x + w - 5) {
    const isDoor = slot % 3 === 2;
    const ww = isDoor ? 9 : 13;
    if (px + ww > x + w - 4) break;

    ctx.fillStyle = COLORS.carGlass;
    ctx.fillRect(px, winTop, ww, winH);
    // Уцелевшее стекло ловит луч; выбитые проёмы остаются чёрными дырами.
    if ((slot * 7 + x) % 5 !== 0) {
      ctx.fillStyle = COLORS.carGlassLit;
      ctx.fillRect(px + 1, winTop + 1, ww - 2, winH * 0.35);
    }
    if (isDoor) {
      // Дверь идёт до самого низа и делится пополам резиновым уплотнителем.
      ctx.fillStyle = COLORS.carBodyDark;
      ctx.fillRect(px, winTop + winH, ww, h * 0.62 - (winTop - y) - winH);
      ctx.strokeStyle = COLORS.carEdge;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(px + ww / 2, winTop);
      ctx.lineTo(px + ww / 2, y + h * 0.62);
      ctx.moveTo(px, winTop);
      ctx.lineTo(px, y + h * 0.62);
      ctx.moveTo(px + ww, winTop);
      ctx.lineTo(px + ww, y + h * 0.62);
      ctx.stroke();
    }
    px += ww + 4;
    slot++;
  }

  // --- рёбра жёсткости крыши
  ctx.strokeStyle = COLORS.carBodyDark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 4.5);
  ctx.lineTo(x + w, y + 4.5);
  ctx.stroke();

  ctx.restore();

  // --- контур кузова
  ctx.strokeStyle = COLORS.carEdge;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x + 0.7, y + h);
  ctx.lineTo(x + 0.7, y + r);
  ctx.quadraticCurveTo(x + 0.7, y + 0.7, x + r, y + 0.7);
  ctx.lineTo(x + w - r, y + 0.7);
  ctx.quadraticCurveTo(x + w - 0.7, y + 0.7, x + w - 0.7, y + r);
  ctx.lineTo(x + w - 0.7, y + h);
  ctx.stroke();

  // --- тележки: две пары колёс под юбкой, у концов вагона
  ctx.fillStyle = COLORS.rail;
  for (const bx of [x + w * 0.16, x + w * 0.84]) {
    for (const off of [-6, 6]) {
      ctx.beginPath();
      ctx.arc(bx + off, y + h - 1.5, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(bx - 10, y + h - 5, 20, 2);
  }

  // --- кабина: прожектора на открытом торце
  if (car.headLeft) drawCab(ctx, x, y, h, -1);
  if (car.headRight) drawCab(ctx, x + w, y, h, 1);
}

/** Лобовая часть головного вагона: два прожектора и «усы» поручней. */
function drawCab(ctx: CanvasRenderingContext2D, ex: number, y: number, h: number, dir: number): void {
  const lampY = y + h * 0.46;
  ctx.save();
  ctx.shadowColor = COLORS.carLamp;
  ctx.shadowBlur = 9;
  ctx.fillStyle = COLORS.carLamp;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(ex - dir * 4 - 1.5, lampY, 3, 2.5);
  ctx.fillRect(ex - dir * 4 - 1.5, lampY - h * 0.22, 3, 2.5);
  ctx.restore();

  ctx.strokeStyle = COLORS.carEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ex - dir * 2, y + h * 0.20);
  ctx.lineTo(ex - dir * 2, y + h * 0.58);
  ctx.stroke();
}

// -------------------------------------------------------------- светофор

/** Путевой светофор на кронштейне: две линзы, горит нижняя. */
export function drawSignal(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const blink = Math.sin(time * 1.6 + x) > -0.5;
  ctx.strokeStyle = COLORS.rail;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 16);
  ctx.lineTo(x + 8, y + 4);
  ctx.stroke();

  ctx.fillStyle = COLORS.carBodyDark;
  ctx.fillRect(x + 4, y - 6, 8, 12);
  ctx.strokeStyle = COLORS.massEdgeDim;
  ctx.lineWidth = 0.8;
  ctx.strokeRect(x + 4.5, y - 5.5, 7, 11);

  ctx.save();
  ctx.shadowColor = COLORS.alarm;
  ctx.shadowBlur = blink ? 10 : 2;
  ctx.fillStyle = blink ? COLORS.alarm : COLORS.alarmDim;
  ctx.beginPath();
  ctx.arc(x + 8, y + 1.5, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#12331c';
  ctx.beginPath();
  ctx.arc(x + 8, y - 3, 2.2, 0, Math.PI * 2);
  ctx.fill();
}
