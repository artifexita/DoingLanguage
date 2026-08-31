/**
 * DoingLanguage — Listen & Repeat Exercise
 * User sees/hears a stimulus, then attempts to say it.
 * Uses speech recognition in Chrome, or self-assessment fallback.
 */

import { speechSynthesis } from '../services/speech-synthesis.js';
import { speechRecognition } from '../services/speech-recognition.js';
import { audioFeedback } from '../services/audio-feedback.js';
import { ScoringEngine } from '../engine/scoring.js';
import { renderSessionComplete } from './multiple-choice.js';

/**
 * Render a listen-and-repeat exercise.
 * @param {HTMLElement} container
 * @param {ExerciseEngine} engine
 * @param {object} subtierConfig
 */
export function renderListenRepeat(container, engine, subtierConfig) {
  const item = engine.currentItem;
  if (!item) return;

  const progress = engine.sessionProgress;
  const display = subtierConfig.getItemDisplay?.(item) || item.id;
  const speechText = subtierConfig.getItemSpeech?.(item) || display;
  const hasSpeechRecognition = speechRecognition.isSupported;

  container.innerHTML = `
    <div class="exercise">
      <div class="exercise__header">
        <h2 class="exercise__title">${subtierConfig.name}: Listen & Repeat</h2>
        <p class="exercise__instruction">
          ${hasSpeechRecognition
            ? 'Listen, then press the microphone and say it'
            : 'Listen, repeat aloud, then rate how you went'}
        </p>
        <div class="exercise__progress-info">
          <span>Item ${progress.current} of ${progress.total}</span>
          <span>${progress.correct} correct</span>
        </div>
        <div class="progress">
          <div class="progress__fill" style="width: ${progress.percentage}%"></div>
        </div>
      </div>

      <div class="exercise__stimulus">
        <div class="display-char" aria-live="polite">${display}</div>
      </div>

      <div class="listen-repeat">
        <div class="listen-repeat__buttons">
          <button class="btn btn--listen" id="lr-listen" title="Listen" aria-label="Hear the correct pronunciation">
            🔊
          </button>
          ${hasSpeechRecognition ? `
            <button class="btn btn--speak" id="lr-speak" title="Speak" aria-label="Record your attempt">
              🎤
            </button>
          ` : ''}
        </div>

        <div class="listen-repeat__result" id="lr-result" style="display:none">
          ${hasSpeechRecognition ? `
            <div class="listen-repeat__your-speech">You said:</div>
            <div class="listen-repeat__transcript" id="lr-transcript"></div>
          ` : ''}
        </div>

        ${!hasSpeechRecognition ? `
          <div class="listen-repeat__self-rate" id="lr-self-rate" style="display:none">
            <p style="color: var(--dl-color-text-muted); font-size: var(--dl-font-size-sm); text-align: center; width: 100%; margin-bottom: var(--dl-space-2);">
              How did that go?
            </p>
            <button class="self-rate-btn self-rate-btn--good" id="lr-rate-good">
              👍 Got it
            </button>
            <button class="self-rate-btn self-rate-btn--try-again" id="lr-rate-again">
              🔄 Try again
            </button>
          </div>
        ` : ''}
      </div>

      <div class="exercise__feedback" id="lr-feedback" aria-live="assertive"></div>

      <div class="exercise__nav">
        <button class="btn btn--secondary" id="lr-skip">Skip →</button>
        <button class="btn btn--primary" id="lr-next" style="display:none">Next →</button>
      </div>
    </div>
  `;

  let answered = false;

  // Listen button
  container.querySelector('#lr-listen').addEventListener('click', () => {
    speechSynthesis.speak(speechText);
  });

  // Speech recognition flow
  if (hasSpeechRecognition) {
    const speakBtn = container.querySelector('#lr-speak');

    speakBtn.addEventListener('click', async () => {
      if (answered) return;
      if (speechRecognition.isListening) {
        speechRecognition.stop();
        speakBtn.classList.remove('is-listening');
        return;
      }

      speakBtn.classList.add('is-listening');
      speakBtn.setAttribute('aria-label', 'Listening... click to stop');

      try {
        const result = await speechRecognition.listen({ timeout: 8000 });
        speakBtn.classList.remove('is-listening');
        speakBtn.setAttribute('aria-label', 'Record your attempt');

        // Show what they said
        const resultEl = container.querySelector('#lr-result');
        resultEl.style.display = '';
        container.querySelector('#lr-transcript').textContent = result.transcript;

        // Score it
        const scoreResult = await engine.submitAnswer(result);
        answered = true;

        showFeedback(container, scoreResult);

        if (scoreResult.correct) {
          audioFeedback.playCorrect();
        } else {
          audioFeedback.playIncorrect();
          setTimeout(() => speechSynthesis.speak(speechText), 800);
        }

        container.querySelector('#lr-next').style.display = '';
        container.querySelector('#lr-skip').style.display = 'none';

      } catch (err) {
        speakBtn.classList.remove('is-listening');

        if (err.message === 'timeout' || err.code === 'no-speech') {
          showFeedback(container, {
            correct: false,
            feedback: 'No speech detected — try pressing 🎤 and speaking clearly',
          }, 'info');
        } else if (err.code === 'not-allowed') {
          showFeedback(container, {
            correct: false,
            feedback: 'Microphone access needed. Please allow microphone access in your browser.',
          }, 'info');
        } else {
          showFeedback(container, {
            correct: false,
            feedback: 'Something went wrong. Try the Listen button to hear it again.',
          }, 'info');
        }
      }
    });
  }

  // Self-assessment flow (non-Chrome)
  if (!hasSpeechRecognition) {
    // Show self-rate after a brief listen
    const showSelfRate = () => {
      const rateEl = container.querySelector('#lr-self-rate');
      if (rateEl) rateEl.style.display = '';
    };

    // Show rate buttons after they've had time to listen and try
    setTimeout(showSelfRate, 1500);

    container.querySelector('#lr-rate-good')?.addEventListener('click', async () => {
      if (answered) return;
      answered = true;
      const result = await engine.submitAnswer(true); // Self-rated as correct
      audioFeedback.playCorrect();
      showFeedback(container, { correct: true, feedback: 'Great work! 👍' });
      container.querySelector('#lr-next').style.display = '';
      container.querySelector('#lr-skip').style.display = 'none';
      container.querySelector('#lr-self-rate').style.display = 'none';
    });

    container.querySelector('#lr-rate-again')?.addEventListener('click', () => {
      // Don't mark as wrong — just replay
      speechSynthesis.speak(speechText);
    });
  }

  // Navigation
  container.querySelector('#lr-next').addEventListener('click', () => {
    const hasMore = engine.next();
    if (hasMore) {
      renderListenRepeat(container, engine, subtierConfig);
    } else {
      renderSessionComplete(container, engine);
    }
  });

  container.querySelector('#lr-skip').addEventListener('click', () => {
    const hasMore = engine.next();
    if (hasMore) {
      renderListenRepeat(container, engine, subtierConfig);
    } else {
      renderSessionComplete(container, engine);
    }
  });

  // Auto-play on load
  setTimeout(() => speechSynthesis.speak(speechText), 300);
}

function showFeedback(container, result, type = null) {
  const feedbackEl = container.querySelector('#lr-feedback');
  const feedbackType = type || (result.correct ? 'correct' : 'incorrect');
  feedbackEl.innerHTML = `
    <div class="feedback feedback--${feedbackType}">
      <span class="feedback__icon">${result.correct ? '✅' : feedbackType === 'info' ? 'ℹ️' : '💪'}</span>
      <span>${result.feedback}</span>
    </div>
  `;
}
