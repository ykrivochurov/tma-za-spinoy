import { FIXED_DT, MAX_STEPS_PER_FRAME, VIEW_H, VIEW_W } from './tuning';
import { buildRoom, ROOM_COUNT, updateCrystals, validateRooms, type Room } from './level';
import { endInputFrame, initInput, input, updateInput } from './input';
import { Player } from './player';
import { addFlash, fx, resetFx, updateFx } from './fx';
import { clearParticles, updateParticles } from './particles';
import { drawOverlay, drawWorld } from './render';
import { drawBeamHaze, drawLightMask, light, resetLight, updateLight } from './lighting';
import { updateCreatures, updateCrumble, updateDoors, updateDresinas } from './entities';
import { drawDebug, debugState, tickDebug } from './debug';
import { drawHero, resetHeroAnim, updateHero } from './hero';
import { drawForeground } from './backdrop';
import { applyPost } from './post';
import { audioLevel, audioState, initAudio, sfx, toggleMute, updateAudio } from './audio';
import { COLORS } from './palette';

// --------------------------------------------------------------------- инициализация

const errors = validateRooms();
if (errors.length) {
  // Кривая карта — самая частая и самая незаметная ошибка. Падаем громко.
  console.error('Ошибки в картах комнат:\n' + errors.join('\n'));
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// Два вспомогательных холста: на одном собирается освещённая сцена,
// на другом — маска света, которой она обрезается.
const litCanvas = document.createElement('canvas');
const litCtx = litCanvas.getContext('2d')!;
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d')!;

initInput();
initAudio();

const player = new Player();

const state = {
  roomIndex: 0,
  room: buildRoom(0),
  deaths: 0,
  timeMs: 0,
  won: false,
};

function enterRoom(index: number): void {
  state.roomIndex = index;
  state.room = buildRoom(index);
  player.spawnAt(state.room.spawn.x, state.room.spawn.y);
  resetLight(player);
  resetHeroAnim();
  clearParticles();
  resetFx();
}

function respawn(): void {
  player.spawnAt(state.room.spawn.x, state.room.spawn.y);
  resetLight(player);
  resetHeroAnim();
}

function restartRun(): void {
  state.deaths = 0;
  state.timeMs = 0;
  state.won = false;
  enterRoom(0);
}

enterRoom(0);

// Состояние наружу: позволяет прогонять игру скриптом (автотесты, проверка проходимости)
// и смотреть живые значения из консоли, не останавливая цикл.
(window as unknown as Record<string, unknown>).__game = {
  state, player, light, enterRoom, restartRun, audioState, audioLevel, sfx, toggleMute,
};

// ------------------------------------------------------------------ масштабирование

let scale = 1;

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const css = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  scale = css * dpr;

  canvas.style.width = `${Math.floor(VIEW_W * css)}px`;
  canvas.style.height = `${Math.floor(VIEW_H * css)}px`;

  for (const [cv, c] of [[canvas, ctx], [litCanvas, litCtx], [maskCanvas, maskCtx]] as const) {
    cv.width = Math.floor(VIEW_W * scale);
    cv.height = Math.floor(VIEW_H * scale);
    // Рисуем всегда в логических 640x368, масштаб живёт в трансформации контекста.
    c.setTransform(scale, 0, 0, scale, 0, 0);
  }
}
window.addEventListener('resize', resize);
resize();

/** Копирует холст один-в-один, минуя логическую трансформацию. */
function blit(dst: CanvasRenderingContext2D, src: HTMLCanvasElement): void {
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  dst.drawImage(src, 0, 0);
  dst.restore();
}

function clear(c: CanvasRenderingContext2D, cv: HTMLCanvasElement): void {
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  c.restore();
}

// ------------------------------------------------------------------------ симуляция

function step(dt: number): void {
  const room: Room = state.room;

  if (player.dead) {
    player.update(room, dt);
    updateLight(player, dt);
    updateParticles(dt);
    if (player.deadTimer <= 0) {
      state.deaths++;
      respawn();
    }
    return;
  }

  // Подвижные твёрдые тела ходят до игрока: сначала мир, потом реакция на мир.
  updateDoors(room, player, dt);
  updateDresinas(room, player, dt);

  player.update(room, dt);
  if (player.dead) addFlash(0.08, player.rad >= 1 ? COLORS.rad : COLORS.spike);

  updateLight(player, dt);
  updateCrumble(room, player, dt);
  updateCreatures(room, player, dt);
  updateCrystals(room, dt);
  updateParticles(dt);

  // Выбежал за правый край — перегон пройден.
  if (player.x > VIEW_W) {
    if (state.roomIndex + 1 < ROOM_COUNT) {
      addFlash(0.06, COLORS.beam);
      sfx.roomEnter();
      enterRoom(state.roomIndex + 1);
    } else {
      state.won = true;
      sfx.goal();
    }
    return;
  }

  if (room.goal && !state.won) {
    const g = room.goal;
    if (Math.abs(g.x - player.cx) < 16 && Math.abs(g.y - 16 - player.cy) < 26) {
      state.won = true;
      addFlash(0.25, COLORS.goal);
      sfx.goal();
    }
  }
}

// ------------------------------------------------------------------------ отрисовка

let frameCount = 0;

function render(time: number): void {
  const room = state.room;

  // 1. То, что видно всегда: дальний план и силуэты геометрии.
  ctx.fillStyle = COLORS.bgBottom;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.save();
  ctx.translate(fx.shakeX, fx.shakeY);
  drawWorld(ctx, room, state.roomIndex, time, 'dim');
  ctx.restore();

  // 2. Полная сцена — на отдельном холсте.
  clear(litCtx, litCanvas);
  litCtx.save();
  litCtx.translate(fx.shakeX, fx.shakeY);
  drawWorld(litCtx, room, state.roomIndex, time, 'lit');
  drawBeamHaze(litCtx, player.dead);
  litCtx.restore();

  // 3. Маска света и обрезка по ней: во тьме получается не затемнение,
  //    а именно отсутствие изображения.
  clear(maskCtx, maskCanvas);
  maskCtx.save();
  maskCtx.translate(fx.shakeX, fx.shakeY);
  drawLightMask(maskCtx, room, time, player.dead);
  maskCtx.restore();

  litCtx.save();
  litCtx.setTransform(1, 0, 0, 1, 0, 0);
  litCtx.globalCompositeOperation = 'destination-in';
  litCtx.drawImage(maskCanvas, 0, 0);
  litCtx.restore();

  blit(ctx, litCanvas);

  // 4. Игрок — поверх композита: сам себе источник света, виден всегда.
  ctx.save();
  ctx.translate(fx.shakeX, fx.shakeY);
  drawHero(ctx, player);
  ctx.restore();

  // 5. Передний план поверх всего и БЕЗ маски света: кабели перед лицом
  //    не освещаются собственным фонарём — они и дают ощущение глубины.
  drawForeground(ctx, room.def, state.roomIndex, time);

  // 6. Постобработка по готовому кадру — до интерфейса, чтобы текст остался резким.
  applyPost(ctx, canvas, frameCount++, player.rad);

  ctx.save();
  ctx.translate(fx.shakeX, fx.shakeY);
  drawDebug(ctx, room, player);
  ctx.restore();

  drawOverlay(ctx, room, player.rad, state.deaths, state.timeMs, state.won);
}

/**
 * Насколько близко подобралась ближайшая НЕотогнанная тварь, 0..1.
 * Из этого числа растёт рычание: игрок слышит, что сзади кто-то есть,
 * раньше, чем успевает обернуться и посветить.
 */
function nearestThreat(): number {
  let worst = 0;
  for (const c of state.room.creatures) {
    if (c.repelled || c.gone || c.dying > 0) continue;
    const d = Math.hypot(c.x - player.cx, c.y - player.cy);
    worst = Math.max(worst, 1 - Math.min(1, d / 210));
  }
  return worst;
}

// ---------------------------------------------------------------------- игровой цикл

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const realDt = Math.min((now - last) / 1000, 0.1);
  last = now;

  updateInput(realDt);
  updateFx(realDt);
  tickDebug(realDt);
  // Анимация — не симуляция: поза живёт от реального времени, поэтому она
  // остаётся плавной и во время hitstop, когда физика стоит.
  updateHero(player, realDt);

  if (input.debugPressed) debugState.on = !debugState.on;
  if (input.mutePressed) console.log(toggleMute() ? 'звук выключен' : 'звук включён');

  // Звук ведём от РЕАЛЬНОГО времени и строго односторонне: он читает состояние
  // мира, но ничего в нём не трогает — иначе детерминизм шага перестаёт им быть.
  updateAudio(realDt, player.rad, nearestThreat(), Math.min(1, state.room.wind / 240));
  if (input.roomSelect >= 0 && input.roomSelect < ROOM_COUNT) {
    state.won = false;
    enterRoom(input.roomSelect);
  }
  if (input.restartPressed) {
    if (state.won) restartRun();
    else respawn();
  }

  // Hitstop: на время заморозки симуляция стоит, но эффекты и ввод живут.
  if (fx.freeze <= 0 && !state.won) {
    accumulator += realDt;
    state.timeMs += realDt * 1000;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      step(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    // Провал по производительности не должен превращаться в «долг» симуляции.
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
  }

  render(now / 1000);

  endInputFrame();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

console.log(
  '%cТЬМА ЗА СПИНОЙ%c  %d перегонов   ·   1..9 — выбор   ·   F1 — debug   ·   R — рестарт   ·   M — звук',
  'color:#ffb45c;font-weight:bold', 'color:#5d6684', ROOM_COUNT,
);
