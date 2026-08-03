import { DASH_BUFFER, JUMP_BUFFER } from './tuning';

/**
 * Ввод с буферизацией. Precision-платформер прощает игроку раннее нажатие:
 * прыжок/дэш, нажатые за мгновение до момента, когда они станут легальны,
 * не теряются — они лежат в буфере и срабатывают сами.
 */

const CODES = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['KeyZ', 'KeyJ', 'Space'],
  dash: ['KeyX', 'KeyK', 'ShiftLeft', 'ShiftRight'],
  restart: ['KeyR'],
  debug: ['F1'],
  mute: ['KeyM'],
} as const;

type Action = keyof typeof CODES;

const down = new Set<string>();
const pressedThisFrame = new Set<Action>();

export const input = {
  x: 0,
  y: 0,
  jumpHeld: false,
  dashHeld: false,
  jumpBuffer: 0,
  dashBuffer: 0,
  /** Одноразовые нажатия, сбрасываются в конце кадра. */
  restartPressed: false,
  debugPressed: false,
  mutePressed: false,
  /** Индекс комнаты, выбранной цифрой 1..9, либо -1. */
  roomSelect: -1,
};

function actionFor(code: string): Action | null {
  for (const key of Object.keys(CODES) as Action[]) {
    if ((CODES[key] as readonly string[]).includes(code)) return key;
  }
  return null;
}

export function initInput(target: Window = window): void {
  target.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const a = actionFor(e.code);
    if (a) {
      e.preventDefault();
      down.add(e.code);
      pressedThisFrame.add(a);
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) input.roomSelect = n - 1;
    }
  });

  target.addEventListener('keyup', (e) => {
    down.delete(e.code);
  });

  // Отпускаем всё при потере фокуса, иначе игрок «залипает» в беге.
  target.addEventListener('blur', () => down.clear());
}

function isDown(a: Action): boolean {
  return (CODES[a] as readonly string[]).some((c) => down.has(c));
}

/** Вызывается один раз за кадр, до симуляции. */
export function updateInput(dt: number): void {
  input.x = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
  input.y = (isDown('down') ? 1 : 0) - (isDown('up') ? 1 : 0);
  input.jumpHeld = isDown('jump');
  input.dashHeld = isDown('dash');

  input.jumpBuffer = pressedThisFrame.has('jump') ? JUMP_BUFFER : Math.max(0, input.jumpBuffer - dt);
  input.dashBuffer = pressedThisFrame.has('dash') ? DASH_BUFFER : Math.max(0, input.dashBuffer - dt);

  input.restartPressed = pressedThisFrame.has('restart');
  input.debugPressed = pressedThisFrame.has('debug');
  input.mutePressed = pressedThisFrame.has('mute');
}

/** Вызывается в самом конце кадра. */
export function endInputFrame(): void {
  pressedThisFrame.clear();
  input.roomSelect = -1;
}

export function consumeJump(): void {
  input.jumpBuffer = 0;
}

export function consumeDash(): void {
  input.dashBuffer = 0;
}
