/**
 * renderer.js — Thin entry point for the Knowledge Review Electron renderer process.
 *
 * All application logic has been extracted into modular files loaded via <script> tags
 * in index.html (in dependency order):
 *
 *   modules/kr-core.js      — Constants, utilities, sample data, normalization
 *   modules/kr-state.js     — State management, load/save, hydration
 *   modules/kr-cards.js     — Card CRUD, library, filtering, batch operations
 *   modules/kr-documents.js — Document tree, editor, knowledge home, LaTeX
 *   modules/kr-review.js    — Review sessions, FSRS, heatmaps, progress
 *   modules/kr-market.js    — Deck market, authentication, admin workspace
 *   modules/kr-profile.js   — Profile editing, avatar management
 *   modules/kr-settings.js  — Settings panels, FSRS config, update panel, init
 *   modules/kr-ui.js        — View switching, event binding, WebDAV, keydown
 *
 * Architecture: All modules share the browser's global scope (loaded via <script> tags
 * without type="module"). Functions and variables declared at the top level of each
 * module are accessible to all subsequently loaded modules.
 *
 * Load order matters: dependencies must be loaded before dependents.
 * See docs/renderer-modules.md for the full architecture guide.
 */

// Bootstrap: init() is defined in kr-settings.js (loaded before this script).
// It asynchronously loads state from IndexedDB/persistent/localStorage and renders the UI.
// We use a DOMContentLoaded wrapper so init runs after the DOM is fully parsed.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init());
} else {
  init();
}
