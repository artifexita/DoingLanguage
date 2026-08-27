/**
 * DoingLanguage — Main Application
 * Handles routing, service initialisation, sidebar rendering,
 * and view coordination.
 */

import { speechSynthesis } from './services/speech-synthesis.js';
import { speechRecognition } from './services/speech-recognition.js';
import { storage } from './services/storage.js';
import { progress } from './services/progress.js';
import { audioFeedback } from './services/audio-feedback.js';
import { CURRICULUM, getSubtier, getUnlockedSubtiers } from './engine/curriculum.js';
import { ExerciseEngine } from './engine/exercise-engine.js';
import { renderMultipleChoice } from './exercises/multiple-choice.js';
import { renderListenRepeat } from './exercises/listen-repeat.js';
import { renderMatchPairs } from './exercises/match-pairs.js';
import { renderSequenceOrder } from './exercises/sequence-order.js';

class App {
  constructor() {
    this.contentEl = null;
    this.sidebarEl = null;
    this.overlayEl = null;
    this._settingsCache = {};
  }

  async init() {
    // Initialise services
    await storage.init();
    await progress.init();
    await speechSynthesis.init();

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

    // Close mobile sidebar on navigation
    this.sidebarEl?.classList.remove('app__sidebar--open');
    this.overlayEl?.classList.remove('app__overlay--visible');

    if (hash === '#/dashboard' || hash === '#/') {
      await this.renderDashboard();
    } else if (hash === '#/settings') {
      await this.renderSettings();
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
    const voices = speechSynthesis.getEnglishVoices();
    const currentVoice = speechSynthesis.currentVoice;
    const currentRate = speechSynthesis.rate;
    const fontSize = await storage.getSetting('fontSize') || 'normal';
    const theme = await storage.getSetting('theme') || 'system';
    const soundEnabled = (await storage.getSetting('soundEnabled')) !== false;

    this.contentEl.innerHTML = `
      <div class="app__content view-enter">
        <h1 style="margin-bottom: var(--dl-space-6)">⚙️ Settings</h1>

        <div class="settings-group">
          <h3 class="settings-group__title">Speech</h3>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Voice</div>
              <div class="settings-field__description">Choose the voice for text-to-speech</div>
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

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Speech Speed</div>
              <div class="settings-field__description">
                <span id="rate-display">${currentRate.toFixed(1)}×</span> — slower is clearer
              </div>
            </div>
            <input type="range" id="setting-rate" min="0.5" max="1.5" step="0.1"
                   value="${currentRate}" aria-label="Speech rate">
          </div>

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Test Voice</div>
              <div class="settings-field__description">Hear the current voice settings</div>
            </div>
            <button class="btn btn--secondary" id="setting-test-voice">🔊 Test</button>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Display</h3>

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

          <div class="settings-field">
            <div>
              <div class="settings-field__label">Sound Effects</div>
              <div class="settings-field__description">Play sounds for correct/incorrect answers</div>
            </div>
            <label class="toggle">
              <input type="checkbox" id="setting-sound" ${soundEnabled ? 'checked' : ''}>
              <span class="toggle__track"></span>
              <span class="toggle__thumb"></span>
            </label>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Data</h3>
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

    // Event handlers
    this.contentEl.querySelector('#setting-voice').addEventListener('change', async (e) => {
      speechSynthesis.setVoice(e.target.value);
      await storage.setSetting('voice', e.target.value);
    });

    this.contentEl.querySelector('#setting-rate').addEventListener('input', async (e) => {
      const rate = parseFloat(e.target.value);
      speechSynthesis.setRate(rate);
      this.contentEl.querySelector('#rate-display').textContent = `${rate.toFixed(1)}×`;
      await storage.setSetting('speechRate', rate);
    });

    this.contentEl.querySelector('#setting-test-voice').addEventListener('click', () => {
      speechSynthesis.speak('Hello! This is how I sound. Ready to practise?');
    });

    this.contentEl.querySelector('#setting-font-size').addEventListener('change', async (e) => {
      const size = e.target.value;
      document.body.classList.remove('font-large', 'font-xlarge');
      if (size === 'large') document.body.classList.add('font-large');
      if (size === 'xlarge') document.body.classList.add('font-xlarge');
      await storage.setSetting('fontSize', size);
    });

    this.contentEl.querySelector('#setting-theme').addEventListener('change', async (e) => {
      const theme = e.target.value;
      document.documentElement.removeAttribute('data-theme');
      if (theme !== 'system') {
        document.documentElement.setAttribute('data-theme', theme);
      }
      await storage.setSetting('theme', theme);
    });

    this.contentEl.querySelector('#setting-sound').addEventListener('change', async (e) => {
      audioFeedback.setEnabled(e.target.checked);
      await storage.setSetting('soundEnabled', e.target.checked);
    });

    this.contentEl.querySelector('#setting-reset').addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset all progress? This cannot be undone.')) {
        await progress.resetAll();
        await this.renderSidebar();
        await this.renderSettings();
      }
    });
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

    // Speech rate
    const rate = await storage.getSetting('speechRate');
    if (rate) speechSynthesis.setRate(rate);

    // Voice
    const voice = await storage.getSetting('voice');
    if (voice) speechSynthesis.setVoice(voice);

    // Sound
    const sound = await storage.getSetting('soundEnabled');
    if (sound === false) audioFeedback.setEnabled(false);
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
