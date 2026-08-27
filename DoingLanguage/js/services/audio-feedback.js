/**
 * DoingLanguage — Audio Feedback Service
 * Uses Web Audio API to generate short sound effects for correct/incorrect answers.
 * No external audio files needed.
 */

class AudioFeedbackService {
  constructor() {
    this._ctx = null;
    this._enabled = true;
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

      // First tone (C5)
      this._playTone(ctx, 523.25, now, 0.12, 0.3);
      // Second tone (E5) — slightly delayed
      this._playTone(ctx, 659.25, now + 0.1, 0.15, 0.3);
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

      // Single low tone (C3)
      this._playTone(ctx, 220, now, 0.2, 0.2, 'triangle');
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

      this._playTone(ctx, 523.25, now, 0.15, 0.25);        // C5
      this._playTone(ctx, 659.25, now + 0.15, 0.15, 0.25);  // E5
      this._playTone(ctx, 783.99, now + 0.3, 0.2, 0.3);     // G5
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
      this._playTone(ctx, 800, now, 0.03, 0.1);
    } catch (e) {
      // Audio not critical
    }
  }

  /**
   * Play a single tone.
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

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = type;
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
}

// Singleton
export const audioFeedback = new AudioFeedbackService();
export default audioFeedback;
