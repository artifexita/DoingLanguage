/**
 * DoingLanguage — Progress Tracking Service
 * Tracks per-item accuracy, sub-tier mastery, and generates adaptive recommendations.
 *
 * Adaptive difficulty system:
 *   - Tracks accuracy per item and per sub-tier
 *   - Mastered (≥90%, ≥10 attempts) → recommend next sub-tier
 *   - Proficient (≥70%, ≥5 attempts) → can move on, more practice helps
 *   - In Progress (<70%) → focus on this sub-tier
 *   - Uses spaced repetition: correct answers increase interval, wrong resets
 */

import { storage } from './storage.js';

/** Mastery thresholds */
const THRESHOLDS = {
  MASTERED_ACCURACY: 0.90,
  MASTERED_MIN_ATTEMPTS: 10,
  PROFICIENT_ACCURACY: 0.70,
  PROFICIENT_MIN_ATTEMPTS: 5,
  RECENT_WINDOW: 10, // Last N attempts for recent accuracy
};

const STATUS = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  PROFICIENT: 'proficient',
  MASTERED: 'mastered',
};

class ProgressService {
  constructor() {
    this._storage = storage;
  }

  async init() {
    await this._storage.init();
  }

  /**
   * Record a single attempt on an item.
   * @param {string} tier - e.g. "1"
   * @param {string} subtier - e.g. "1.1"
   * @param {string} itemId - e.g. "letter-A"
   * @param {boolean} correct - whether the attempt was correct
   * @param {string} exerciseType - e.g. "multiple-choice"
   */
  async recordAttempt(tier, subtier, itemId, correct, exerciseType = '') {
    const key = `${subtier}::${itemId}`;
    let record = await this._storage.get(this._storage.STORES.PROGRESS, key);

    if (!record) {
      record = {
        id: key,
        tier,
        subtier,
        itemId,
        attempts: 0,
        correct: 0,
        recentAttempts: [],     // Array of booleans, most recent last
        streak: 0,
        bestStreak: 0,
        lastAttempted: null,
        firstAttempted: new Date().toISOString(),
        box: 1,                 // Spaced repetition box (1–4)
        lastCorrectAt: null,
      };
    }

    record.attempts++;
    if (correct) {
      record.correct++;
      record.streak++;
      record.bestStreak = Math.max(record.bestStreak, record.streak);
      record.box = Math.min(4, record.box + 1);
      record.lastCorrectAt = new Date().toISOString();
    } else {
      record.streak = 0;
      record.box = 1; // Reset to box 1 on error
    }

    // Keep recent attempts window
    record.recentAttempts.push(correct);
    if (record.recentAttempts.length > THRESHOLDS.RECENT_WINDOW) {
      record.recentAttempts.shift();
    }

    record.lastAttempted = new Date().toISOString();
    await this._storage.put(this._storage.STORES.PROGRESS, record);

    return record;
  }

  /**
   * Record a completed session.
   * @param {object} sessionData
   */
  async recordSession(sessionData) {
    const session = {
      ...sessionData,
      timestamp: new Date().toISOString(),
    };
    await this._storage.put(this._storage.STORES.SESSIONS, session);
  }

  /**
   * Get progress for a specific sub-tier.
   * @param {string} subtier - e.g. "1.1"
   * @returns {Promise<{accuracy, recentAccuracy, totalAttempts, totalCorrect, status, itemCount, itemsMastered}>}
   */
  async getSubtierProgress(subtier) {
    const records = await this._storage.getByIndex(
      this._storage.STORES.PROGRESS,
      'subtier',
      subtier
    );

    if (records.length === 0) {
      return {
        accuracy: 0,
        recentAccuracy: 0,
        totalAttempts: 0,
        totalCorrect: 0,
        status: STATUS.NOT_STARTED,
        itemCount: 0,
        itemsMastered: 0,
      };
    }

    const totalAttempts = records.reduce((sum, r) => sum + r.attempts, 0);
    const totalCorrect = records.reduce((sum, r) => sum + r.correct, 0);
    const accuracy = totalAttempts > 0 ? totalCorrect / totalAttempts : 0;

    // Recent accuracy across all items
    const allRecent = records.flatMap(r => r.recentAttempts);
    const recentCorrect = allRecent.filter(Boolean).length;
    const recentAccuracy = allRecent.length > 0 ? recentCorrect / allRecent.length : 0;

    // Count mastered items
    const itemsMastered = records.filter(r => {
      const itemAcc = r.attempts > 0 ? r.correct / r.attempts : 0;
      return itemAcc >= THRESHOLDS.MASTERED_ACCURACY && r.attempts >= THRESHOLDS.MASTERED_MIN_ATTEMPTS;
    }).length;

    // Determine status
    let status;
    if (accuracy >= THRESHOLDS.MASTERED_ACCURACY && totalAttempts >= THRESHOLDS.MASTERED_MIN_ATTEMPTS) {
      status = STATUS.MASTERED;
    } else if (accuracy >= THRESHOLDS.PROFICIENT_ACCURACY && totalAttempts >= THRESHOLDS.PROFICIENT_MIN_ATTEMPTS) {
      status = STATUS.PROFICIENT;
    } else {
      status = STATUS.IN_PROGRESS;
    }

    return {
      accuracy,
      recentAccuracy,
      totalAttempts,
      totalCorrect,
      status,
      itemCount: records.length,
      itemsMastered,
    };
  }

  /**
   * Get progress summary for a whole tier.
   * @param {string} tier - e.g. "1"
   * @returns {Promise<{totalAttempts, accuracy, status}>}
   */
  async getTierProgress(tier) {
    const records = await this._storage.getByIndex(
      this._storage.STORES.PROGRESS,
      'tier',
      tier
    );

    const totalAttempts = records.reduce((sum, r) => sum + r.attempts, 0);
    const totalCorrect = records.reduce((sum, r) => sum + r.correct, 0);
    const accuracy = totalAttempts > 0 ? totalCorrect / totalAttempts : 0;

    let status = STATUS.NOT_STARTED;
    if (totalAttempts > 0) {
      if (accuracy >= THRESHOLDS.MASTERED_ACCURACY) {
        status = STATUS.MASTERED;
      } else if (accuracy >= THRESHOLDS.PROFICIENT_ACCURACY) {
        status = STATUS.PROFICIENT;
      } else {
        status = STATUS.IN_PROGRESS;
      }
    }

    return { totalAttempts, totalCorrect: totalCorrect, accuracy, status };
  }

  /**
   * Get overall progress across all tiers.
   */
  async getOverallProgress() {
    const allRecords = await this._storage.getAll(this._storage.STORES.PROGRESS);
    const totalAttempts = allRecords.reduce((sum, r) => sum + r.attempts, 0);
    const totalCorrect = allRecords.reduce((sum, r) => sum + r.correct, 0);
    const accuracy = totalAttempts > 0 ? totalCorrect / totalAttempts : 0;

    // Count unique subtiers attempted
    const subtiers = new Set(allRecords.map(r => r.subtier));

    return {
      totalAttempts,
      totalCorrect,
      accuracy,
      subtiersAttempted: subtiers.size,
      itemsAttempted: allRecords.length,
    };
  }

  /**
   * Get items for a session, using spaced repetition.
   * Selects items from due boxes + new items.
   * @param {string} subtier
   * @param {array} allItems - All possible items for this sub-tier
   * @param {number} sessionSize - How many items per session (default 10)
   * @returns {Promise<array>} Selected items for the session
   */
  async getSessionItems(subtier, allItems, sessionSize = 10) {
    const records = await this._storage.getByIndex(
      this._storage.STORES.PROGRESS,
      'subtier',
      subtier
    );

    const recordMap = new Map(records.map(r => [r.itemId, r]));

    // Categorise items
    const newItems = [];
    const dueItems = [];
    const reviewItems = [];

    for (const item of allItems) {
      const itemId = item.id || item.digit?.toString() || item.upper || item.symbol;
      const record = recordMap.get(itemId);

      if (!record) {
        newItems.push(item);
      } else {
        // Check if due based on box level
        const hoursSinceCorrect = record.lastCorrectAt
          ? (Date.now() - new Date(record.lastCorrectAt).getTime()) / (1000 * 60 * 60)
          : Infinity;

        const intervalHours = [0, 0.5, 4, 24, 72][record.box] || 0;

        if (hoursSinceCorrect >= intervalHours) {
          dueItems.push({ ...item, _priority: record.box === 1 ? 0 : 1 });
        } else {
          reviewItems.push(item);
        }
      }
    }

    // Sort due items: box 1 (recently wrong) first
    dueItems.sort((a, b) => a._priority - b._priority);

    // Build session: due items first, then new items, then review
    const session = [];
    const sources = [dueItems, newItems, reviewItems];

    for (const source of sources) {
      for (const item of source) {
        if (session.length >= sessionSize) break;
        const clean = { ...item };
        delete clean._priority;
        session.push(clean);
      }
      if (session.length >= sessionSize) break;
    }

    // Shuffle to avoid predictable ordering
    return this._shuffle(session);
  }

  /**
   * Get recent session history.
   * @param {number} limit
   * @returns {Promise<array>}
   */
  async getRecentSessions(limit = 10) {
    const sessions = await this._storage.getAll(this._storage.STORES.SESSIONS);
    return sessions
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /** Fisher-Yates shuffle. */
  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Reset all progress (with confirmation). */
  async resetAll() {
    await this._storage.clear(this._storage.STORES.PROGRESS);
    await this._storage.clear(this._storage.STORES.SESSIONS);
  }

  get THRESHOLDS() {
    return THRESHOLDS;
  }

  get STATUS() {
    return STATUS;
  }
}

// Singleton
export const progress = new ProgressService();
export default progress;
