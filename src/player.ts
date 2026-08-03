import {
  AIR_MULT, COYOTE_TIME, DASH_COOLDOWN, DASH_END_SPEED, DASH_FREEZE, DASH_REFILL,
  DASH_SPEED, DASH_TIME, DEATH_FREEZE, DEATH_TIME, FAST_MAX_FALL, GRAVITY,
  HALF_GRAV_THRESHOLD, JUMP_H_BOOST, JUMP_SPEED, MAX_FALL,
  MAX_RUN, PLAYER_H, PLAYER_W, RAD_DEATH_TIME, RAD_RECOVER_MULT, RESPAWN_TIME,
  RUN_ACCEL, RUN_REDUCE, SHAKE_DASH,
  SHAKE_DEATH, SHAKE_LAND, SQUASH_JUMP, SQUASH_LAND, SQUASH_RECOVER, VAR_JUMP_TIME,
  VIEW_H, WALL_COYOTE_TIME, WALL_GRAB_REACH, WALL_JUMP_H_SPEED, WALL_JUMP_LOCK,
  WALL_SLIDE_SPEED, WIND_GROUND_MULT,
} from './tuning';
import { rectRad, rectSolid, rectSpike, takeCrystal, type Room } from './level';
import { consumeDash, consumeJump, input } from './input';
import { addFreeze, addShake } from './fx';
import { burst } from './particles';
import { sfx } from './audio';
import { COLORS } from './palette';

export interface Afterimage {
  x: number;
  y: number;
  sx: number;
  sy: number;
  life: number;
}

export class Player {
  x = 0;
  y = 0;
  readonly w = PLAYER_W;
  readonly h = PLAYER_H;
  vx = 0;
  vy = 0;

  // Остатки субпиксельного движения: позиция игрока целочисленная, дробная часть копится здесь.
  private remX = 0;
  private remY = 0;

  onGround = false;
  wallDir = 0; // -1 стена слева, 1 стена справа, 0 нет
  facing = 1;

  coyote = 0;
  wallCoyote = 0;
  wallCoyoteDir = 0;
  varJumpTimer = 0;
  wallJumpLock = 0;

  dashes = DASH_REFILL;
  dashTimer = 0;
  dashCooldown = 0;
  dashDirX = 0;
  dashDirY = 0;

  dead = false;
  deadTimer = 0;
  respawnTimer = 0;

  /** Набранный фон, 0..1. Единица — смерть. */
  rad = 0;
  /** Стоит ли игрок в «зелёном» прямо сейчас — нужно и звуку, и интерфейсу. */
  inRad = false;

  squashX = 1;
  squashY = 1;

  trail: Afterimage[] = [];
  private trailAccum = 0;

  get cx(): number { return this.x + this.w / 2; }
  get cy(): number { return this.y + this.h / 2; }
  get dashing(): boolean { return this.dashTimer > 0; }

  spawnAt(x: number, y: number): void {
    this.x = Math.round(x - this.w / 2);
    this.y = Math.round(y - this.h);
    this.vx = 0;
    this.vy = 0;
    this.remX = 0;
    this.remY = 0;
    this.dead = false;
    this.deadTimer = 0;
    this.respawnTimer = RESPAWN_TIME;
    sfx.respawn();
    this.dashes = DASH_REFILL;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.varJumpTimer = 0;
    this.wallJumpLock = 0;
    this.coyote = 0;
    this.wallCoyote = 0;
    this.rad = 0;
    this.inRad = false;
    this.squashX = 1;
    this.squashY = 1;
    this.trail.length = 0;
  }

  kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.deadTimer = DEATH_TIME;
    addShake(SHAKE_DEATH);
    addFreeze(DEATH_FREEZE);
    sfx.death();
    burst(this.cx, this.cy, 26, {
      speed: 260, life: 0.5, size: 3.5, color: COLORS.playerNoDash, drag: 2.2,
    });
    burst(this.cx, this.cy, 10, {
      speed: 150, life: 0.7, size: 2, color: COLORS.player, drag: 1.5,
    });
  }

  update(room: Room, dt: number): void {
    this.updateVisuals(dt);

    if (this.dead) {
      this.deadTimer -= dt;
      return;
    }

    this.respawnTimer = Math.max(0, this.respawnTimer - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.wallJumpLock = Math.max(0, this.wallJumpLock - dt);

    this.sense(room);

    if (this.dashing) {
      this.updateDash(dt);
    } else {
      this.updateNormal(room, dt);
    }

    this.tryDash();
    this.tryJump();

    this.moveX(room, this.vx * dt);
    this.moveY(room, this.vy * dt);

    this.sense(room);
    this.collide(room, dt);
  }

  // ------------------------------------------------------------------ ощупывание мира

  private sense(room: Room): void {
    const wasGround = this.onGround;
    this.onGround = rectSolid(room, this.x, this.y + this.h, this.w, 1);

    if (this.onGround && !wasGround && this.vy > 60) {
      // Приземление: сплющиваем, трясём экран, выбиваем пыль.
      this.squashX = 1 + SQUASH_LAND;
      this.squashY = 1 - SQUASH_LAND;
      addShake(SHAKE_LAND * Math.min(1, this.vy / MAX_FALL));
      sfx.land(Math.min(1, this.vy / MAX_FALL));
      burst(this.cx, this.y + this.h, 6, {
        speed: 90, angle: -Math.PI / 2, spread: Math.PI * 1.2,
        life: 0.28, size: 2.5, color: COLORS.dust, drag: 5,
      });
    }

    const wallRight = rectSolid(room, this.x + this.w, this.y, WALL_GRAB_REACH, this.h);
    const wallLeft = rectSolid(room, this.x - WALL_GRAB_REACH, this.y, WALL_GRAB_REACH, this.h);
    this.wallDir = wallRight ? 1 : wallLeft ? -1 : 0;
  }

  // --------------------------------------------------------------------- обычное состояние

  private updateNormal(room: Room, dt: number): void {
    // --- горизонталь
    const mult = this.onGround ? 1 : AIR_MULT;
    const lock = this.wallJumpLock > 0 ? 0.28 : 1;
    const target = MAX_RUN * input.x;
    const overspeed = Math.abs(this.vx) > MAX_RUN && Math.sign(this.vx) === input.x && input.x !== 0;
    const accel = (overspeed ? RUN_REDUCE : RUN_ACCEL) * mult * lock;
    this.vx = approach(this.vx, target, accel * dt);

    // Сквозняк в тоннеле тянет постоянно; на земле подошвы держат заметно лучше.
    if (room.wind !== 0) {
      this.vx += room.wind * (this.onGround ? WIND_GROUND_MULT : 1) * dt;
    }

    if (input.x !== 0) this.facing = input.x;

    // --- вертикаль
    const sliding = !this.onGround && this.wallDir !== 0 && input.x === this.wallDir && this.vy > 0;
    // У вершины прыжка гравитация вдвое слабее — игрок «зависает» и успевает прицелиться.
    const gravMult = Math.abs(this.vy) < HALF_GRAV_THRESHOLD && input.jumpHeld ? 0.5 : 1;
    const maxFall = sliding ? WALL_SLIDE_SPEED : input.y > 0 ? FAST_MAX_FALL : MAX_FALL;

    if (!this.onGround) {
      this.vy = approach(this.vy, maxFall, GRAVITY * gravMult * dt);
    } else if (this.vy > 0) {
      this.vy = 0;
    }

    if (sliding) {
      this.vy = Math.min(this.vy, WALL_SLIDE_SPEED);
      if (Math.random() < 0.35) {
        burst(this.x + (this.wallDir > 0 ? this.w : 0), this.cy + Math.random() * 8, 1, {
          speed: 40, angle: -Math.PI / 2, spread: 1, life: 0.25, size: 2, color: COLORS.dust, drag: 4,
        });
      }
    }

    // --- переменная высота прыжка: удержание кнопки продолжает тянуть вверх
    if (this.varJumpTimer > 0) {
      if (input.jumpHeld) this.vy = Math.min(this.vy, -JUMP_SPEED);
      else this.varJumpTimer = 0;
      this.varJumpTimer -= dt;
    }

    // --- тайминги прощения
    this.coyote = this.onGround ? COYOTE_TIME : Math.max(0, this.coyote - dt);
    if (this.wallDir !== 0 && !this.onGround) {
      this.wallCoyote = WALL_COYOTE_TIME;
      this.wallCoyoteDir = this.wallDir;
    } else {
      this.wallCoyote = Math.max(0, this.wallCoyote - dt);
    }

    if (this.onGround && this.dashCooldown <= 0) this.dashes = DASH_REFILL;
  }

  // --------------------------------------------------------------------------- дэш

  private updateDash(dt: number): void {
    this.dashTimer -= dt;
    this.vx = this.dashDirX * DASH_SPEED;
    this.vy = this.dashDirY * DASH_SPEED;

    // Шлейф из «призраков» — читаемость движения на скорости 480 px/s.
    this.trailAccum += dt;
    if (this.trailAccum > 0.018) {
      this.trailAccum = 0;
      this.trail.push({ x: this.x, y: this.y, sx: this.squashX, sy: this.squashY, life: 0.22 });
    }

    if (this.dashTimer <= 0) {
      this.vx = this.dashDirX * DASH_END_SPEED;
      this.vy = this.dashDirY * DASH_END_SPEED;
      // Вертикальный импульс гасим сильнее: иначе дэш вверх превращается в полёт.
      if (this.dashDirY < 0) this.vy *= 0.6;
      this.dashCooldown = DASH_COOLDOWN;
      this.varJumpTimer = 0;
    }
  }

  private tryDash(): void {
    if (input.dashBuffer <= 0 || this.dashes <= 0 || this.dashing || this.dashCooldown > 0) return;
    consumeDash();

    let dx = input.x;
    let dy = input.y;
    if (dx === 0 && dy === 0) dx = this.facing;
    const len = Math.hypot(dx, dy);
    this.dashDirX = dx / len;
    this.dashDirY = dy / len;

    this.dashes--;
    this.dashTimer = DASH_TIME;
    this.varJumpTimer = 0;
    if (dx !== 0) this.facing = Math.sign(dx);

    addFreeze(DASH_FREEZE);
    addShake(SHAKE_DASH);
    sfx.dash();
    burst(this.cx, this.cy, 14, {
      speed: 220, angle: Math.atan2(-this.dashDirY, -this.dashDirX), spread: 1.5,
      life: 0.35, size: 3, color: COLORS.dash, drag: 3.5,
    });
  }

  // ------------------------------------------------------------------------- прыжок

  private tryJump(): void {
    if (input.jumpBuffer <= 0 || this.dashing) return;

    if (this.coyote > 0) {
      consumeJump();
      this.jump();
    } else if (this.wallCoyote > 0 || this.wallDir !== 0) {
      consumeJump();
      this.wallJump(this.wallDir !== 0 ? this.wallDir : this.wallCoyoteDir);
    }
  }

  private jump(): void {
    this.vy = -JUMP_SPEED;
    this.vx += JUMP_H_BOOST * input.x;
    this.varJumpTimer = VAR_JUMP_TIME;
    this.coyote = 0;
    this.onGround = false;
    this.squashX = 1 - SQUASH_JUMP;
    this.squashY = 1 + SQUASH_JUMP;
    sfx.jump();
    burst(this.cx, this.y + this.h, 8, {
      speed: 110, angle: Math.PI / 2, spread: Math.PI * 0.9,
      life: 0.3, size: 2.5, color: COLORS.dust, drag: 4,
    });
  }

  private wallJump(dir: number): void {
    this.vx = -dir * WALL_JUMP_H_SPEED;
    this.vy = -JUMP_SPEED;
    this.varJumpTimer = VAR_JUMP_TIME;
    this.wallJumpLock = WALL_JUMP_LOCK;
    this.wallCoyote = 0;
    this.facing = -dir;
    this.squashX = 1 - SQUASH_JUMP * 0.7;
    this.squashY = 1 + SQUASH_JUMP * 0.7;
    addShake(1.2);
    sfx.wallJump();
    burst(this.x + (dir > 0 ? this.w : 0), this.cy, 10, {
      speed: 160, angle: dir > 0 ? Math.PI : 0, spread: 1.4,
      life: 0.3, size: 2.5, color: COLORS.dust, drag: 3.5,
    });
  }

  // ------------------------------------------------------- движение с коллизиями (по 1 px)

  private moveX(room: Room, amount: number): void {
    this.remX += amount;
    let step = Math.round(this.remX);
    if (step === 0) return;
    this.remX -= step;
    const sign = Math.sign(step);
    step = Math.abs(step);

    while (step-- > 0) {
      if (rectSolid(room, this.x + sign, this.y, this.w, this.h)) {
        this.remX = 0;
        this.vx = 0;
        // Дэш в стену обрывается — иначе игрок «залипает» на всю длительность.
        if (this.dashing && this.dashDirX !== 0) this.dashTimer = 0;
        return;
      }
      this.x += sign;
    }
  }

  private moveY(room: Room, amount: number): void {
    this.remY += amount;
    let step = Math.round(this.remY);
    if (step === 0) return;
    this.remY -= step;
    const sign = Math.sign(step);
    step = Math.abs(step);

    while (step-- > 0) {
      if (rectSolid(room, this.x, this.y + sign, this.w, this.h)) {
        this.remY = 0;
        this.vy = 0;
        if (this.dashing && this.dashDirY !== 0) this.dashTimer = 0;
        return;
      }
      this.y += sign;
    }
  }

  // ------------------------------------------------------------------ столкновения с миром

  /**
   * Принудительный перенос: дрезина везёт стоящего сверху игрока.
   * Отличается от moveX тем, что не гасит собственную скорость игрока —
   * он едет и одновременно может бежать по платформе.
   */
  shift(room: Room, amount: number): void {
    let step = Math.round(amount + (amount > 0 ? 0.5 : -0.5));
    if (step === 0) step = Math.sign(amount);
    const sign = Math.sign(step);
    let n = Math.abs(step);
    while (n-- > 0) {
      if (rectSolid(room, this.x + sign, this.y, this.w, this.h)) return;
      this.x += sign;
    }
  }

  private collide(room: Room, dt: number): void {
    if (rectSpike(room, this.x, this.y, this.w, this.h)) {
      this.kill();
      return;
    }
    if (this.y > VIEW_H + 40) {
      this.kill();
      return;
    }

    // Радиация набирается за RAD_DEATH_TIME секунд и выветривается медленнее,
    // чем набирается: пробежать зону можно, отсидеться в ней — нет.
    this.inRad = rectRad(room, this.x, this.y, this.w, this.h);
    this.rad += (this.inRad ? 1 : -RAD_RECOVER_MULT) * (dt / RAD_DEATH_TIME);
    if (this.rad <= 0) this.rad = 0;
    if (this.rad >= 1) {
      this.rad = 1;
      this.kill();
      return;
    }
    for (const c of room.crystals) {
      if (!c.alive) continue;
      if (Math.abs(c.x - this.cx) < 10 + this.w / 2 && Math.abs(c.y - this.cy) < 10 + this.h / 2) {
        if (this.dashes >= DASH_REFILL && this.dashCooldown <= 0) continue;
        takeCrystal(c);
        this.dashes = DASH_REFILL;
        this.dashCooldown = 0;
        addShake(1.5);
        addFreeze(0.03);
        sfx.crystal();
        burst(c.x, c.y, 16, { speed: 200, life: 0.45, size: 3, color: COLORS.crystal, drag: 3 });
      }
    }
  }

  // ------------------------------------------------------------------------- визуал

  private updateVisuals(dt: number): void {
    this.squashX = approach(this.squashX, 1, SQUASH_RECOVER * dt);
    this.squashY = approach(this.squashY, 1, SQUASH_RECOVER * dt);
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life -= dt;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }
  }
}

export function approach(value: number, target: number, maxDelta: number): number {
  return value > target ? Math.max(value - maxDelta, target) : Math.min(value + maxDelta, target);
}
