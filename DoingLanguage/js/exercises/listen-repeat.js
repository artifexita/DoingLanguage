/**
 * DoingLanguage — Listen & Repeat Exercise
 * User sees/hears a stimulus, then attempts to say it.
 * Uses 100% On-Device Speech Recognition (Private & Offline) with acoustic feedback.
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
  const isEngineOnDevice = speechRecognition.getEngineMode() === 'on-device';

  container.innerHTML = `
    <div class="exercise">
      <div class="exercise__header">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--dl-space-2); flex-wrap: wrap; gap: var(--dl-space-2);">
          <h2 class="exercise__title" style="margin: 0;">${subtierConfig.name}: Listen & Repeat</h2>
          <span class="badge ${isEngineOnDevice ? 'badge--mastered' : 'badge--in-progress'}" style="font-size: 0.75rem;">
            ${isEngineOnDevice ? '🔒 On-Device (Private & Offline)' : '🌐 Speech Recognition'}
          </span>
        </div>
        <p class="exercise__instruction">
          Listen to the model, then tap the microphone and vocalize clearly
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

        <!-- Real-time Audio Level Indicator -->
        <div id="lr-audio-meter" style="width: 12rem; height: 6px; background: var(--dl-color-surface-active); border-radius: 3px; overflow: hidden; margin: var(--dl-space-2) auto 0; display: none;">
          <div id="lr-audio-level" style="width: 0%; height: 100%; background: var(--dl-color-primary); transition: width 60ms ease;"></div>
        </div>

        <div class="listen-repeat__result" id="lr-result" style="display:none">
          <div class="listen-repeat__your-speech">You said:</div>
          <div class="listen-repeat__transcript" id="lr-transcript"></div>
        </div>

        <!-- Fallback Manual Self-Rate Option -->
        <div class="listen-repeat__self-rate" id="lr-self-rate" style="display:none">
          <p style="color: var(--dl-color-text-muted); font-size: var(--dl-font-size-sm); text-align: center; width: 100%; margin-bottom: var(--dl-space-2);">
            How did that sound?
          </p>
          <button class="self-rate-btn self-rate-btn--good" id="lr-rate-good">
            👍 Sounded Good
          </button>
          <button class="self-rate-btn self-rate-btn--try-again" id="lr-rate-again">
            🔄 Try Again
          </button>
        </div>
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
    const audioMeter = container.querySelector('#lr-audio-meter');
    const audioLevelBar = container.querySelector('#lr-audio-level');

    speakBtn.addEventListener('click', async () => {
      if (answered) return;
      if (speechRecognition.isListening) {
        speechRecognition.stop();
        speakBtn.classList.remove('is-listening');
        if (audioMeter) audioMeter.style.display = 'none';
        return;
      }

      speakBtn.classList.add('is-listening');
      speakBtn.setAttribute('aria-label', 'Listening... speak now');
      if (audioMeter) audioMeter.style.display = 'block';

      try {
        const result = await speechRecognition.listen({
          targetWord: item.id || speechText,
          targetPhonemes: item.phonemes || null,
          timeout: 8500,
          onAudioLevel: (lvl) => {
            if (audioLevelBar) {
              audioLevelBar.style.width = `${Math.min(100, Math.round(lvl * 100))}%`;
            }
          },
        });

        speakBtn.classList.remove('is-listening');
        if (audioMeter) audioMeter.style.display = 'none';
        speakBtn.setAttribute('aria-label', 'Record your attempt');

        // Show recognized transcript
        const resultEl = container.querySelector('#lr-result');
        resultEl.style.display = '';
        container.querySelector('#lr-transcript').textContent = result.transcript;

        // Score response with on-device acoustic metrics
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
        if (audioMeter) audioMeter.style.display = 'none';

        if (err.message === 'timeout' || err.code === 'no-speech') {
          showFeedback(container, {
            correct: false,
            feedback: 'No speech detected — press 🎤 and speak clearly into your mic',
          }, 'info');
        } else if (err.name === 'NotAllowedError' || err.code === 'not-allowed') {
          showFeedback(container, {
            correct: false,
            feedback: 'Microphone permission required. Please enable microphone in browser settings.',
          }, 'info');
        } else {
          showFeedback(container, {
            correct: false,
            feedback: 'Practice attempt captured. Tap 🔊 to hear the model and try again.',
          }, 'info');
        }

        // Show self-rate fallback in case user wants manual progression
        const selfRate = container.querySelector('#lr-self-rate');
        if (selfRate) selfRate.style.display = '';
      }
    });
  }

  // Self-assessment handlers
  container.querySelector('#lr-rate-good')?.addEventListener('click', async () => {
    if (answered) return;
    answered = true;
    const result = await engine.submitAnswer(true);
    audioFeedback.playCorrect();
    showFeedback(container, { correct: true, feedback: 'Great work! 👍' });
    container.querySelector('#lr-next').style.display = '';
    container.querySelector('#lr-skip').style.display = 'none';
    const selfRate = container.querySelector('#lr-self-rate');
    if (selfRate) selfRate.style.display = 'none';
  });

  container.querySelector('#lr-rate-again')?.addEventListener('click', () => {
    speechSynthesis.speak(speechText);
  });

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

  // Auto-play stimulus on load
  setTimeout(() => speechSynthesis.speak(speechText), 300);
}

function showFeedback(container, result, type = null) {
  const feedbackEl = container.querySelector('#lr-feedback');
  const feedbackType = type || (result.correct ? 'correct' : 'incorrect');

  let extraTelemetry = '';
  if (result.details) {
    const { acousticScore, articulatoryScore } = result.details;
    if (acousticScore != null) {
      extraTelemetry = `
        <div style="font-size: var(--dl-font-size-xs); color: var(--dl-color-text-muted); margin-top: var(--dl-space-1); display: flex; gap: var(--dl-space-3); justify-content: center;">
          <span>🎯 Acoustic Match: <strong>${Math.round(acousticScore * 100)}%</strong></span>
          <span>🗣️ Articulatory Clarity: <strong>${Math.round(articulatoryScore * 100)}%</strong></span>
        </div>
      `;
    }
  }

  feedbackEl.innerHTML = `
    <div class="feedback feedback--${feedbackType}">
      <span class="feedback__icon">${result.correct ? '✅' : feedbackType === 'info' ? 'ℹ️' : '💪'}</span>
      <div>
        <span>${result.feedback}</span>
        ${extraTelemetry}
      </div>
    </div>
  `;
}
