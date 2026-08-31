/**
 * DoingLanguage — Multiple Choice Exercise
 * Renders a stimulus (letter, number, etc.) with multiple answer options.
 * The user selects one; feedback is immediate.
 */

import { ExerciseEngine } from '../engine/exercise-engine.js';
import { speechSynthesis } from '../services/speech-synthesis.js';
import { audioFeedback } from '../services/audio-feedback.js';

/**
 * Render a multiple-choice exercise into a container.
 * @param {HTMLElement} container
 * @param {ExerciseEngine} engine
 * @param {object} subtierConfig - From curriculum
 * @param {array} allItems - Full pool for distractor generation
 */
export function renderMultipleChoice(container, engine, subtierConfig, allItems) {
  const item = engine.currentItem;
  if (!item) return;

  const progress = engine.sessionProgress;
  const display = subtierConfig.getItemDisplay?.(item) || item.id;
  const label = subtierConfig.getItemLabel?.(item) || '';
  const speechText = subtierConfig.getItemSpeech?.(item) || display;

  // Generate options
  const options = ExerciseEngine.generateOptions(item, allItems, 3);

  container.innerHTML = `
    <div class="exercise">
      <div class="exercise__header">
        <h2 class="exercise__title">${subtierConfig.name}: Identify</h2>
        <p class="exercise__instruction">Listen to the sound, then choose the correct answer</p>
        <div class="exercise__progress-info">
          <span>Question ${progress.current} of ${progress.total}</span>
          <span>${progress.correct} correct</span>
        </div>
        <div class="progress">
          <div class="progress__fill" style="width: ${progress.percentage}%"></div>
        </div>
      </div>

      <div class="exercise__stimulus">
        <div class="display-char" id="mc-display" aria-live="polite">${display}</div>
      </div>

      <div class="exercise__controls">
        <button class="btn btn--listen" id="mc-listen" title="Listen" aria-label="Listen to the correct answer">
          🔊
        </button>
      </div>

      <div class="mc-grid ${label ? '' : 'mc-grid--chars'}" id="mc-options" role="radiogroup" aria-label="Choose the correct answer">
        ${options.map((opt, i) => {
          const optDisplay = subtierConfig.getItemLabel?.(opt) || subtierConfig.getItemDisplay?.(opt) || opt.id;
          const optId = opt.id || opt.upper || opt.digit?.toString() || opt.symbol;
          return `
            <button class="mc-option"
                    role="radio"
                    aria-checked="false"
                    data-answer="${optId}"
                    data-display="${optDisplay}"
                    tabindex="${i === 0 ? '0' : '-1'}"
                    aria-label="${optDisplay}">
              ${optDisplay}
            </button>
          `;
        }).join('')}
      </div>

      <div class="exercise__feedback" id="mc-feedback" aria-live="assertive"></div>

      <div class="exercise__nav">
        <button class="btn btn--secondary" id="mc-skip">Skip →</button>
        <button class="btn btn--primary" id="mc-next" style="display:none">Next →</button>
      </div>
    </div>
  `;

  // --- Event Handlers ---
  let answered = false;

  // Listen button
  container.querySelector('#mc-listen').addEventListener('click', () => {
    speechSynthesis.speak(speechText);
  });

  // Option selection
  const optionButtons = container.querySelectorAll('.mc-option');
  optionButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      if (answered) return;
      answered = true;

      const answer = btn.dataset.answer;
      const correctId = item.id || item.upper || item.digit?.toString() || item.symbol;
      const result = await engine.submitAnswer(answer);

      // Highlight correct/incorrect
      optionButtons.forEach(b => {
        b.classList.add('mc-option--disabled');
        const bId = b.dataset.answer;
        if (bId === correctId) {
          b.classList.add('mc-option--correct');
        } else if (b === btn && !result.correct) {
          b.classList.add('mc-option--incorrect');
        }
      });

      // Audio feedback
      if (result.correct) {
        audioFeedback.playCorrect();
      } else {
        audioFeedback.playIncorrect();
      }

      // Show feedback
      const feedbackEl = container.querySelector('#mc-feedback');
      feedbackEl.innerHTML = `
        <div class="feedback feedback--${result.correct ? 'correct' : 'incorrect'}">
          <span class="feedback__icon">${result.correct ? '✅' : '💪'}</span>
          <span>${result.feedback}</span>
        </div>
      `;

      // Speak the correct answer
      if (!result.correct) {
        setTimeout(() => {
          speechSynthesis.speak(speechText);
        }, 500);
      }

      // Show next button
      container.querySelector('#mc-next').style.display = '';
      container.querySelector('#mc-skip').style.display = 'none';
    });
  });

  // Keyboard navigation within options
  container.querySelector('#mc-options').addEventListener('keydown', (e) => {
    const focused = document.activeElement;
    const opts = [...optionButtons];
    const idx = opts.indexOf(focused);

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = opts[(idx + 1) % opts.length];
      next.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = opts[(idx - 1 + opts.length) % opts.length];
      prev.focus();
    }
  });

  // Next button
  container.querySelector('#mc-next').addEventListener('click', () => {
    const hasMore = engine.next();
    if (hasMore) {
      renderMultipleChoice(container, engine, subtierConfig, allItems);
    } else {
      renderSessionComplete(container, engine);
    }
  });

  // Skip button
  container.querySelector('#mc-skip').addEventListener('click', () => {
    const hasMore = engine.next();
    if (hasMore) {
      renderMultipleChoice(container, engine, subtierConfig, allItems);
    } else {
      renderSessionComplete(container, engine);
    }
  });

  // Auto-play audio on first load
  setTimeout(() => speechSynthesis.speak(speechText), 300);
}

/**
 * Render the session complete summary.
 */
export function renderSessionComplete(container, engine) {
  const summary = engine.getSessionSummary();
  const accuracyPct = Math.round(summary.accuracy * 100);
  audioFeedback.playComplete();

  let message, icon;
  if (accuracyPct >= 90) {
    message = 'Outstanding work! 🌟';
    icon = '🏆';
  } else if (accuracyPct >= 70) {
    message = 'Great progress! Keep it up!';
    icon = '⭐';
  } else if (accuracyPct >= 50) {
    message = 'Good effort! Practice makes progress!';
    icon = '💪';
  } else {
    message = 'Keep going — every attempt helps! 🌱';
    icon = '🌱';
  }

  container.innerHTML = `
    <div class="session-complete">
      <div class="session-complete__icon">${icon}</div>
      <h2 class="session-complete__title">${message}</h2>

      <div class="session-complete__stats">
        <div class="session-complete__stat">
          <div class="session-complete__stat-value">${accuracyPct}%</div>
          <div class="session-complete__stat-label">Accuracy</div>
        </div>
        <div class="session-complete__stat">
          <div class="session-complete__stat-value">${summary.correctCount}</div>
          <div class="session-complete__stat-label">Correct</div>
        </div>
        <div class="session-complete__stat">
          <div class="session-complete__stat-value">${summary.totalItems}</div>
          <div class="session-complete__stat-label">Total</div>
        </div>
      </div>

      <div class="session-complete__actions">
        <button class="btn btn--primary btn--large" id="sc-try-again">Try Again</button>
        <button class="btn btn--secondary btn--large" id="sc-back">Back to Exercises</button>
      </div>
    </div>
  `;

  container.querySelector('#sc-try-again').addEventListener('click', () => {
    window.location.hash = window.location.hash; // Re-trigger route
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  container.querySelector('#sc-back').addEventListener('click', () => {
    const subtier = engine.subtier;
    window.location.hash = `#/tier/${subtier}`;
  });
}
