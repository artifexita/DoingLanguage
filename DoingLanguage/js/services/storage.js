/**
 * DoingLanguage — Storage Service
 * Lightweight IndexedDB wrapper for persisting progress, settings, and user data.
 */

const DB_NAME = 'DoingLanguageDB';
const DB_VERSION = 1;

const STORES = {
  PROGRESS: 'progress',     // Per-item progress records
  SETTINGS: 'settings',     // User preferences
  SESSIONS: 'sessions',     // Session history
};

class StorageService {
  constructor() {
    this._db = null;
    this._isSupported = 'indexedDB' in window;
  }

  /** Open the database and create stores if needed. */
  async init() {
    if (!this._isSupported) {
      console.warn('IndexedDB not supported. Progress will not be saved.');
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Progress store: keyed by composite key (tier.subtier.itemId)
        if (!db.objectStoreNames.contains(STORES.PROGRESS)) {
          const progressStore = db.createObjectStore(STORES.PROGRESS, { keyPath: 'id' });
          progressStore.createIndex('tier', 'tier', { unique: false });
          progressStore.createIndex('subtier', 'subtier', { unique: false });
          progressStore.createIndex('lastAttempted', 'lastAttempted', { unique: false });
        }

        // Settings store: simple key-value
        if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
          db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
        }

        // Sessions store: session history
        if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
          const sessionStore = db.createObjectStore(STORES.SESSIONS, {
            keyPath: 'id',
            autoIncrement: true,
          });
          sessionStore.createIndex('timestamp', 'timestamp', { unique: false });
          sessionStore.createIndex('tier', 'tier', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve();
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Get a single record by key from a store.
   * @param {string} storeName
   * @param {string} key
   * @returns {Promise<any>}
   */
  async get(storeName, key) {
    if (!this._db) return null;
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Put (upsert) a record in a store.
   * @param {string} storeName
   * @param {object} value
   * @returns {Promise<void>}
   */
  async put(storeName, value) {
    if (!this._db) return;
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all records from a store.
   * @param {string} storeName
   * @returns {Promise<any[]>}
   */
  async getAll(storeName) {
    if (!this._db) return [];
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all records from a store matching an index value.
   * @param {string} storeName
   * @param {string} indexName
   * @param {string} value
   * @returns {Promise<any[]>}
   */
  async getByIndex(storeName, indexName, value) {
    if (!this._db) return [];
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a record by key.
   * @param {string} storeName
   * @param {string} key
   * @returns {Promise<void>}
   */
  async delete(storeName, key) {
    if (!this._db) return;
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all records in a store.
   * @param {string} storeName
   * @returns {Promise<void>}
   */
  async clear(storeName) {
    if (!this._db) return;
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /** Get a setting value. */
  async getSetting(key) {
    const record = await this.get(STORES.SETTINGS, key);
    return record?.value ?? null;
  }

  /** Set a setting value. */
  async setSetting(key, value) {
    return this.put(STORES.SETTINGS, { key, value });
  }

  get isSupported() {
    return this._isSupported;
  }

  get STORES() {
    return STORES;
  }
}

// Singleton
export const storage = new StorageService();
export default storage;
