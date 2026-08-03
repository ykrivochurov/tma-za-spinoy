import { CRYSTAL_RESPAWN, DRESINA_TILES, LAMP_R, ROOM_H, ROOM_W, TILE, type CreatureKind } from './tuning';
import { ROOMS, type RoomDef } from './rooms';
import type { Creature, Door, Dresina, Lamp } from './entities';

export const Tile = {
  Empty: 0,
  Solid: 1,
  Spike: 2,
  /** Фон радиации: проходим насквозь, но набивает счётчик. */
  Rad: 3,
  /** Гнилая шпала: твёрдая, пока не осыпалась. */
  Crumble: 4,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

/** Состояние гнилой шпалы. */
export const Crumb = { Intact: 0, Shaking: 1, Gone: 2 } as const;

export interface Crystal {
  x: number;
  y: number;
  alive: boolean;
  respawn: number;
}

export interface Room {
  def: RoomDef;
  tiles: Uint8Array;
  spawn: { x: number; y: number };
  crystals: Crystal[];
  goal: { x: number; y: number } | null;
  lamps: Lamp[];
  creatures: Creature[];
  dresinas: Dresina[];
  doors: Door[];
  /** Параллельные сетке массивы состояния гнилых шпал. */
  crumbState: Uint8Array;
  crumbTimer: Float32Array;
  /** Общий таймер цикла гермозатворов — все двери комнаты дышат в такт. */
  doorTimer: number;
  wind: number;
}

/**
 * Бюджет движения, ЗАМЕРЕННЫЙ В ИГРЕ (см. `tuning.ts` — если правишь прыжок,
 * перемеряй и правь здесь):
 *   прыжок вверх   58 px = 3.6 тайла  → уступ не выше 3 тайлов
 *   прыжок в длину 119 px = 7.4 тайла → провал не шире 6 тайлов
 *   рывок          148 px = 9.2 тайла
 */
const REACH_UP = 3;
const REACH_FAR = 6;
const REACH_DASH = 8;

/**
 * Проверяет геометрию карт на старте — кривая комната ломает всё молча, так что лучше громко.
 *
 * Кроме размеров ловит две вещи, которые глазами по ASCII не видно:
 *
 *  1. ПРОСВЕТ. Игрок 18 px высотой при тайле 16, то есть он ВЫШЕ одного тайла.
 *     Любая поверхность, над которой всего один пустой ряд, — не проход, а тупик.
 *     Ровно на этом однажды закрылся единственный путь во второй комнате.
 *  2. ДОСТИЖИМОСТЬ. Обход игрового пространства от точки спавна до выхода
 *     моделью движения выше. Модель НАМЕРЕННО щедрая (ходы прямыми углами,
 *     без учёта времени и инерции): если даже она до выхода не добралась —
 *     комната непроходима наверняка, и это уже не ложная тревога.
 */
export function validateRooms(): string[] {
  const errors: string[] = [];
  ROOMS.forEach((def, i) => {
    const tag = `комната ${i} "${def.name}"`;
    if (def.map.length !== ROOM_H) {
      errors.push(`${tag}: ${def.map.length} строк вместо ${ROOM_H}`);
      return;
    }
    let ragged = false;
    def.map.forEach((row, y) => {
      if (row.length !== ROOM_W) {
        errors.push(`${tag}, строка ${y}: ${row.length} символов вместо ${ROOM_W}`);
        ragged = true;
      }
    });
    if (ragged) return;

    if (!def.map.some((row) => row.includes('P'))) {
      errors.push(`${tag}: нет точки спавна P`);
      return;
    }
    errors.push(...auditRoom(tag, def.map));
  });
  return errors;
}

function auditRoom(tag: string, map: string[]): string[] {
  const errors: string[] = [];
  const at = (x: number, y: number): string =>
    (x < 0 || x >= ROOM_W || y < 0 || y >= ROOM_H) ? '#' : map[y][x];

  const isRock = (x: number, y: number): boolean => at(x, y) === '#' || at(x, y) === 'c';
  // Арматура непроходима: сквозь неё не ходят, её перепрыгивают.
  const blocks = (x: number, y: number): boolean => isRock(x, y) || at(x, y) === '^';
  // Клетка, куда помещается игрок: он выше тайла, значит нужны два пустых ряда.
  const fits = (x: number, y: number): boolean => !blocks(x, y) && !blocks(x, y - 1);
  // Дрезина — движущийся пол; для обхода считаем её опорой.
  const holds = (x: number, y: number): boolean =>
    isRock(x, y + 1) || at(x, y + 1) === '=' || at(x, y + 1) === 'D';

  // --- 1. просвет
  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      if (blocks(x, y) || !isRock(x, y + 1) || !isRock(x, y - 1)) continue;
      errors.push(`${tag}: поверхность (${x},${y}) с просветом в 1 тайл — игрок туда не влезет`);
    }
  }

  // --- 2. достижимость
  let spawn = { x: 0, y: 0 };
  const goals = new Set<number>();
  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      if (at(x, y) === 'P') spawn = { x, y };
      if (at(x, y) === 'E') goals.add(y * ROOM_W + x);
    }
    if (fits(ROOM_W - 1, y)) goals.add(y * ROOM_W + ROOM_W - 1);
  }

  const seen = new Uint8Array(ROOM_W * ROOM_H);
  const stack = [spawn];
  const push = (x: number, y: number): void => {
    if (x < 0 || x >= ROOM_W || y < 0 || y >= ROOM_H) return;
    if (seen[y * ROOM_W + x] || !fits(x, y)) return;
    stack.push({ x, y });
  };

  while (stack.length) {
    const { x, y } = stack.pop()!;
    const key = y * ROOM_W + x;
    if (seen[key] || !fits(x, y)) continue;
    seen[key] = 1;

    if (!holds(x, y)) push(x, y + 1);          // падение
    push(x - 1, y);                            // шаг вбок, в том числе с уступа
    push(x + 1, y);

    // Вол-джамп цепляется В ВОЗДУХЕ, поэтому проверяется до требования стоять
    // на земле: иначе ствол шахты, который берут серией отскоков, читается тупиком.
    if (isRock(x - 1, y) || isRock(x + 1, y)) {
      for (let dy = 1; dy <= REACH_UP; dy++) {
        if (!fits(x, y - dy)) break;
        push(x, y - dy);
        push(x - 1, y - dy);
        push(x + 1, y - dy);
      }
    }
    if (!holds(x, y)) continue;

    // Прыжок: сначала вверх по чистому стволу, потом вбок на этой высоте.
    for (let dy = 0; dy <= REACH_UP; dy++) {
      let clear = true;
      for (let k = 1; k <= dy; k++) if (!fits(x, y - k)) clear = false;
      if (!clear) break;
      for (const dir of [-1, 1]) {
        for (let d = 1; d <= REACH_FAR; d++) {
          if (!fits(x + dir * d, y - dy)) break;
          push(x + dir * d, y - dy);
        }
      }
    }
    // Рывок по горизонтали.
    for (const dir of [-1, 1]) {
      for (let d = 1; d <= REACH_DASH; d++) {
        if (!fits(x + dir * d, y)) break;
        push(x + dir * d, y);
      }
    }
  }

  if (![...goals].some((k) => seen[k])) {
    errors.push(`${tag}: ВЫХОД НЕДОСТИЖИМ от точки спавна`);
  }

  // --- 3. тварь в свету лампы
  const lamps: { x: number; y: number }[] = [];
  const beasts: { x: number; y: number; ch: string }[] = [];
  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      const ch = at(x, y);
      const p = { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
      if (ch === 'L') lamps.push(p);
      if (ch === 'M' || ch === 'W' || ch === 'B') beasts.push({ ...p, ch });
    }
  }
  for (const b of beasts) {
    const near = lamps.find((l) => Math.hypot(b.x - l.x, b.y - l.y) < LAMP_R);
    if (near) {
      // Свет ламп гонит тварей. Логово внутри пятна — значит зверь вечно пятится
      // домой и не двигается с места: врага на карте видно, а препятствия нет.
      errors.push(
        `${tag}: тварь '${b.ch}' в тайле (${Math.floor(b.x / TILE)},${Math.floor(b.y / TILE)}) ` +
        `стоит в свету лампы — она никогда не тронется с места`,
      );
    }
  }
  return errors;
}

export function buildRoom(index: number): Room {
  const def = ROOMS[index];
  const tiles = new Uint8Array(ROOM_W * ROOM_H);
  const crystals: Crystal[] = [];
  const lamps: Lamp[] = [];
  const creatures: Creature[] = [];
  const dresinas: Dresina[] = [];
  const doors: Door[] = [];
  let spawn = { x: TILE * 2, y: TILE * 2 };
  let goal: { x: number; y: number } | null = null;

  const at = (x: number, y: number): string => def.map[y]?.[x] ?? '.';

  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      const c = at(x, y);
      const i = y * ROOM_W + x;
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;

      switch (c) {
        case '#': tiles[i] = Tile.Solid; break;
        case '^': tiles[i] = Tile.Spike; break;
        case '~': tiles[i] = Tile.Rad; break;
        case 'c': tiles[i] = Tile.Crumble; break;
        case 'P': spawn = { x: cx, y: (y + 1) * TILE }; break;
        case 'E': goal = { x: cx, y: (y + 1) * TILE }; break;
        case 'o': crystals.push({ x: cx, y: cy, alive: true, respawn: 0 }); break;
        case 'L': lamps.push({ x: cx, y: cy, seed: x * 7.13 + y * 3.71 }); break;
        case 'M': case 'W': case 'B': {
          // M — упырь, W — горбун, B — нетопырь. Повадка и силуэт берутся из вида.
          const kind: CreatureKind = c === 'W' ? 'brute' : c === 'B' ? 'bat' : 'ghoul';
          creatures.push({
            kind, x: cx, y: cy, homeX: cx, homeY: cy, vx: 0, vy: 0,
            seen: false, repelled: false, alpha: 0, phase: 0, facing: -1, pitch: 0,
            seed: x * 1.37 + y * 2.71,
          });
          break;
        }
        case 'D': {
          // Коридор дрезины — непрерывная полоса из `D` и `=` на той же строке.
          let min = x;
          let max = x;
          while (min > 0 && '=D'.includes(at(min - 1, y))) min--;
          while (max < ROOM_W - 1 && '=D'.includes(at(max + 1, y))) max++;
          const w = DRESINA_TILES * TILE;
          dresinas.push({
            x: min * TILE, y: y * TILE, w, h: TILE,
            minX: min * TILE, maxX: (max + 1) * TILE - w, dir: 1, dx: 0,
          });
          break;
        }
        case 'G': {
          // Столбец гермозатвора собирается один раз — по верхней клетке.
          if (at(x, y - 1) === 'G') break;
          let h = 0;
          while (at(x, y + h) === 'G') h++;
          doors.push({ x: x * TILE, y: y * TILE, w: TILE, h: h * TILE, closed: false, warning: false });
          break;
        }
        default: break;
      }
    }
  }

  return {
    def, tiles, spawn, crystals, goal, lamps, creatures, dresinas, doors,
    crumbState: new Uint8Array(ROOM_W * ROOM_H),
    crumbTimer: new Float32Array(ROOM_W * ROOM_H),
    doorTimer: 0,
    wind: def.wind ?? 0,
  };
}

export function tileAt(room: Room, tx: number, ty: number): Tile {
  if (tx < 0 || tx >= ROOM_W || ty < 0 || ty >= ROOM_H) return Tile.Empty;
  return room.tiles[ty * ROOM_W + tx] as Tile;
}

/** Твёрдая ли клетка прямо сейчас: бетон всегда, гнилая шпала — пока не осыпалась. */
function tileBlocks(room: Room, tx: number, ty: number): boolean {
  const t = tileAt(room, tx, ty);
  if (t === Tile.Solid) return true;
  if (t === Tile.Crumble) return room.crumbState[ty * ROOM_W + tx] !== Crumb.Gone;
  return false;
}

function overlaps(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Пересекает ли прямоугольник что-либо твёрдое: тайлы, дрезины, закрытые гермозатворы.
 * Вызывается попиксельно из moveX/moveY, поэтому держим её плоской и без аллокаций.
 */
export function rectSolid(room: Room, x: number, y: number, w: number, h: number): boolean {
  const x0 = Math.floor(x / TILE);
  const x1 = Math.floor((x + w - 1) / TILE);
  const y0 = Math.floor(y / TILE);
  const y1 = Math.floor((y + h - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tileBlocks(room, tx, ty)) return true;
    }
  }
  for (const d of room.dresinas) {
    if (overlaps(x, y, w, h, d.x, d.y, d.w, d.h)) return true;
  }
  for (const g of room.doors) {
    if (g.closed && overlaps(x, y, w, h, g.x, g.y, g.w, g.h)) return true;
  }
  return false;
}

/**
 * Шипы убивают только по «настоящему» перекрытию: хитбокс арматуры ужат внутрь тайла,
 * иначе игрок умирает, просто пробежав рядом, и это ощущается нечестно.
 */
const SPIKE_INSET_X = 3;
const SPIKE_INSET_TOP = 6;

export function rectSpike(room: Room, x: number, y: number, w: number, h: number): boolean {
  const x0 = Math.floor(x / TILE);
  const x1 = Math.floor((x + w - 1) / TILE);
  const y0 = Math.floor(y / TILE);
  const y1 = Math.floor((y + h - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tileAt(room, tx, ty) !== Tile.Spike) continue;
      const sx = tx * TILE + SPIKE_INSET_X;
      const sy = ty * TILE + SPIKE_INSET_TOP;
      if (overlaps(x, y, w, h, sx, sy, TILE - SPIKE_INSET_X * 2, TILE - SPIKE_INSET_TOP)) return true;
    }
  }
  return false;
}

/** Стоит ли прямоугольник в зоне радиации. */
export function rectRad(room: Room, x: number, y: number, w: number, h: number): boolean {
  const x0 = Math.floor(x / TILE);
  const x1 = Math.floor((x + w - 1) / TILE);
  const y0 = Math.floor(y / TILE);
  const y1 = Math.floor((y + h - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tileAt(room, tx, ty) === Tile.Rad) return true;
    }
  }
  return false;
}

export function updateCrystals(room: Room, dt: number): void {
  for (const c of room.crystals) {
    if (c.alive) continue;
    c.respawn -= dt;
    if (c.respawn <= 0) c.alive = true;
  }
}

export function takeCrystal(c: Crystal): void {
  c.alive = false;
  c.respawn = CRYSTAL_RESPAWN;
}

export const ROOM_COUNT = ROOMS.length;
