import { DARK_VISIBILITY, LAMP_R, ROOM_H, ROOM_W, TILE, VIEW_H, VIEW_W } from './tuning';
import { Crumb, Tile, tileAt, type Room } from './level';
import { COLORS } from './palette';
import { drawParticles } from './particles';
import { drawBackdrop } from './backdrop';
import { drawCreature } from './bestiary';

/**
 * Весь арт — векторный и процедурный: ни одного файла-ассета.
 *
 * Главное правило картинки: ПОРОДА — ЭТО МАССА, А НЕ КОНТУР. Твёрдые тайлы
 * заливаются почти-чёрным единым силуэтом, и читаются они не заливкой, а
 * кромкой, поймавшей свет, плюс затеканием тьмы в пустоту рядом. Поэтому
 * игровое пространство выглядит вырезанным в скале, а не набором палок в вакууме.
 *
 * Мир рисуется дважды одной и той же функцией:
 *   'dim' — то, что видно всегда: силуэты геометрии и опасностей. Платформинг честный.
 *   'lit' — полная картинка; она обрезается маской света, поэтому детали, цвет
 *           и тварей показывает только луч.
 */
export type Pass = 'dim' | 'lit';

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  room: Room,
  index: number,
  time: number,
  pass: Pass,
): void {
  const lit = pass === 'lit';

  drawBackdrop(ctx, room.def, index, time, lit);
  if (!lit) ctx.globalAlpha = DARK_VISIBILITY;

  drawMass(ctx, room, lit);
  drawCrumble(ctx, room, time, lit);
  drawRad(ctx, room, time, lit);
  drawSpikes(ctx, room, lit);
  drawDoors(ctx, room, lit);
  drawDresinas(ctx, room, lit);
  drawCrystals(ctx, room, time, lit);
  drawGoal(ctx, room, time, lit);

  for (const c of room.creatures) drawCreature(ctx, c, lit);

  if (lit) {
    drawLamps(ctx, room, time);
    drawParticles(ctx);
  }

  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ порода

const isSolid = (room: Room, x: number, y: number): boolean =>
  tileAt(room, x, y) === Tile.Solid;

/**
 * Порода одним силуэтом: сначала сплошная заливка, потом затекание тьмы
 * в прилегающую пустоту, и только потом — светящаяся кромка на открытых гранях.
 *
 * Порядок важен: кромка должна лечь поверх затекания, иначе она сама себя гасит.
 */
function drawMass(ctx: CanvasRenderingContext2D, room: Room, lit: boolean): void {
  // --- 1. тело породы
  ctx.fillStyle = lit ? COLORS.massFill : '#000000';
  ctx.beginPath();
  for (let ty = 0; ty < ROOM_H; ty++) {
    for (let tx = 0; tx < ROOM_W; tx++) {
      if (!isSolid(room, tx, ty)) continue;
      ctx.rect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }
  ctx.fill();

  // --- 2. неоднородность камня: чуть более светлое ядро в глубине массива,
  //        чтобы порода не выглядела вырезанной из бумаги
  if (lit) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = COLORS.massCore;
    ctx.globalAlpha = 0.55;
    for (let ty = 0; ty < ROOM_H; ty++) {
      for (let tx = 0; tx < ROOM_W; tx++) {
        if (!isSolid(room, tx, ty)) continue;
        // Клетка глубоко внутри массива — все четыре соседа твёрдые.
        if (!isSolid(room, tx, ty - 1) || !isSolid(room, tx, ty + 1)) continue;
        if (!isSolid(room, tx - 1, ty) || !isSolid(room, tx + 1, ty)) continue;
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // --- 3. затекание тьмы: у каждой открытой грани пустота рядом темнее
  const AO = 11;
  const alpha = ctx.globalAlpha;
  for (let ty = 0; ty < ROOM_H; ty++) {
    for (let tx = 0; tx < ROOM_W; tx++) {
      if (!isSolid(room, tx, ty)) continue;
      const x = tx * TILE;
      const y = ty * TILE;

      if (!isSolid(room, tx, ty - 1)) shadeFace(ctx, x, y, TILE, -AO, false, alpha);
      if (!isSolid(room, tx, ty + 1)) shadeFace(ctx, x, y + TILE, TILE, AO, false, alpha);
      if (!isSolid(room, tx - 1, ty)) shadeFace(ctx, x, y, TILE, -AO, true, alpha);
      if (!isSolid(room, tx + 1, ty)) shadeFace(ctx, x + TILE, y, TILE, AO, true, alpha);
    }
  }
  ctx.globalAlpha = alpha;

  // --- 4. кромка: верхние грани ярко (на них садятся), боковые и нижние глухо
  ctx.save();
  ctx.lineCap = 'butt';

  ctx.strokeStyle = lit ? COLORS.massEdgeDim : COLORS.massEdgeDim;
  ctx.globalAlpha = alpha * (lit ? 0.5 : 1);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let ty = 0; ty < ROOM_H; ty++) {
    for (let tx = 0; tx < ROOM_W; tx++) {
      if (!isSolid(room, tx, ty)) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      if (!isSolid(room, tx, ty + 1)) { ctx.moveTo(x, y + TILE - 0.75); ctx.lineTo(x + TILE, y + TILE - 0.75); }
      if (!isSolid(room, tx - 1, ty)) { ctx.moveTo(x + 0.75, y); ctx.lineTo(x + 0.75, y + TILE); }
      if (!isSolid(room, tx + 1, ty)) { ctx.moveTo(x + TILE - 0.75, y); ctx.lineTo(x + TILE - 0.75, y + TILE); }
    }
  }
  ctx.stroke();

  ctx.strokeStyle = lit ? COLORS.massEdge : COLORS.massEdgeDim;
  ctx.globalAlpha = alpha;
  if (lit) {
    ctx.shadowColor = COLORS.massEdge;
    ctx.shadowBlur = 3;
  }
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let ty = 0; ty < ROOM_H; ty++) {
    for (let tx = 0; tx < ROOM_W; tx++) {
      if (!isSolid(room, tx, ty) || isSolid(room, tx, ty - 1)) continue;
      const x = tx * TILE;
      ctx.moveTo(x, ty * TILE + 1);
      ctx.lineTo(x + TILE, ty * TILE + 1);
    }
  }
  ctx.stroke();
  ctx.restore();

  // --- 5. рельсы по открытым верхним граням: пол читается как путь, а не полка
  if (lit) {
    ctx.strokeStyle = COLORS.rail;
    ctx.globalAlpha = alpha * 0.9;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let ty = 0; ty < ROOM_H; ty++) {
      for (let tx = 0; tx < ROOM_W; tx++) {
        if (!isSolid(room, tx, ty) || isSolid(room, tx, ty - 1)) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        ctx.moveTo(x, y + 6.5);
        ctx.lineTo(x + TILE, y + 6.5);
        ctx.moveTo(x + 4.5, y + 3);
        ctx.lineTo(x + 4.5, y + 10);
        ctx.moveTo(x + 11.5, y + 3);
        ctx.lineTo(x + 11.5, y + 10);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }
}

/** Полоса затекающей тьмы от грани породы в пустоту. */
function shadeFace(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, len: number, depth: number, vertical: boolean, alpha: number,
): void {
  const g = vertical
    ? ctx.createLinearGradient(x, y, x + depth, y)
    : ctx.createLinearGradient(x, y, x, y + depth);
  g.addColorStop(0, COLORS.massShade);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.globalAlpha = alpha * 0.9;
  if (vertical) ctx.fillRect(Math.min(x, x + depth), y, Math.abs(depth), len);
  else ctx.fillRect(x, Math.min(y, y + depth), len, Math.abs(depth));
}

// ------------------------------------------------------------- гнилые шпалы

function drawCrumble(ctx: CanvasRenderingContext2D, room: Room, time: number, lit: boolean): void {
  for (let ty = 0; ty < ROOM_H; ty++) {
    for (let tx = 0; tx < ROOM_W; tx++) {
      if (tileAt(room, tx, ty) !== Tile.Crumble) continue;
      const st = room.crumbState[ty * ROOM_W + tx];
      if (st === Crumb.Gone) continue;
      const shake = st === Crumb.Shaking ? Math.sin(time * 60 + tx) * 1.5 : 0;
      const x = tx * TILE + shake;
      const y = ty * TILE;

      ctx.fillStyle = lit ? COLORS.massFill : '#000000';
      ctx.fillRect(x, y, TILE, TILE);
      // Шпала — брус: три доски поперёк, чтобы отличалась от бетона на глаз.
      ctx.strokeStyle = st === Crumb.Shaking ? COLORS.alarm : COLORS.massEdgeDim;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
      if (lit) {
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 1; k < 3; k++) {
          ctx.moveTo(x + 2, y + (TILE * k) / 3);
          ctx.lineTo(x + TILE - 2, y + (TILE * k) / 3);
        }
        ctx.stroke();
      }
    }
  }
}

// ------------------------------------------------------------------ радиация

function drawRad(ctx: CanvasRenderingContext2D, room: Room, time: number, lit: boolean): void {
  const alpha = ctx.globalAlpha;
  for (let ty = 0; ty < ROOM_H; ty++) {
    for (let tx = 0; tx < ROOM_W; tx++) {
      if (tileAt(room, tx, ty) !== Tile.Rad) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      // Заливка намеренно слабая: плотное зелёное пятно читается как стена,
      // а это проходимая зона. Границу обозначает яркая кромка сверху.
      ctx.fillStyle = lit ? 'rgba(127, 217, 74, 0.09)' : 'rgba(127, 217, 74, 0.26)';
      ctx.fillRect(x, y, TILE, TILE);

      if (tileAt(room, tx, ty - 1) !== Tile.Rad) {
        ctx.strokeStyle = COLORS.rad;
        ctx.globalAlpha = alpha * (0.7 + Math.sin(time * 6 + tx) * 0.25);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y + 1);
        ctx.lineTo(x + TILE, y + 1);
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }
      if (!lit) continue;

      // Дрожащие штрихи: зона «шевелится», её видно даже краем глаза.
      ctx.strokeStyle = COLORS.rad;
      ctx.globalAlpha = alpha * (0.5 + Math.sin(time * 4 + tx * 0.9 + ty * 1.7) * 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const o = (Math.sin(time * 2 + tx + ty) * 3) | 0;
      ctx.moveTo(x + 2, y + 8 + o);
      ctx.lineTo(x + TILE - 2, y + 8 - o);
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }
  }
}

// ------------------------------------------------------------------ арматура

function drawSpikes(ctx: CanvasRenderingContext2D, room: Room, lit: boolean): void {
  ctx.save();
  if (lit) {
    ctx.shadowColor = COLORS.spikeGlow;
    ctx.shadowBlur = 10;
  }
  ctx.fillStyle = lit ? COLORS.spike : '#5c1f1a';
  for (let ty = 0; ty < ROOM_H; ty++) {
    for (let tx = 0; tx < ROOM_W; tx++) {
      if (tileAt(room, tx, ty) !== Tile.Spike) continue;
      drawSpikeTile(ctx, room, tx, ty);
    }
  }
  ctx.restore();
}

function drawSpikeTile(ctx: CanvasRenderingContext2D, room: Room, tx: number, ty: number): void {
  const x = tx * TILE;
  const y = ty * TILE;
  // Ориентация выводится из соседей: арматура торчит из ближайшей стены.
  const down = isSolid(room, tx, ty + 1);
  const up = isSolid(room, tx, ty - 1);
  const left = isSolid(room, tx - 1, ty);

  const spikes = 3;
  const step = TILE / spikes;
  ctx.beginPath();
  for (let i = 0; i < spikes; i++) {
    const o = i * step;
    if (down || (!up && !left)) {
      ctx.moveTo(x + o, y + TILE);
      ctx.lineTo(x + o + step / 2, y + TILE * 0.25);
      ctx.lineTo(x + o + step, y + TILE);
    } else if (up) {
      ctx.moveTo(x + o, y);
      ctx.lineTo(x + o + step / 2, y + TILE * 0.75);
      ctx.lineTo(x + o + step, y);
    } else if (left) {
      ctx.moveTo(x, y + o);
      ctx.lineTo(x + TILE * 0.75, y + o + step / 2);
      ctx.lineTo(x, y + o + step);
    } else {
      ctx.moveTo(x + TILE, y + o);
      ctx.lineTo(x + TILE * 0.25, y + o + step / 2);
      ctx.lineTo(x + TILE, y + o + step);
    }
  }
  ctx.fill();
}

// --------------------------------------------------------------------- объекты

function drawLamps(ctx: CanvasRenderingContext2D, room: Room, time: number): void {
  for (const l of room.lamps) {
    const flicker = 0.85 + Math.sin(time * 7.3 + l.seed) * 0.09 + Math.sin(time * 23 + l.seed * 3) * 0.06;

    // Тёплый налив поверх сцены. Маска света бесцветна, поэтому без этого слоя
    // натриевая лампа освещала бы тоннель тем же холодным светом, что и фонарь.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const warm = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, LAMP_R);
    warm.addColorStop(0, `rgba(255, 180, 92, ${0.34 * flicker})`);
    warm.addColorStop(0.5, `rgba(255, 150, 70, ${0.14 * flicker})`);
    warm.addColorStop(1, 'rgba(255, 140, 60, 0)');
    ctx.fillStyle = warm;
    ctx.fillRect(l.x - LAMP_R, l.y - LAMP_R, LAMP_R * 2, LAMP_R * 2);
    ctx.restore();

    ctx.save();
    // Плафон в решётчатом кожухе на кронштейне — а не парящая точка.
    ctx.strokeStyle = COLORS.massEdgeDim;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(l.x, l.y - 12);
    ctx.lineTo(l.x, l.y - 3);
    ctx.moveTo(l.x - 7, l.y - 3);
    ctx.lineTo(l.x + 7, l.y - 3);
    ctx.stroke();

    ctx.shadowColor = COLORS.lamp;
    ctx.shadowBlur = 22 * flicker;
    ctx.fillStyle = COLORS.lampCore;
    ctx.globalAlpha = flicker;
    ctx.fillRect(l.x - 5, l.y - 2, 10, 4);
    ctx.fillStyle = COLORS.lamp;
    ctx.fillRect(l.x - 6, l.y + 2, 12, 1.2);
    ctx.restore();
  }
}

function drawDoors(ctx: CanvasRenderingContext2D, room: Room, lit: boolean): void {
  for (const g of room.doors) {
    // Гермозатвор виден в темноте всегда: он мигает собственной аварийной лампой.
    const alpha = ctx.globalAlpha;
    if (g.warning) ctx.globalAlpha = 1;

    if (g.closed) {
      ctx.fillStyle = lit ? COLORS.massCore : '#05070c';
      ctx.fillRect(g.x, g.y, g.w, g.h);
      ctx.strokeStyle = COLORS.alarm;
      ctx.lineWidth = 2;
      ctx.strokeRect(g.x + 1, g.y + 1, g.w - 2, g.h - 2);
      if (lit) {
        ctx.strokeStyle = COLORS.alarmDim;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = g.y + 4; y < g.y + g.h; y += 8) {
          ctx.moveTo(g.x + 2, y);
          ctx.lineTo(g.x + g.w - 2, y);
        }
        ctx.stroke();
      }
    } else {
      // Открыт: остаются только направляющие в проёме и аварийный маячок.
      ctx.strokeStyle = g.warning ? COLORS.alarm : COLORS.alarmDim;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(g.x + 1, g.y);
      ctx.lineTo(g.x + 1, g.y + g.h);
      ctx.moveTo(g.x + g.w - 1, g.y);
      ctx.lineTo(g.x + g.w - 1, g.y + g.h);
      ctx.stroke();

      ctx.fillStyle = COLORS.alarm;
      ctx.fillRect(g.x + g.w / 2 - 2, g.y - 4, 4, 4);
    }
    ctx.globalAlpha = alpha;
  }
}

function drawDresinas(ctx: CanvasRenderingContext2D, room: Room, lit: boolean): void {
  for (const d of room.dresinas) {
    ctx.fillStyle = lit ? COLORS.massCore : '#05070c';
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.strokeStyle = lit ? COLORS.massEdge : COLORS.massEdgeDim;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(d.x + 1, d.y + 1);
    ctx.lineTo(d.x + d.w - 1, d.y + 1);
    ctx.stroke();
    if (!lit) continue;

    ctx.strokeStyle = COLORS.rail;
    ctx.lineWidth = 1;
    ctx.strokeRect(d.x + 1.5, d.y + 1.5, d.w - 3, d.h - 3);
    // Колёса и рычаг: без них платформа не читается как едущая.
    ctx.fillStyle = COLORS.rail;
    ctx.fillRect(d.x + 5, d.y + d.h - 1, 5, 3);
    ctx.fillRect(d.x + d.w - 10, d.y + d.h - 1, 5, 3);
    ctx.beginPath();
    ctx.moveTo(d.x + d.w / 2, d.y + 1);
    ctx.lineTo(d.x + d.w / 2 + 3, d.y - 7);
    ctx.stroke();
  }
}

function drawCrystals(ctx: CanvasRenderingContext2D, room: Room, time: number, lit: boolean): void {
  for (const c of room.crystals) {
    if (!c.alive) continue;
    const pulse = 1 + Math.sin(time * 5 + c.x) * 0.12;
    ctx.save();
    ctx.translate(c.x, c.y + Math.sin(time * 2.2 + c.x) * 2);
    ctx.rotate(Math.PI / 4 + time * 0.8);
    if (lit) {
      ctx.shadowColor = COLORS.crystal;
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = COLORS.crystal;
    const s = 9 * pulse;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
}

function drawGoal(ctx: CanvasRenderingContext2D, room: Room, time: number, lit: boolean): void {
  if (!room.goal) return;
  const { x, y } = room.goal;
  const pulse = Math.sin(time * 3) * 0.5 + 0.5;
  ctx.save();
  if (lit) {
    ctx.shadowColor = COLORS.goal;
    ctx.shadowBlur = 14 + pulse * 12;
  }
  ctx.strokeStyle = COLORS.goal;
  ctx.lineWidth = 2;
  const alpha = ctx.globalAlpha;
  for (let i = 0; i < 3; i++) {
    const r = 10 + i * 7 + pulse * 4;
    ctx.globalAlpha = alpha * (0.8 - i * 0.25);
    ctx.beginPath();
    ctx.arc(x, y - 14, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.goal;
  ctx.fillRect(x - 3, y - 34, 6, 34);
  ctx.restore();
}

// -------------------------------------------------------------------- интерфейс

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  room: Room,
  rad: number,
  deaths: number,
  timeMs: number,
  won: boolean,
): void {
  const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.3, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, COLORS.vignette);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.font = '11px ui-monospace, monospace';
  ctx.textBaseline = 'top';

  ctx.fillStyle = COLORS.uiBright;
  ctx.fillText(room.def.name, 12, 10);

  ctx.fillStyle = COLORS.ui;
  ctx.textAlign = 'right';
  ctx.fillText(`СМЕРТЕЙ ${deaths}   ${formatTime(timeMs)}`, VIEW_W - 12, 10);
  ctx.textAlign = 'left';

  // Дозиметр: появляется только когда есть что показывать.
  if (rad > 0.01) {
    const w = 90;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(12, VIEW_H - 30, w + 4, 12);
    ctx.fillStyle = COLORS.rad;
    ctx.fillRect(14, VIEW_H - 28, w * rad, 8);
    ctx.strokeStyle = COLORS.rad;
    ctx.lineWidth = 1;
    ctx.strokeRect(13.5, VIEW_H - 28.5, w + 1, 9);
    ctx.fillStyle = rad > 0.6 ? COLORS.alarm : COLORS.ui;
    ctx.fillText('ФОН', 12 + w + 12, VIEW_H - 29);
  }

  if (room.def.hint) {
    ctx.fillStyle = COLORS.ui;
    ctx.textAlign = 'center';
    ctx.fillText(room.def.hint, VIEW_W / 2, VIEW_H - 22);
    ctx.textAlign = 'left';
  }

  if (won) {
    ctx.fillStyle = 'rgba(4, 4, 10, 0.85)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.goal;
    ctx.font = '26px ui-monospace, monospace';
    ctx.fillText('НАВЕРХ', VIEW_W / 2, VIEW_H / 2 - 40);
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillStyle = COLORS.uiBright;
    ctx.fillText(`${formatTime(timeMs)}   ·   смертей: ${deaths}`, VIEW_W / 2, VIEW_H / 2 + 4);
    ctx.fillStyle = COLORS.ui;
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('R — пройти заново', VIEW_W / 2, VIEW_H / 2 + 34);
    ctx.textAlign = 'left';
  }
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 10);
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
