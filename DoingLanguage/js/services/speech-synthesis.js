/**
 * DoingLanguage — Speech Synthesis Service
 * Wraps the Web Speech API SpeechSynthesis with Australian English defaults
 * and an extensive suite of clinical and tweakable speech parameters for
 * Apraxia, Aphasia, and motor speech rehabilitation.
 *
 * Full parameter list:
 *   - rate: 0.10× (ultra-slow) to 1.50× (fast). Default 0.85×
 *   - pitch: 0.0 (deepest) to 2.0 (highest). Default 1.0
 *   - volume: 0.0 (mute) to 1.0 (full). Default 1.0
 *   - wordGap: 0 to 3000 ms (inter-word pacing board pause). Default 0 ms
 *   - letterGap: 0 to 1500 ms (pause between spelled letters / phonics). Default 0 ms
 *   - punctMultiplier: 1.0× to 3.0× (extra pause at commas, full stops, question marks). Default 1.0×
 *   - repeatCount: 1× to 5× (integral stimulation repetitions). Default 1×
 *   - repeatDelay: 200 to 5000 ms (pause between repetitions). Default 1000 ms
 *   - cueTone: 'off' | 'soft' | 'chime' | 'click' (pre-speech attention alert). Default 'off'
 *   - voiceScope: 'english' | 'all' (filter voice selection dropdown). Default 'english'
 */

import { audioFeedback } from './audio-feedback.js';

class SpeechSynthesisService {
  constructor() {
    this._synth = window.speechSynthesis;
    this._voices = [];
    this._currentVoice = null;

    // ---- Tweakable Parameters ----
    this._rate = 0.85;            // Speech rate (0.1 - 1.5)
    this._pitch = 1.0;           // Speech pitch (0.0 - 2.0)
    this._volume = 1.0;          // Output volume (0.0 - 1.0)
    this._wordGap = 0;           // Inter-word pause in ms (0 - 3000)
    this._letterGap = 0;         // Inter-letter pause in ms (0 - 1500)
    this._punctMultiplier = 1.0; // Punctuation pause multiplier (1.0 - 3.0)
    this._repeatCount = 1;       // Automatic repetition count (1 - 5)
    this._repeatDelay = 1000;    // Pause between repetitions in ms (200 - 5000)
    this._cueTone = 'off';       // Attention tone before speech ('off'|'soft'|'chime'|'click')
    this._voiceScope = 'english'; // 'english' or 'all'

    this._isSupported = 'speechSynthesis' in window;
    this._ready = false;
    this._readyPromise = null;
    this._isSpeaking = false;
    this._cancelRequested = false;
  }

  // =====================================================================
  // Parameter definitions & metadata for the UI
  // =====================================================================
  static get PARAMS() {
    return {
      rate: {
        min: 0.1, max: 1.5, step: 0.05, default: 0.85, unit: '×',
        label: 'Speech Speed (Rate)',
        description: 'How fast the voice speaks (0.10× = ultra-slow for phoneme placement, 1.00× = natural, 1.50× = fast)',
      },
      pitch: {
        min: 0.0, max: 2.0, step: 0.05, default: 1.0, unit: '',
        label: 'Vocal Pitch',
        description: 'Voice frequency tone (0.0 = deep bass, 1.0 = natural, 2.0 = high treble)',
      },
      volume: {
        min: 0.0, max: 1.0, step: 0.05, default: 1.0, unit: '',
        label: 'Voice Volume',
        description: 'Loudness of speech output (0% = silent, 100% = full volume)',
      },
      wordGap: {
        min: 0, max: 3000, step: 50, default: 0, unit: 'ms',
        label: 'Word Gap (Pacing Board)',
        description: 'Inserts pauses between words to provide time for motor planning and auditory processing (0 = natural flow)',
      },
      letterGap: {
        min: 0, max: 1500, step: 50, default: 0, unit: 'ms',
        label: 'Letter / Spelling Delay',
        description: 'Extra delay when letters or phonemes are spoken individually (0 = default)',
      },
      punctMultiplier: {
        min: 1.0, max: 3.0, step: 0.25, default: 1.0, unit: '×',
        label: 'Punctuation Pause Multiplier',
        description: 'Lengthens natural pauses at commas, full stops, and question marks to aid comprehension',
      },
      repeatCount: {
        min: 1, max: 5, step: 1, default: 1, unit: '×',
        label: 'Repetition Count',
        description: 'Number of times to speak each item (repetition supports motor speech learning)',
      },
      repeatDelay: {
        min: 200, max: 5000, step: 100, default: 1000, unit: 'ms',
        label: 'Repetition Interval',
        description: 'Pause duration between automatic repetitions',
      },
      cueTone: {
        options: [
          { value: 'off', label: 'Off (No Cue)' },
          { value: 'soft', label: 'Soft Beep (440 Hz)' },
          { value: 'chime', label: 'High Chime (880 Hz)' },
          { value: 'click', label: 'Gentle Wood Click' },
        ],
        default: 'off',
        label: 'Pre-Speech Attention Cue',
        description: 'Plays a short audio tone immediately before speech begins to focus attention',
      },
      voiceScope: {
        options: [
          { value: 'english', label: 'English Voices (AU, GB, US, NZ, CA)' },
          { value: 'all', label: 'All System Installed Voices' },
        ],
        default: 'english',
        label: 'Voice List Filter',
        description: 'Filter available voices list to English accents or show all system voices',
      },
    };
  }

  /** Initialise the service and load available voices. */
  async init() {
    if (!this._isSupported) {
      console.warn('SpeechSynthesis not supported in this browser.');
      return;
    }

    this._readyPromise = new Promise((resolve) => {
      const loadVoices = () => {
        this._voices = this._synth.getVoices();
        if (this._voices.length > 0) {
          this._selectDefaultVoice();
          this._ready = true;
          resolve();
        }
      };

      loadVoices();
      if (!this._ready) {
        this._synth.addEventListener('voiceschanged', loadVoices, { once: true });
        setTimeout(() => {
          if (!this._ready) {
            loadVoices();
            this._ready = true;
            resolve();
          }
        }, 2000);
      }
    });

    return this._readyPromise;
  }

  /** Select the best Australian English voice, or fall back gracefully. */
  _selectDefaultVoice() {
    const preferences = [
      (v) => v.lang === 'en-AU',
      (v) => v.lang.startsWith('en-AU'),
      (v) => v.lang === 'en-GB',
      (v) => v.lang.startsWith('en-GB'),
      (v) => v.lang === 'en-US',
      (v) => v.lang.startsWith('en'),
    ];

    for (const test of preferences) {
      const match = this._voices.find(test);
      if (match) {
        this._currentVoice = match;
        return;
      }
    }

    this._currentVoice = this._voices[0] || null;
  }

  /** Play pre-speech attention cue if enabled. */
  async _playCueTone() {
    if (this._cueTone === 'off') return;
    try {
      if (this._cueTone === 'soft') {
        audioFeedback._playTone(audioFeedback._getContext(), 440, audioFeedback._getContext().currentTime, 0.08, 0.25, 'sine');
        await this._delay(140);
      } else if (this._cueTone === 'chime') {
        audioFeedback._playTone(audioFeedback._getContext(), 880, audioFeedback._getContext().currentTime, 0.12, 0.2, 'sine');
        await this._delay(180);
      } else if (this._cueTone === 'click') {
        audioFeedback.playClick();
        await this._delay(100);
      }
    } catch (e) {
      // Non-critical
    }
  }

  /**
   * Pre-process text to incorporate punctuation multipliers.
   * Inserts micro-pauses or breath marks based on punctuation settings.
   */
  _processPunctuation(text) {
    if (this._punctMultiplier <= 1.0) return text;
    // Replace punctuation with spaced equivalents or commas for extra pauses
    if (this._punctMultiplier >= 2.0) {
      return text
        .replace(/,/g, ', ... ')
        .replace(/\./g, '. .... ')
        .replace(/\?/g, '? .... ')
        .replace(/!/g, '! .... ');
    }
    return text
      .replace(/,/g, ', .. ')
      .replace(/\./g, '. .. ')
      .replace(/\?/g, '? .. ')
      .replace(/!/g, '! .. ');
  }

  /**
   * Speak a single utterance (internal).
   */
  _speakOnce(text, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this._isSupported || this._cancelRequested) {
        resolve();
        return;
      }

      this._synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice  = opts.voice  || this._currentVoice;
      utterance.rate   = opts.rate   ?? this._rate;
      utterance.pitch  = opts.pitch  ?? this._pitch;
      utterance.volume = opts.volume ?? this._volume;
      utterance.lang   = utterance.voice?.lang || 'en-AU';

      // Dispatch word boundary events for visual highlighting
      utterance.onboundary = (e) => {
        window.dispatchEvent(new CustomEvent('dl:speech-boundary', {
          detail: {
            name: e.name,
            charIndex: e.charIndex,
            charLength: e.charLength,
            text,
          }
        }));
      };

      // Chrome long-utterance keep-alive
      const keepAlive = setInterval(() => {
        if (this._synth.speaking) {
          this._synth.pause();
          this._synth.resume();
        } else {
          clearInterval(keepAlive);
        }
      }, 8000);

      utterance.onend = () => {
        clearInterval(keepAlive);
        resolve();
      };

      utterance.onerror = (event) => {
        clearInterval(keepAlive);
        if (event.error === 'interrupted' || event.error === 'canceled') {
          resolve();
        } else {
          reject(new Error(`Speech error: ${event.error}`));
        }
      };

      this._synth.speak(utterance);
    });
  }

  /**
   * Speak a series of individual letters or phonemes for calibration.
   * Dispatches 'dl:calibration-step' event for each item.
   * @param {string[]} items - Array of letter strings e.g. ['A', 'B', 'C', 'D', 'E']
   * @param {object} [options] - Parameter overrides
   */
  async speakLetterSeries(items, options = {}) {
    if (!this._isSupported || !Array.isArray(items)) return;

    this._cancelRequested = false;
    this._isSpeaking = true;

    const opts = {
      voice:  options.voice  || this._currentVoice,
      rate:   options.rate   ?? this._rate,
      pitch:  options.pitch  ?? this._pitch,
      volume: options.volume ?? this._volume,
    };
    const letterGap = options.letterGap ?? this._letterGap;

    try {
      await this._playCueTone();

      for (let i = 0; i < items.length; i++) {
        if (this._cancelRequested) break;

        const rawItem = items[i];
        const processed = this._processPunctuation(rawItem);

        // Dispatch calibration step event
        window.dispatchEvent(new CustomEvent('dl:calibration-step', {
          detail: { index: i, item: rawItem, total: items.length, isComplete: false }
        }));

        await this._speakOnce(processed, opts);

        if (i < items.length - 1 && !this._cancelRequested) {
          const delay = Math.max(80, letterGap);
          await this._delay(delay);
        }
      }

      window.dispatchEvent(new CustomEvent('dl:calibration-step', {
        detail: { index: items.length, item: null, total: items.length, isComplete: true }
      }));
    } finally {
      this._isSpeaking = false;
    }
  }

  /**
   * Speak text applying all clinical & tweakable parameters.
   * Handles word pacing, repetition cycles, pre-cue tones, and delays.
   */
  async speak(text, options = {}) {
    if (!this._isSupported) return;

    this._cancelRequested = false;
    this._isSpeaking = true;

    const opts = {
      voice:  options.voice  || this._currentVoice,
      rate:   options.rate   ?? this._rate,
      pitch:  options.pitch  ?? this._pitch,
      volume: options.volume ?? this._volume,
    };
    const wordGap     = options.wordGap     ?? this._wordGap;
    const letterGap   = options.letterGap   ?? this._letterGap;
    const repeatCount = options.repeatCount ?? this._repeatCount;
    const repeatDelay = options.repeatDelay ?? this._repeatDelay;

    const processedText = this._processPunctuation(text);

    try {
      for (let rep = 0; rep < repeatCount; rep++) {
        if (this._cancelRequested) break;

        // Pre-speech attention cue tone
        await this._playCueTone();
        if (this._cancelRequested) break;

        if (letterGap > 0 && processedText.length <= 8 && !processedText.includes(' ')) {
          // Letter-by-letter spelling mode
          const chars = Array.from(processedText);
          for (let i = 0; i < chars.length; i++) {
            if (this._cancelRequested) break;
            await this._speakOnce(chars[i], opts);
            if (i < chars.length - 1 && letterGap > 0) {
              await this._delay(letterGap);
            }
          }
        } else if (wordGap > 0) {
          // Word-by-word pacing board mode
          const words = processedText.split(/\s+/).filter(w => w.length > 0);
          for (let i = 0; i < words.length; i++) {
            if (this._cancelRequested) break;
            await this._speakOnce(words[i], opts);
            if (i < words.length - 1 && wordGap > 0) {
              await this._delay(wordGap);
            }
          }
        } else {
          // Normal unified sentence / phrase mode
          await this._speakOnce(processedText, opts);
        }

        // Pause between repetitions
        if (rep < repeatCount - 1 && !this._cancelRequested) {
          await this._delay(repeatDelay);
        }
      }
    } finally {
      this._isSpeaking = false;
    }
  }

  /** Simple async delay. */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Stop any current speech and cancel pending repetitions. */
  stop() {
    this._cancelRequested = true;
    this._isSpeaking = false;
    if (this._isSupported) {
      this._synth.cancel();
    }
  }

  // =====================================================================
  // Getters & Setters
  // =====================================================================
  setRate(rate) { this._rate = Math.max(0.1, Math.min(1.5, rate)); }
  get rate() { return this._rate; }

  setPitch(pitch) { this._pitch = Math.max(0.0, Math.min(2.0, pitch)); }
  get pitch() { return this._pitch; }

  setVolume(vol) { this._volume = Math.max(0.0, Math.min(1.0, vol)); }
  get volume() { return this._volume; }

  setWordGap(ms) { this._wordGap = Math.max(0, Math.min(3000, Math.round(ms))); }
  get wordGap() { return this._wordGap; }

  setLetterGap(ms) { this._letterGap = Math.max(0, Math.min(1500, Math.round(ms))); }
  get letterGap() { return this._letterGap; }

  setPunctMultiplier(m) { this._punctMultiplier = Math.max(1.0, Math.min(3.0, m)); }
  get punctMultiplier() { return this._punctMultiplier; }

  setRepeatCount(n) { this._repeatCount = Math.max(1, Math.min(5, Math.round(n))); }
  get repeatCount() { return this._repeatCount; }

  setRepeatDelay(ms) { this._repeatDelay = Math.max(200, Math.min(5000, Math.round(ms))); }
  get repeatDelay() { return this._repeatDelay; }

  setCueTone(val) { this._cueTone = val; }
  get cueTone() { return this._cueTone; }

  setVoiceScope(scope) { this._voiceScope = scope; }
  get voiceScope() { return this._voiceScope; }

  // =====================================================================
  // Voice listing and selection
  // =====================================================================
  getVoices() {
    if (this._voiceScope === 'all') {
      return this._voices;
    }
    return this.getEnglishVoices();
  }

  getAllVoices() { return this._voices; }

  getEnglishVoices() {
    return this._voices
      .filter(v => v.lang.startsWith('en'))
      .sort((a, b) => {
        const order = ['en-AU', 'en-GB', 'en-US', 'en-NZ', 'en-CA', 'en-IE'];
        const aIdx = order.findIndex(l => a.lang.startsWith(l));
        const bIdx = order.findIndex(l => b.lang.startsWith(l));
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      });
  }

  setVoice(voiceURI) {
    const voice = this._voices.find(v => v.voiceURI === voiceURI);
    if (voice) {
      this._currentVoice = voice;
    }
  }

  get currentVoice() { return this._currentVoice; }
  get isSupported()  { return this._isSupported; }
  get isReady()      { return this._ready; }
  get isSpeaking()   { return this._isSpeaking; }

  getParams() {
    return {
      rate:            this._rate,
      pitch:           this._pitch,
      volume:          this._volume,
      wordGap:         this._wordGap,
      letterGap:       this._letterGap,
      punctMultiplier: this._punctMultiplier,
      repeatCount:     this._repeatCount,
      repeatDelay:     this._repeatDelay,
      cueTone:         this._cueTone,
      voiceScope:      this._voiceScope,
      voice:           this._currentVoice?.voiceURI || null,
    };
  }

  applyParams(params) {
    if (params.rate            != null) this.setRate(params.rate);
    if (params.pitch           != null) this.setPitch(params.pitch);
    if (params.volume          != null) this.setVolume(params.volume);
    if (params.wordGap         != null) this.setWordGap(params.wordGap);
    if (params.letterGap       != null) this.setLetterGap(params.letterGap);
    if (params.punctMultiplier != null) this.setPunctMultiplier(params.punctMultiplier);
    if (params.repeatCount     != null) this.setRepeatCount(params.repeatCount);
    if (params.repeatDelay     != null) this.setRepeatDelay(params.repeatDelay);
    if (params.cueTone         != null) this.setCueTone(params.cueTone);
    if (params.voiceScope      != null) this.setVoiceScope(params.voiceScope);
    if (params.voice           != null) this.setVoice(params.voice);
  }
}

// Singleton
export const speechSynthesis = new SpeechSynthesisService();
export default speechSynthesis;

