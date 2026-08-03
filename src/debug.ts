import { ROOM_H, ROOM_W, TILE, VIEW_W } from './tuning';
import { Tile, tileAt, type Room } from './level';
import { Player } from './player';

/**
 * Debug-оверлей (F1) — это «глаза» при отладке физики: без него причина
 * залипания в стене или пропущенного вол-джампа не видна вообще.
 */
export const debugState = { on: false, fps: 0 };

let frames = 0;
let acc = 0;

export function tickDebug(realDt: number): void {
  frames++;
  acc += realDt;
  if (acc >= 0.5) {
    debugState.fps = Math.round(frames / acc);
    frames = 0;
    acc = 0;
  }
}

export function drawDebug(ctx: CanvasRenderingContext2D, room: Room, p: Player): void {
  if (!debugState.on) return;

  ctx.save();

  // Хитбоксы твёрдых тайлов и шипов.
  ctx.lineWidth = 1;
  for (let ty = 0; ty < ROOM_H; ty++) {
    for (let tx = 0; tx < ROOM_W; tx++) {
      const t = tileAt(room, tx, ty);
      if (t === Tile.Empty) continue;
      ctx.strokeStyle = t === Tile.Spike ? 'rgba(255,80,80,0.6)' : 'rgba(80,255,160,0.25)';
      ctx.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, TILE - 1, TILE - 1);
    }
  }

  // Хитбокс игрока и вектор скорости.
  ctx.strokeStyle = '#ffe14d';
  ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
  ctx.strokeStyle = '#ff8a3d';
  ctx.beginPath();
  ctx.moveTo(p.cx, p.cy);
  ctx.lineTo(p.cx + p.vx * 0.12, p.cy + p.vy * 0.12);
  ctx.stroke();

  const lines = [
    `fps ${debugState.fps}`,
    `pos ${p.x.toFixed(0)},${p.y.toFixed(0)}`,
    `vel ${p.vx.toFixed(0)},${p.vy.toFixed(0)}`,
    `ground ${p.onGround ? 1 : 0}  wall ${p.wallDir}  face ${p.facing}`,
    `coyote ${p.coyote.toFixed(2)}  varJump ${p.varJumpTimer.toFixed(2)}`,
    `dashes ${p.dashes}  t ${p.dashTimer.toFixed(2)}  cd ${p.dashCooldown.toFixed(2)}`,
    `wallLock ${p.wallJumpLock.toFixed(2)}`,
  ];
  ctx.font = '10px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(VIEW_W - 190, 26, 180, lines.length * 12 + 8);
  ctx.fillStyle = '#9effc9';
  lines.forEach((l, i) => ctx.fillText(l, VIEW_W - 182, 32 + i * 12));

  ctx.restore();
}
