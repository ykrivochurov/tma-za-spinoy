import {
  LAMP_R, LIGHT_AIM_Y, LIGHT_AMBIENT_R, LIGHT_CONE_HALF, LIGHT_CONE_LEN, LIGHT_TURN,
} from './tuning';
import type { Room } from './level';
import type { Player } from './player';
import { input } from './input';

/**
 * Свет — главная выразительная система игры. Отсюда берутся и картинка (маска
 * освещения), и правила (тварь боится только освещённого места).
 * Один источник истины: если что-то светит на экране, оно светит и в isLit().
 */
export const light = {
  x: 0,
  y: 0,
  dirX: 1,
  dirY: 0,
};

const COS_HALF = Math.cos(LIGHT_CONE_HALF);

export function updateLight(player: Player, dt: number): void {
  light.x = player.cx;
  light.y = player.cy;

  // По горизонтали луч ПЕРЕКЛАДЫВАЕТСЯ МГНОВЕННО вслед за разворотом.
  // Сглаживать здесь нельзя: проходя через ноль, вектор направления схлопывается,
  // рука с фонарём складывается в плечо, и разворот выглядит как поломка.
  // Развернулся — значит и фонарь развернулся.
  const ty = input.y * LIGHT_AIM_Y;

  // Запаздывание оставляем только по вертикали: там оно и читается как
  // «фонарь в руке, а не на турели», и через ноль ничего не выворачивает.
  const k = 1 - Math.exp(-LIGHT_TURN * dt);
  light.dirY += (ty - light.dirY) * k;

  const n = Math.hypot(1, light.dirY) || 1;
  light.dirX = player.facing / n;
  light.dirY /= n;
}

export function resetLight(player: Player): void {
  light.x = player.cx;
  light.y = player.cy;
  light.dirX = player.facing;
  light.dirY = 0;
}

/** Освещена ли точка — то есть ВИДНО ли то, что в ней. Ровно то, что рисует маска. */
export function isLit(room: Room, x: number, y: number): boolean {
  const dx = x - light.x;
  const dy = y - light.y;
  const d = Math.hypot(dx, dy);

  if (d < LIGHT_AMBIENT_R) return true;
  if (inBeam(dx, dy, d)) return true;
  return inLamp(room, x, y);
}

/**
 * Отгоняет ли свет в этой точке. НЕ то же, что `isLit`: ореол под ногами
 * сюда НЕ входит.
 *
 * Ореол нужен, чтобы игрок видел, куда прыгает, — он про зрение, а не про защиту.
 * Если бы он ещё и отпугивал, тварь физически не могла бы дотянуться: смертельное
 * касание в 17 px лежит глубоко внутри ореола в 52 px, и любой враг «загорался»
 * раньше, чем доставал. Ровно из-за этого твари были безобидны.
 *
 * Поэтому оружие — направленный луч и лампы. Отвернулся — и за спиной темно.
 * Собственно, игра про это и называется.
 */
export function repels(room: Room, x: number, y: number): boolean {
  const dx = x - light.x;
  const dy = y - light.y;
  const d = Math.hypot(dx, dy);
  if (inBeam(dx, dy, d)) return true;
  return inLamp(room, x, y);
}

function inBeam(dx: number, dy: number, d: number): boolean {
  return d < LIGHT_CONE_LEN && (dx * light.dirX + dy * light.dirY) / d > COS_HALF;
}

function inLamp(room: Room, x: number, y: number): boolean {
  for (const l of room.lamps) {
    if (Math.hypot(x - l.x, y - l.y) < LAMP_R) return true;
  }
  return false;
}

/**
 * Рисует маску освещения: прозрачный холст, на который аддитивно кладутся источники.
 * Дальше сцена обрезается по этой маске (destination-in) — так «во тьме» получается
 * не затемнение, а именно отсутствие изображения.
 */
export function drawLightMask(ctx: CanvasRenderingContext2D, room: Room, time: number, dead: boolean): void {
  ctx.globalCompositeOperation = 'lighter';

  // --- натриевые лампы: тёплые, с медленным неровным мерцанием
  for (const l of room.lamps) {
    const flicker = 0.86 + Math.sin(time * 7.3 + l.seed) * 0.05 + Math.sin(time * 23 + l.seed * 3) * 0.04;
    // Спад держим пологим: станция должна быть освещённым островом,
    // а не точкой света в метре от плафона.
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, LAMP_R);
    g.addColorStop(0, `rgba(255,255,255,${1 * flicker})`);
    g.addColorStop(0.5, `rgba(255,255,255,${0.62 * flicker})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(l.x, l.y, LAMP_R, 0, Math.PI * 2);
    ctx.fill();
  }

  // Мёртвый игрок не светит: комната гаснет — это и есть «тьма за спиной».
  if (!dead) {
    // --- ореол под ногами: игрок никогда не бывает слеп вплотную к себе
    const a = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, LIGHT_AMBIENT_R);
    a.addColorStop(0, 'rgba(255,255,255,0.95)');
    a.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = a;
    ctx.beginPath();
    ctx.arc(light.x, light.y, LIGHT_AMBIENT_R, 0, Math.PI * 2);
    ctx.fill();

    // --- конус фонаря
    const ang = Math.atan2(light.dirY, light.dirX);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(light.x, light.y);
    ctx.arc(light.x, light.y, LIGHT_CONE_LEN, ang - LIGHT_CONE_HALF, ang + LIGHT_CONE_HALF);
    ctx.closePath();
    ctx.clip();

    const c = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, LIGHT_CONE_LEN);
    c.addColorStop(0, 'rgba(255,255,255,1)');
    c.addColorStop(0.45, 'rgba(255,255,255,0.72)');
    c.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = c;
    ctx.fillRect(
      light.x - LIGHT_CONE_LEN, light.y - LIGHT_CONE_LEN,
      LIGHT_CONE_LEN * 2, LIGHT_CONE_LEN * 2,
    );
    ctx.restore();
  }

  ctx.globalCompositeOperation = 'source-over';
}

/** Видимый луч в воздухе: пыль в свете фонаря. Рисуется поверх сцены, не в маске. */
export function drawBeamHaze(ctx: CanvasRenderingContext2D, dead: boolean): void {
  if (dead) return;
  const ang = Math.atan2(light.dirY, light.dirX);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.moveTo(light.x, light.y);
  ctx.arc(light.x, light.y, LIGHT_CONE_LEN, ang - LIGHT_CONE_HALF, ang + LIGHT_CONE_HALF);
  ctx.closePath();
  const g = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, LIGHT_CONE_LEN);
  g.addColorStop(0, 'rgba(150, 190, 255, 0.10)');
  g.addColorStop(1, 'rgba(150, 190, 255, 0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}
