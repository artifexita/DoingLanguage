/**
 * DoingLanguage — Match Pairs Exercise
 * User taps items from two columns to match them.
 * Used for: uppercase↔lowercase, digit↔word, etc.
 */

import { audioFeedback } from '../services/audio-feedback.js';
import { speechSynthesis } from '../services/speech-synthesis.js';
import { renderSessionComplete } from './multiple-choice.js';

/**
 * Render a match-pairs exercise.
 * @param {HTMLElement} container
 * @param {ExerciseEngine} engine
 * @param {object} subtierConfig
 */
export function renderMatchPairs(container, engine, subtierConfig) {
  // Take up to 6 items for a round
  const items = engine.items.slice(0, Math.min(6, engine.items.length));

  // Build left column (display) and right column (label), shuffled independently
  const leftItems = items.map(item => ({
    id: item.id || item.upper || item.digit?.toString() || item.symbol,
    display: subtierConfig.getItemDisplay?.(item) || item.id,
    item,
  }));

  const rightItems = items.map(item => ({
    id: item.id || item.upper || item.digit?.toString() || item.symbol,
    display: subtierConfig.getItemLabel?.(item) || item.lower || item.word || item.name,
    item,
  }));

  // Shuffle both columns
  const shuffledLeft = [...leftItems].sort(() => Math.random() - 0.5);
  const shuffledRight = [...rightItems].sort(() => Math.random() - 0.5);

  const matched = new Set();
  let selectedLeft = null;
  let selectedRight = null;
  let totalMatched = 0;

  container.innerHTML = `
    <div class="exercise">
      <div class="exercise__header">
        <h2 class="exercise__title">${subtierConfig.name}: Match Pairs</h2>
        <p class="exercise__instruction">Tap one item from each column to match them</p>
        <div class="exercise__progress-info">
          <span id="mp-count">0 of ${items.length} matched</span>
        </div>
        <div class="progress">
          <div class="progress__fill" id="mp-progress" style="width: 0%"></div>
        </div>
      </div>

      <div class="match-area" role="group" aria-label="Match pairs">
        <div class="match-column" id="mp-left">
          <div class="match-column__title">Match from</div>
          ${shuffledLeft.map(item => `
            <button class="match-item"
                    data-id="${item.id}"
                    data-side="left"
                    aria-label="${item.display}">
              ${item.display}
            </button>
          `).join('')}
        </div>

        <div class="match-lines" aria-hidden="true">
          ↔
        </div>

        <div class="match-column" id="mp-right">
          <div class="match-column__title">Match to</div>
          ${shuffledRight.map(item => `
            <button class="match-item"
                    data-id="${item.id}"
                    data-side="right"
                    aria-label="${item.display}">
              ${item.display}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="exercise__feedback" id="mp-feedback" aria-live="assertive"></div>

      <div class="exercise__nav">
        <button class="btn btn--secondary" id="mp-skip">Skip →</button>
        <button class="btn btn--primary" id="mp-done" style="display:none">Continue →</button>
      </div>
    </div>
  `;

  // Handle item clicks
  const handleClick = async (e) => {
    const btn = e.target.closest('.match-item');
    if (!btn || btn.classList.contains('match-item--matched')) return;

    const side = btn.dataset.side;
    const id = btn.dataset.id;

    // Deselect previous selection on same side
    if (side === 'left') {
      if (selectedLeft) selectedLeft.classList.remove('match-item--selected');
      selectedLeft = btn;
      btn.classList.add('match-item--selected');
      audioFeedback.playClick();
    } else {
      if (selectedRight) selectedRight.classList.remove('match-item--selected');
      selectedRight = btn;
      btn.classList.add('match-item--selected');
      audioFeedback.playClick();
    }

    // Check for match when both sides selected
    if (selectedLeft && selectedRight) {
      const leftId = selectedLeft.dataset.id;
      const rightId = selectedRight.dataset.id;

      if (leftId === rightId) {
        // Correct match!
        selectedLeft.classList.remove('match-item--selected');
        selectedRight.classList.remove('match-item--selected');
        selectedLeft.classList.add('match-item--matched');
        selectedRight.classList.add('match-item--matched');
        matched.add(leftId);
        totalMatched++;
        audioFeedback.playCorrect();

        // Record as correct
        await engine.submitAnswer(leftId);

        // Update progress
        updateProgress();

        // Speak the matched item
        const matchedItem = items.find(i =>
          (i.id || i.upper || i.digit?.toString() || i.symbol) === leftId
        );
        if (matchedItem) {
          const speech = subtierConfig.getItemSpeech?.(matchedItem) || leftId;
          speechSynthesis.speak(speech);
        }

        selectedLeft = null;
        selectedRight = null;

        // Check if all matched
        if (totalMatched === items.length) {
          setTimeout(() => {
            showCompleteFeedback();
          }, 500);
        }
      } else {
        // Wrong match
        selectedLeft.classList.add('match-item--wrong');
        selectedRight.classList.add('match-item--wrong');
        audioFeedback.playIncorrect();

        setTimeout(() => {
          selectedLeft?.classList.remove('match-item--wrong', 'match-item--selected');
          selectedRight?.classList.remove('match-item--wrong', 'match-item--selected');
          selectedLeft = null;
          selectedRight = null;
        }, 600);
      }
    }
  };

  container.querySelector('#mp-left').addEventListener('click', handleClick);
  container.querySelector('#mp-right').addEventListener('click', handleClick);

  function updateProgress() {
    const pct = (totalMatched / items.length) * 100;
    container.querySelector('#mp-progress').style.width = `${pct}%`;
    container.querySelector('#mp-count').textContent =
      `${totalMatched} of ${items.length} matched`;
  }

  function showCompleteFeedback() {
    const feedbackEl = container.querySelector('#mp-feedback');
    feedbackEl.innerHTML = `
      <div class="feedback feedback--correct">
        <span class="feedback__icon">🎉</span>
        <span>All pairs matched! Well done!</span>
      </div>
    `;
    container.querySelector('#mp-done').style.display = '';
    container.querySelector('#mp-skip').style.display = 'none';
  }

  // Navigation
  container.querySelector('#mp-done').addEventListener('click', () => {
    renderSessionComplete(container, engine);
  });

  container.querySelector('#mp-skip').addEventListener('click', () => {
    renderSessionComplete(container, engine);
  });
}
