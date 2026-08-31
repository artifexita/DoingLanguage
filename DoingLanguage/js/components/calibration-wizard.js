/**
 * DoingLanguage — Audio & Speech Self-Calibration Wizard
 * 
 * Clinical & Psychoacoustic Calibration Flow:
 * 1. Plays target letter stimulus
 * 2. Samples user voice via microphone (extracts duration, pitch, energy & waveform)
 * 3. Replays letter across candidate parameter variations (Speed, Pitch, Spacing, Filter)
 * 4. Applies Moving Average convergence to discover the optimal sweet spot
 * 5. Saves calibrated profile into persistent IndexedDB storage
 */

import { speechSynthesis } from '../services/speech-synthesis.js';
import { audioFeedback } from '../services/audio-feedback.js';
import { storage } from '../services/storage.js';
import { onDeviceSpeech } from '../services/on-device-speech.js';

export class CalibrationWizard {
  constructor(containerEl) {
    this.container = containerEl;
    this.currentStep = 1;
    this.totalSteps = 6;

    // Active calibration letter (start with lowercase)
    this.targetLetter = 'a';
    this.letterOptions = ['a', 'b', 'c', 'd', 'e', 'm', 's', 'apple', 'A', 'B', 'C'];

    // Microphone & Audio Recording State
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.userAudioBlob = null;
    this.userAudioUrl = null;
    this.userAudioBuffer = null;
    this.isRecording = false;
    this.recordingStartTime = null;
    this.audioCtx = null;
    this.analyser = null;
    this.animFrameId = null;

    // Sampled Acoustic Metrics
    this.sampleMetrics = {
      durationMs: null,
      avgVolume: null,
      pitchHz: null,
      recordedAt: null,
    };

    // Working Calibration Values
    this.values = {
      rate: speechSynthesis.rate,
      pitch: speechSynthesis.pitch,
      volume: speechSynthesis.volume,
      letterGap: speechSynthesis.letterGap,
      punctMultiplier: speechSynthesis.punctMultiplier,
      wordGap: speechSynthesis.wordGap,
      filterCutoff: audioFeedback.filterCutoff,
      sfxVolume: audioFeedback.volume,
      voice: speechSynthesis.currentVoice?.voiceURI || null,
    };

    // Moving Average History (Tracks parameter choices across trials & letters)
    this.maHistory = {
      rate: [speechSynthesis.rate],
      pitch: [speechSynthesis.pitch],
      letterGap: [speechSynthesis.letterGap],
      filterCutoff: [audioFeedback.filterCutoff],
    };

    // Candidate Selections per Step
    this.selectedCandidate = {
      rate: null,
      pitch: null,
      letterGap: null,
      filterCutoff: null,
    };

    this.isAuditioning = false;
    this._stepListener = null;
  }

  /** Initialize and render wizard */
  render() {
    this._stopAudio();
    this.container.innerHTML = `
      <div class="app__content view-enter" style="max-width: 54rem; margin: 0 auto; padding-bottom: var(--dl-space-8);">
        <!-- Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--dl-space-5); flex-wrap: wrap; gap: var(--dl-space-3);">
          <div>
            <h1 style="margin-bottom: var(--dl-space-1); font-size: var(--dl-font-size-xl);">🎯 Speech & Audio Self-Calibration</h1>
            <p style="color: var(--dl-color-text-muted); font-size: var(--dl-font-size-sm); margin: 0;">
              Step ${this.currentStep} of ${this.totalSteps} — Sample your voice, audition parameter variations & converge with moving averages
            </p>
          </div>
          <button class="btn btn--secondary" id="cal-exit" title="Exit Calibration">✕ Exit</button>
        </div>

        <!-- Wizard Progress Bar & Steps -->
        <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--dl-space-2); margin-bottom: var(--dl-space-6);">
          ${[
            '1. Voice Sample',
            '2. Speed (Rate)',
            '3. Vocal Pitch',
            '4. Letter Spacing',
            '5. Audio Warmth',
            '6. Review & Save'
          ].map((label, idx) => {
            const stepNum = idx + 1;
            const isActive = stepNum === this.currentStep;
            const isDone = stepNum < this.currentStep;
            return `
              <div style="text-align: center;">
                <div style="height: 6px; border-radius: 3px; margin-bottom: var(--dl-space-1);
                            background: ${isActive ? 'var(--dl-color-primary)' : isDone ? 'var(--dl-color-success)' : 'var(--dl-color-surface-active)'};"></div>
                <span style="font-size: 0.72rem; font-weight: ${isActive ? '700' : '400'};
                             color: ${isActive ? 'var(--dl-color-primary)' : isDone ? 'var(--dl-color-success)' : 'var(--dl-color-text-muted)'};">
                  ${label}
                </span>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Step Content Card -->
        <div class="card card--elevated" id="cal-step-card" style="padding: var(--dl-space-6); margin-bottom: var(--dl-space-6);">
          ${this._renderStepContent()}
        </div>

        <!-- Wizard Navigation Footer -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <button class="btn btn--secondary btn--large" id="cal-prev" ${this.currentStep === 1 ? 'disabled' : ''}>
            ← Previous Step
          </button>

          <div style="display: flex; gap: var(--dl-space-3);">
            ${this.currentStep < this.totalSteps ? `
              <button class="btn btn--primary btn--large" id="cal-next">
                Next Step →
              </button>
            ` : `
              <button class="btn btn--primary btn--large" id="cal-save" style="background: var(--dl-color-success); border-color: var(--dl-color-success);">
                💾 Save & Apply Calibrated Settings
              </button>
            `}
          </div>
        </div>
      </div>
    `;

    this._bindGlobalEvents();
    this._bindStepSpecificEvents();
  }

  /** Render content for active step */
  _renderStepContent() {
    switch (this.currentStep) {
      case 1:
        return this._renderStep1Sampling();
      case 2:
        return this._renderStep2Speed();
      case 3:
        return this._renderStep3Pitch();
      case 4:
        return this._renderStep4Spacing();
      case 5:
        return this._renderStep5Filter();
      case 6:
        return this._renderStep6Review();
      default:
        return '';
    }
  }

  // =========================================================================
  // STEP 1: Letter Stimulus & Microphone Sampling
  // =========================================================================
  _renderStep1Sampling() {
    const hasSample = !!this.userAudioUrl;

    return `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--dl-space-4); flex-wrap: wrap; gap: var(--dl-space-2);">
          <div>
            <h2 style="margin-bottom: var(--dl-space-1);">Step 1: Play & Sample Target Letter</h2>
            <p style="color: var(--dl-color-text-muted); margin: 0; font-size: var(--dl-font-size-sm);">
              Hear the reference pronunciation, then record your spoken sample to calibrate pacing and pitch.
            </p>
          </div>
          <div style="display: flex; align-items: center; gap: var(--dl-space-2);">
            <label for="cal-target-select" style="font-size: var(--dl-font-size-xs); font-weight: 600; color: var(--dl-color-text-muted);">Letter:</label>
            <select id="cal-target-select" style="font-size: var(--dl-font-size-sm); padding: var(--dl-space-1) var(--dl-space-2);">
              ${this.letterOptions.map(l => `<option value="${l}" ${l === this.targetLetter ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Stimulus Display & Reference Audio -->
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--dl-color-surface); border: 1px solid var(--dl-color-border); border-radius: var(--dl-radius-lg); padding: var(--dl-space-5); margin-bottom: var(--dl-space-5);">
          <div class="display-char" style="font-size: 4.5rem; padding: var(--dl-space-2); min-height: 5rem; color: var(--dl-color-primary); text-transform: lowercase;" id="cal-stimulus-display">
            ${this.targetLetter}
          </div>
          <div style="display: flex; gap: var(--dl-space-3); margin-top: var(--dl-space-2);">
            <button class="btn btn--primary" id="cal-play-reference">
              🔊 Hear Reference Letter ("${this.targetLetter}")
            </button>
          </div>
        </div>

        <!-- Voice Sampling Box -->
        <div class="cal-sampling-box">
          <div style="font-weight: 600; font-size: var(--dl-font-size-base); color: var(--dl-color-text);">
            🎙️ Record Your Voice Sample
          </div>
          <p style="color: var(--dl-color-text-muted); font-size: var(--dl-font-size-sm); max-width: 32rem; margin: 0;">
            Press record, clearly say the letter <strong>"${this.targetLetter}"</strong>, then press <strong>Stop Recording</strong>.
          </p>

          <!-- Waveform Canvas & VU Meter -->
          <div class="cal-waveform-container">
            <canvas class="cal-waveform-canvas" id="cal-waveform" width="450" height="70"></canvas>
            <div id="cal-rec-status" style="position: absolute; font-size: var(--dl-font-size-xs); font-weight: 600; color: var(--dl-color-text-muted);">
              ${this.isRecording ? '🔴 Recording... Speak now, then click "Stop Recording"' : hasSample ? '✅ Sample captured' : 'Microphone standby'}
            </div>
          </div>

          <div class="cal-vu-meter">
            <div class="cal-vu-level" id="cal-vu-bar"></div>
          </div>

          <!-- Record & Playback Controls -->
          <div style="display: flex; gap: var(--dl-space-3); flex-wrap: wrap; justify-content: center;" id="cal-rec-actions">
            <button class="btn ${this.isRecording ? 'btn--secondary' : 'btn--primary'}" id="cal-record-btn" style="min-width: 11rem;">
              ${this.isRecording ? '⏹️ Stop Recording' : '🎤 Start Recording'}
            </button>

            ${hasSample ? `
              <button class="btn btn--secondary" id="cal-replay-sample-btn">
                ▶️ Replay Your Sample
              </button>
            ` : ''}
          </div>

          <!-- Sample Acoustic Metrics -->
          <div id="cal-metrics-display" style="width: 100%;">
            ${hasSample && this.sampleMetrics.durationMs ? `
              <div class="cal-metric-tags" style="margin-top: var(--dl-space-2); margin-bottom: var(--dl-space-3);">
                <div class="cal-metric-tag">⏱️ Duration: <strong>${this.sampleMetrics.durationMs}ms</strong></div>
                <div class="cal-metric-tag">🎵 Pitch: <strong>${this.sampleMetrics.pitchHz ? Math.round(this.sampleMetrics.pitchHz) + ' Hz' : 'Detected'}</strong></div>
                <div class="cal-metric-tag">🔊 Loudness: <strong>${Math.round(this.sampleMetrics.avgVolume * 100)}%</strong></div>
              </div>

              <!-- Automated Moving Average Calibration Panel -->
              <div style="background: linear-gradient(135deg, var(--dl-color-surface) 0%, var(--dl-color-primary-light) 100%); border: 2px solid var(--dl-color-primary); border-radius: var(--dl-radius-lg); padding: var(--dl-space-4); text-align: center; margin-top: var(--dl-space-2);">
                <div style="font-weight: 700; color: var(--dl-color-primary); font-size: var(--dl-font-size-base); margin-bottom: var(--dl-space-1);">
                  ⚡ Automatic Moving Average Calibration
                </div>
                <p style="font-size: var(--dl-font-size-xs); color: var(--dl-color-text-muted); margin-bottom: var(--dl-space-3); max-width: 28rem; margin-left: auto; margin-right: auto;">
                  Let DoingLanguage compute the moving average of your articulation pace and pitch, and calibrate all speech parameters automatically!
                </p>
                <div style="display: flex; gap: var(--dl-space-3); justify-content: center; flex-wrap: wrap;">
                  <button class="btn btn--primary btn--large" id="cal-auto-calibrate-btn" style="box-shadow: var(--dl-shadow-md);">
                    ✨ Auto-Calibrate With Moving Average (${this.sampleMetrics.computed ? this.sampleMetrics.computed.rate.toFixed(2) + '×, ' + this.sampleMetrics.computed.pitch.toFixed(2) : 'Optimal'})
                  </button>
                  <button class="btn btn--secondary btn--large" id="cal-full-auto-run-btn">
                    🚀 Run Full Auto-Calibration Sweep
                  </button>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // STEP 2: Speech Speed (Rate) with Variations & Moving Average
  // =========================================================================
  _renderStep2Speed() {
    const currentRate = this.values.rate;
    // Generate bracketed candidate variations around current moving average
    const candidates = [
      { id: 'slow', val: Math.max(0.2, Math.round((currentRate - 0.20) * 100) / 100), label: 'Slow & Deliberate', desc: 'Extra time for mouth shaping & motor planning' },
      { id: 'balanced', val: Math.round(currentRate * 100) / 100, label: 'Balanced Pacing', desc: 'Current moving average estimate' },
      { id: 'brisk', val: Math.min(1.4, Math.round((currentRate + 0.20) * 100) / 100), label: 'Brisk & Fluent', desc: 'Natural conversational pace' }
    ];

    return `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--dl-space-4); flex-wrap: wrap; gap: var(--dl-space-2);">
          <div>
            <h2 style="margin-bottom: var(--dl-space-1);">Step 2: Speech Speed (Rate) Calibration</h2>
            <p style="color: var(--dl-color-text-muted); font-size: var(--dl-font-size-sm); margin: 0;">
              Audition the letter <strong>"${this.targetLetter}"</strong> at varying speeds. Select an option or let the system auto-calculate.
            </p>
          </div>
          <button class="btn btn--primary" id="cal-auto-speed-btn">
            ⚡ Auto-Calculate Best Speed
          </button>
        </div>

        <!-- Candidate Variations Grid -->
        <div class="cal-variation-grid">
          ${candidates.map((c, i) => {
            const isSel = this.selectedCandidate.rate === c.id;
            return `
              <div class="cal-variation-card ${isSel ? 'cal-variation-card--selected' : ''}" data-type="rate" data-cand="${c.id}" data-val="${c.val}">
                <div class="cal-variation-header">
                  <span class="cal-variation-badge">Option ${String.fromCharCode(65 + i)}</span>
                  <button class="btn btn--icon btn--secondary cal-audition-btn" title="Audition this speed" style="padding: 0.2rem 0.6rem; font-size: 0.9rem;">
                    🔊 Play
                  </button>
                </div>
                <div class="cal-variation-val">${c.val.toFixed(2)}×</div>
                <div style="font-weight: 600; font-size: var(--dl-font-size-sm);">${c.label}</div>
                <div class="cal-variation-desc">${c.desc}</div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Fine-tune Slider -->
        <div class="settings-field" style="margin-bottom: var(--dl-space-4); border-top: 1px solid var(--dl-color-border); padding-top: var(--dl-space-3);">
          <div>
            <div class="settings-field__label">Fine-Tune Speed</div>
            <div class="settings-field__description">
              <span id="cal-rate-display" style="font-weight: 700; color: var(--dl-color-primary);">${this.values.rate.toFixed(2)}×</span>
            </div>
          </div>
          <input type="range" id="cal-rate-slider" min="0.1" max="1.5" step="0.05" value="${this.values.rate}" style="min-width: 14rem;">
        </div>

        <!-- Moving Average Convergence Tracker -->
        <div class="cal-ma-tracker">
          <div class="cal-ma-header">
            <span style="font-weight: 600; font-size: var(--dl-font-size-sm);">📈 Speed Moving Average Convergence</span>
            <span class="cal-ma-chip cal-ma-chip--converged">Optimal: ${this.values.rate.toFixed(2)}×</span>
          </div>
          <div class="cal-ma-chips">
            ${this.maHistory.rate.map((val, idx) => `
              <span class="cal-ma-chip">Trial ${idx + 1}: ${val.toFixed(2)}×</span>
            `).join(' <span style="color: var(--dl-color-text-muted)">→</span> ')}
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // STEP 3: Vocal Pitch with Variations, A/B Compare & Moving Average
  // =========================================================================
  _renderStep3Pitch() {
    const currentPitch = this.values.pitch;
    const candidates = [
      { id: 'deep', val: Math.max(0.3, Math.round((currentPitch - 0.25) * 100) / 100), label: 'Deep / Bass', desc: 'Low frequency resonance' },
      { id: 'natural', val: Math.round(currentPitch * 100) / 100, label: 'Natural Baritone/Alto', desc: 'Neutral speech pitch' },
      { id: 'bright', val: Math.min(1.8, Math.round((currentPitch + 0.25) * 100) / 100), label: 'Bright / Treble', desc: 'High frequency clarity' }
    ];

    return `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--dl-space-4); flex-wrap: wrap; gap: var(--dl-space-2);">
          <div>
            <h2 style="margin-bottom: var(--dl-space-1);">Step 3: Vocal Pitch Calibration</h2>
            <p style="color: var(--dl-color-text-muted); font-size: var(--dl-font-size-sm); margin: 0;">
              Compare voice pitch variations against your own voice. Find the tone that sounds most distinguishable.
            </p>
          </div>
          <button class="btn btn--primary" id="cal-auto-pitch-btn">
            ⚡ Auto-Match Voice Pitch
          </button>
        </div>

        ${this.userAudioUrl ? `
          <div style="display: flex; justify-content: center; gap: var(--dl-space-3); margin-bottom: var(--dl-space-4); background: var(--dl-color-surface-hover); padding: var(--dl-space-3); border-radius: var(--dl-radius-md);">
            <button class="btn btn--secondary" id="cal-ab-sample">
              🎙️ Listen to Your Sample
            </button>
            <button class="btn btn--primary" id="cal-ab-tts">
              🗣️ Listen to Current Voice
            </button>
          </div>
        ` : ''}

        <!-- Variations Grid -->
        <div class="cal-variation-grid">
          ${candidates.map((c, i) => {
            const isSel = this.selectedCandidate.pitch === c.id;
            return `
              <div class="cal-variation-card ${isSel ? 'cal-variation-card--selected' : ''}" data-type="pitch" data-cand="${c.id}" data-val="${c.val}">
                <div class="cal-variation-header">
                  <span class="cal-variation-badge">Option ${String.fromCharCode(65 + i)}</span>
                  <button class="btn btn--icon btn--secondary cal-audition-btn" title="Audition this pitch" style="padding: 0.2rem 0.6rem; font-size: 0.9rem;">
                    🔊 Play
                  </button>
                </div>
                <div class="cal-variation-val">${c.val.toFixed(2)}</div>
                <div style="font-weight: 600; font-size: var(--dl-font-size-sm);">${c.label}</div>
                <div class="cal-variation-desc">${c.desc}</div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Fine-tune Slider -->
        <div class="settings-field" style="margin-bottom: var(--dl-space-4); border-top: 1px solid var(--dl-color-border); padding-top: var(--dl-space-3);">
          <div>
            <div class="settings-field__label">Fine-Tune Pitch</div>
            <div class="settings-field__description">
              <span id="cal-pitch-display" style="font-weight: 700; color: var(--dl-color-primary);">${this.values.pitch.toFixed(2)}</span>
            </div>
          </div>
          <input type="range" id="cal-pitch-slider" min="0.0" max="2.0" step="0.05" value="${this.values.pitch}" style="min-width: 14rem;">
        </div>

        <!-- Moving Average Tracker -->
        <div class="cal-ma-tracker">
          <div class="cal-ma-header">
            <span style="font-weight: 600; font-size: var(--dl-font-size-sm);">📈 Vocal Pitch Moving Average</span>
            <span class="cal-ma-chip cal-ma-chip--converged">Optimal: ${this.values.pitch.toFixed(2)}</span>
          </div>
          <div class="cal-ma-chips">
            ${this.maHistory.pitch.map((val, idx) => `
              <span class="cal-ma-chip">Trial ${idx + 1}: ${val.toFixed(2)}</span>
            `).join(' <span style="color: var(--dl-color-text-muted)">→</span> ')}
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // STEP 4: Letter Delay & Spacing Calibration
  // =========================================================================
  _renderStep4Spacing() {
    const currentGap = this.values.letterGap;
    const candidates = [
      { id: 'rapid', val: 100, label: 'Fast (100ms)', desc: 'Minimal pause between letters' },
      { id: 'moderate', val: 350, label: 'Moderate (350ms)', desc: 'Comfortable processing break' },
      { id: 'spaced', val: 700, label: 'Paced (700ms)', desc: 'Extended time for motor planning' }
    ];

    return `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--dl-space-4); flex-wrap: wrap; gap: var(--dl-space-2);">
          <div>
            <h2 style="margin-bottom: var(--dl-space-1);">Step 4: Letter Delay & Spacing</h2>
            <p style="color: var(--dl-color-text-muted); font-size: var(--dl-font-size-sm); margin: 0;">
              Audition the letter series <strong>"a – b – c"</strong> with varied pause gaps between letters.
            </p>
          </div>
          <button class="btn btn--primary" id="cal-auto-spacing-btn">
            ⚡ Auto-Calculate Spacing Delay
          </button>
        </div>

        <!-- Series Display -->
        <div style="display: flex; justify-content: center; gap: var(--dl-space-3); margin-bottom: var(--dl-space-5);" id="cal-series-cards">
          ${['a', 'b', 'c'].map((char, idx) => `
            <div class="card cal-series-card" data-idx="${idx}"
                 style="width: 4.5rem; height: 5rem; display: flex; align-items: center; justify-content: center;
                        font-size: 2.2rem; font-weight: 700; border-radius: var(--dl-radius-md);
                        border: 2px solid var(--dl-color-border); background: var(--dl-color-surface);">
              ${char}
            </div>
          `).join('')}
        </div>

        <!-- Variations Grid -->
        <div class="cal-variation-grid">
          ${candidates.map((c, i) => {
            const isSel = this.selectedCandidate.letterGap === c.id;
            return `
              <div class="cal-variation-card ${isSel ? 'cal-variation-card--selected' : ''}" data-type="letterGap" data-cand="${c.id}" data-val="${c.val}">
                <div class="cal-variation-header">
                  <span class="cal-variation-badge">Option ${String.fromCharCode(65 + i)}</span>
                  <button class="btn btn--icon btn--secondary cal-audition-btn" title="Audition this pause gap" style="padding: 0.2rem 0.6rem; font-size: 0.9rem;">
                    🔊 Play Series
                  </button>
                </div>
                <div class="cal-variation-val">${c.val} ms</div>
                <div style="font-weight: 600; font-size: var(--dl-font-size-sm);">${c.label}</div>
                <div class="cal-variation-desc">${c.desc}</div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Fine-tune Slider -->
        <div class="settings-field" style="margin-bottom: var(--dl-space-4); border-top: 1px solid var(--dl-color-border); padding-top: var(--dl-space-3);">
          <div>
            <div class="settings-field__label">Fine-Tune Letter Delay</div>
            <div class="settings-field__description">
              <span id="cal-gap-display" style="font-weight: 700; color: var(--dl-color-primary);">${this.values.letterGap} ms</span>
            </div>
          </div>
          <input type="range" id="cal-gap-slider" min="0" max="1500" step="50" value="${this.values.letterGap}" style="min-width: 14rem;">
        </div>

        <!-- Moving Average Tracker -->
        <div class="cal-ma-tracker">
          <div class="cal-ma-header">
            <span style="font-weight: 600; font-size: var(--dl-font-size-sm);">📈 Spacing Delay Moving Average</span>
            <span class="cal-ma-chip cal-ma-chip--converged">Optimal: ${this.values.letterGap} ms</span>
          </div>
          <div class="cal-ma-chips">
            ${this.maHistory.letterGap.map((val, idx) => `
              <span class="cal-ma-chip">Trial ${idx + 1}: ${val}ms</span>
            `).join(' <span style="color: var(--dl-color-text-muted)">→</span> ')}
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // STEP 5: Audio Warmth & Lowpass Filter Calibration
  // =========================================================================
  _renderStep5Filter() {
    const candidates = [
      { id: 'warm', val: 1500, label: 'Warm & Soft (1500 Hz)', desc: 'Cuts harsh treble; gentle on sensitive ears' },
      { id: 'balanced', val: 4500, label: 'Balanced (4500 Hz)', desc: 'Pleasant natural chime clarity' },
      { id: 'crisp', val: 8000, label: 'Bright & Crisp (8000 Hz)', desc: 'High frequency definition' }
    ];

    return `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--dl-space-4); flex-wrap: wrap; gap: var(--dl-space-2);">
          <div>
            <h2 style="margin-bottom: var(--dl-space-1);">Step 5: Audio Lowpass Filter (Warmth Tone)</h2>
            <p style="color: var(--dl-color-text-muted); font-size: var(--dl-font-size-sm); margin: 0;">
              Adjust the sound effects lowpass filter to remove sharp frequencies from feedback chimes.
            </p>
          </div>
          <button class="btn btn--primary" id="cal-auto-filter-btn">
            ⚡ Auto-Tune Tone Warmth
          </button>
        </div>

        <!-- Variations Grid -->
        <div class="cal-variation-grid">
          ${candidates.map((c, i) => {
            const isSel = this.selectedCandidate.filterCutoff === c.id;
            return `
              <div class="cal-variation-card ${isSel ? 'cal-variation-card--selected' : ''}" data-type="filterCutoff" data-cand="${c.id}" data-val="${c.val}">
                <div class="cal-variation-header">
                  <span class="cal-variation-badge">Option ${String.fromCharCode(65 + i)}</span>
                  <button class="btn btn--icon btn--secondary cal-audition-btn" title="Audition feedback chime" style="padding: 0.2rem 0.6rem; font-size: 0.9rem;">
                    🔔 Test Chime
                  </button>
                </div>
                <div class="cal-variation-val">${c.val} Hz</div>
                <div style="font-weight: 600; font-size: var(--dl-font-size-sm);">${c.label}</div>
                <div class="cal-variation-desc">${c.desc}</div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Fine-tune Slider -->
        <div class="settings-field" style="margin-bottom: var(--dl-space-4); border-top: 1px solid var(--dl-color-border); padding-top: var(--dl-space-3);">
          <div>
            <div class="settings-field__label">Fine-Tune Cutoff Frequency</div>
            <div class="settings-field__description">
              <span id="cal-filter-display" style="font-weight: 700; color: var(--dl-color-primary);">${this.values.filterCutoff} Hz</span>
            </div>
          </div>
          <input type="range" id="cal-filter-slider" min="400" max="12000" step="200" value="${this.values.filterCutoff}" style="min-width: 14rem;">
        </div>

        <!-- Moving Average Tracker -->
        <div class="cal-ma-tracker">
          <div class="cal-ma-header">
            <span style="font-weight: 600; font-size: var(--dl-font-size-sm);">📈 Audio Filter Moving Average</span>
            <span class="cal-ma-chip cal-ma-chip--converged">Optimal: ${this.values.filterCutoff} Hz</span>
          </div>
          <div class="cal-ma-chips">
            ${this.maHistory.filterCutoff.map((val, idx) => `
              <span class="cal-ma-chip">Trial ${idx + 1}: ${val}Hz</span>
            `).join(' <span style="color: var(--dl-color-text-muted)">→</span> ')}
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // STEP 6: Review, Live Replay Test & Save
  // =========================================================================
  _renderStep6Review() {
    return `
      <div>
        <div style="margin-bottom: var(--dl-space-5);">
          <h2 style="margin-bottom: var(--dl-space-1);">Step 6: Review & Save Calibrated Profile</h2>
          <p style="color: var(--dl-color-text-muted); font-size: var(--dl-font-size-sm); margin: 0;">
            Here is your calibrated speech and audio profile converged via moving averages. Test the full sequence and save.
          </p>
        </div>

        <!-- Profile Parameter Matrix -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--dl-space-3); margin-bottom: var(--dl-space-6);">
          <div class="card" style="padding: var(--dl-space-3); text-align: center;">
            <div style="font-size: var(--dl-font-size-xs); color: var(--dl-color-text-muted);">Calibrated Speed</div>
            <div style="font-size: var(--dl-font-size-xl); font-weight: 700; color: var(--dl-color-primary);">${this.values.rate.toFixed(2)}×</div>
            <div style="font-size: 0.7rem; color: var(--dl-color-text-muted);">${this.maHistory.rate.length} trials averaged</div>
          </div>

          <div class="card" style="padding: var(--dl-space-3); text-align: center;">
            <div style="font-size: var(--dl-font-size-xs); color: var(--dl-color-text-muted);">Vocal Pitch</div>
            <div style="font-size: var(--dl-font-size-xl); font-weight: 700; color: var(--dl-color-primary);">${this.values.pitch.toFixed(2)}</div>
            <div style="font-size: 0.7rem; color: var(--dl-color-text-muted);">${this.maHistory.pitch.length} trials averaged</div>
          </div>

          <div class="card" style="padding: var(--dl-space-3); text-align: center;">
            <div style="font-size: var(--dl-font-size-xs); color: var(--dl-color-text-muted);">Letter Delay</div>
            <div style="font-size: var(--dl-font-size-xl); font-weight: 700; color: var(--dl-color-primary);">${this.values.letterGap} ms</div>
            <div style="font-size: 0.7rem; color: var(--dl-color-text-muted);">${this.maHistory.letterGap.length} trials averaged</div>
          </div>

          <div class="card" style="padding: var(--dl-space-3); text-align: center;">
            <div style="font-size: var(--dl-font-size-xs); color: var(--dl-color-text-muted);">Tone Warmth Filter</div>
            <div style="font-size: var(--dl-font-size-xl); font-weight: 700; color: var(--dl-color-primary);">${this.values.filterCutoff} Hz</div>
            <div style="font-size: 0.7rem; color: var(--dl-color-text-muted);">${this.maHistory.filterCutoff.length} trials averaged</div>
          </div>

          <div class="card" style="padding: var(--dl-space-3); text-align: center; border: 1px solid var(--dl-color-primary); background: var(--dl-color-surface-hover);">
            <div style="font-size: var(--dl-font-size-xs); color: var(--dl-color-primary); font-weight: 600;">🔒 On-Device Speech Model</div>
            <div style="font-size: var(--dl-font-size-xl); font-weight: 700; color: var(--dl-color-primary);">${onDeviceSpeech.calibrationProfile.vtlnAlpha.toFixed(2)} α</div>
            <div style="font-size: 0.7rem; color: var(--dl-color-text-muted);">Acoustics & VTLN Personalised</div>
          </div>
        </div>

        <!-- Full Audio Playback Test -->
        <div style="display: flex; flex-direction: column; align-items: center; gap: var(--dl-space-3); background: var(--dl-color-surface-hover); padding: var(--dl-space-5); border-radius: var(--dl-radius-lg); margin-bottom: var(--dl-space-5);">
          <div style="font-weight: 600; font-size: var(--dl-font-size-base);">🔊 Test Full Calibrated Sentence</div>
          <p style="color: var(--dl-color-text-muted); font-size: var(--dl-font-size-sm); margin: 0; text-align: center;">
            "a, b, c. 1, 2, 3. Ready to learn!"
          </p>
          <div style="display: flex; gap: var(--dl-space-3); margin-top: var(--dl-space-2);">
            <button class="btn btn--primary btn--large" id="cal-play-full-test">
              ▶️ Play Calibrated Sequence
            </button>
            ${this.userAudioUrl ? `
              <button class="btn btn--secondary btn--large" id="cal-replay-user-final">
                🎙️ Replay Your Sample
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Event Binding
  // =========================================================================
  _bindGlobalEvents() {
    this.container.querySelector('#cal-exit')?.addEventListener('click', () => {
      this._stopAudio();
      window.location.hash = '#/settings';
    });

    this.container.querySelector('#cal-prev')?.addEventListener('click', () => {
      this._stopAudio();
      if (this.currentStep > 1) {
        this.currentStep--;
        this.render();
      }
    });

    this.container.querySelector('#cal-next')?.addEventListener('click', () => {
      this._stopAudio();
      if (this.currentStep < this.totalSteps) {
        this.currentStep++;
        this.render();
      }
    });

    this.container.querySelector('#cal-save')?.addEventListener('click', async () => {
      this._stopAudio();
      await this._saveAllSettings();
      audioFeedback.playComplete();
      alert('Calibration complete! Calibrated moving-average speech and audio settings saved.');
      window.location.hash = '#/settings';
    });
  }

  _bindStepSpecificEvents() {
    // ---- STEP 1 EVENTS ----
    if (this.currentStep === 1) {
      const targetSelect = this.container.querySelector('#cal-target-select');
      targetSelect?.addEventListener('change', (e) => {
        this.targetLetter = e.target.value;
        const disp = this.container.querySelector('#cal-stimulus-display');
        if (disp) disp.textContent = this.targetLetter;
        const refBtn = this.container.querySelector('#cal-play-reference');
        if (refBtn) refBtn.textContent = `🔊 Hear Reference Letter ("${this.targetLetter}")`;
      });

      this.container.querySelector('#cal-play-reference')?.addEventListener('click', () => {
        speechSynthesis.speak(this.targetLetter, {
          rate: this.values.rate,
          pitch: this.values.pitch,
          volume: this.values.volume
        });
      });

      this.container.querySelector('#cal-record-btn')?.addEventListener('click', () => {
        if (this.isRecording) {
          this._stopRecording();
        } else {
          this._startRecording();
        }
      });

      this.container.querySelector('#cal-replay-sample-btn')?.addEventListener('click', () => {
        this._playUserSample();
      });

      this.container.querySelector('#cal-auto-calibrate-btn')?.addEventListener('click', async () => {
        await this.autoCalibrateFromSample();
      });

      this.container.querySelector('#cal-full-auto-run-btn')?.addEventListener('click', async () => {
        await this.runFullAutoCalibration();
      });
    }

    // ---- STEP 2 EVENTS (Rate) ----
    if (this.currentStep === 2) {
      this.container.querySelector('#cal-auto-speed-btn')?.addEventListener('click', async () => {
        await this.autoCalibrateSpeed();
      });

      this._bindVariationEvents('rate', (val) => {
        this._applyMovingAverage('rate', val);
        speechSynthesis.setRate(this.values.rate);
        const disp = this.container.querySelector('#cal-rate-display');
        if (disp) disp.textContent = `${this.values.rate.toFixed(2)}×`;
        const slider = this.container.querySelector('#cal-rate-slider');
        if (slider) slider.value = this.values.rate;
      }, (val) => {
        speechSynthesis.speak(this.targetLetter, { rate: val, pitch: this.values.pitch });
      });

      const rateSlider = this.container.querySelector('#cal-rate-slider');
      rateSlider?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.values.rate = val;
        this.container.querySelector('#cal-rate-display').textContent = `${val.toFixed(2)}×`;
      });
      rateSlider?.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        this._applyMovingAverage('rate', val);
        this.render();
      });
    }

    // ---- STEP 3 EVENTS (Pitch) ----
    if (this.currentStep === 3) {
      this.container.querySelector('#cal-auto-pitch-btn')?.addEventListener('click', async () => {
        await this.autoCalibratePitch();
      });

      this.container.querySelector('#cal-ab-sample')?.addEventListener('click', () => {
        this._playUserSample();
      });

      this.container.querySelector('#cal-ab-tts')?.addEventListener('click', () => {
        speechSynthesis.speak(this.targetLetter, { rate: this.values.rate, pitch: this.values.pitch });
      });

      this._bindVariationEvents('pitch', (val) => {
        this._applyMovingAverage('pitch', val);
        speechSynthesis.setPitch(this.values.pitch);
        const disp = this.container.querySelector('#cal-pitch-display');
        if (disp) disp.textContent = this.values.pitch.toFixed(2);
        const slider = this.container.querySelector('#cal-pitch-slider');
        if (slider) slider.value = this.values.pitch;
      }, (val) => {
        speechSynthesis.speak(this.targetLetter, { rate: this.values.rate, pitch: val });
      });

      const pitchSlider = this.container.querySelector('#cal-pitch-slider');
      pitchSlider?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.values.pitch = val;
        this.container.querySelector('#cal-pitch-display').textContent = val.toFixed(2);
      });
      pitchSlider?.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        this._applyMovingAverage('pitch', val);
        this.render();
      });
    }

    // ---- STEP 4 EVENTS (Spacing) ----
    if (this.currentStep === 4) {
      this.container.querySelector('#cal-auto-spacing-btn')?.addEventListener('click', async () => {
        await this.autoCalibrateSpacing();
      });

      this._bindVariationEvents('letterGap', (val) => {
        this._applyMovingAverage('letterGap', val);
        speechSynthesis.setLetterGap(this.values.letterGap);
        const disp = this.container.querySelector('#cal-gap-display');
        if (disp) disp.textContent = `${this.values.letterGap} ms`;
        const slider = this.container.querySelector('#cal-gap-slider');
        if (slider) slider.value = this.values.letterGap;
      }, async (val) => {
        await this._playLetterSeries(['a', 'b', 'c'], { letterGap: val });
      });

      const gapSlider = this.container.querySelector('#cal-gap-slider');
      gapSlider?.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.values.letterGap = val;
        this.container.querySelector('#cal-gap-display').textContent = `${val} ms`;
      });
      gapSlider?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        this._applyMovingAverage('letterGap', val);
        this.render();
      });
    }

    // ---- STEP 5 EVENTS (Filter Cutoff) ----
    if (this.currentStep === 5) {
      this.container.querySelector('#cal-auto-filter-btn')?.addEventListener('click', async () => {
        await this.autoCalibrateFilter();
      });

      this._bindVariationEvents('filterCutoff', (val) => {
        this._applyMovingAverage('filterCutoff', val);
        audioFeedback.setFilterCutoff(this.values.filterCutoff);
        const disp = this.container.querySelector('#cal-filter-display');
        if (disp) disp.textContent = `${this.values.filterCutoff} Hz`;
        const slider = this.container.querySelector('#cal-filter-slider');
        if (slider) slider.value = this.values.filterCutoff;
      }, (val) => {
        const prev = audioFeedback.filterCutoff;
        audioFeedback.setFilterCutoff(val);
        audioFeedback.playCorrect();
        audioFeedback.setFilterCutoff(this.values.filterCutoff);
      });

      const filterSlider = this.container.querySelector('#cal-filter-slider');
      filterSlider?.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.values.filterCutoff = val;
        this.container.querySelector('#cal-filter-display').textContent = `${val} Hz`;
      });
      filterSlider?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        this._applyMovingAverage('filterCutoff', val);
        this.render();
      });
    }

    // ---- STEP 6 EVENTS (Review & Save) ----
    if (this.currentStep === 6) {
      this.container.querySelector('#cal-play-full-test')?.addEventListener('click', async () => {
        audioFeedback.setFilterCutoff(this.values.filterCutoff);
        await speechSynthesis.speakLetterSeries(['a,', 'b,', 'c.', '1,', '2,', '3.', 'Ready to learn!'], {
          rate: this.values.rate,
          pitch: this.values.pitch,
          letterGap: this.values.letterGap,
          volume: this.values.volume
        });
        audioFeedback.playCorrect();
      });

      this.container.querySelector('#cal-replay-user-final')?.addEventListener('click', () => {
        this._playUserSample();
      });
    }
  }

  /** Helper to wire candidate variation card click and audition button */
  _bindVariationEvents(paramKey, onSelect, onAudition) {
    const cards = this.container.querySelectorAll(`.cal-variation-card[data-type="${paramKey}"]`);
    cards.forEach(card => {
      const candId = card.dataset.cand;
      const val = parseFloat(card.dataset.val);

      card.addEventListener('click', (e) => {
        // If clicking audition button, do audition
        if (e.target.closest('.cal-audition-btn')) {
          e.stopPropagation();
          card.classList.add('cal-variation-card--active');
          onAudition(val);
          setTimeout(() => card.classList.remove('cal-variation-card--active'), 800);
          return;
        }

        this.selectedCandidate[paramKey] = candId;
        cards.forEach(c => c.classList.remove('cal-variation-card--selected'));
        card.classList.add('cal-variation-card--selected');
        onSelect(val);
        this.render();
      });
    });
  }

  // =========================================================================
  // Moving Average Algorithm
  // =========================================================================
  /**
   * Updates the moving average for a parameter key.
   * EMA formula: MA_new = alpha * candidateVal + (1 - alpha) * MA_prev
   * Alpha adapts based on sample count.
   */
  _applyMovingAverage(paramKey, candidateVal) {
    if (!this.maHistory[paramKey]) {
      this.maHistory[paramKey] = [candidateVal];
    } else {
      this.maHistory[paramKey].push(candidateVal);
    }

    const history = this.maHistory[paramKey];
    const prevMA = this.values[paramKey];
    
    // Adaptive alpha: starts at 0.5 for fast response, smooths to 0.3
    const alpha = Math.max(0.3, 1 / Math.sqrt(history.length + 1));
    const newMA = alpha * candidateVal + (1 - alpha) * prevMA;

    if (paramKey === 'letterGap' || paramKey === 'filterCutoff') {
      this.values[paramKey] = Math.round(newMA);
    } else {
      this.values[paramKey] = Math.round(newMA * 100) / 100;
    }
  }

  // =========================================================================
  // Microphone Audio Recording & Feature Extraction
  // =========================================================================
  async _startRecording() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.isRecording = true;
      this.recordingStartTime = performance.now();

      // Setup Web Audio Analyser for live visualization & pitch/energy estimation
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      source.connect(this.analyser);

      // Determine supported mimeType
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const supportedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';

      this.mediaRecorder = supportedMime ? new MediaRecorder(this.mediaStream, { mimeType: supportedMime }) : new MediaRecorder(this.mediaStream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const endTime = performance.now();
        const durationMs = Math.max(100, Math.round(endTime - this.recordingStartTime));
        const mime = this.mediaRecorder.mimeType || 'audio/webm';
        this.userAudioBlob = new Blob(this.audioChunks, { type: mime });
        this.userAudioUrl = URL.createObjectURL(this.userAudioBlob);

        // Decode audio buffer for analysis
        try {
          const arrayBuffer = await this.userAudioBlob.arrayBuffer();
          this.userAudioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
          this._analyzeAudioBuffer(this.userAudioBuffer, durationMs);
          // Calibrate On-Device Speech Recognition Acoustic Model
          await onDeviceSpeech.calibrateFromSample(this.userAudioBlob, this.targetLetter);
        } catch (err) {
          this.sampleMetrics.durationMs = durationMs;
          this.sampleMetrics.avgVolume = 0.6;
          this.sampleMetrics.pitchHz = 160;
          this.sampleMetrics.recordedAt = Date.now();
        }

        this.isRecording = false;
        this._stopVisualization();
        this.render();
      };

      this.mediaRecorder.start(100); // 100ms timeslice chunks
      this._startVisualization();

      // Update UI in-place for active recording state (do NOT call this.render() here)
      const recBtn = this.container.querySelector('#cal-record-btn');
      if (recBtn) {
        recBtn.innerHTML = '⏹️ Stop Recording';
        recBtn.className = 'btn btn--secondary';
        recBtn.style.background = '#DC2626';
        recBtn.style.color = '#FFFFFF';
        recBtn.style.borderColor = '#DC2626';
      }

      const recStatus = this.container.querySelector('#cal-rec-status');
      if (recStatus) {
        recStatus.textContent = '🔴 Recording... Speak now, then click "Stop Recording"';
        recStatus.style.color = '#DC2626';
      }

      // Auto-stop safety timeout after 8 seconds
      setTimeout(() => {
        if (this.isRecording) {
          this._stopRecording();
        }
      }, 8000);

    } catch (err) {
      console.warn('Microphone access denied or error:', err);
      alert('Microphone access unavailable or denied. You can still calibrate all parameters using reference audition buttons!');
      this.isRecording = false;
      this._stopVisualization();
      this.render();
    }
  }

  _stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.isRecording = false;
      this._stopVisualization();
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        // Handled
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(t => t.stop());
      }
    }
  }

  /** Live Canvas Waveform & VU Meter Animation */
  _startVisualization() {
    const canvas = this.container.querySelector('#cal-waveform');
    const vuBar = this.container.querySelector('#cal-vu-bar');
    if (!canvas || !this.analyser) return;

    const ctx = canvas.getContext('2d');
    const bufferLength = this.analyser.frequencyBinCount;
    const timeData = new Uint8Array(bufferLength);

    const draw = () => {
      if (!this.isRecording) return;
      this.animFrameId = requestAnimationFrame(draw);

      this.analyser.getByteTimeDomainData(timeData);

      // Clear canvas
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--dl-color-surface') || '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--dl-color-primary') || '#2563EB';
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      let sumSq = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = timeData[i] / 128.0;
        const y = (v * canvas.height) / 2;

        const dev = timeData[i] - 128;
        sumSq += dev * dev;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.stroke();

      // RMS Volume for VU bar
      const rms = Math.sqrt(sumSq / bufferLength) / 128;
      if (vuBar) {
        vuBar.style.width = `${Math.min(100, Math.round(rms * 250))}%`;
      }
    };

    draw();
  }

  _stopVisualization() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /** Extract fundamental frequency (Yin/autocorrelation) and RMS */
  _analyzeAudioBuffer(buffer, durationMs) {
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    // Autocorrelation pitch detector
    let bestCorrelation = 0;
    let bestPeriod = 0;
    const minPeriod = Math.floor(sampleRate / 600); // 600 Hz max pitch
    const maxPeriod = Math.floor(sampleRate / 60);  // 60 Hz min pitch

    for (let period = minPeriod; period <= maxPeriod; period++) {
      let corr = 0;
      for (let i = 0; i < 2048; i++) {
        corr += data[i] * data[i + period];
      }
      if (corr > bestCorrelation) {
        bestCorrelation = corr;
        bestPeriod = period;
      }
    }

    const detectedPitch = bestPeriod > 0 ? sampleRate / bestPeriod : 150;
    
    // Average RMS volume
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      sumSquares += data[i] * data[i];
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const pitchHz = Math.max(70, Math.min(500, detectedPitch));

    // Automated Moving Average Target Computations
    const computedRate = Math.max(0.25, Math.min(1.30, Math.round((450 / durationMs) * 100) / 100));
    const computedPitch = Math.max(0.40, Math.min(1.80, Math.round((pitchHz / 180) * 100) / 100));
    const computedGap = Math.max(100, Math.min(1200, Math.round((durationMs * 0.55) / 50) * 50));
    const computedFilter = Math.max(1500, Math.min(9000, Math.round((pitchHz * 22) / 100) * 100));

    this.sampleMetrics = {
      durationMs,
      avgVolume: Math.min(1.0, rms * 3),
      pitchHz,
      computed: {
        rate: computedRate,
        pitch: computedPitch,
        letterGap: computedGap,
        filterCutoff: computedFilter,
      },
      recordedAt: Date.now()
    };
  }

  /**
   * Automated Moving Average Calibration:
   * Analyzes the user's recorded sample, converges all parameters via moving average,
   * updates live settings, and auditions the calibrated speech.
   */
  async autoCalibrateFromSample() {
    let comp = this.sampleMetrics.computed;
    if (!comp) {
      comp = { rate: 0.75, pitch: 1.0, letterGap: 350, filterCutoff: 4500 };
    }

    this._applyMovingAverage('rate', comp.rate);
    this._applyMovingAverage('pitch', comp.pitch);
    this._applyMovingAverage('letterGap', comp.letterGap);
    this._applyMovingAverage('filterCutoff', comp.filterCutoff);

    speechSynthesis.setRate(this.values.rate);
    speechSynthesis.setPitch(this.values.pitch);
    speechSynthesis.setLetterGap(this.values.letterGap);
    audioFeedback.setFilterCutoff(this.values.filterCutoff);

    this.render();

    // Audition the auto-calibrated speech letter immediately
    await speechSynthesis.speak(this.targetLetter, {
      rate: this.values.rate,
      pitch: this.values.pitch,
      volume: this.values.volume
    });
  }

  /** Auto-calibrate Step 2 Speed (Rate) */
  async autoCalibrateSpeed() {
    const compRate = this.sampleMetrics.computed?.rate ?? 0.80;
    this._applyMovingAverage('rate', compRate);
    speechSynthesis.setRate(this.values.rate);
    this.render();
    await speechSynthesis.speak(this.targetLetter, {
      rate: this.values.rate,
      pitch: this.values.pitch,
      volume: this.values.volume
    });
  }

  /** Auto-calibrate Step 3 Vocal Pitch */
  async autoCalibratePitch() {
    const compPitch = this.sampleMetrics.computed?.pitch ?? 1.00;
    this._applyMovingAverage('pitch', compPitch);
    speechSynthesis.setPitch(this.values.pitch);
    this.render();
    await speechSynthesis.speak(this.targetLetter, {
      rate: this.values.rate,
      pitch: this.values.pitch,
      volume: this.values.volume
    });
  }

  /** Auto-calibrate Step 4 Letter Spacing */
  async autoCalibrateSpacing() {
    const compGap = this.sampleMetrics.computed?.letterGap ?? 350;
    this._applyMovingAverage('letterGap', compGap);
    speechSynthesis.setLetterGap(this.values.letterGap);
    this.render();
    await this._playLetterSeries(['a', 'b', 'c'], { letterGap: this.values.letterGap });
  }

  /** Auto-calibrate Step 5 Audio Filter */
  async autoCalibrateFilter() {
    const compFilter = this.sampleMetrics.computed?.filterCutoff ?? 4500;
    this._applyMovingAverage('filterCutoff', compFilter);
    audioFeedback.setFilterCutoff(this.values.filterCutoff);
    this.render();
    audioFeedback.playCorrect();
  }

  /** Full automatic sweep across all calibration parameters directly to Step 6 */
  async runFullAutoCalibration() {
    let comp = this.sampleMetrics.computed;
    if (!comp) {
      comp = { rate: 0.75, pitch: 1.0, letterGap: 350, filterCutoff: 4500 };
    }

    this._applyMovingAverage('rate', comp.rate);
    this._applyMovingAverage('pitch', comp.pitch);
    this._applyMovingAverage('letterGap', comp.letterGap);
    this._applyMovingAverage('filterCutoff', comp.filterCutoff);

    speechSynthesis.setRate(this.values.rate);
    speechSynthesis.setPitch(this.values.pitch);
    speechSynthesis.setLetterGap(this.values.letterGap);
    audioFeedback.setFilterCutoff(this.values.filterCutoff);

    // Jump straight to review step
    this.currentStep = 6;
    this.render();

    // Audition the full sequence
    await speechSynthesis.speakLetterSeries(['a,', 'b,', 'c.', '1,', '2,', '3.', 'Ready to learn!'], {
      rate: this.values.rate,
      pitch: this.values.pitch,
      letterGap: this.values.letterGap,
      volume: this.values.volume
    });
    audioFeedback.playCorrect();
  }

  /** Replay user's recorded audio sample */
  _playUserSample() {
    if (!this.userAudioUrl) return;
    const audio = new Audio(this.userAudioUrl);
    audio.play();
  }

  /** Replay multi-letter series with highlight animation */
  async _playLetterSeries(items, overrides = {}) {
    this._stopAudio();
    const cards = this.container.querySelectorAll('.cal-series-card');

    const listener = (e) => {
      const { index, isComplete } = e.detail;
      cards.forEach((c, idx) => {
        if (!isComplete && idx === index) {
          c.style.borderColor = 'var(--dl-color-primary)';
          c.style.background = 'var(--dl-color-primary-light)';
          c.style.transform = 'scale(1.1)';
        } else {
          c.style.borderColor = 'var(--dl-color-border)';
          c.style.background = 'var(--dl-color-surface)';
          c.style.transform = 'scale(1.0)';
        }
      });
    };

    window.addEventListener('dl:calibration-step', listener);

    await speechSynthesis.speakLetterSeries(items, {
      rate: overrides.rate ?? this.values.rate,
      pitch: overrides.pitch ?? this.values.pitch,
      letterGap: overrides.letterGap ?? this.values.letterGap,
      volume: overrides.volume ?? this.values.volume
    });

    window.removeEventListener('dl:calibration-step', listener);
    cards.forEach(c => {
      c.style.borderColor = 'var(--dl-color-border)';
      c.style.background = 'var(--dl-color-surface)';
      c.style.transform = 'scale(1.0)';
    });
  }

  _stopAudio() {
    speechSynthesis.stop();
    this._stopRecording();
    this._stopVisualization();
  }

  /** Save all calibrated settings to storage & apply */
  async _saveAllSettings() {
    await storage.setSetting('speechRate', this.values.rate);
    await storage.setSetting('speechPitch', this.values.pitch);
    await storage.setSetting('speechVolume', this.values.volume);
    await storage.setSetting('speechLetterGap', this.values.letterGap);
    await storage.setSetting('speechPunctMultiplier', this.values.punctMultiplier);
    await storage.setSetting('sfxFilterCutoff', this.values.filterCutoff);
    await storage.setSetting('sfxVolume', this.values.sfxVolume);

    speechSynthesis.setRate(this.values.rate);
    speechSynthesis.setPitch(this.values.pitch);
    speechSynthesis.setVolume(this.values.volume);
    speechSynthesis.setLetterGap(this.values.letterGap);
    speechSynthesis.setPunctMultiplier(this.values.punctMultiplier);
    audioFeedback.setFilterCutoff(this.values.filterCutoff);
    audioFeedback.setVolume(this.values.sfxVolume);
  }

  destroy() {
    this._stopAudio();
    if (this.userAudioUrl) {
      URL.revokeObjectURL(this.userAudioUrl);
    }
  }
}

export default CalibrationWizard;
