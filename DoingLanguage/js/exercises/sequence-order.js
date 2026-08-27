/**
 * DoingLanguage — Sequence Order Exercise
 * User drags/clicks items to arrange them in the correct order.
 * Used for: alphabetical order, number sequences, etc.
 */

import { audioFeedback } from '../services/audio-feedback.js';
import { speechSynthesis } from '../services/speech-synthesis.js';
import { renderSessionComplete } from './multiple-choice.js';

/**
 * Render a sequence-ordering exercise.
 * @param {HTMLElement} container
 * @param {ExerciseEngine} engine
 * @param {object} subtierConfig
 */
export function renderSequenceOrder(container, engine, subtierConfig) {
  // Take 5 items and define the correct order
  const rawItems = engine.items.slice(0, Math.min(5, engine.items.length));

  // Sort to get correct order
  const correctOrder = [...rawItems].sort((a, b) => {
    // Numbers: sort numerically
    if (a.digit !== undefined) return a.digit - b.digit;
    // Letters: sort alphabetically
    if (a.upper) return a.upper.localeCompare(b.upper);
    // Fallback
    return 0;
  });

  const correctIds = correctOrder.map(item =>
    item.id || item.upper || item.digit?.toString() || item.symbol
  );

  // Shuffle for display
  const shuffled = [...rawItems].sort(() => Math.random() - 0.5);
  let currentOrder = shuffled.map(item =>
    item.id || item.upper || item.digit?.toString() || item.symbol
  );

  container.innerHTML = `
    <div class="exercise">
      <div class="exercise__header">
        <h2 class="exercise__title">${subtierConfig.name}: Put in Order</h2>
        <p class="exercise__instruction">Click two items to swap them into the correct order</p>
      </div>

      <div class="sequence-area" id="seq-area" role="list" aria-label="Items to reorder">
        ${renderItems(shuffled, subtierConfig, currentOrder, correctIds)}
      </div>

      <div class="exercise__feedback" id="seq-feedback" aria-live="assertive"></div>

      <div class="exercise__controls" style="margin-top: var(--dl-space-4)">
        <button class="btn btn--primary btn--large" id="seq-check">Check Order ✓</button>
      </div>

      <div class="exercise__nav">
        <button class="btn btn--secondary" id="seq-skip">Skip →</button>
        <button class="btn btn--primary" id="seq-next" style="display:none">Continue →</button>
      </div>
    </div>
  `;

  let selectedIndex = null;
  let checked = false;

  // Click to swap
  container.querySelector('#seq-area').addEventListener('click', (e) => {
    if (checked) return;
    const item = e.target.closest('.sequence-item');
    if (!item) return;

    const idx = parseInt(item.dataset.index);

    if (selectedIndex === null) {
      // First selection
      selectedIndex = idx;
      item.classList.add('sequence-item--drop-target');
      audioFeedback.playClick();
    } else if (selectedIndex === idx) {
      // Deselect
      item.classList.remove('sequence-item--drop-target');
      selectedIndex = null;
    } else {
      // Swap
      const temp = currentOrder[selectedIndex];
      currentOrder[selectedIndex] = currentOrder[idx];
      currentOrder[idx] = temp;

      // Also swap in shuffled array
      const tempItem = shuffled[selectedIndex];
      shuffled[selectedIndex] = shuffled[idx];
      shuffled[idx] = tempItem;

      selectedIndex = null;
      audioFeedback.playClick();

      // Re-render items
      container.querySelector('#seq-area').innerHTML =
        renderItems(shuffled, subtierConfig, currentOrder, correctIds);
    }
  });

  // Check button
  container.querySelector('#seq-check').addEventListener('click', async () => {
    if (checked) return;
    checked = true;

    const isCorrect = currentOrder.every((id, i) => id === correctIds[i]);

    // Record result
    await engine.submitAnswer(currentOrder);

    // Highlight correct/incorrect positions
    const items = container.querySelectorAll('.sequence-item');
    items.forEach((el, i) => {
      if (currentOrder[i] === correctIds[i]) {
        el.classList.add('sequence-item--correct');
      } else {
        el.classList.add('sequence-item--incorrect');
      }
    });

    if (isCorrect) {
      audioFeedback.playCorrect();
      showFeedback(container, true, 'Perfect order! 🎯');
    } else {
      audioFeedback.playIncorrect();
      const correctCount = currentOrder.filter((id, i) => id === correctIds[i]).length;
      showFeedback(container, false,
        `${correctCount} of ${correctIds.length} in the right place. The correct order is shown below.`
      );

      // Show correct order after a moment
      setTimeout(() => {
        container.querySelector('#seq-area').innerHTML =
          renderItems(correctOrder, subtierConfig, correctIds, correctIds, true);
      }, 1500);
    }

    container.querySelector('#seq-check').style.display = 'none';
    container.querySelector('#seq-next').style.display = '';
    container.querySelector('#seq-skip').style.display = 'none';

    // Speak the correct sequence
    setTimeout(async () => {
      for (const item of correctOrder) {
        const speech = subtierConfig.getItemSpeech?.(item) ||
          subtierConfig.getItemDisplay?.(item) || '';
        if (speech) {
          await speechSynthesis.speak(speech);
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }, 800);
  });

  // Navigation
  container.querySelector('#seq-next').addEventListener('click', () => {
    renderSessionComplete(container, engine);
  });

  container.querySelector('#seq-skip').addEventListener('click', () => {
    renderSessionComplete(container, engine);
  });
}

function renderItems(items, subtierConfig, currentOrder, correctIds, showCorrect = false) {
  return items.map((item, i) => {
    const display = subtierConfig.getItemDisplay?.(item) || item.id;
    const id = item.id || item.upper || item.digit?.toString() || item.symbol;
    const correctClass = showCorrect ? 'sequence-item--correct' : '';

    return `
      <div class="sequence-item ${correctClass}"
           data-index="${i}"
           data-id="${id}"
           role="listitem"
           tabindex="0"
           aria-label="${display}, position ${i + 1}">
        <span class="sequence-item__position">${i + 1}</span>
        <span class="sequence-item__handle" aria-hidden="true">⠿</span>
        <span class="sequence-item__content">${display}</span>
      </div>
    `;
  }).join('');
}

function showFeedback(container, correct, message) {
  const feedbackEl = container.querySelector('#seq-feedback');
  feedbackEl.innerHTML = `
    <div class="feedback feedback--${correct ? 'correct' : 'incorrect'}">
      <span class="feedback__icon">${correct ? '✅' : '💪'}</span>
      <span>${message}</span>
    </div>
  `;
}
