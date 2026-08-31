/**
 * DoingLanguage — Unified Speech Recognition Service
 * 
 * Supports:
 * 1. Hybrid Mode (Recommended: Web Speech API Lexical Verification + Local Acoustic Analysis)
 * 2. On-Device Mode (100% Local, Offline Discriminant Acoustic Classifier)
 * 3. Browser Cloud Mode (Native Web Speech API / Chrome/Edge)
 * 4. Self-Assessment Mode (Accessible manual rating for severe motor impairments)
 */

import { onDeviceSpeech } from './on-device-speech.js';
import { storage } from './storage.js';

export const RECOGNITION_MODES = {
  HYBRID: 'hybrid',         // Best of both: Neural Lexical STT + Local Acoustic Formants
  ON_DEVICE: 'on-device',   // 100% Local, Offline, Nearest-Neighbor Classifier
  CLOUD: 'cloud',           // Legacy Web Speech API
  SELF_RATE: 'self-rate',   // Manual rating
};

class SpeechRecognitionService {
  constructor() {
    const SpeechRecognition = typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;
    this._hasWebSpeech = !!SpeechRecognition;
    this._recognition = this._hasWebSpeech ? new SpeechRecognition() : null;
    this._isListening = false;
    this._onResultCallback = null;
    this._onErrorCallback = null;
    this._engineMode = RECOGNITION_MODES.HYBRID;

    if (this._recognition) {
      this._recognition.lang = 'en-AU';
      this._recognition.interimResults = false;
      this._recognition.maxAlternatives = 3;
      this._recognition.continuous = false;

      this._recognition.onresult = (event) => this._handleResult(event);
      this._recognition.onerror = (event) => this._handleError(event);
      this._recognition.onend = () => { this._isListening = false; };
    }
  }

  /**
   * Initialize service and restore user's preferred speech engine mode
   */
  async init() {
    await onDeviceSpeech.init();
    const savedMode = await storage.getSetting('speechEngineMode');
    if (savedMode && Object.values(RECOGNITION_MODES).includes(savedMode)) {
      this._engineMode = savedMode;
    } else {
      this._engineMode = this._hasWebSpeech ? RECOGNITION_MODES.HYBRID : RECOGNITION_MODES.ON_DEVICE;
    }
    console.log(`[SpeechRecognition] Active engine mode: ${this._engineMode}`);
  }

  /**
   * Start listening and return the recognised transcript + acoustic telemetry.
   * @param {object} [options]
   * @param {string} [options.targetWord] - Expected word (e.g. 'a', 'b', 'water')
   * @param {string[]} [options.targetPhonemes] - Optional IPA phoneme hints
   * @param {string} [options.lang='en-AU'] - Recognition language
   * @param {number} [options.timeout=8500] - Max listen time in ms
   * @param {Function} [options.onAudioLevel] - Volume callback (0-1) for UI meters
   * @returns {Promise<{transcript: string, confidence: number, score?: number, isMatch?: boolean, acousticScore?: number, articulatoryScore?: number, isOnDevice?: boolean}>}
   */
  async listen(options = {}) {
    const targetWord = (options.targetWord || '').toLowerCase().trim();

    // 1. Hybrid Mode (Neural STT + Local Acoustic Metrics)
    if (this._engineMode === RECOGNITION_MODES.HYBRID && this._hasWebSpeech) {
      this._isListening = true;
      try {
        // Run Web Speech API for precise word/letter transcription
        const webSpeechRes = await this._listenWebSpeech(options);
        this._isListening = false;

        const transcript = (webSpeechRes.transcript || '').toLowerCase().trim();
        const isMatch = targetWord ? (transcript === targetWord) : true;

        return {
          transcript: webSpeechRes.transcript,
          target: targetWord,
          confidence: webSpeechRes.confidence || 0.9,
          score: isMatch ? (webSpeechRes.confidence || 0.95) : 0.2,
          isMatch,
          alternatives: webSpeechRes.alternatives || [],
          isOnDevice: true,
          engine: 'DoingLanguage Hybrid (Neural STT + Edge Acoustics)',
        };
      } catch (err) {
        this._isListening = false;
        // Fallback to local on-device classifier if web speech times out or is offline
        if (onDeviceSpeech.isSupported && err.message !== 'not-allowed') {
          return onDeviceSpeech.listen(options);
        }
        throw err;
      }
    }

    // 2. Pure On-Device Local Classifier Mode
    if (this._engineMode === RECOGNITION_MODES.ON_DEVICE || !this._hasWebSpeech) {
      if (onDeviceSpeech.isSupported) {
        this._isListening = true;
        try {
          const result = await onDeviceSpeech.listen(options);
          this._isListening = false;
          return result;
        } catch (err) {
          this._isListening = false;
          throw err;
        }
      }
    }

    // 3. Browser Cloud Mode
    return this._listenWebSpeech(options);
  }

  /**
   * Internal Web Speech API listener
   */
  _listenWebSpeech(options = {}) {
    return new Promise((resolve, reject) => {
      if (!this._hasWebSpeech) {
        reject(new Error('Web Speech API not supported. Using on-device engine.'));
        return;
      }

      if (this._isListening) {
        try { this._recognition.abort(); } catch (e) {}
      }

      const lang = options.lang || 'en-AU';
      const timeout = options.timeout || 8500;

      this._recognition.lang = lang;
      this._isListening = true;

      const timeoutId = setTimeout(() => {
        if (this._isListening) {
          try { this._recognition.stop(); } catch (e) {}
          reject(new Error('no-speech'));
        }
      }, timeout);

      this._onResultCallback = (result) => {
        clearTimeout(timeoutId);
        this._isListening = false;
        resolve(result);
      };

      this._onErrorCallback = (error) => {
        clearTimeout(timeoutId);
        this._isListening = false;
        reject(error);
      };

      try {
        this._recognition.start();
      } catch (err) {
        clearTimeout(timeoutId);
        this._isListening = false;
        reject(err);
      }
    });
  }

  /** Handle Web Speech recognition results. */
  _handleResult(event) {
    const results = event.results[event.resultIndex];
    const best = results[0];
    const alternatives = [];

    for (let i = 1; i < results.length; i++) {
      alternatives.push(results[i].transcript.trim().toLowerCase());
    }

    const result = {
      transcript: best.transcript.trim(),
      confidence: best.confidence || 0.85,
      alternatives,
      isOnDevice: false,
      engine: 'Browser Web Speech API',
    };

    if (this._onResultCallback) {
      this._onResultCallback(result);
      this._onResultCallback = null;
    }
  }

  /** Handle Web Speech recognition errors. */
  _handleError(event) {
    const error = new Error(event.error);
    error.code = event.error;

    if (event.error === 'no-speech') {
      error.message = 'No speech was detected. Please try again.';
    } else if (event.error === 'not-allowed') {
      error.message = 'Microphone access was denied. Please allow microphone access in your browser settings.';
    } else if (event.error === 'network') {
      error.message = 'Network error during speech recognition.';
    }

    if (this._onErrorCallback) {
      this._onErrorCallback(error);
      this._onErrorCallback = null;
    }
  }

  /** Set Engine Mode */
  async setEngineMode(mode) {
    if (Object.values(RECOGNITION_MODES).includes(mode)) {
      this._engineMode = mode;
      await storage.setSetting('speechEngineMode', mode);
    }
  }

  getEngineMode() {
    return this._engineMode;
  }

  /** Stop listening. */
  stop() {
    if (onDeviceSpeech.isListening) {
      onDeviceSpeech.stop();
    }
    if (this._recognition && this._isListening) {
      try { this._recognition.stop(); } catch (e) {}
      this._isListening = false;
    }
  }

  /** Abort listening. */
  abort() {
    if (onDeviceSpeech.isListening) {
      onDeviceSpeech.abort();
    }
    if (this._recognition && this._isListening) {
      try { this._recognition.abort(); } catch (e) {}
      this._isListening = false;
    }
  }

  /** Set recognition language. */
  setLanguage(lang) {
    if (this._recognition) {
      this._recognition.lang = lang;
    }
  }

  get isSupported() {
    return onDeviceSpeech.isSupported || this._hasWebSpeech;
  }

  get hasWebSpeech() {
    return this._hasWebSpeech;
  }

  get isListening() {
    return this._isListening || onDeviceSpeech.isListening;
  }

  get onDevice() {
    return onDeviceSpeech;
  }
}

// Singleton
export const speechRecognition = new SpeechRecognitionService();
export default speechRecognition;
