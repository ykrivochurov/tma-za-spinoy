import { SHAKE_DECAY } from './tuning';

/**
 * Экранные эффекты: тряска, hitstop (заморозка кадра) и вспышка.
 * Всё это — «сочность»: механику не меняет, ощущение меняет радикально.
 */
export const fx = {
  shake: 0,
  shakeX: 0,
  shakeY: 0,
  /** Пока > 0, симуляция стоит — удар «застывает» на пару кадров. */
  freeze: 0,
  flash: 0,
  flashColor: '#ffffff',
};

export function addShake(amount: number): void {
  fx.shake = Math.max(fx.shake, amount);
}

export function addFreeze(seconds: number): void {
  fx.freeze = Math.max(fx.freeze, seconds);
}

export function addFlash(seconds: number, color: string): void {
  fx.flash = Math.max(fx.flash, seconds);
  fx.flashColor = color;
}

/** Обновляется в реальном времени, даже во время freeze — иначе заморозка выглядит как зависание. */
export function updateFx(realDt: number): void {
  if (fx.freeze > 0) fx.freeze = Math.max(0, fx.freeze - realDt);

  fx.shake = Math.max(0, fx.shake - fx.shake * SHAKE_DECAY * realDt - 0.05 * realDt);
  if (fx.shake < 0.02) fx.shake = 0;
  fx.shakeX = (Math.random() * 2 - 1) * fx.shake;
  fx.shakeY = (Math.random() * 2 - 1) * fx.shake;

  fx.flash = Math.max(0, fx.flash - realDt);
}

export function resetFx(): void {
  fx.shake = 0;
  fx.shakeX = 0;
  fx.shakeY = 0;
  fx.freeze = 0;
  fx.flash = 0;
}
