/**
 * DoingLanguage — Cueing System
 * Manages the cueing hierarchy used in speech therapy:
 *   Full cue → Partial cue → Independent
 *
 * As accuracy improves, cues are faded.
 */

export const CUE_LEVELS = {
  FULL: 'full',           // Maximum support: visual + audio + phonetic hint
  PARTIAL: 'partial',     // Some support: first sound or visual only
  INDEPENDENT: 'independent', // No cues: user works from memory
};

export class CueingSystem {
  /**
   * Determine the appropriate cue level based on recent accuracy.
   * @param {number} accuracy - 0 to 1
   * @param {number} attempts - total attempts on this item
   * @returns {string} CUE_LEVELS value
   */
  static getCueLevel(accuracy, attempts = 0) {
    if (attempts < 3) return CUE_LEVELS.FULL;
    if (accuracy >= 0.85) return CUE_LEVELS.INDEPENDENT;
    if (accuracy >= 0.60) return CUE_LEVELS.PARTIAL;
    return CUE_LEVELS.FULL;
  }

  /**
   * Generate cues for an exercise item at a given cue level.
   * @param {object} item - The exercise item
   * @param {string} cueLevel - CUE_LEVELS value
   * @param {string} exerciseType - Type of exercise
   * @returns {object} Cues to display/play
   */
  static getCues(item, cueLevel, exerciseType) {
    const cues = {
      showAnswer: false,
      showPhoneticHint: false,
      showFirstLetter: false,
      playAudioAutomatically: false,
      showVisualHint: false,
      numberOfOptions: 4,       // For multiple choice
      hintText: null,
    };

    switch (cueLevel) {
      case CUE_LEVELS.FULL:
        cues.playAudioAutomatically = true;
        cues.showPhoneticHint = true;
        cues.showVisualHint = true;
        cues.numberOfOptions = 3;  // Fewer options = easier
        cues.hintText = CueingSystem._getFullHint(item, exerciseType);
        break;

      case CUE_LEVELS.PARTIAL:
        cues.playAudioAutomatically = false;
        cues.showPhoneticHint = false;
        cues.showFirstLetter = true;
        cues.numberOfOptions = 4;
        cues.hintText = CueingSystem._getPartialHint(item, exerciseType);
        break;

      case CUE_LEVELS.INDEPENDENT:
        cues.playAudioAutomatically = false;
        cues.numberOfOptions = 6;   // More options = harder
        break;
    }

    return cues;
  }

  /**
   * Get the next cue level to fade to (increase difficulty).
   * @param {string} currentLevel
   * @returns {string}
   */
  static fadeCue(currentLevel) {
    switch (currentLevel) {
      case CUE_LEVELS.FULL: return CUE_LEVELS.PARTIAL;
      case CUE_LEVELS.PARTIAL: return CUE_LEVELS.INDEPENDENT;
      case CUE_LEVELS.INDEPENDENT: return CUE_LEVELS.INDEPENDENT;
      default: return CUE_LEVELS.FULL;
    }
  }

  /**
   * Get the previous cue level (increase support).
   * @param {string} currentLevel
   * @returns {string}
   */
  static increaseCue(currentLevel) {
    switch (currentLevel) {
      case CUE_LEVELS.INDEPENDENT: return CUE_LEVELS.PARTIAL;
      case CUE_LEVELS.PARTIAL: return CUE_LEVELS.FULL;
      case CUE_LEVELS.FULL: return CUE_LEVELS.FULL;
      default: return CUE_LEVELS.FULL;
    }
  }

  /** Generate a full hint for an item. */
  static _getFullHint(item, exerciseType) {
    // For letters
    if (item.name && item.upper) {
      return `This letter is called "${item.name}" and makes the sound ${item.primarySound || ''}`;
    }
    // For numbers
    if (item.word !== undefined && item.digit !== undefined) {
      return `This number is "${item.word}"`;
    }
    // For punctuation
    if (item.symbol && item.name) {
      return `This is called a "${item.name}" — ${item.function || ''}`;
    }
    // For phonemes
    if (item.ipa) {
      return `${item.mouthPosition || 'Listen and repeat the sound'}`;
    }
    return null;
  }

  /** Generate a partial hint for an item. */
  static _getPartialHint(item, exerciseType) {
    // For letters — just the first sound
    if (item.name && item.upper) {
      return `It starts with "${item.name[0]}..."`;
    }
    // For numbers — just the first digit
    if (item.word !== undefined) {
      return `It starts with "${item.word[0]}..."`;
    }
    // For punctuation — category
    if (item.symbol) {
      return `It's a type of punctuation mark`;
    }
    return null;
  }

  /**
   * Get display label for a cue level.
   */
  static getLabel(cueLevel) {
    switch (cueLevel) {
      case CUE_LEVELS.FULL: return 'Full Support';
      case CUE_LEVELS.PARTIAL: return 'Partial Support';
      case CUE_LEVELS.INDEPENDENT: return 'Independent';
      default: return 'Unknown';
    }
  }
}

export default CueingSystem;
