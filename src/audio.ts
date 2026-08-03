/**
 * ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ЖИВЁТ ЗВУК. Ни одного файла-ассета — как и весь
 * остальной арт проекта, звук синтезируется кодом через Web Audio.
 *
 * Правило то же, что у палитры: новый звук — сначала сюда, в `sfx`, потом
 * в использование. Звук, заведённый «по месту», ломает громкостной баланс
 * ровно так же, как цвет, заведённый по месту, ломает картинку.
 *
 * Два обязательных ограничения:
 *
 *  1. ЗВУК НИЧЕГО НЕ ЗНАЕТ О СИМУЛЯЦИИ И НЕ ВЛИЯЕТ НА НЕЁ. Связь строго
 *     односторонняя: физика зовёт `sfx.*`, обратно — ничего. Иначе детерминизм
 *     фиксированного шага перестаёт быть детерминизмом.
 *  2. КОНТЕКСТ СОЗДАЁТСЯ ТОЛЬКО ПОСЛЕ ЖЕСТА ПОЛЬЗОВАТЕЛЯ. Браузер не даст
 *     играть раньше, а созданный «впустую» контекст останется навсегда
 *     подвешенным. Поэтому `initAudio()` лишь вешает одноразовые слушатели.
 */

// ------------------------------------------------------------------ громкости

/** Общая громкость. Всё остальное — доли от неё. */
const MASTER = 0.55;

/**
 * Баланс проверяется ЗАМЕРОМ, а не на слух: `audioLevel()` даёт RMS на выходе.
 * Ориентиры, снятые в игре: фон в тишине ~0.012, движение 0.04–0.08,
 * смерть и затвор 0.15–0.25. Если гул подобрался к движению — гул слишком громкий,
 * и первым делом надо ронять `drone`, а не задирать всё остальное.
 */
const VOL = {
  step: 0.20,
  jump: 0.22,
  land: 0.26,
  wallJump: 0.24,
  dash: 0.40,
  death: 0.42,
  respawn: 0.10,
  crystal: 0.20,
  crumble: 0.24,
  doorWarn: 0.18,
  doorSlam: 0.40,
  growl: 0.20,
  geiger: 0.34,
  goal: 0.28,
  /** Гул тоннеля. Держать НИЗКО: он звучит всегда и глушит короткие события. */
  drone: 0.020,
  bed: 0.011,
};

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;

/** Постоянный гул тоннеля: он не выключается, только меняет плотность. */
let bed: { gain: GainNode; filter: BiquadFilterNode } | null = null;
/** Съём уровня на выходе: без него «звук работает» проверяется только ушами. */
let meter: AnalyserNode | null = null;
let meterBuf: Float32Array<ArrayBuffer> | null = null;

// ------------------------------------------------------------------- запуск

/**
 * Вешает одноразовые слушатели: контекст оживает на первом же нажатии.
 * До этого момента все вызовы `sfx.*` молча уходят в никуда.
 */
export function initAudio(): void {
  const start = (): void => {
    if (ac) { void ac.resume(); return; }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ac = new Ctor();
    master = ac.createGain();
    master.gain.value = muted ? 0 : MASTER;
    meter = ac.createAnalyser();
    meter.fftSize = 1024;
    meterBuf = new Float32Array(new ArrayBuffer(meter.fftSize * 4));
    master.connect(meter).connect(ac.destination);
    noise = makeNoise(ac);
    startAmbience();
  };
  window.addEventListener('keydown', start);
  window.addEventListener('pointerdown', start);
}

export function toggleMute(): boolean {
  muted = !muted;
  if (master && ac) {
    master.gain.setTargetAtTime(muted ? 0 : MASTER, ac.currentTime, 0.02);
  }
  return muted;
}

export function isMuted(): boolean {
  return muted;
}

/**
 * Состояние звука наружу — тем же принципом, что и `window.__game`:
 * без этого проверить, что звук вообще ожил, можно только ушами.
 */
export function audioState(): { started: boolean; ctx: string; muted: boolean; level: number } {
  return { started: ac !== null, ctx: ac ? ac.state : 'нет контекста', muted, level: audioLevel() };
}

/** Среднеквадратичный уровень на выходе прямо сейчас, 0..1. */
export function audioLevel(): number {
  if (!meter || !meterBuf) return 0;
  meter.getFloatTimeDomainData(meterBuf);
  let sum = 0;
  for (let i = 0; i < meterBuf.length; i++) sum += meterBuf[i] * meterBuf[i];
  return Math.sqrt(sum / meterBuf.length);
}

/** Секунда белого шума — основа всего перкуссионного и всех шорохов. */
function makeNoise(c: AudioContext): AudioBuffer {
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = buf.getChannelData(0);
  // Детерминированный шум: одинаковый при каждом запуске, как и весь остальной декор.
  let s = 0x2545f491;
  for (let i = 0; i < d.length; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  return buf;
}

// -------------------------------------------------------------- кирпичики

interface ToneOpts {
  from: number;
  to?: number;
  dur: number;
  vol: number;
  type?: OscillatorType;
  /** Доля длительности, уходящая на атаку. Ноль — щелчок, 0.3 — мягкий заход. */
  attack?: number;
  delay?: number;
}

function tone(o: ToneOpts): void {
  if (!ac || !master) return;
  const t = ac.currentTime + (o.delay ?? 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.from, t);
  if (o.to !== undefined) {
    // Экспоненциальный свип: линейный по частоте слышится как «неправильный».
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + o.dur);
  }
  const atk = Math.max(0.001, o.dur * (o.attack ?? 0.02));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vol, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

interface NoiseOpts {
  dur: number;
  vol: number;
  from: number;
  to?: number;
  type?: BiquadFilterType;
  q?: number;
  delay?: number;
}

function hiss(o: NoiseOpts): void {
  if (!ac || !master || !noise) return;
  const t = ac.currentTime + (o.delay ?? 0);
  const src = ac.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  // Случайная точка старта: иначе все щелчки звучат одинаково и слышно «зацикленность».
  src.loopStart = Math.random() * 0.8;
  src.loopEnd = src.loopStart + 0.2;

  const f = ac.createBiquadFilter();
  f.type = o.type ?? 'lowpass';
  f.frequency.setValueAtTime(o.from, t);
  if (o.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
  f.Q.value = o.q ?? 1;

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vol, t + Math.max(0.001, o.dur * 0.08));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

  src.connect(f).connect(g).connect(master);
  src.start(t, src.loopStart);
  src.stop(t + o.dur + 0.02);
}

// ------------------------------------------------------------------- фон

/** Гул тоннеля: две расстроенные низкие пилы плюс шумовая подложка. */
function startAmbience(): void {
  if (!ac || !master || !noise) return;

  const droneGain = ac.createGain();
  droneGain.gain.value = VOL.drone;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 190;
  droneGain.connect(lp).connect(master);

  for (const f of [43, 43.4, 64.5]) {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(droneGain);
    o.start();
  }

  // Медленное «дыхание» тоннеля — без него гул слышится как ровный шум техники.
  const lfo = ac.createOscillator();
  const lfoGain = ac.createGain();
  lfo.frequency.value = 0.06;
  lfoGain.gain.value = VOL.drone * 0.5;
  lfo.connect(lfoGain).connect(droneGain.gain);
  lfo.start();

  const src = ac.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const bf = ac.createBiquadFilter();
  bf.type = 'lowpass';
  bf.frequency.value = 320;
  const bg = ac.createGain();
  bg.gain.value = VOL.bed;
  src.connect(bf).connect(bg).connect(master);
  src.start();

  bed = { gain: bg, filter: bf };
}

/**
 * Плотность шумовой подложки. `wind` 0..1 — сквозняк в комнате: в перегоне
 * с тягой подложка становится заметно жёстче и выше.
 */
export function setAmbience(wind: number): void {
  if (!ac || !bed) return;
  const t = ac.currentTime;
  bed.gain.gain.setTargetAtTime(VOL.bed * (1 + wind * 5), t, 0.6);
  bed.filter.frequency.setTargetAtTime(320 + wind * 900, t, 0.6);
}

// ------------------------------------------------------- счётчик и рычание

let geigerAcc = 0;
let growlCd = 0;

/**
 * Вызывается раз в кадр из игрового цикла реальным dt.
 * `rad` 0..1 — набранный фон, `threat` 0..1 — насколько близко ближайшая тварь.
 */
export function updateAudio(dt: number, rad: number, threat: number, wind: number): void {
  if (!ac) return;
  setAmbience(wind);

  // Дозиметр: частота щелчков растёт с набранным фоном. Слышно раньше, чем видно.
  if (rad > 0.01) {
    geigerAcc -= dt;
    if (geigerAcc <= 0) {
      geigerAcc = 0.04 + (1 - rad) * 0.5 * Math.random();
      // Щелчок должен РЕЗАТЬ, а не шуршать: узкий высокий шум почти без энергии
      // тонет в гуле, поэтому берём полосу пошире и добавляем короткий тон.
      const v = VOL.geiger * (0.4 + rad * 0.6);
      hiss({ dur: 0.02, vol: v, from: 2600, to: 5200, type: 'bandpass', q: 0.6 });
      tone({ from: 2400, to: 1500, dur: 0.018, vol: v * 0.5, type: 'square' });
    }
  }

  growlCd -= dt;
  if (threat > 0.35 && growlCd <= 0) {
    growlCd = 1.4 - threat * 0.7;
    sfx.growl(threat);
  }
}

// ------------------------------------------------------------------ события

export const sfx = {
  /**
   * Шаг по щебню. Громкость — от скорости, чтобы шаг не молотил на месте.
   * Обязательно с низом: узкий полосовой шум сам по себе даёт такой тихий
   * и тонкий щелчок, что он тонет в гуле тоннеля. Сапог имеет тело.
   */
  step(speed: number): void {
    const v = VOL.step * Math.min(1, speed);
    hiss({ dur: 0.05, vol: v, from: 1500 + Math.random() * 600, to: 420, type: 'bandpass', q: 0.7 });
    tone({ from: 132 + Math.random() * 20, to: 78, dur: 0.06, vol: v * 0.75, type: 'triangle' });
  },

  jump(): void {
    hiss({ dur: 0.09, vol: VOL.jump * 0.7, from: 700, to: 1800, type: 'bandpass', q: 0.9 });
    tone({ from: 180, to: 320, dur: 0.10, vol: VOL.jump, type: 'triangle' });
  },

  wallJump(): void {
    hiss({ dur: 0.10, vol: VOL.wallJump, from: 1600, to: 500, type: 'bandpass', q: 1.2 });
    tone({ from: 240, to: 380, dur: 0.09, vol: VOL.wallJump * 0.8, type: 'triangle' });
  },

  /** Приземление. `force` 0..1 — доля от максимальной скорости падения. */
  land(force: number): void {
    const v = 0.35 + force * 0.65;
    hiss({ dur: 0.13, vol: VOL.land * v, from: 700, to: 160 });
    tone({ from: 110, to: 48, dur: 0.16, vol: VOL.land * v, type: 'sine' });
  },

  dash(): void {
    hiss({ dur: 0.22, vol: VOL.dash, from: 300, to: 2600, type: 'bandpass', q: 0.7 });
    tone({ from: 520, to: 120, dur: 0.20, vol: VOL.dash * 0.5, type: 'sawtooth' });
  },

  death(): void {
    tone({ from: 140, to: 38, dur: 0.55, vol: VOL.death, type: 'sine' });
    hiss({ dur: 0.35, vol: VOL.death * 0.8, from: 1800, to: 120 });
    // Металлический призвук: смерть в тоннеле звучит как удар по железу.
    tone({ from: 620, to: 300, dur: 0.30, vol: VOL.death * 0.25, type: 'square', delay: 0.01 });
  },

  respawn(): void {
    tone({ from: 190, to: 420, dur: 0.22, vol: VOL.respawn, type: 'sine', attack: 0.3 });
  },

  crystal(): void {
    tone({ from: 880, dur: 0.28, vol: VOL.crystal, type: 'sine' });
    tone({ from: 1320, dur: 0.34, vol: VOL.crystal * 0.6, type: 'sine', delay: 0.03 });
  },

  /** Шпала хрустнула под ногой — предупреждение за CRUMBLE_DELAY до обвала. */
  crumbleCrack(): void {
    hiss({ dur: 0.07, vol: VOL.crumble, from: 2200, to: 900, type: 'bandpass', q: 2 });
    tone({ from: 190, to: 130, dur: 0.09, vol: VOL.crumble * 0.6, type: 'square' });
  },

  crumbleFall(): void {
    hiss({ dur: 0.30, vol: VOL.crumble * 1.2, from: 900, to: 90 });
  },

  doorWarn(): void {
    tone({ from: 760, dur: 0.07, vol: VOL.doorWarn, type: 'square' });
  },

  doorSlam(): void {
    tone({ from: 90, to: 32, dur: 0.45, vol: VOL.doorSlam, type: 'sine' });
    hiss({ dur: 0.28, vol: VOL.doorSlam * 0.7, from: 1400, to: 130 });
    tone({ from: 300, to: 170, dur: 0.22, vol: VOL.doorSlam * 0.2, type: 'square' });
  },

  /** Рычание из темноты. `near` 0..1 — чем ближе тварь, тем громче и ниже. */
  growl(near: number): void {
    const base = 92 - near * 30;
    tone({ from: base, to: base * 0.75, dur: 0.55, vol: VOL.growl * near, type: 'sawtooth', attack: 0.25 });
    hiss({ dur: 0.5, vol: VOL.growl * near * 0.5, from: 260, to: 130, type: 'lowpass' });
  },

  goal(): void {
    [392, 523, 659].forEach((f, i) => {
      tone({ from: f, dur: 0.9, vol: VOL.goal * (1 - i * 0.2), type: 'triangle', attack: 0.1, delay: i * 0.11 });
    });
  },

  /** Переход в следующий перегон: короткий выдох воздуха. */
  roomEnter(): void {
    hiss({ dur: 0.4, vol: 0.10, from: 200, to: 900, type: 'bandpass', q: 0.6 });
  },
};
