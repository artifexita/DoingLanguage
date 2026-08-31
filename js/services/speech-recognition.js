/**
 * DoingLanguage — Speech Recognition Service
 * Wraps the Web Speech API SpeechRecognition (Chrome/Edge).
 * Falls back gracefully on unsupported browsers with self-assessment UI.
 */

class SpeechRecognitionService {
  constructor() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._isSupported = !!SpeechRecognition;
    this._recognition = this._isSupported ? new SpeechRecognition() : null;
    this._isListening = false;
    this._onResultCallback = null;
    this._onErrorCallback = null;

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
   * Start listening and return the recognised transcript.
   * @param {object} [options]
   * @param {string} [options.lang='en-AU'] - Recognition language
   * @param {number} [options.timeout=10000] - Max listen time in ms
   * @returns {Promise<{transcript: string, confidence: number, alternatives: string[]}>}
   */
  listen(options = {}) {
    return new Promise((resolve, reject) => {
      if (!this._isSupported) {
        reject(new Error('Speech recognition not supported. Use Chrome or Edge.'));
        return;
      }

      if (this._isListening) {
        this._recognition.abort();
      }

      const lang = options.lang || 'en-AU';
      const timeout = options.timeout || 10000;

      this._recognition.lang = lang;
      this._isListening = true;

      // Timeout safety
      const timeoutId = setTimeout(() => {
        if (this._isListening) {
          this._recognition.stop();
          reject(new Error('timeout'));
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

  /** Handle recognition results. */
  _handleResult(event) {
    const results = event.results[event.resultIndex];
    const best = results[0];
    const alternatives = [];

    for (let i = 1; i < results.length; i++) {
      alternatives.push(results[i].transcript.trim().toLowerCase());
    }

    const result = {
      transcript: best.transcript.trim(),
      confidence: best.confidence,
      alternatives,
    };

    if (this._onResultCallback) {
      this._onResultCallback(result);
      this._onResultCallback = null;
    }
  }

  /** Handle recognition errors. */
  _handleError(event) {
    const error = new Error(event.error);
    error.code = event.error;

    // 'no-speech' and 'aborted' are non-critical
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

  /** Stop listening. */
  stop() {
    if (this._recognition && this._isListening) {
      this._recognition.stop();
      this._isListening = false;
    }
  }

  /** Abort listening (discard results). */
  abort() {
    if (this._recognition && this._isListening) {
      this._recognition.abort();
      this._isListening = false;
    }
  }

  /**
   * Compare the recognised speech against the expected text.
   * Returns a match score from 0 to 1.
   * @param {string} expected
   * @param {string} actual
   * @returns {number}
   */
  static compareTranscripts(expected, actual) {
    const clean = (s) => s.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
    const exp = clean(expected);
    const act = clean(actual);

    if (exp === act) return 1.0;

    // Check if the expected text is contained in the actual
    if (act.includes(exp)) return 0.9;

    // Simple Levenshtein-based similarity
    const distance = SpeechRecognitionService._levenshtein(exp, act);
    const maxLen = Math.max(exp.length, act.length);
    if (maxLen === 0) return 1.0;

    return Math.max(0, 1 - (distance / maxLen));
  }

  /** Levenshtein distance between two strings. */
  static _levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    return dp[m][n];
  }

  /** Set recognition language. */
  setLanguage(lang) {
    if (this._recognition) {
      this._recognition.lang = lang;
    }
  }

  get isSupported() {
    return this._isSupported;
  }

  get isListening() {
    return this._isListening;
  }
}

// Singleton
export const speechRecognition = new SpeechRecognitionService();
export default speechRecognition;
