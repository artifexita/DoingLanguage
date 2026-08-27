/**
 * DoingLanguage — Speech Synthesis Service
 * Wraps the Web Speech API SpeechSynthesis with Australian English defaults,
 * configurable rate/pitch, and reliable voice selection.
 */

class SpeechSynthesisService {
  constructor() {
    this._synth = window.speechSynthesis;
    this._voices = [];
    this._currentVoice = null;
    this._rate = 0.85;      // Slightly slower default for clarity
    this._pitch = 1.0;
    this._isSupported = 'speechSynthesis' in window;
    this._ready = false;
    this._readyPromise = null;
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

      // Voices may be loaded asynchronously
      loadVoices();
      if (!this._ready) {
        this._synth.addEventListener('voiceschanged', loadVoices, { once: true });
        // Fallback timeout — some browsers never fire voiceschanged
        setTimeout(() => {
          if (!this._ready) {
            loadVoices();
            if (!this._ready) {
              this._ready = true;
              resolve();
            }
          }
        }, 2000);
      }
    });

    return this._readyPromise;
  }

  /** Select the best Australian English voice, or fall back gracefully. */
  _selectDefaultVoice() {
    // Priority: Australian English > British English > any English > default
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

    // Absolute fallback — use the system default
    this._currentVoice = this._voices[0] || null;
  }

  /**
   * Speak the given text.
   * @param {string} text - Text to speak
   * @param {object} [options] - Override rate, pitch, voice
   * @returns {Promise<void>} Resolves when speech finishes
   */
  speak(text, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this._isSupported) {
        resolve();
        return;
      }

      // Cancel any ongoing speech
      this._synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = options.voice || this._currentVoice;
      utterance.rate = options.rate ?? this._rate;
      utterance.pitch = options.pitch ?? this._pitch;
      utterance.lang = utterance.voice?.lang || 'en-AU';

      utterance.onend = () => resolve();
      utterance.onerror = (event) => {
        // 'interrupted' and 'canceled' are not real errors
        if (event.error === 'interrupted' || event.error === 'canceled') {
          resolve();
        } else {
          reject(new Error(`Speech error: ${event.error}`));
        }
      };

      // Chrome bug workaround: long utterances may stop mid-way.
      // Resuming keeps it going.
      const keepAlive = setInterval(() => {
        if (this._synth.speaking) {
          this._synth.pause();
          this._synth.resume();
        } else {
          clearInterval(keepAlive);
        }
      }, 10000);

      utterance.onend = () => {
        clearInterval(keepAlive);
        resolve();
      };

      this._synth.speak(utterance);
    });
  }

  /** Stop any current speech. */
  stop() {
    if (this._isSupported) {
      this._synth.cancel();
    }
  }

  /** Get all available voices. */
  getVoices() {
    return this._voices;
  }

  /** Get English voices only, sorted with Australian first. */
  getEnglishVoices() {
    return this._voices
      .filter(v => v.lang.startsWith('en'))
      .sort((a, b) => {
        const order = ['en-AU', 'en-GB', 'en-US'];
        const aIdx = order.findIndex(l => a.lang.startsWith(l));
        const bIdx = order.findIndex(l => b.lang.startsWith(l));
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      });
  }

  /** Set the active voice by voiceURI. */
  setVoice(voiceURI) {
    const voice = this._voices.find(v => v.voiceURI === voiceURI);
    if (voice) {
      this._currentVoice = voice;
    }
  }

  /** Get the current voice. */
  get currentVoice() {
    return this._currentVoice;
  }

  /** Set speech rate (0.5 – 2.0). */
  setRate(rate) {
    this._rate = Math.max(0.5, Math.min(2.0, rate));
  }

  get rate() {
    return this._rate;
  }

  /** Set speech pitch (0.5 – 2.0). */
  setPitch(pitch) {
    this._pitch = Math.max(0.5, Math.min(2.0, pitch));
  }

  get pitch() {
    return this._pitch;
  }

  get isSupported() {
    return this._isSupported;
  }

  get isReady() {
    return this._ready;
  }
}

// Singleton
export const speechSynthesis = new SpeechSynthesisService();
export default speechSynthesis;
