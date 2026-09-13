/* Interface sound.
 *
 * Axis 6 of the token contract has been specified in TOKENS.md since the first
 * day and absent from the code until now.
 *
 * ⭐ THE MANAGEMENT MODEL IS THE PRODUCT, NOT THE SOUNDS. That is the lesson
 * of arwes/bleeps and it is the whole design here: named sounds,
 * categories, and a mute per category. "Sound on/off" is too coarse, because a
 * room that wants alarms does not necessarily want key clicks.
 *
 * Synthesised, never sampled. A sound is a number array, so there are no assets
 * to fetch, nothing to 404, and a theme can retune its own vocabulary without
 * shipping a file.
 *
 * ⭐ AND IT DOES: THE CONTOUR IS THE MEANING AND THE TIMBRE IS THE THEME.
 * That is the icon register's rule in another medium. `refuse` falls and
 * `commit` rises in every theme, because that is what they MEAN; whether they
 * do it as a square wave through a relay or a sine through air is what the
 * theme gets to say. A theme cannot invent a sound, mute one, or swap two
 * over - it changes only the VOICE they are all spoken in, which arrives as
 * --ov-snd-* tokens and is read off the element the sound was played FROM.
 * Nine themes that looked different and sounded identical was the complaint;
 * this is half the answer and the control furniture is the other half.
 *
 * Three rules, and the third is not negotiable:
 *
 * 1. DEFAULT OFF. An interface that makes noise before it was asked to is the
 *    failure, and browsers agree: audio needs a gesture before it will start.
 * 2. REMEMBERED, and per category, so the choice survives a reload.
 * 3. 🔴 SOUND IS NEVER THE ONLY CHANNEL. Anything a sound reports must also be
 *    visible, because sound is off by default, mutable, and unavailable to
 *    plenty of people. An alarm that is only audible is an alarm that has not
 *    been raised.
 */
import './ov-core.js';

(() => {
  const KEY = 'overscan.sound';
  const sounds = new Map();
  let ctx = null;
  let state = { on: false, muted: {} };

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) state = { ...state, ...saved };
  } catch { /* storage can throw in a private window; the default stands */ }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* fine */ }
  }

  /* The voice, read off wherever the sound came from. A page shows every
   * theme at once, so the theme is a property of the ELEMENT and not of the
   * document - the same reason every other axis is a token rather than a
   * global. Falls back to the plain voice, never to silence: a theme that
   * fails to declare one still has to be audible. */
  const WAVES = ['sine', 'square', 'sawtooth', 'triangle'];
  const PLAIN = { pitch: 1, decay: 1, gain: 1, grit: 0, wave: 'square' };

  function voice(from) {
    const el = (from && from.nodeType === 1) ? from : document.body;
    if (!el) return PLAIN;
    const cs = getComputedStyle(el);
    const num = (k, d) => {
      const v = parseFloat(cs.getPropertyValue('--ov-snd-' + k));
      return Number.isFinite(v) && v > 0 ? v : d;
    };
    const w = cs.getPropertyValue('--ov-snd-wave').trim();
    return {
      pitch: num('pitch', 1),
      decay: num('decay', 1),
      gain: num('gain', 1),
      // grit is allowed to be 0, so it cannot use the >0 guard above.
      grit: (() => {
        const v = parseFloat(cs.getPropertyValue('--ov-snd-grit'));
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
      })(),
      // An unrecognised waveform is refused rather than passed to the
      // oscillator, which would throw and take the whole sound with it.
      wave: WAVES.includes(w) ? w : PLAIN.wave,
    };
  }

  /* spec: { freq, to, decay, type, gain, noise, category } */
  function define(name, spec) {
    sounds.set(name, { category: 'ui', type: 'square', decay: 0.09, gain: 0.12, ...spec });
    return name;
  }

  function enable(on = true) {
    state.on = on;
    save();
    if (on && !ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (on && ctx && ctx.state === 'suspended') ctx.resume();
    window.dispatchEvent(new CustomEvent('ov:sound', { detail: { ...state } }));
  }

  function mute(category, on) {
    state.muted[category] = on;
    save();
    window.dispatchEvent(new CustomEvent('ov:sound', { detail: { ...state } }));
  }

  function audible(name) {
    const s = sounds.get(name);
    return Boolean(state.on && s && !state.muted[s.category]);
  }

  function play(name, from) {
    if (!audible(name) || !ctx) return false;
    const s = sounds.get(name);
    const v = voice(from);
    const decay = s.decay * v.decay;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(s.gain * v.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    gain.connect(ctx.destination);

    if (s.noise) {
      const n = Math.floor(ctx.sampleRate * decay);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      src.start(t);
      return true;
    }

    const osc = ctx.createOscillator();
    // The theme's timbre, not the sound's. What survives is the CONTOUR -
    // both ends of the sweep are transposed by the same factor, so a fall is
    // still a fall and `refuse` cannot be mistaken for `commit` in any voice.
    osc.type = v.wave;
    osc.frequency.setValueAtTime(s.freq * v.pitch, t);
    if (s.to) {
      osc.frequency.exponentialRampToValueAtTime(s.to * v.pitch, t + decay);
    }
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + decay + 0.02);

    // Grit rides ALONGSIDE the tone rather than replacing it, because an
    // electromechanical panel does not click cleanly and a projection does.
    if (v.grit > 0) {
      const n = Math.floor(ctx.sampleRate * decay);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(s.gain * v.gain * v.grit, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      ng.connect(ctx.destination);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ng);
      src.start(t);
    }
    return true;
  }

  Object.assign(window.Overscan, {
    sound: {
      define, play, enable, mute, audible, voice, sounds,
      get state() { return { ...state }; },
    },
  });
})();

/* The house vocabulary. Deliberately small: a kit with forty sounds has a sound
 * for everything and a meaning for nothing. */
Overscan.sound.define('press', { freq: 720, to: 380, decay: 0.05, gain: 0.09 });
Overscan.sound.define('key', { freq: 1400, to: 900, decay: 0.022, gain: 0.05 });
Overscan.sound.define('commit', { freq: 300, to: 900, decay: 0.16, type: 'sawtooth', gain: 0.1 });
Overscan.sound.define('refuse', { freq: 220, to: 120, decay: 0.16, type: 'square', gain: 0.11 });
Overscan.sound.define('alarm', { freq: 880, to: 440, decay: 0.34, type: 'square', gain: 0.13, category: 'alarm' });
Overscan.sound.define('vent', { noise: true, decay: 0.5, gain: 0.09, category: 'ambient' });

export const { sound } = window.Overscan;
