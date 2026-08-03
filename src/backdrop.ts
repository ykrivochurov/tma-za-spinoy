/**
 * Архитектура метро — параметрическая, без единого файла-ассета.
 *
 * Приём, который делает всю работу: ОДНА ТОЧКА СХОДА. Дальний план — это одна
 * и та же форма (кольцо тюбинга, пилон, ферма), нарисованная N раз с масштабом,
 * убывающим к точке схода, и с туманом, густеющим по глубине. Отсюда берётся
 * настоящая глубина, хотя рисуем мы плоские кривые.
 *
 * Слоёв четыре, от далёкого к близкому:
 *   1. свод/перспектива      — уходит в точку схода, самый светлый от тумана
 *   2. путевая стена         — кабельные трассы, ниши, аварийные короба
 *   3. ближняя архитектура   — пилоны, край платформы, фермы депо
 *   4. передний план         — провисающие кабели и трубы, почти чёрные
 *
 * Всё, что рисуется, детерминировано: генератор сеется номером комнаты, поэтому
 * перегон выглядит одинаково при каждом заходе, а декор не «кипит» между кадрами.
 */

import { VIEW_H, VIEW_W } from './tuning';
import { COLORS } from './palette';
import type { RoomDef } from './rooms';

const TAU = Math.PI * 2;

/** Детерминированный генератор: одинаковая комната — одинаковый декор. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------- заготовки

interface Cable {
  x0: number;
  x1: number;
  y: number;
  sag: number;
  w: number;
}

interface Decor {
  vpx: number;
  vpy: number;
  /** Провисающие кабели переднего плана. */
  cables: Cable[];
  /** Вертикальные свесы: оборванные провода, ветошь. */
  drops: { x: number; y: number; len: number; w: number }[];
  /** Пятна протечек и копоти на путевой стене. */
  stains: { x: number; y: number; r: number; a: number }[];
  /** Ниши и служебные двери в стене. */
  niches: { x: number; y: number; w: number; h: number; door: boolean }[];
}

const CACHE = new WeakMap<RoomDef, Decor>();

function decorFor(def: RoomDef, index: number): Decor {
  const cached = CACHE.get(def);
  if (cached) return cached;

  const r = rng(index * 9176 + def.name.length * 131 + 17);
  const scene = def.scene ?? 'tunnel';

  const cables: Cable[] = [];
  const cableCount = scene === 'shaft' ? 2 : 3;
  for (let i = 0; i < cableCount; i++) {
    const y = VIEW_H * 0.43 + r() * 10 + i * 7;
    const x0 = -20 - r() * 40;
    cables.push({ x0, x1: VIEW_W + 20 + r() * 40, y, sag: 4 + r() * 11, w: 0.9 + r() * 0.9 });
  }

  const drops: { x: number; y: number; len: number; w: number }[] = [];
  for (let i = 0; i < 7; i++) {
    drops.push({
      x: r() * VIEW_W,
      y: VIEW_H * 0.44 + r() * 18,
      len: 8 + r() * 26,
      w: 0.7 + r() * 0.6,
    });
  }

  const stains: { x: number; y: number; r: number; a: number }[] = [];
  for (let i = 0; i < 14; i++) {
    stains.push({
      x: r() * VIEW_W,
      y: 40 + r() * (VIEW_H - 120),
      r: 14 + r() * 46,
      a: 0.05 + r() * 0.11,
    });
  }

  const niches: { x: number; y: number; w: number; h: number; door: boolean }[] = [];
  const nicheCount = scene === 'station' || scene === 'hall' ? 4 : 3;
  for (let i = 0; i < nicheCount; i++) {
    const w = 14 + r() * 12;
    niches.push({
      x: (i + 0.5) * (VIEW_W / nicheCount) + (r() - 0.5) * 40 - w / 2,
      y: VIEW_H * 0.42 + r() * VIEW_H * 0.16,
      w,
      h: 26 + r() * 16,
      door: r() > 0.45,
    });
  }

  const d: Decor = {
    vpx: 0.34 + r() * 0.32,
    vpy: 0.44 + r() * 0.08,
    cables, drops, stains, niches,
  };
  CACHE.set(def, d);
  return d;
}

// ------------------------------------------------------------------ фон целиком

/**
 * `lit` = false — проход «видно всегда»: только крупные силуэты архитектуры,
 * приглушённые. `lit` = true — полный фон с деталями, его покажет луч.
 */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  def: RoomDef,
  index: number,
  time: number,
  lit: boolean,
): void {
  const d = decorFor(def, index);
  const scene = def.scene ?? 'tunnel';
  const vx = VIEW_W * d.vpx;
  const vy = VIEW_H * d.vpy;

  if (lit) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, COLORS.bgTop);
    g.addColorStop(0.55, COLORS.bgMid);
    g.addColorStop(1, COLORS.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Дымка вокруг точки схода: в глубине тоннеля всегда светлее, чем у стен.
    const haze = ctx.createRadialGradient(vx, vy, 0, vx, vy, VIEW_W * 0.55);
    haze.addColorStop(0, COLORS.depthHaze);
    haze.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  ctx.save();
  if (!lit) ctx.globalAlpha *= 0.32;

  if (scene === 'station' || scene === 'hall') drawStation(ctx, vx, vy, lit, scene === 'hall');
  else if (scene === 'shaft') drawShaft(ctx, vx, vy, time, lit);
  else if (scene === 'depot') drawDepot(ctx, vx, vy, lit);
  else drawTunnel(ctx, vx, vy, lit);

  if (lit) drawWallDetail(ctx, d);

  ctx.restore();
}

// ------------------------------------------------------------------- перегон

/** Кольца тюбинга, уходящие в точку схода. Классический силуэт метро. */
function drawTunnel(
  ctx: CanvasRenderingContext2D,
  vx: number, vy: number, lit: boolean,
): void {
  const RINGS = 10;
  for (let i = RINGS - 1; i >= 0; i--) {
    const s = Math.pow(0.79, i);
    const w = VIEW_W * 0.72 * s;
    const h = VIEW_H * 0.62 * s;

    // Видимость колоколом по глубине: ближние кольца уходят за край кадра,
    // дальние тают в дымке. Резкими остаются только средние — иначе весь свод
    // превращается в равномерную сетку линий и перестаёт читаться как глубина.
    const vis = Math.sin((Math.PI * (i + 0.5)) / RINGS);
    ctx.strokeStyle = lit ? COLORS.archLit : COLORS.archDim;
    ctx.globalAlpha = (lit ? 0.34 : 0.6) * vis;
    ctx.lineWidth = Math.max(0.6, 3.0 * s);

    ctx.beginPath();
    ctx.ellipse(vx, vy, w, h, 0, Math.PI * 0.02, Math.PI * 0.98, true);
    ctx.stroke();

    // Сегменты чугунного кольца: короткие штрихи поперёк свода.
    if (lit && s > 0.28) {
      ctx.lineWidth = Math.max(0.5, 1.2 * s);
      ctx.globalAlpha *= 0.7;
      ctx.beginPath();
      for (let k = 1; k < 9; k++) {
        const a = Math.PI + (Math.PI * k) / 9;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        ctx.moveTo(vx + c * w * 0.93, vy + sn * h * 0.93);
        ctx.lineTo(vx + c * w * 1.06, vy + sn * h * 1.06);
      }
      ctx.stroke();
    }
  }

  // Путь, сходящийся в ту же точку. Обрезаем полосой у пола: если пустить
  // нитки до самой точки схода, они прочерчивают через всё игровое поле крест,
  // который читается как геометрия уровня и врёт игроку про то, куда можно встать.
  ctx.save();
  const floorTop = VIEW_H * 0.72;
  ctx.beginPath();
  ctx.rect(0, floorTop, VIEW_W, VIEW_H - floorTop);
  ctx.clip();

  ctx.strokeStyle = lit ? COLORS.railFar : COLORS.archDim;
  ctx.lineWidth = 1.2;
  const baseY = VIEW_H * 0.98;
  for (const off of [-0.5, -0.16, 0.16, 0.5]) {
    // Гаснут по мере ухода вглубь — иначе дальний план спорит с ближним.
    const g = ctx.createLinearGradient(0, baseY, 0, floorTop);
    g.addColorStop(0, lit ? 'rgba(107, 123, 168, 0.5)' : 'rgba(38, 48, 74, 0.7)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(VIEW_W / 2 + off * VIEW_W * 1.5, baseY);
    ctx.lineTo(vx, vy);
    ctx.stroke();
  }
  if (lit) {
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = COLORS.railFar;
    for (let i = 0; i < 16; i++) {
      const t = Math.pow(i / 16, 1.8);
      const y = baseY + (vy - baseY) * t;
      const half = (1 - t) * VIEW_W * 0.75;
      ctx.beginPath();
      ctx.moveTo(vx - half, y);
      ctx.lineTo(vx + half, y);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// -------------------------------------------------------------------- станция

/**
 * Пилонная станция: ряд колонн с арочными проходами между ними, уходящий
 * в перспективу, и кессонированный свод сверху.
 */
function drawStation(
  ctx: CanvasRenderingContext2D,
  vx: number, vy: number, lit: boolean, grand: boolean,
): void {
  // Всего два плана аркады, а не лестница из шести: вложенные ряды арок
  // на разной глубине сливаются в мусор из дуг и убивают именно то ощущение
  // объёма, ради которого рисовались. Ближняя аркада — сплошные тёмные пилоны,
  // сквозь проёмы видна вторая, бледная. Этого хватает, чтобы прочесть зал.
  const planes = grand ? [0.62, 0.4] : [0.52, 0.34];

  for (let i = planes.length - 1; i >= 0; i--) {
    const s = planes[i];
    const near = i === 0;
    ctx.strokeStyle = lit ? COLORS.archLit : COLORS.archDim;
    ctx.fillStyle = COLORS.bgBottom;
    ctx.lineWidth = Math.max(0.7, 2.4 * s);

    const halfW = VIEW_W * (grand ? 1.0 : 0.86) * s;
    const top = vy - VIEW_H * (grand ? 0.5 : 0.42) * s;
    const bot = vy + VIEW_H * 0.55 * s;
    const cols = grand ? 4 : 3;

    // Пилон — тёмная масса; арка между пилонами — вырез, сквозь который
    // видно следующий план. Заливаем фоном, чтобы дальний ряд не просвечивал.
    for (let k = 0; k < cols; k++) {
      const t0 = k / cols + 0.07;
      const t1 = (k + 1) / cols - 0.07;
      const x0 = vx - halfW + halfW * 2 * t0;
      const x1 = vx - halfW + halfW * 2 * t1;
      const r = (x1 - x0) / 2;

      ctx.globalAlpha = (lit ? 0.5 : 0.75) * (near ? 1 : 0.45);
      ctx.beginPath();
      ctx.moveTo(x0, bot);
      ctx.lineTo(x0, top + r);
      ctx.arc((x0 + x1) / 2, top + r, r, Math.PI, 0);
      ctx.lineTo(x1, bot);
      if (near) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fill();
        ctx.restore();
      }
      ctx.stroke();
    }

    // Карниз над аркадой — горизонталь, которая связывает пилоны в ряд.
    ctx.globalAlpha = (lit ? 0.45 : 0.7) * (near ? 1 : 0.4);
    ctx.beginPath();
    ctx.moveTo(vx - halfW * 1.06, top - 6 * s);
    ctx.lineTo(vx + halfW * 1.06, top - 6 * s);
    ctx.stroke();
  }

  // Свод: кессоны расходятся веером от точки схода.
  if (lit) {
    ctx.globalAlpha = 0.09;
    ctx.strokeStyle = COLORS.archLit;
    ctx.lineWidth = 1;
    for (let k = -6; k <= 6; k++) {
      const a = -Math.PI / 2 + (k / 6) * 1.15;
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(vx + Math.cos(a) * VIEW_W, vy + Math.sin(a) * VIEW_W);
      ctx.stroke();
    }
  }

  // Край платформы на переднем плане — то, что читается как «станция», а не «зал».
  ctx.globalAlpha = lit ? 0.5 : 0.8;
  ctx.strokeStyle = lit ? COLORS.archLit : COLORS.archDim;
  ctx.lineWidth = 2;
  const py = VIEW_H * 0.86;
  ctx.beginPath();
  ctx.moveTo(0, py);
  ctx.lineTo(VIEW_W, py);
  ctx.stroke();
  if (lit) {
    // Ограничительная линия у края платформы.
    ctx.globalAlpha = 0.3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(0, py + 6);
    ctx.lineTo(VIEW_W, py + 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ вентшахта

/** Вертикальный ствол: короба, скобы-лестница и медленно ворочающийся вентилятор. */
function drawShaft(
  ctx: CanvasRenderingContext2D,
  vx: number, vy: number, time: number, lit: boolean,
): void {
  ctx.strokeStyle = lit ? COLORS.archLit : COLORS.archDim;

  // Короба воздуховодов уходят вверх, сужаясь.
  for (let i = 0; i < 5; i++) {
    const s = 1 - i * 0.16;
    ctx.globalAlpha = (lit ? 0.4 : 0.8) * (0.2 + i * 0.16);
    ctx.lineWidth = Math.max(0.7, 2.4 * s);
    const w = VIEW_W * 0.3 * s;
    const y = VIEW_H * (0.1 + i * 0.02);
    ctx.strokeRect(vx - w / 2, y, w, VIEW_H);
  }

  // Скобы-лестница по стволу.
  ctx.globalAlpha = lit ? 0.34 : 0.6;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  const lx = vx + VIEW_W * 0.2;
  for (let y = 20; y < VIEW_H; y += 14) {
    ctx.moveTo(lx - 5, y);
    ctx.lineTo(lx + 5, y);
  }
  ctx.moveTo(lx - 5, 20);
  ctx.lineTo(lx - 5, VIEW_H);
  ctx.moveTo(lx + 5, 20);
  ctx.lineTo(lx + 5, VIEW_H);
  ctx.stroke();

  // Вентилятор в глубине: единственное, что здесь ещё шевелится.
  if (lit) {
    const spin = time * 0.55;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 2;
    const r = 34;
    ctx.beginPath();
    ctx.arc(vx, vy, r, 0, TAU);
    ctx.stroke();
    for (let k = 0; k < 5; k++) {
      const a = spin + (k / 5) * TAU;
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.quadraticCurveTo(
        vx + Math.cos(a + 0.5) * r * 0.7, vy + Math.sin(a + 0.5) * r * 0.7,
        vx + Math.cos(a) * r, vy + Math.sin(a) * r,
      );
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ----------------------------------------------------------------------- депо

/** Депо: стропильные фермы под потолком, кран-балка и остовы вагонов в глубине. */
function drawDepot(
  ctx: CanvasRenderingContext2D,
  vx: number, vy: number, lit: boolean,
): void {
  ctx.strokeStyle = lit ? COLORS.archLit : COLORS.archDim;

  // Фермы: зигзаг между двумя поясами — форма, которую ни с чем не спутать.
  for (let i = 0; i < 4; i++) {
    const s = Math.pow(0.76, i);
    ctx.globalAlpha = (lit ? 0.42 : 0.85) * (0.18 + i * 0.2);
    ctx.lineWidth = Math.max(0.6, 2.0 * s);
    const y = vy - VIEW_H * 0.3 * s;
    const h = 14 * s;
    const halfW = VIEW_W * 0.8 * s;

    ctx.beginPath();
    ctx.moveTo(vx - halfW, y);
    ctx.lineTo(vx + halfW, y);
    ctx.moveTo(vx - halfW, y + h);
    ctx.lineTo(vx + halfW, y + h);
    const segs = Math.max(4, Math.round(14 * s));
    for (let k = 0; k <= segs; k++) {
      const x = vx - halfW + (halfW * 2 * k) / segs;
      ctx.moveTo(x, k % 2 ? y : y + h);
      ctx.lineTo(x + (halfW * 2) / segs / 2, k % 2 ? y + h : y);
    }
    ctx.stroke();
  }

  // Кран-балка поперёк зала.
  ctx.globalAlpha = lit ? 0.34 : 0.7;
  ctx.lineWidth = 3;
  const cy = vy - VIEW_H * 0.14;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(VIEW_W, cy);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(VIEW_W * 0.36, cy);
  ctx.lineTo(VIEW_W * 0.36, cy + 18);
  ctx.moveTo(VIEW_W * 0.3, cy + 18);
  ctx.lineTo(VIEW_W * 0.42, cy + 18);
  ctx.stroke();

  // Остовы вагонов в глубине — просто длинные коробки с проёмами окон.
  if (lit) {
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < 2; i++) {
      const s = 0.7 - i * 0.22;
      const w = VIEW_W * 0.5 * s;
      const h = 34 * s;
      const x = vx - w / 2 + (i ? 60 : -70) * s;
      const y = vy + 10 * s;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x, y, w, h);
      const win = Math.round(6 * s) + 2;
      for (let k = 1; k < win; k++) {
        const wx = x + (w * k) / win;
        ctx.strokeRect(wx - 2 * s, y + 6 * s, 5 * s, 9 * s);
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------- детали путевой стены

/** Копоть, протечки, ниши и кабельные трассы — то, что делает стену обжитой. */
function drawWallDetail(ctx: CanvasRenderingContext2D, d: Decor): void {
  // Пятна: мягкие радиальные кляксы, ломающие ровный градиент.
  for (const s of d.stains) {
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
    g.addColorStop(0, `rgba(10, 14, 24, ${s.a})`);
    g.addColorStop(1, 'rgba(10, 14, 24, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
  }

  // Ниши и служебные двери.
  ctx.globalAlpha = 0.34;
  ctx.strokeStyle = COLORS.archLit;
  ctx.lineWidth = 1.2;
  for (const n of d.niches) {
    ctx.beginPath();
    ctx.moveTo(n.x, n.y + n.h);
    ctx.lineTo(n.x, n.y + n.w / 2);
    ctx.arc(n.x + n.w / 2, n.y + n.w / 2, n.w / 2, Math.PI, 0);
    ctx.lineTo(n.x + n.w, n.y + n.h);
    ctx.stroke();
    if (n.door) {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = COLORS.archFill;
      ctx.fillRect(n.x + 2, n.y + n.w / 2, n.w - 4, n.h - n.w / 2);
      ctx.globalAlpha = 0.34;
    }
  }

  // Кабельная трасса вдоль стены: пучок линий с редкими кронштейнами.
  ctx.globalAlpha = 0.26;
  ctx.strokeStyle = COLORS.cable;
  const ty = VIEW_H * 0.3;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, ty + i * 2.6);
    ctx.bezierCurveTo(VIEW_W * 0.3, ty + i * 2.6 + 5, VIEW_W * 0.7, ty + i * 2.6 - 4, VIEW_W, ty + i * 2.6 + 2);
    ctx.stroke();
  }
  ctx.lineWidth = 1.6;
  for (let x = 24; x < VIEW_W; x += 78) {
    ctx.beginPath();
    ctx.moveTo(x, ty - 3);
    ctx.lineTo(x, ty + 12);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

// -------------------------------------------------------------- передний план

/**
 * Передний план: провисающие кабели и оборванные провода поверх всей сцены.
 * Они почти чёрные и намеренно НЕ освещаются — силуэт перед лицом даёт глубину
 * сильнее, чем любая деталь в глубине.
 */
export function drawForeground(
  ctx: CanvasRenderingContext2D,
  def: RoomDef,
  index: number,
  time: number,
): void {
  const d = decorFor(def, index);

  ctx.save();
  ctx.strokeStyle = COLORS.foreground;
  ctx.lineCap = 'round';

  for (const c of d.cables) {
    // Медленное покачивание: тоннель «дышит» сквозняком.
    const sway = Math.sin(time * 0.4 + c.y) * 1.6;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = c.w;
    ctx.beginPath();
    ctx.moveTo(c.x0, c.y);
    ctx.quadraticCurveTo((c.x0 + c.x1) / 2, c.y + c.sag + sway, c.x1, c.y - 4);
    ctx.stroke();
  }

  for (const dr of d.drops) {
    const sway = Math.sin(time * 0.6 + dr.x) * 2.2;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = dr.w;
    ctx.beginPath();
    ctx.moveTo(dr.x, dr.y);
    ctx.quadraticCurveTo(dr.x + sway * 0.5, dr.y + dr.len * 0.6, dr.x + sway, dr.y + dr.len);
    ctx.stroke();
  }

  ctx.restore();
}
