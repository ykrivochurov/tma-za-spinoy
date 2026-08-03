import {
  CREATURE_AGGRO, CREATURE_FLEE_SPEED, CREATURE_KINDS, CREATURE_LEASH, CREATURE_SPEED,
  CREATURE_TOUCH, CRUMBLE_DELAY, CRUMBLE_RESPAWN, DOOR_CLOSED_TIME, DOOR_OPEN_TIME,
  DOOR_WARN_TIME, DRESINA_SPEED, ROOM_W, TILE, type CreatureKind,
} from './tuning';
import { Crumb, Tile, tileAt, type Room } from './level';
import { isLit, repels } from './lighting';
import { addShake } from './fx';
import { burst } from './particles';
import { sfx } from './audio';
import { COLORS } from './palette';
import type { Player } from './player';

export interface Lamp {
  x: number;
  y: number;
  /** Фаза мерцания: без неё все лампы комнаты дёргаются синхронно и это видно. */
  seed: number;
}

export interface Creature {
  kind: CreatureKind;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  /** Видно ли тварь: попадает в любой свет, включая ореол под ногами игрока. */
  seen: boolean;
  /** Гонит ли её свет: только направленный луч и лампы. Ореол не в счёт. */
  repelled: boolean;
  /** Видимость: тварь проступает из темноты, а не появляется рывком. */
  alpha: number;
  /** Фаза собственного движения: шаг упыря, взмах нетопыря, качание горбуна. */
  phase: number;
  /** Сглаженное направление взгляда — тварь разворачивается, а не телепортируется. */
  facing: number;
  /** Куда смотрит корпус по вертикали: нужен нетопырю, чтобы пикировать. */
  pitch: number;
  seed: number;
}

export interface Dresina {
  x: number;
  y: number;
  w: number;
  h: number;
  minX: number;
  maxX: number;
  dir: number;
  /** Смещение за последний шаг — им же переносим стоящего сверху игрока. */
  dx: number;
}

export interface Door {
  x: number;
  y: number;
  w: number;
  h: number;
  closed: boolean;
  warning: boolean;
}

// ------------------------------------------------------------------------ твари

export function updateCreatures(room: Room, player: Player, dt: number): void {
  for (const c of room.creatures) {
    const k = CREATURE_KINDS[c.kind];
    c.seen = isLit(room, c.x, c.y);
    c.repelled = repels(room, c.x, c.y);

    const dx = player.cx - c.x;
    const dy = player.cy - c.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (c.repelled) {
      // В луче тварь пятится в своё логово. Свет здесь — оружие, а не декорация.
      const hx = c.homeX - c.x;
      const hy = c.homeY - c.y;
      const hd = Math.hypot(hx, hy);
      if (hd > 2) {
        c.vx = (hx / hd) * CREATURE_FLEE_SPEED * k.flee;
        c.vy = (hy / hd) * CREATURE_FLEE_SPEED * k.flee;
      } else {
        c.vx = 0;
        c.vy = 0;
      }
    } else if (dist < CREATURE_AGGRO * k.aggro) {
      c.vx = (dx / dist) * CREATURE_SPEED * k.speed;
      c.vy = (dy / dist) * CREATURE_SPEED * k.speed;
    } else {
      c.vx *= 0.9;
      c.vy *= 0.9;
    }

    // Проступает из темноты по ВИДИМОСТИ, а не по страху: тварь, стоящая
    // вплотную в ореоле, обязана быть нарисована, даже если луч её не гонит.
    c.alpha = c.seen
      ? Math.min(1, c.alpha + dt * 5)
      : Math.max(0.12, c.alpha - dt * 2);

    // Рыскание поперёк курса: нетопырь мечется, горбун почти идёт по прямой.
    // Оно же ломает «лазерное» наведение — гнаться по прямой линии страшно не было.
    c.phase += dt * k.wobbleHz * Math.PI * 2;
    const wob = Math.sin(c.phase + c.seed) * k.wobble * CREATURE_SPEED * 0.35;
    c.x += (c.vx - (dy / dist) * wob) * dt;
    c.y += (c.vy + (dx / dist) * wob) * dt;

    // Поводок: тварь охраняет свой участок тоннеля, а не гонится через всю комнату.
    const lx = c.x - c.homeX;
    const ly = c.y - c.homeY;
    const ld = Math.hypot(lx, ly);
    if (ld > CREATURE_LEASH * k.leash) {
      c.x = c.homeX + (lx / ld) * CREATURE_LEASH * k.leash;
      c.y = c.homeY + (ly / ld) * CREATURE_LEASH * k.leash;
    }

    // Разворот и наклон — сглаженные: рывок силуэта на 180° выглядит как баг.
    const want = Math.abs(c.vx) > 4 ? Math.sign(c.vx) : c.facing;
    c.facing += (want - c.facing) * (1 - Math.exp(-9 * dt));
    const wantPitch = Math.max(-1, Math.min(1, c.vy / 90));
    c.pitch += (wantPitch - c.pitch) * (1 - Math.exp(-7 * dt));

    // Касание убивает всегда. Свет — не щит вокруг игрока, а то, чем тварь
    // отталкивают ДО того, как она дошла: раньше здесь стояла проверка на свет,
    // и она делала врагов принципиально безвредными.
    if (!player.dead && dist < CREATURE_TOUCH * k.touch + player.w / 2) {
      player.kill();
    }
  }
}

// ---------------------------------------------------------------------- дрезины

export function updateDresinas(room: Room, player: Player, dt: number): void {
  for (const d of room.dresinas) {
    // Кто едет — определяем ДО движения платформы: после сдвига игрок уже висит в воздухе.
    const riding =
      !player.dead &&
      Math.abs(player.y + player.h - d.y) <= 2 &&
      player.x < d.x + d.w &&
      player.x + player.w > d.x;

    const prev = d.x;
    d.x += DRESINA_SPEED * d.dir * dt;
    if (d.x <= d.minX) { d.x = d.minX; d.dir = 1; }
    if (d.x >= d.maxX) { d.x = d.maxX; d.dir = -1; }
    d.dx = d.x - prev;

    if (riding && d.dx !== 0) player.shift(room, d.dx);
  }
}

// ---------------------------------------------------------------- гермозатворы

const DOOR_CYCLE = DOOR_OPEN_TIME + DOOR_WARN_TIME + DOOR_CLOSED_TIME;
/** Период писка в фазе предупреждения. */
const DOOR_BEEP = 0.16;

export function updateDoors(room: Room, player: Player, dt: number): void {
  if (room.doors.length === 0) return;
  const prev = room.doorTimer;
  room.doorTimer = (room.doorTimer + dt) % DOOR_CYCLE;

  const t = room.doorTimer;

  // Писк отсчёта: пока горит предупреждение, затвор пикает каждые DOOR_BEEP секунд.
  // Индекс пика считаем из таймера, а не копим отдельный счётчик, — иначе звук
  // разъезжается с миганием, которое живёт от того же таймера.
  if (t >= DOOR_OPEN_TIME && t < DOOR_OPEN_TIME + DOOR_WARN_TIME && prev < t) {
    const beep = (v: number): number => Math.floor((v - DOOR_OPEN_TIME) / DOOR_BEEP);
    if (beep(t) !== beep(prev)) sfx.doorWarn();
  }
  const warning = t >= DOOR_OPEN_TIME && t < DOOR_OPEN_TIME + DOOR_WARN_TIME;
  const closed = t >= DOOR_OPEN_TIME + DOOR_WARN_TIME;

  for (const g of room.doors) {
    const wasClosed = g.closed;
    g.warning = warning;
    g.closed = closed;

    if (!wasClosed && g.closed) {
      addShake(3);
      sfx.doorSlam();
      burst(g.x + g.w / 2, g.y + g.h, 10, {
        speed: 130, life: 0.4, size: 2.5, color: COLORS.dust, drag: 3,
      });
      // Затвор бьёт насмерть — но он честно мигал красным DOOR_WARN_TIME секунд.
      if (!player.dead &&
          player.x < g.x + g.w && player.x + player.w > g.x &&
          player.y < g.y + g.h && player.y + player.h > g.y) {
        player.kill();
      }
    }
  }
}

// ------------------------------------------------------------------ гнилые шпалы

export function updateCrumble(room: Room, player: Player, dt: number): void {
  // Отмечаем шпалы прямо под ногами.
  if (!player.dead && player.onGround) {
    const ty = Math.floor((player.y + player.h) / TILE);
    const x0 = Math.floor(player.x / TILE);
    const x1 = Math.floor((player.x + player.w - 1) / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      if (tileAt(room, tx, ty) !== Tile.Crumble) continue;
      const i = ty * ROOM_W + tx;
      if (room.crumbState[i] === Crumb.Intact) {
        room.crumbState[i] = Crumb.Shaking;
        room.crumbTimer[i] = CRUMBLE_DELAY;
        sfx.crumbleCrack();
      }
    }
  }

  for (let i = 0; i < room.crumbState.length; i++) {
    const st = room.crumbState[i];
    if (st === Crumb.Intact) continue;
    room.crumbTimer[i] -= dt;
    if (room.crumbTimer[i] > 0) continue;

    if (st === Crumb.Shaking) {
      room.crumbState[i] = Crumb.Gone;
      room.crumbTimer[i] = CRUMBLE_RESPAWN;
      const tx = i % ROOM_W;
      const ty = Math.floor(i / ROOM_W);
      addShake(1.6);
      sfx.crumbleFall();
      burst(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 10, {
        speed: 90, life: 0.6, size: 3, color: COLORS.sleeper, gravity: 700, drag: 0.6,
      });
    } else {
      // Не восстанавливаем шпалу внутри игрока — иначе он окажется замурован.
      const tx = i % ROOM_W;
      const ty = Math.floor(i / ROOM_W);
      const inside =
        player.x < (tx + 1) * TILE && player.x + player.w > tx * TILE &&
        player.y < (ty + 1) * TILE && player.y + player.h > ty * TILE;
      if (!inside) room.crumbState[i] = Crumb.Intact;
    }
  }
}
