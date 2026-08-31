/**
 * DoingLanguage — Main Application
 * Handles routing, service initialisation, sidebar rendering,
 * and view coordination.
 */

import { speechSynthesis } from './services/speech-synthesis.js';
import { speechRecognition } from './services/speech-recognition.js';
import { onDeviceSpeech } from './services/on-device-speech.js';
import { storage } from './services/storage.js';
import { progress } from './services/progress.js';
import { audioFeedback } from './services/audio-feedback.js';
import { CURRICULUM, getSubtier, getUnlockedSubtiers } from './engine/curriculum.js';
import { ExerciseEngine } from './engine/exercise-engine.js';
import { renderMultipleChoice } from './exercises/multiple-choice.js';
import { renderListenRepeat } from './exercises/listen-repeat.js';
import { renderMatchPairs } from './exercises/match-pairs.js';
import { renderSequenceOrder } from './exercises/sequence-order.js';
import { CalibrationWizard } from './components/calibration-wizard.js';

class App {
  constructor() {
    this.contentEl = null;
    this.sidebarEl = null;
    this.overlayEl = null;
    this._settingsCache = {};
    this._currentWizard = null;
  }

  async init() {
    // Initialise services
    await storage.init();
    await progress.init();
    await speechSynthesis.init();
    await speechRecognition.init();

    // Load saved settings
    await this._loadSettings();

    // Get DOM references
    this.contentEl = document.getElementById('app-content');
    this.sidebarEl = document.getElementById('app-sidebar');
    this.overlayEl = document.getElementById('app-overlay');

    // Render sidebar
    await this.renderSidebar();

    // Setup routing
    window.addEventListener('hashchange', () => this.route());

    // Mobile menu toggle
    document.getElementById('menu-toggle')?.addEventListener('click', () => {
      this.sidebarEl.classList.toggle('app__sidebar--open');
      this.overlayEl.classList.toggle('app__overlay--visible');
    });

    this.overlayEl?.addEventListener('click', () => {
      this.sidebarEl.classList.remove('app__sidebar--open');
      this.overlayEl.classList.remove('app__overlay--visible');
    });

    // Header buttons
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      window.location.hash = '#/settings';
    });
    document.getElementById('btn-dashboard')?.addEventListener('click', () => {
      window.location.hash = '#/dashboard';
    });

    // Route to current hash (or dashboard)
    if (!window.location.hash || window.location.hash === '#/') {
      window.location.hash = '#/dashboard';
    } else {
      this.route();
    }
  }

  /** Hash-based router. */
  async route() {
    const hash = window.location.hash || '#/dashboard';

    // Clean up any running wizard loops
    if (this._currentWizard) {
      this._currentWizard.destroy();
      this._currentWizard = null;
    }

    // Close mobile sidebar on navigation
    this.sidebarEl?.classList.remove('app__sidebar--open');
    this.overlayEl?.classList.remove('app__overlay--visible');

    if (hash === '#/dashboard' || hash === '#/') {
      await this.renderDashboard();
    } else if (hash === '#/settings') {
      await this.renderSettings();
    } else if (hash === '#/calibrate') {
      await this.renderCalibration();
    } else if (hash.startsWith('#/tier/')) {
      const subtierId = hash.replace('#/tier/', '');
      await this.renderSubtier(subtierId);
    } else if (hash.startsWith('#/exercise/')) {
      const parts = hash.replace('#/exercise/', '').split('/');
      const subtierId = parts[0];
      const exerciseType = parts[1];
      await this.startExercise(subtierId, exerciseType);
    } else {
      await this.renderDashboard();
    }

    // Update active sidebar item
    this._updateSidebarActive(hash);
  }

  /** Render the navigation sidebar. */
  async renderSidebar() {
    let html = `
      <div class="sidebar__brand">
        <span class="sidebar__brand-icon">🧠</span>
        <span class="sidebar__brand-name">DoingLanguage</span>
      </div>
      <nav class="sidebar__nav" aria-label="Exercise tiers">
        <button class="sidebar__item" data-route="#/dashboard">
          <span>📊</span> Dashboard
        </button>
        <button class="sidebar__item" data-route="#/calibrate">
          <span>🎯</span> Self-Calibration
        </button>
    `;

    for (const tier of CURRICULUM) {
      const tierProgress = await progress.getTierProgress(tier.id);
      const isOpen = !tier.locked;

      html += `
        <div class="sidebar__section ${isOpen ? 'sidebar__section--open' : ''}">
          <button class="sidebar__section-header ${tier.locked ? 'sidebar__item--locked' : ''}"
                  data-tier="${tier.id}"
                  ${tier.locked ? 'disabled aria-disabled="true"' : ''}
                  aria-expanded="${isOpen}">
            <span class="sidebar__section-icon">${tier.icon}</span>
            <span>${tier.name}</span>
            ${!tier.locked ? `<span class="sidebar__section-chevron">▶</span>` : '🔒'}
          </button>
          <div class="sidebar__items">
      `;

      if (tier.subtiers) {
        for (const sub of tier.subtiers) {
          const subProgress = !sub.locked ? await progress.getSubtierProgress(sub.id) : null;
          const status = subProgress?.status || 'not_started';

          html += `
            <button class="sidebar__item ${sub.locked ? 'sidebar__item--locked' : ''}"
                    data-route="#/tier/${sub.id}"
                    ${sub.locked ? 'disabled aria-disabled="true"' : ''}>
              <span class="sidebar__item-status sidebar__item-status--${status.replace('_', '-')}"
                    title="${status.replace('_', ' ')}"></span>
              <span>${sub.name}</span>
            </button>
          `;
        }
      }

      html += `</div></div>`;
    }

    html += `
        <button class="sidebar__item" data-route="#/settings" style="margin-top: auto;">
          <span>⚙️</span> Settings
        </button>
      </nav>
    `;

    this.sidebarEl.innerHTML = html;

    // Section toggle
    this.sidebarEl.querySelectorAll('.sidebar__section-header:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.closest('.sidebar__section');
        section.classList.toggle('sidebar__section--open');
        btn.setAttribute('aria-expanded',
          section.classList.contains('sidebar__section--open'));
      });
    });

    // Navigation clicks
    this.sidebarEl.querySelectorAll('[data-route]').forEach(btn => {
      btn.addEventListener('click', () => {
        window.location.hash = btn.dataset.route;
      });
    });
  }

  /** Update active state in sidebar. */
  _updateSidebarActive(hash) {
    this.sidebarEl?.querySelectorAll('.sidebar__item').forEach(item => {
      item.classList.toggle('sidebar__item--active', item.dataset.route === hash);
    });
  }

  /** Render the dashboard view. */
  async renderDashboard() {
    const overall = await progress.getOverallProgress();
    const recentSessions = await progress.getRecentSessions(5);
    const unlocked = getUnlockedSubtiers();

    // Get per-subtier status
    const subtierStatuses = [];
    for (const { tier, subtier } of unlocked) {
      const prog = await progress.getSubtierProgress(subtier.id);
      subtierStatuses.push({ tier, subtier, progress: prog });
    }

    // Find recommendation
    const inProgress = subtierStatuses.filter(s => s.progress.status === 'in_progress');
    const notStarted = subtierStatuses.filter(s => s.progress.status === 'not_started');
    const needsWork = inProgress.sort((a, b) => a.progress.accuracy - b.progress.accuracy);
    const recommended = needsWork[0] || notStarted[0] || subtierStatuses[0];

    const accuracyPct = overall.totalAttempts > 0 ? Math.round(overall.accuracy * 100) : 0;

    this.contentEl.innerHTML = `
      <div class="app__content view-enter">
        <h1 style="margin-bottom: var(--dl-space-5)">Welcome to DoingLanguage 🧠</h1>

        <div class="stat-grid" style="margin-bottom: var(--dl-space-6)">
          <div class="stat-card">
            <div class="stat-card__value">${overall.totalAttempts}</div>
            <div class="stat-card__label">Total Attempts</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__value">${accuracyPct}%</div>
            <div class="stat-card__label">Overall Accuracy</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__value">${overall.subtiersAttempted}</div>
            <div class="stat-card__label">Topics Practised</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__value">${overall.itemsAttempted}</div>
            <div class="stat-card__label">Items Learnt</div>
          </div>
        </div>

        ${recommended ? `
          <div class="card card--elevated" style="margin-bottom: var(--dl-space-6)">
            <div class="card__header">
              <h2 class="card__title">📌 Recommended Next</h2>
            </div>
            <p style="margin-bottom: var(--dl-space-3)">
              <strong>${recommended.subtier.name}</strong>
              ${recommended.progress.status !== 'not_started'
                ? `— ${Math.round(recommended.progress.accuracy * 100)}% accuracy so far`
                : '— not started yet'}
            </p>
            <p style="color: var(--dl-color-text-muted); margin-bottom: var(--dl-space-4)">
              ${recommended.subtier.description || ''}
            </p>
            <button class="btn btn--primary" data-goto="#/tier/${recommended.subtier.id}">
              Start Practising →
            </button>
          </div>
        ` : ''}

        <h2 style="margin-bottom: var(--dl-space-4)">Your Progress</h2>
        <div style="display: flex; flex-direction: column; gap: var(--dl-space-3); margin-bottom: var(--dl-space-6)">
          ${subtierStatuses.map(({ subtier: sub, progress: prog }) => {
            const pct = Math.round(prog.accuracy * 100);
            return `
              <div class="card" style="cursor: pointer" data-goto="#/tier/${sub.id}">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--dl-space-2)">
                  <strong>${sub.name}</strong>
                  <span class="badge badge--${prog.status.replace('_', '-')}">${prog.status.replace('_', ' ')}</span>
                </div>
                <div class="progress">
                  <div class="progress__fill ${prog.status === 'mastered' ? '' : ''}"
                       style="width: ${prog.totalAttempts > 0 ? pct : 0}%;
                              background: var(--dl-color-status-${prog.status.replace('_', '-')})"></div>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: var(--dl-space-1)">
                  <span style="font-size: var(--dl-font-size-xs); color: var(--dl-color-text-muted)">
                    ${prog.totalAttempts > 0 ? `${pct}% accuracy` : 'Not started'}
                  </span>
                  <span style="font-size: var(--dl-font-size-xs); color: var(--dl-color-text-muted)">
                    ${prog.totalAttempts} attempts
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        ${overall.totalAttempts === 0 ? `
          <div class="empty-state">
            <div class="empty-state__icon">🚀</div>
            <div class="empty-state__title">Ready to begin?</div>
            <div class="empty-state__text">
              Choose a topic from the sidebar, or tap "Start Practising" above to begin your first exercise.
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Navigation clicks
    this.contentEl.querySelectorAll('[data-goto]').forEach(el => {
      el.addEventListener('click', () => {
        window.location.hash = el.dataset.goto;
      });
    });
  }

  /** Render a sub-tier landing page with exercise type choices. */
  async renderSubtier(subtierId) {
    const lookup = getSubtier(subtierId);
    if (!lookup || lookup.subtier.locked) {
      this.contentEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🔒</div>
          <div class="empty-state__title">Coming Soon</div>
          <div class="empty-state__text">This topic is being built and will be available in a future update.</div>
          <button class="btn btn--secondary" onclick="window.location.hash='#/dashboard'">← Back to Dashboard</button>
        </div>
      `;
      return;
    }

    const { tier, subtier } = lookup;
    const prog = await progress.getSubtierProgress(subtierId);
    const accuracyPct = Math.round(prog.accuracy * 100);

    this.contentEl.innerHTML = `
      <div class="app__content view-enter">
        <div style="margin-bottom: var(--dl-space-4)">
          <button class="btn btn--secondary" style="margin-bottom: var(--dl-space-3)"
                  onclick="window.location.hash='#/dashboard'">← Dashboard</button>
        </div>

        <h1 style="margin-bottom: var(--dl-space-2)">${tier.icon} ${subtier.name}</h1>
        <p style="color: var(--dl-color-text-muted); margin-bottom: var(--dl-space-5)">
          ${subtier.description || ''}
        </p>

        ${prog.totalAttempts > 0 ? `
          <div class="card" style="margin-bottom: var(--dl-space-5)">
            <div class="stat-grid">
              <div class="stat-card">
                <div class="stat-card__value">${accuracyPct}%</div>
                <div class="stat-card__label">Accuracy</div>
              </div>
              <div class="stat-card">
                <div class="stat-card__value">${prog.totalAttempts}</div>
                <div class="stat-card__label">Attempts</div>
              </div>
              <div class="stat-card">
                <div class="stat-card__value">
                  <span class="badge badge--${prog.status.replace('_', '-')}">${prog.status.replace('_', ' ')}</span>
                </div>
                <div class="stat-card__label">Status</div>
              </div>
            </div>
          </div>
        ` : ''}

        <h2 style="margin-bottom: var(--dl-space-4)">Choose an Exercise</h2>
        <div class="exercise-type-grid">
          ${(subtier.exerciseTypes || []).map(ex => `
            <button class="exercise-type-card" data-goto="#/exercise/${subtierId}/${ex.type}">
              <div class="exercise-type-card__icon">${ex.icon}</div>
              <div class="exercise-type-card__name">${ex.name}</div>
              <div class="exercise-type-card__description">${ex.description}</div>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    this.contentEl.querySelectorAll('[data-goto]').forEach(el => {
      el.addEventListener('click', () => {
        window.location.hash = el.dataset.goto;
      });
    });
  }

  /** Start an exercise session. */
  async startExercise(subtierId, exerciseType) {
    const lookup = getSubtier(subtierId);
    if (!lookup) return;

    const { tier, subtier } = lookup;

    // Load data
    let allItems;
    try {
      const response = await fetch(subtier.dataFile);
      allItems = await response.json();
    } catch (err) {
      this.contentEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">⚠️</div>
          <div class="empty-state__title">Could not load exercise data</div>
          <div class="empty-state__text">${err.message}</div>
          <button class="btn btn--secondary" onclick="window.location.hash='#/tier/${subtierId}'">← Back</button>
        </div>
      `;
      return;
    }

    // Get session items (spaced repetition)
    const sessionItems = await progress.getSessionItems(subtierId, allItems, 10);

    // Create engine
    const engine = new ExerciseEngine({
      tier: tier.id,
      subtier: subtierId,
      exerciseType,
      items: sessionItems,
    });

    // Render the appropriate exercise type
    switch (exerciseType) {
      case 'multiple-choice':
        renderMultipleChoice(this.contentEl, engine, subtier, allItems);
        break;
      case 'listen-repeat':
        renderListenRepeat(this.contentEl, engine, subtier);
        break;
      case 'match-pairs':
        renderMatchPairs(this.contentEl, engine, subtier);
        break;
      case 'sequence-order':
        renderSequenceOrder(this.contentEl, engine, subtier);
        break;
      default:
        this.contentEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-state__icon">🚧</div>
            <div class="empty-state__title">Exercise type "${exerciseType}" is not yet available</div>
            <button class="btn btn--secondary" onclick="window.location.hash='#/tier/${subtierId}'">← Back</button>
          </div>
        `;
    }
  }

  /** Render the settings panel. */
  async renderSettings() {
    const voices = speechSynthesis.getVoices();
    const currentVoice = speechSynthesis.currentVoice;
    const P = speechSynthesis.constructor.PARAMS;
    const AP = audioFeedback.constructor.PARAMS;
    const fontSize = await storage.getSetting('fontSize') || 'normal';
    const theme = await storage.getSetting('theme') || 'system';
    const soundEnabled = (await storage.getSetting('soundEnabled')) !== false;

    const sliderField = (id, param, currentValue, formatFn) => {
      const displayValue = formatFn ? formatFn(currentValue) : `${currentValue}${param.unit}`;
      return `
        <div class="settings-field">
          <div>
            <div class="settings-field__label">${param.label}</div>
            <div class="settings-field__description">
              <span id="${id}-display">${displayValue}</span> — ${param.description}
            </div>
          </div>
          <input type="range" id="${id}" min="${param.min}" max="${param.max}" step="${param.step}"
                 value="${currentValue}" aria-label="${param.label}"
                 style="min-width: 200px">
        </div>
      `;
    };

    this.contentEl.innerHTML = `
      <div class="app__content view-enter">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--dl-space-6);">
          <h1 style="margin: 0;">⚙️ Settings</h1>
          <button class="btn btn--primary" id="btn-start-calibration" style="font-size: var(--dl-font-size-base); padding: var(--dl-space-2) var(--dl-space-4);">
            🎯 Start Self-Calibration Wizard →
          </button>
        </div>

        <!-- Self-Calibration Callout Card -->
        <div class="card card--elevated" style="background: linear-gradient(135deg, var(--dl-color-surface) 0%, var(--dl-color-primary-light) 100%); border-left: 4px solid var(--dl-color-primary); padding: var(--dl-space-4); margin-bottom: var(--dl-space-6); display: flex; align-items: center; justify-content: space-between; gap: var(--dl-space-4);">
          <div>
            <div style="font-weight: 700; font-size: var(--dl-font-size-base); color: var(--dl-color-text); margin-bottom: var(--dl-space-1);">
              🎯 Self-Calibrate Speech & Tone
            </div>
            <div style="font-size: var(--dl-font-size-sm); color: var(--dl-color-text-muted);">
              Use our guided wizard to self-calibrate Speed, Vocal Pitch, Volume, Letter Delay, Punctuation Pauses, and Tone Warmth by listening to an interactive series of letters.
            </div>
          </div>
          <button class="btn btn--primary" id="btn-callout-calibration" style="white-space: nowrap;">
            Calibrate Now 🎯
          </button>
        </div>

        <!-- Live Letter Series Calibrator Widget -->
        <div class="card" style="background: var(--dl-color-surface-hover); border: 2px dashed var(--dl-color-primary); padding: var(--dl-space-4); margin-bottom: var(--dl-space-6);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--dl-space-3); flex-wrap: wrap; gap: var(--dl-space-2);">
            <div>
              <div style="font-weight: 700; font-size: var(--dl-font-size-base); color: var(--dl-color-text);">
                🎧 Live Series Calibrator Player
              </div>
              <div style="font-size: var(--dl-font-size-sm); color: var(--dl-color-text-muted);">
                Play or loop a test sequence while moving any slider below to hear your adjustments in real time
              </div>
            </div>
            <select id="setting-series-sample" aria-label="Calibration test sample" style="min-width: 14rem;">
              <option value="letters">Letters (A, B, C, D, E)</option>
              <option value="letters-punct">Letters with Punctuation (A, B, C. D? E!)</option>
              <option value="phonemes">Letter Sounds / Phonics (æ, b, k, d, eɪ)</option>
              <option value="numbers">Numbers (1, 2, 3, 4, 5)</option>
              <option value="words">Words (Apple, Bird, Cat, Dog)</option>
            </select>
          </div>

          <!-- Glowing visual cards -->
          <div style="display: flex; justify-content: center; gap: var(--dl-space-2); margin-bottom: var(--dl-space-4); flex-wrap: wrap;" id="setting-series-cards">
            ${['A', 'B', 'C', 'D', 'E'].map((item, idx) => `
              <div class="card live-cal-card" data-idx="${idx}"
                   style="width: 3.5rem; height: 3.8rem; display: flex; align-items: center; justify-content: center;
                          font-size: 1.4rem; font-weight: 700; border-radius: var(--dl-radius-md);
                          border: 2px solid var(--dl-color-border); background: var(--dl-color-surface);">
                ${item}
              </div>
            `).join('')}
          </div>

          <!-- Play & Loop Controls -->
          <div style="display: flex; justify-content: center; gap: var(--dl-space-3);">
            <button class="btn btn--primary" id="setting-series-play">
              🔊 Play Series
            </button>
            <button class="btn btn--secondary" id="setting-series-loop">
              🔁 Loop Series
            </button>
            <button class="btn btn--secondary" id="setting-series-stop" style="display: none;">
              ⏹️ Stop
            </button>
          </div>
        </div>

        <!-- Voice Selection -->
        <div class="settings-group">
          <h3 class="settings-group__title">🗣️ Voice & Accent</h3>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Voice Filter</div>
              <div class="settings-field__description">Show English voices or all system voices</div>
            </div>
            <select id="setting-voice-scope" aria-label="Voice list filter">
              ${P.voiceScope.options.map(opt => `
                <option value="${opt.value}" ${speechSynthesis.voiceScope === opt.value ? 'selected' : ''}>
                  ${opt.label}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Active Voice</div>
              <div class="settings-field__description">Choose the text-to-speech voice for all spoken targets</div>
            </div>
            <select id="setting-voice" aria-label="Voice selection">
              ${voices.map(v => `
                <option value="${v.voiceURI}"
                        ${v.voiceURI === currentVoice?.voiceURI ? 'selected' : ''}>
                  ${v.name} (${v.lang})
                </option>
              `).join('')}
            </select>
          </div>
        </div>

        <!-- Speech Synthesis Parameters -->
        <div class="settings-group">
          <h3 class="settings-group__title">🎛️ Speech Synthesis Parameters</h3>

          ${sliderField('setting-rate', P.rate, speechSynthesis.rate,
            v => `${v.toFixed(2)}×`)}

          ${sliderField('setting-pitch', P.pitch, speechSynthesis.pitch,
            v => `${v.toFixed(2)}`)}

          ${sliderField('setting-volume', P.volume, speechSynthesis.volume,
            v => `${Math.round(v * 100)}%`)}

          ${sliderField('setting-wordgap', P.wordGap, speechSynthesis.wordGap,
            v => v === 0 ? 'Off (0ms)' : `${v}ms`)}

          ${sliderField('setting-lettergap', P.letterGap, speechSynthesis.letterGap,
            v => v === 0 ? 'Off (0ms)' : `${v}ms`)}

          ${sliderField('setting-punct-multiplier', P.punctMultiplier, speechSynthesis.punctMultiplier,
            v => `${v.toFixed(2)}×`)}

          ${sliderField('setting-repeat-count', P.repeatCount, speechSynthesis.repeatCount,
            v => v === 1 ? '1× (once)' : `${v}×`)}

          ${sliderField('setting-repeat-delay', P.repeatDelay, speechSynthesis.repeatDelay,
            v => `${v}ms`)}

          <div class="settings-field">
            <div>
              <div class="settings-field__label">${P.cueTone.label}</div>
              <div class="settings-field__description">${P.cueTone.description}</div>
            </div>
            <select id="setting-cue-tone" aria-label="Pre-speech cue tone">
              ${P.cueTone.options.map(opt => `
                <option value="${opt.value}" ${speechSynthesis.cueTone === opt.value ? 'selected' : ''}>
                  ${opt.label}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Test Voice</div>
              <div class="settings-field__description">Hear all current speech and pacing parameters on a test sentence</div>
            </div>
            <button class="btn btn--secondary" id="setting-test-voice">🔊 Test Voice</button>
          </div>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Reset Speech to Defaults</div>
              <div class="settings-field__description">Restore all speech parameters to recommended clinical defaults</div>
            </div>
            <button class="btn btn--secondary" id="setting-reset-speech">↩️ Reset Speech</button>
          </div>
        </div>

        <!-- On-Device Speech Recognition Model -->
        <div class="settings-group">
          <h3 class="settings-group__title">🎙️ On-Device Speech Recognition Model</h3>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Speech Recognition Engine</div>
              <div class="settings-field__description">Choose between private on-device local model, hybrid, or browser STT</div>
            </div>
            <select id="setting-speech-engine" aria-label="Speech Recognition Engine">
              <option value="on-device" ${speechRecognition.getEngineMode() === 'on-device' ? 'selected' : ''}>
                🔒 On-Device Local Model (Private, Offline &amp; Dysarthria-Tuned)
              </option>
              <option value="hybrid" ${speechRecognition.getEngineMode() === 'hybrid' ? 'selected' : ''}>
                ⚡ Hybrid (On-Device Acoustics + Browser STT)
              </option>
              <option value="cloud" ${speechRecognition.getEngineMode() === 'cloud' ? 'selected' : ''}>
                🌐 Browser Cloud (Web Speech API)
              </option>
              <option value="self-rate" ${speechRecognition.getEngineMode() === 'self-rate' ? 'selected' : ''}>
                👍 Self-Assessment Rating (Manual)
              </option>
            </select>
          </div>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Personalised Acoustic Calibration</div>
              <div class="settings-field__description">
                VTLN Warping Factor: <strong>${onDeviceSpeech.calibrationProfile.vtlnAlpha.toFixed(2)}α</strong> |
                Adapted Targets: <strong>${onDeviceSpeech.calibrationProfile.calibratedItemsCount}</strong>
              </div>
            </div>
            <div style="display: flex; gap: var(--dl-space-2); flex-wrap: wrap;">
              <button class="btn btn--secondary" id="setting-recalibrate-speech">🎯 Calibrate in Wizard</button>
              <button class="btn btn--secondary" id="setting-reset-speech-model" style="color: var(--dl-color-error);">↩️ Reset Model</button>
            </div>
          </div>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Test On-Device Recognition</div>
              <div class="settings-field__description">Speak into your mic to test local acoustic recognition and formant analysis</div>
            </div>
            <button class="btn btn--primary" id="setting-test-speech-rec">🎤 Test On-Device Mic</button>
          </div>

          <div id="setting-speech-rec-result" class="card" style="display: none; background: var(--dl-color-surface-hover); margin-top: var(--dl-space-3); padding: var(--dl-space-3); border: 1px solid var(--dl-color-border);">
            <div style="font-weight: 700; font-size: var(--dl-font-size-sm); margin-bottom: var(--dl-space-1);" id="setting-rec-status">Listening...</div>
            <div id="setting-rec-details" style="font-size: var(--dl-font-size-xs); color: var(--dl-color-text-muted);"></div>
          </div>
        </div>

        <!-- Audio Feedback & Sound Effects -->
        <div class="settings-group">
          <h3 class="settings-group__title">🔔 Audio Feedback & Sound Filters</h3>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Sound Effects</div>
              <div class="settings-field__description">Play audio tones for correct/incorrect answers</div>
            </div>
            <label class="toggle">
              <input type="checkbox" id="setting-sound" ${soundEnabled ? 'checked' : ''}>
              <span class="toggle__track"></span>
              <span class="toggle__thumb"></span>
            </label>
          </div>

          ${sliderField('setting-sfx-volume', AP.volume, audioFeedback.volume,
            v => `${Math.round(v * 100)}%`)}

          ${sliderField('setting-sfx-pitch', AP.pitchShift, audioFeedback.pitchShift,
            v => `${v.toFixed(2)}×`)}

          ${sliderField('setting-sfx-filter', AP.filterCutoff, audioFeedback.filterCutoff,
            v => `${v} Hz`)}

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Test Audio Chimes</div>
              <div class="settings-field__description">Audition the correct or incorrect feedback sound with current filters</div>
            </div>
            <div style="display: flex; gap: var(--dl-space-2)">
              <button class="btn btn--secondary" id="setting-test-correct">✅ Correct Chime</button>
              <button class="btn btn--secondary" id="setting-test-incorrect">❌ Incorrect Tone</button>
            </div>
          </div>
        </div>

        <!-- Display Settings -->
        <div class="settings-group">
          <h3 class="settings-group__title">🖥️ Display</h3>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Font Size</div>
              <div class="settings-field__description">Larger text is easier to read</div>
            </div>
            <select id="setting-font-size" aria-label="Font size">
              <option value="normal" ${fontSize === 'normal' ? 'selected' : ''}>Normal</option>
              <option value="large" ${fontSize === 'large' ? 'selected' : ''}>Large</option>
              <option value="xlarge" ${fontSize === 'xlarge' ? 'selected' : ''}>Extra Large</option>
            </select>
          </div>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Theme</div>
              <div class="settings-field__description">Light, dark, or follow your system</div>
            </div>
            <select id="setting-theme" aria-label="Theme">
              <option value="system" ${theme === 'system' ? 'selected' : ''}>System</option>
              <option value="light" ${theme === 'light' ? 'selected' : ''}>Light</option>
              <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark</option>
            </select>
          </div>
        </div>

        <!-- Data & Cache Management -->
        <div class="settings-group">
          <h3 class="settings-group__title">💾 Data & Updates</h3>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Check for App Updates</div>
              <div class="settings-field__description">Clear cache and refresh to load latest version</div>
            </div>
            <button class="btn btn--secondary" id="setting-update-app">🔄 Update & Refresh</button>
          </div>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Reset Progress</div>
              <div class="settings-field__description">Clear all saved progress. This cannot be undone.</div>
            </div>
            <button class="btn btn--secondary" id="setting-reset"
                    style="color: var(--dl-color-error)">Reset All</button>
          </div>
        </div>
      </div>
    `;

    // ---- Event handlers ----

    // Calibration Wizard triggers
    const launchWizard = () => {
      window.location.hash = '#/calibrate';
    };
    this.contentEl.querySelector('#btn-start-calibration')?.addEventListener('click', launchWizard);
    this.contentEl.querySelector('#btn-callout-calibration')?.addEventListener('click', launchWizard);

    // Live Series Calibrator Logic
    const samplePresets = {
      letters: ['A', 'B', 'C', 'D', 'E'],
      'letters-punct': ['A,', 'B,', 'C.', 'D?', 'E!'],
      phonemes: ['æ', 'b', 'k', 'd', 'eɪ'],
      numbers: ['1', '2', '3', '4', '5'],
      words: ['Apple', 'Bird', 'Cat', 'Dog'],
    };

    let activeLiveItems = samplePresets.letters;
    let liveLooping = false;
    let liveTimeout = null;

    const cardsContainer = this.contentEl.querySelector('#setting-series-cards');
    const updateCardsUI = (items) => {
      if (!cardsContainer) return;
      cardsContainer.innerHTML = items.map((it, i) => `
        <div class="card live-cal-card" data-idx="${i}"
             style="padding: var(--dl-space-2) var(--dl-space-3); min-width: 3.5rem; height: 3.8rem;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 1.4rem; font-weight: 700; border-radius: var(--dl-radius-md);
                    border: 2px solid var(--dl-color-border); background: var(--dl-color-surface);">
          ${it}
        </div>
      `).join('');
    };

    this.contentEl.querySelector('#setting-series-sample')?.addEventListener('change', (e) => {
      activeLiveItems = samplePresets[e.target.value] || samplePresets.letters;
      updateCardsUI(activeLiveItems);
    });

    const stopLivePlayer = () => {
      liveLooping = false;
      if (liveTimeout) clearTimeout(liveTimeout);
      speechSynthesis.stop();
      const stopBtn = this.contentEl.querySelector('#setting-series-stop');
      if (stopBtn) stopBtn.style.display = 'none';

      cardsContainer?.querySelectorAll('.live-cal-card').forEach(c => {
        c.style.borderColor = 'var(--dl-color-border)';
        c.style.background = 'var(--dl-color-surface)';
        c.style.transform = 'scale(1.0)';
      });
    };

    const onLiveStep = (e) => {
      const { index, isComplete } = e.detail;
      cardsContainer?.querySelectorAll('.live-cal-card').forEach((c, idx) => {
        if (!isComplete && idx === index) {
          c.style.borderColor = 'var(--dl-color-primary)';
          c.style.background = 'var(--dl-color-primary-light)';
          c.style.transform = 'scale(1.12)';
          c.style.transition = 'all 120ms ease';
        } else {
          c.style.borderColor = 'var(--dl-color-border)';
          c.style.background = 'var(--dl-color-surface)';
          c.style.transform = 'scale(1.0)';
        }
      });
    };
    window.addEventListener('dl:calibration-step', onLiveStep);

    this.contentEl.querySelector('#setting-series-play')?.addEventListener('click', async () => {
      stopLivePlayer();
      await speechSynthesis.speakLetterSeries(activeLiveItems);
    });

    this.contentEl.querySelector('#setting-series-loop')?.addEventListener('click', () => {
      liveLooping = true;
      const stopBtn = this.contentEl.querySelector('#setting-series-stop');
      if (stopBtn) stopBtn.style.display = '';

      const loopPlay = async () => {
        if (!liveLooping) return;
        await speechSynthesis.speakLetterSeries(activeLiveItems);
        if (liveLooping) {
          liveTimeout = setTimeout(loopPlay, 1000);
        }
      };
      loopPlay();
    });

    this.contentEl.querySelector('#setting-series-stop')?.addEventListener('click', stopLivePlayer);

    // Voice Scope
    this.contentEl.querySelector('#setting-voice-scope')?.addEventListener('change', async (e) => {
      speechSynthesis.setVoiceScope(e.target.value);
      await storage.setSetting('voiceScope', e.target.value);
      await this.renderSettings();
    });

    // Voice selection
    this.contentEl.querySelector('#setting-voice')?.addEventListener('change', async (e) => {
      speechSynthesis.setVoice(e.target.value);
      await storage.setSetting('voice', e.target.value);
    });

    // Cue Tone
    this.contentEl.querySelector('#setting-cue-tone')?.addEventListener('change', async (e) => {
      speechSynthesis.setCueTone(e.target.value);
      await storage.setSetting('speechCueTone', e.target.value);
    });

    // --- Speech parameter sliders ---
    const bindSlider = (id, setter, formatFn, settingKey) => {
      const el = this.contentEl.querySelector(`#${id}`);
      if (!el) return;
      el.addEventListener('input', async (e) => {
        const val = parseFloat(e.target.value);
        setter(val);
        const display = this.contentEl.querySelector(`#${id}-display`);
        if (display) display.textContent = formatFn(val);
        await storage.setSetting(settingKey, val);
      });
    };

    bindSlider('setting-rate', v => speechSynthesis.setRate(v),
      v => `${v.toFixed(2)}×`, 'speechRate');

    bindSlider('setting-pitch', v => speechSynthesis.setPitch(v),
      v => `${v.toFixed(2)}`, 'speechPitch');

    bindSlider('setting-volume', v => speechSynthesis.setVolume(v),
      v => `${Math.round(v * 100)}%`, 'speechVolume');

    bindSlider('setting-wordgap', v => speechSynthesis.setWordGap(v),
      v => v === 0 ? 'Off (0ms)' : `${v}ms`, 'speechWordGap');

    bindSlider('setting-lettergap', v => speechSynthesis.setLetterGap(v),
      v => v === 0 ? 'Off (0ms)' : `${v}ms`, 'speechLetterGap');

    bindSlider('setting-punct-multiplier', v => speechSynthesis.setPunctMultiplier(v),
      v => `${v.toFixed(2)}×`, 'speechPunctMultiplier');

    bindSlider('setting-repeat-count', v => speechSynthesis.setRepeatCount(v),
      v => v === 1 ? '1× (once)' : `${v}×`, 'speechRepeatCount');

    bindSlider('setting-repeat-delay', v => speechSynthesis.setRepeatDelay(v),
      v => `${v}ms`, 'speechRepeatDelay');

    // --- SFX parameter sliders ---
    bindSlider('setting-sfx-volume', v => audioFeedback.setVolume(v),
      v => `${Math.round(v * 100)}%`, 'sfxVolume');

    bindSlider('setting-sfx-pitch', v => audioFeedback.setPitchShift(v),
      v => `${v.toFixed(2)}×`, 'sfxPitch');

    bindSlider('setting-sfx-filter', v => audioFeedback.setFilterCutoff(v),
      v => `${v} Hz`, 'sfxFilterCutoff');

    // SFX Test buttons
    this.contentEl.querySelector('#setting-test-correct')?.addEventListener('click', () => {
      audioFeedback.playCorrect();
    });
    this.contentEl.querySelector('#setting-test-incorrect')?.addEventListener('click', () => {
      audioFeedback.playIncorrect();
    });

    // Test voice button
    this.contentEl.querySelector('#setting-test-voice')?.addEventListener('click', () => {
      speechSynthesis.speak('Hello! This is how I sound. Ready to practise?');
    });

    // Reset speech to defaults
    this.contentEl.querySelector('#setting-reset-speech')?.addEventListener('click', async () => {
      const P = speechSynthesis.constructor.PARAMS;
      speechSynthesis.setRate(P.rate.default);
      speechSynthesis.setPitch(P.pitch.default);
      speechSynthesis.setVolume(P.volume.default);
      speechSynthesis.setWordGap(P.wordGap.default);
      speechSynthesis.setLetterGap(P.letterGap.default);
      speechSynthesis.setPunctMultiplier(P.punctMultiplier.default);
      speechSynthesis.setRepeatCount(P.repeatCount.default);
      speechSynthesis.setRepeatDelay(P.repeatDelay.default);
      speechSynthesis.setCueTone(P.cueTone.default);
      speechSynthesis.setVoiceScope(P.voiceScope.default);

      await storage.setSetting('speechRate', P.rate.default);
      await storage.setSetting('speechPitch', P.pitch.default);
      await storage.setSetting('speechVolume', P.volume.default);
      await storage.setSetting('speechWordGap', P.wordGap.default);
      await storage.setSetting('speechLetterGap', P.letterGap.default);
      await storage.setSetting('speechPunctMultiplier', P.punctMultiplier.default);
      await storage.setSetting('speechRepeatCount', P.repeatCount.default);
      await storage.setSetting('speechRepeatDelay', P.repeatDelay.default);
      await storage.setSetting('speechCueTone', P.cueTone.default);
      await storage.setSetting('voiceScope', P.voiceScope.default);

      // Re-render to update slider positions
      await this.renderSettings();
    });

    // --- On-Device Speech Recognition Event Handlers ---
    this.contentEl.querySelector('#setting-speech-engine')?.addEventListener('change', async (e) => {
      await speechRecognition.setEngineMode(e.target.value);
    });

    this.contentEl.querySelector('#setting-recalibrate-speech')?.addEventListener('click', () => {
      window.location.hash = '#/calibrate';
    });

    this.contentEl.querySelector('#setting-reset-speech-model')?.addEventListener('click', async () => {
      if (confirm('Reset your personalized speech acoustic calibration to defaults?')) {
        await onDeviceSpeech.resetCalibration();
        await this.renderSettings();
      }
    });

    // Test on-device speech recognition live in settings
    const testMicBtn = this.contentEl.querySelector('#setting-test-speech-rec');
    const testResultCard = this.contentEl.querySelector('#setting-speech-rec-result');
    const testStatus = this.contentEl.querySelector('#setting-rec-status');
    const testDetails = this.contentEl.querySelector('#setting-rec-details');

    testMicBtn?.addEventListener('click', async () => {
      if (onDeviceSpeech.isListening) {
        onDeviceSpeech.abort();
        testMicBtn.innerHTML = '🎤 Test On-Device Mic';
        testMicBtn.className = 'btn btn--primary';
        if (testStatus) testStatus.textContent = 'Cancelled';
        return;
      }

      if (testResultCard) testResultCard.style.display = 'block';
      if (testStatus) testStatus.textContent = '🔴 Listening... Say "a", "b", "hello", or "water" into your mic';
      testMicBtn.innerHTML = '⏹️ Stop Testing';
      testMicBtn.className = 'btn btn--secondary';

      try {
        const res = await onDeviceSpeech.listen({
          targetWord: 'a',
          timeout: 6000,
        });

        testMicBtn.innerHTML = '🎤 Test On-Device Mic';
        testMicBtn.className = 'btn btn--primary';

        if (testStatus) {
          testStatus.innerHTML = `✅ Recognized: "<strong>${res.transcript}</strong>" (Confidence: ${Math.round(res.confidence * 100)}%)`;
        }
        if (testDetails) {
          testDetails.innerHTML = `
            <div>Acoustic Score: <strong>${Math.round(res.acousticScore * 100)}%</strong> | Articulatory Clarity: <strong>${Math.round(res.articulatoryScore * 100)}%</strong></div>
            <div style="margin-top: 4px;">Formants: F1=${res.formantMetrics?.f1}Hz, F2=${res.formantMetrics?.f2}Hz, F0=${res.formantMetrics?.f0}Hz, Duration=${res.formantMetrics?.durationMs}ms</div>
            <div style="margin-top: 2px; color: var(--dl-color-success);">🔒 100% On-Device / Local Execution</div>
          `;
        }
      } catch (err) {
        testMicBtn.innerHTML = '🎤 Test On-Device Mic';
        testMicBtn.className = 'btn btn--primary';
        if (testStatus) {
          testStatus.textContent = err.message === 'timeout'
            ? 'ℹ️ No speech detected — try speaking closer to your mic'
            : `⚠️ Error: ${err.message}`;
        }
      }
    });

    // --- Display settings ---
    this.contentEl.querySelector('#setting-font-size')?.addEventListener('change', async (e) => {
      const size = e.target.value;
      document.body.classList.remove('font-large', 'font-xlarge');
      if (size === 'large') document.body.classList.add('font-large');
      if (size === 'xlarge') document.body.classList.add('font-xlarge');
      await storage.setSetting('fontSize', size);
    });

    this.contentEl.querySelector('#setting-theme')?.addEventListener('change', async (e) => {
      const theme = e.target.value;
      document.documentElement.removeAttribute('data-theme');
      if (theme !== 'system') {
        document.documentElement.setAttribute('data-theme', theme);
      }
      await storage.setSetting('theme', theme);
    });

    this.contentEl.querySelector('#setting-sound')?.addEventListener('change', async (e) => {
      audioFeedback.setEnabled(e.target.checked);
      await storage.setSetting('soundEnabled', e.target.checked);
    });

    // Update & Refresh
    this.contentEl.querySelector('#setting-update-app')?.addEventListener('click', async () => {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let r of registrations) {
          await r.unregister();
        }
      }
      window.location.reload(true);
    });

    // Reset Progress
    this.contentEl.querySelector('#setting-reset')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset all progress? This cannot be undone.')) {
        await progress.resetAll();
        await this.renderSidebar();
        await this.renderSettings();
      }
    });
  }

  /** Render the step-by-step Self-Calibration Wizard view. */
  async renderCalibration() {
    if (this._currentWizard) {
      this._currentWizard.destroy();
    }
    this._currentWizard = new CalibrationWizard(this.contentEl);
    this._currentWizard.render();
  }

  /** Load saved settings and apply them. */
  async _loadSettings() {
    // Font size
    const fontSize = await storage.getSetting('fontSize');
    if (fontSize === 'large') document.body.classList.add('font-large');
    if (fontSize === 'xlarge') document.body.classList.add('font-xlarge');

    // Theme
    const theme = await storage.getSetting('theme');
    if (theme && theme !== 'system') {
      document.documentElement.setAttribute('data-theme', theme);
    }

    // Speech parameters — restore all saved values
    const rate = await storage.getSetting('speechRate');
    if (rate != null) speechSynthesis.setRate(rate);

    const pitch = await storage.getSetting('speechPitch');
    if (pitch != null) speechSynthesis.setPitch(pitch);

    const volume = await storage.getSetting('speechVolume');
    if (volume != null) speechSynthesis.setVolume(volume);

    const wordGap = await storage.getSetting('speechWordGap');
    if (wordGap != null) speechSynthesis.setWordGap(wordGap);

    const letterGap = await storage.getSetting('speechLetterGap');
    if (letterGap != null) speechSynthesis.setLetterGap(letterGap);

    const punctMult = await storage.getSetting('speechPunctMultiplier');
    if (punctMult != null) speechSynthesis.setPunctMultiplier(punctMult);

    const repeatCount = await storage.getSetting('speechRepeatCount');
    if (repeatCount != null) speechSynthesis.setRepeatCount(repeatCount);

    const repeatDelay = await storage.getSetting('speechRepeatDelay');
    if (repeatDelay != null) speechSynthesis.setRepeatDelay(repeatDelay);

    const cueTone = await storage.getSetting('speechCueTone');
    if (cueTone != null) speechSynthesis.setCueTone(cueTone);

    const voiceScope = await storage.getSetting('voiceScope');
    if (voiceScope != null) speechSynthesis.setVoiceScope(voiceScope);

    // Voice
    const voice = await storage.getSetting('voice');
    if (voice) speechSynthesis.setVoice(voice);

    // Sound effects & filters
    const sound = await storage.getSetting('soundEnabled');
    if (sound === false) audioFeedback.setEnabled(false);

    const sfxVol = await storage.getSetting('sfxVolume');
    if (sfxVol != null) audioFeedback.setVolume(sfxVol);

    const sfxPitch = await storage.getSetting('sfxPitch');
    if (sfxPitch != null) audioFeedback.setPitchShift(sfxPitch);

    const sfxFilter = await storage.getSetting('sfxFilterCutoff');
    if (sfxFilter != null) audioFeedback.setFilterCutoff(sfxFilter);
  }
}

// Boot the app
const app = new App();

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}

