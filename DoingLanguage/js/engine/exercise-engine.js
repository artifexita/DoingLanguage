/**
 * DoingLanguage — Exercise Engine
 * Manages exercise sessions: loading items, tracking position,
 * coordinating with scoring and progress services.
 */

import { ScoringEngine } from './scoring.js';
import { CueingSystem } from './cueing-system.js';
import { progress } from '../services/progress.js';

export class ExerciseEngine {
  /**
   * @param {object} options
   * @param {string} options.tier
   * @param {string} options.subtier
   * @param {string} options.exerciseType
   * @param {array} options.items - Items for this session
   */
  constructor({ tier, subtier, exerciseType, items }) {
    this.tier = tier;
    this.subtier = subtier;
    this.exerciseType = exerciseType;
    this.items = items;
    this.currentIndex = 0;
    this.results = [];       // Array of {item, correct, score, feedback}
    this.isComplete = false;
    this._listeners = {};
  }

  /** Get the current item. */
  get currentItem() {
    return this.items[this.currentIndex] || null;
  }

  /** Get session progress. */
  get sessionProgress() {
    const correctCount = this.results.filter(r => r.correct).length;
    return {
      current: this.currentIndex + 1,
      total: this.items.length,
      correct: correctCount,
      accuracy: this.results.length > 0 ? correctCount / this.results.length : 0,
      percentage: ((this.currentIndex) / this.items.length) * 100,
    };
  }

  /** Get remaining items count. */
  get remaining() {
    return this.items.length - this.currentIndex;
  }

  /**
   * Submit an answer for the current item.
   * @param {*} answer - User's answer
   * @returns {{correct, feedback, score, item}}
   */
  async submitAnswer(answer) {
    const item = this.currentItem;
    if (!item) return null;

    const correctAnswer = this._getCorrectAnswer(item);
    const result = ScoringEngine.check(answer, correctAnswer, this.exerciseType);

    const itemId = this._getItemId(item);

    // Record in progress system
    await progress.recordAttempt(
      this.tier,
      this.subtier,
      itemId,
      result.correct,
      this.exerciseType
    );

    const fullResult = {
      item,
      itemId,
      correct: result.correct,
      score: result.score,
      feedback: result.feedback,
      userAnswer: answer,
      correctAnswer,
    };

    this.results.push(fullResult);
    this._emit('answer', fullResult);

    return fullResult;
  }

  /** Move to the next item. */
  next() {
    if (this.currentIndex < this.items.length - 1) {
      this.currentIndex++;
      this._emit('next', { index: this.currentIndex, item: this.currentItem });
      return true;
    } else {
      this.isComplete = true;
      this._emit('complete', this.getSessionSummary());
      return false;
    }
  }

  /** Move to the previous item. */
  previous() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this._emit('previous', { index: this.currentIndex, item: this.currentItem });
      return true;
    }
    return false;
  }

  /** Get a summary of the completed session. */
  getSessionSummary() {
    const correctCount = this.results.filter(r => r.correct).length;
    const accuracy = this.results.length > 0 ? correctCount / this.results.length : 0;

    return {
      tier: this.tier,
      subtier: this.subtier,
      exerciseType: this.exerciseType,
      totalItems: this.items.length,
      correctCount,
      accuracy,
      results: this.results,
      duration: null, // Can be set externally
    };
  }

  /**
   * Generate distractors for multiple-choice exercises.
   * @param {object} currentItem - The correct item
   * @param {array} allItems - Pool of all items to choose distractors from
   * @param {number} count - Number of distractors
   * @returns {array} Shuffled options including the correct answer
   */
  static generateOptions(currentItem, allItems, count = 3) {
    const correctId = currentItem.id || currentItem.upper || currentItem.digit?.toString() || currentItem.symbol;

    // Filter out the current item
    const distractorPool = allItems.filter(item => {
      const id = item.id || item.upper || item.digit?.toString() || item.symbol;
      return id !== correctId;
    });

    // Shuffle and take `count` distractors
    const shuffled = [...distractorPool].sort(() => Math.random() - 0.5);
    const distractors = shuffled.slice(0, count);

    // Combine with correct answer and shuffle
    const options = [...distractors, currentItem].sort(() => Math.random() - 0.5);
    return options;
  }

  /** Extract the correct answer from an item based on exercise context. */
  _getCorrectAnswer(item) {
    // Letters
    if (item.upper && item.name) return item.upper;
    // Numbers
    if (item.digit !== undefined) return item.digit.toString();
    // Punctuation
    if (item.symbol) return item.name || item.symbol;
    // Phonemes
    if (item.ipa) return item.ipa;
    // Generic
    return item.answer || item.id || '';
  }

  /** Get a stable ID for an item. */
  _getItemId(item) {
    return item.id || item.upper || item.digit?.toString() || item.symbol || 'unknown';
  }

  /** Simple event emitter. */
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  off(event, callback) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }
  }

  _emit(event, data) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => cb(data));
    }
  }
}

export default ExerciseEngine;
