/**
 * DoingLanguage — Audio Feedback Service
 * Uses Web Audio API to generate short sound effects for correct/incorrect answers.
 * Supports configurable audio parameters including volume, pitch shift,
 * waveform type, and biquad lowpass filter cutoff frequency.
 */

class AudioFeedbackService {
  constructor() {
    this._ctx = null;
    this._enabled = true;
    this._volume = 0.5;
    this._pitchShift = 1.0;
    this._filterCutoff = 8000; // Hz lowpass filter cutoff
    this._waveform = 'sine';   // 'sine' | 'triangle' | 'square' | 'sawtooth'
  }

  static get PARAMS() {
    return {
      volume:       { min: 0.0, max: 1.0,   step: 0.05, default: 0.5,  unit: '',   label: 'SFX Volume',     description: 'Volume of feedback chimes and tones (0 = silent, 1 = max)' },
      pitchShift:   { min: 0.5, max: 2.0,   step: 0.05, default: 1.0,  unit: '×',  label: 'SFX Pitch Shift', description: 'Pitch multiplier for sound effects (0.5 = low, 2.0 = high)' },
      filterCutoff: { min: 400, max: 12000, step: 200,  default: 8000, unit: 'Hz', label: 'Audio Lowpass Filter', description: 'Cutoff frequency to soften harsh high-frequency sounds (warmth filter)' },
    };
  }

  /** Lazily initialise AudioContext (must happen after user gesture). */
  _getContext() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
    return this._ctx;
  }

  /** Play a pleasant "correct" chime (ascending two-tone). */
  playCorrect() {
    if (!this._enabled) return;
    try {
      const ctx = this._getContext();
      const now = ctx.currentTime;
      const base1 = 523.25 * this._pitchShift;
      const base2 = 659.25 * this._pitchShift;

      // First tone (C5)
      this._playTone(ctx, base1, now, 0.12, 0.3 * this._volume, this._waveform);
      // Second tone (E5) — slightly delayed
      this._playTone(ctx, base2, now + 0.1, 0.15, 0.3 * this._volume, this._waveform);
    } catch (e) {
      // Audio not critical — fail silently
    }
  }

  /** Play a gentle "incorrect" buzz (low tone). */
  playIncorrect() {
    if (!this._enabled) return;
    try {
      const ctx = this._getContext();
      const now = ctx.currentTime;
      const base = 220 * this._pitchShift;

      // Single low tone (C3)
      this._playTone(ctx, base, now, 0.2, 0.25 * this._volume, 'triangle');
    } catch (e) {
      // Audio not critical — fail silently
    }
  }

  /** Play a "session complete" celebration (three ascending tones). */
  playComplete() {
    if (!this._enabled) return;
    try {
      const ctx = this._getContext();
      const now = ctx.currentTime;
      const c = 523.25 * this._pitchShift;
      const e = 659.25 * this._pitchShift;
      const g = 783.99 * this._pitchShift;

      this._playTone(ctx, c, now, 0.15, 0.25 * this._volume, this._waveform);
      this._playTone(ctx, e, now + 0.15, 0.15, 0.25 * this._volume, this._waveform);
      this._playTone(ctx, g, now + 0.3, 0.2, 0.3 * this._volume, this._waveform);
    } catch (e) {
      // Audio not critical
    }
  }

  /** Play a simple click for UI interactions. */
  playClick() {
    if (!this._enabled) return;
    try {
      const ctx = this._getContext();
      const now = ctx.currentTime;
      this._playTone(ctx, 800 * this._pitchShift, now, 0.03, 0.1 * this._volume, 'sine');
    } catch (e) {
      // Audio not critical
    }
  }

  /**
   * Play a single tone with biquad lowpass filtering.
   * @param {AudioContext} ctx
   * @param {number} frequency - Hz
   * @param {number} startTime - AudioContext time
   * @param {number} duration - seconds
   * @param {number} volume - 0–1
   * @param {string} type - oscillator type
   */
  _playTone(ctx, frequency, startTime, duration, volume = 0.3, type = 'sine') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    // Configure lowpass filter
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(this._filterCutoff, startTime);
    filter.Q.setValueAtTime(1, startTime);

    osc.connect(gain);
    gain.connect(filter);
    filter.connect(ctx.destination);

    osc.type = type || this._waveform;
    osc.frequency.setValueAtTime(frequency, startTime);

    // Smooth envelope to avoid clicks
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  /** Enable or disable audio feedback. */
  setEnabled(enabled) {
    this._enabled = enabled;
  }
  get isEnabled() {
    return this._enabled;
  }

  setVolume(vol) {
    this._volume = Math.max(0.0, Math.min(1.0, vol));
  }
  get volume() {
    return this._volume;
  }

  setPitchShift(pitch) {
    this._pitchShift = Math.max(0.5, Math.min(2.0, pitch));
  }
  get pitchShift() {
    return this._pitchShift;
  }

  setFilterCutoff(hz) {
    this._filterCutoff = Math.max(200, Math.min(20000, hz));
  }
  get filterCutoff() {
    return this._filterCutoff;
  }

  setWaveform(type) {
    if (['sine', 'triangle', 'square', 'sawtooth'].includes(type)) {
      this._waveform = type;
    }
  }
  get waveform() {
    return this._waveform;
  }
}

// Singleton
export const audioFeedback = new AudioFeedbackService();
export default audioFeedback;
