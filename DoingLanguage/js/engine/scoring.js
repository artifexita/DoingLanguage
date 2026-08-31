/**
 * DoingLanguage — Scoring Engine
 * Validates answers for different exercise types and calculates scores.
 * Enhanced with discriminant On-Device Acoustic & Articulatory Phonetic scoring.
 */

export class ScoringEngine {
  /**
   * Check a user's answer against the correct answer.
   * @param {*} userAnswer - The user's response
   * @param {*} correctAnswer - The expected answer
   * @param {string} exerciseType - Type of exercise
   * @returns {{correct: boolean, feedback: string, score: number, details?: object}}
   */
  static check(userAnswer, correctAnswer, exerciseType) {
    switch (exerciseType) {
      case 'multiple-choice':
        return ScoringEngine._checkExact(userAnswer, correctAnswer);

      case 'listen-repeat':
        return ScoringEngine._checkSpeech(userAnswer, correctAnswer);

      case 'match-pairs':
        return ScoringEngine._checkExact(userAnswer, correctAnswer);

      case 'sequence-order':
        return ScoringEngine._checkSequence(userAnswer, correctAnswer);

      default:
        return ScoringEngine._checkExact(userAnswer, correctAnswer);
    }
  }

  /** Exact match (case-insensitive, trimmed). */
  static _checkExact(userAnswer, correctAnswer) {
    const clean = (s) => String(s).toLowerCase().trim();
    const correct = clean(userAnswer) === clean(correctAnswer);

    return {
      correct,
      feedback: correct ? ScoringEngine._getPositiveFeedback() : ScoringEngine._getEncouragingFeedback(),
      score: correct ? 1 : 0,
    };
  }

  /** Speech-based match validating recognized transcript & acoustic distance against target. */
  static _checkSpeech(userAnswer, correctAnswer) {
    if (typeof userAnswer === 'object' && (userAnswer.transcript != null || userAnswer.score != null)) {
      const transcript = (userAnswer.transcript || '').trim();
      const clean = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
      const expected = clean(correctAnswer);
      const actual = clean(transcript);

      const isAcousticMatch = userAnswer.isMatch === true || (userAnswer.isOnDevice && actual === expected && (userAnswer.score || 0) >= 0.55);

      // 1. Exact Match on transcript or verified acoustic match
      if (actual === expected || isAcousticMatch) {
        const score = Math.max(0.85, userAnswer.score || 1.0);
        return {
          correct: true,
          feedback: ScoringEngine._getPositiveFeedback(),
          score,
          details: {
            acousticScore: userAnswer.acousticScore || score,
            articulatoryScore: userAnswer.articulatoryScore || score,
            formantMetrics: userAnswer.formantMetrics,
            engine: userAnswer.engine,
          },
        };
      }

      // 2. Check alternatives if present
      if (userAnswer.alternatives && Array.isArray(userAnswer.alternatives)) {
        for (const alt of userAnswer.alternatives) {
          if (clean(alt) === expected) {
            return {
              correct: true,
              feedback: ScoringEngine._getPositiveFeedback(),
              score: 0.9,
              details: { engine: userAnswer.engine },
            };
          }
        }
      }

      // 3. String & Phonetic Similarity check
      const similarity = ScoringEngine._similarity(expected, actual);

      if (similarity >= 0.8) {
        return {
          correct: true,
          feedback: 'Close enough — well done! 👍',
          score: similarity,
          details: {
            acousticScore: userAnswer.acousticScore,
            articulatoryScore: userAnswer.articulatoryScore,
            engine: userAnswer.engine,
          },
        };
      } else if (similarity >= 0.45) {
        return {
          correct: false,
          feedback: `Almost! You said "${transcript}". Expected "${correctAnswer}". Try again? 🔄`,
          score: similarity,
          details: {
            acousticScore: userAnswer.acousticScore || similarity,
            articulatoryScore: userAnswer.articulatoryScore,
            engine: userAnswer.engine,
          },
        };
      } else {
        return {
          correct: false,
          feedback: transcript
            ? `You said "${transcript}". Target was "${correctAnswer}". Have another go! 💪`
            : `Could not clearly detect "${correctAnswer}". Please try again! 💪`,
          score: Math.max(0, similarity),
          details: {
            acousticScore: userAnswer.acousticScore || 0.1,
            articulatoryScore: userAnswer.articulatoryScore,
            engine: userAnswer.engine,
          },
        };
      }
    }

    // Self-rated fallback (boolean)
    if (typeof userAnswer === 'boolean') {
      return {
        correct: userAnswer,
        feedback: userAnswer ? 'Great work! 👍' : 'No worries — practice makes perfect!',
        score: userAnswer ? 1 : 0,
      };
    }

    return ScoringEngine._checkExact(userAnswer, correctAnswer);
  }

  /** Check if array order matches. */
  static _checkSequence(userSequence, correctSequence) {
    if (!Array.isArray(userSequence) || !Array.isArray(correctSequence)) {
      return { correct: false, feedback: 'Invalid sequence.', score: 0 };
    }

    let correctCount = 0;
    const total = correctSequence.length;

    for (let i = 0; i < total; i++) {
      if (String(userSequence[i]) === String(correctSequence[i])) {
        correctCount++;
      }
    }

    const score = total > 0 ? correctCount / total : 0;
    const correct = score === 1;

    let feedback;
    if (correct) {
      feedback = ScoringEngine._getPositiveFeedback();
    } else if (score >= 0.8) {
      feedback = `Almost perfect! ${correctCount} out of ${total} in the right place.`;
    } else {
      feedback = `${correctCount} out of ${total} correct. Keep trying!`;
    }

    return { correct, feedback, score };
  }

  /** Levenshtein-based string similarity (0–1). */
  static _similarity(a, b) {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const m = a.length, n = b.length;
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
    return 1 - dp[m][n] / Math.max(m, n);
  }

  static _getPositiveFeedback() {
    const messages = [
      'Excellent! 🌟',
      'Well done! ✨',
      'Great work! 👏',
      'Perfect! 🎯',
      'Spot on! ✅',
      'Brilliant! 💪',
      'Fantastic! 🏆',
      'You got it! 🎉',
      'Top notch! ⭐',
      'Nice one! 👍',
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  static _getEncouragingFeedback() {
    const messages = [
      'Not quite — have another go! 💪',
      'Almost there — try again! 🔄',
      'Keep going — you\'re doing great! 👍',
      'That\'s OK — let\'s try once more! 💫',
      'No worries — practice makes progress! 🌱',
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }
}

export default ScoringEngine;
