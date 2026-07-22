# Notion Card (knowledge-review-electron) - Feature Development Diary

> **Project**: Notion Card v0.1.8-modular -> v0.1.9-featured
> **Development period**: 2026-07-22
> **Branch**: main (10 commits since Phase 0)
> **Status**: All phases complete, syntax checks pass

---

## Phase 0 - Foundation (previously completed)

### Bug Fixes (8 items)

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | CRITICAL | .gitignore | Added .env exclusion to prevent secrets leak |
| 2 | CRITICAL | backend/src/server.ts | CORS null origin restricted to non-production |
| 3 | CRITICAL | src/main.js | market:saveCredentials IPC: safeStorage availability check |
| 4 | MEDIUM | backend/src/server.ts | Rate limiter cleanup setInterval (60s) for memory leak |
| 5 | MEDIUM | src/main.js | updateInstallStarted reset in try/catch for error recovery |
| 6 | MEDIUM | renderer.js | save() auto-trim retry with 5000 event cap |
| 7 | MEDIUM | renderer.js | loadMarketDecks/loadMarketCategories requestToken race protection |
| 8 | LOW | renderer.js | Admin decks null-safety fallback |

### 0-1: Renderer Modularization
- Original 3010-line renderer.js split into **10 modules** in src/modules/
- Architecture doc: docs/renderer-modules.md
- Key decision: Global scope sharing via script tags (no bundler)

### 0-2: localStorage to IndexedDB Migration
- New module: src/modules/idb-store.js (Promise-based adapter)
- Dual-write: IDB + localStorage for backward compatibility
- Auto-migration on first launch

---

## Phase 1 - Core Experience

### 1-3: Password Change UI
**Commit**: 6310e24
**Files changed**: src/index.html, src/modules/kr-settings.js, src/styles.css

- Added "Security" tab to settings navigation
- Created ensureAccountSecurityPanel() with form:
  - Current password field
  - New password field (min 8 chars validation)
  - Confirm password field
- Integrated with existing backend PATCH /api/v1/me/password
- Auto-clears credentials after successful password change
- MutationObserver for dynamic form state (login/logout detection)
- Panel refresh on navigation via setting() enhancement

### 1-4: Enhanced FSRS Learning Plan Settings
**Commit**: 7fab3b9
**Files changed**: src/modules/kr-settings.js, src/modules/kr-review.js, src/styles.css

- Redesigned settings panel with card-style layout per setting
- Added descriptive hints for each parameter
- **Interval preview with dates**: Shows actual calendar dates alongside interval durations
- **7-day forecast**: Visual bar chart showing predicted review load
  - Calculates due cards per day from current state
  - Color-coded: green (normal), yellow (over daily limit), red (overdue)
  - Summary: total weekly reviews + daily average
- Range labels: "Relaxed (80%)" to "Strict (99%)"

### 1-5: Deck Bookmarks/Favorites
**Commit**: 7ba167e
**Files changed**: 6 files (Prisma schema, backend, frontend)

**Backend**:
- New Prisma model: DeckFavorite (deckId + userId unique constraint)
- Endpoints: GET/POST/DELETE /api/v1/favorites/:deckId
- Audit logging for favorite actions

**Frontend**:
- Heart icon button on each deck card (absolute positioned, top-right)
- Toggle animation with fill color transition
- "My Favorites" filter option in category dropdown
- State persistence: favorites array in local state
- Syncs with backend when authenticated, falls back to local-only

### 1-6: Card Tag System Enhancement
**Commit**: cbee80e
**Files changed**: kr-core.js, kr-cards.js, kr-review.js, kr-settings.js, kr-state.js, styles.css

- **Colored tags**: 10-color palette with hash-based auto-assignment
- **Multi-tag display**: All tags shown in review view (was: only first tag)
- **Tag color management**: Settings panel with clickable color chips
  - Click to cycle through palette colors
  - Color preview with hex value
  - Persisted in state.settings.tagColors
- CSS custom property --tag-color for color-mix backgrounds
- Tag colors preserved across state hydration

### 1-7: Global Search
**Commit**: 280e603
**Files changed**: src/index.html, src/modules/kr-ui.js, src/styles.css

- **Trigger**: Ctrl+K / Cmd+K keyboard shortcut
- **Modal design**: Clean dialog with search icon, input, keyboard hints
- **Search scope**:
  - Documents: title and content
  - Cards: question text, tags, folder names
  - Market decks: title, author, description (only when authenticated)
- **Results**: Grouped by type, scored by relevance (title > tags > content)
- **Navigation**: Arrow keys + Enter, Escape to close
- **Actions**: Opens document/card in library view, scrolls to card

---

## Phase 2 - Growth/UGC (Security First)

### 2-8: Redis Shared Rate Limiting
**Commit**: 9aee127
**Files changed**: backend/package.json, backend/src/server.ts

- Added ioredis dependency
- **Graceful fallback**: Uses Redis when REDIS_URL is set, falls back to in-memory Map
- **Atomic operations**: INCR + PEXPIRE for race-condition-free counting
- **Response headers**: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
- All 5 rate-limited endpoints updated: login IP, login account, download, upload (2x)
- Redis disconnect on SIGTERM
- Configurable via environment variables

### 2-9: User Self-Registration
**Commit**: 8caf6ce
**Files changed**: backend/src/server.ts, src/index.html, src/modules/kr-market.js, src/modules/kr-ui.js, src/styles.css

**Backend**:
- POST /api/v1/auth/register endpoint
- Validation: username 3-80 chars (alphanumeric + hyphens/underscores), password 8-200 chars
- Server key required (same as login)
- Rate limited: 3 registrations per hour per IP
- Configurable via ALLOW_SELF_REGISTER env var (default: enabled)

**Frontend**:
- Toggle between login/register modes on market login form
- Submit button text changes: "Verify & Enter" / "Register & Enter"
- Password length validation on client side
- Same credential saving flow after registration

### 2-10: Deck Reviews and Ratings
**Commit**: 2d3b313
**Files changed**: backend/prisma/schema.prisma, backend/src/server.ts, src/modules/kr-market.js, src/styles.css

**Backend**:
- Prisma model: DeckReview (deckId + userId unique, rating 1-5, comment 2000 chars)
- GET /decks/:id/reviews: List reviews with user info + aggregate stats
- POST /decks/:id/reviews: Create/update review (cannot review own deck)
- DELETE /decks/:id/reviews: Remove review

**Frontend**:
- Reviews section in deck detail modal
- Star rating input (interactive buttons with hover scale)
- Comment textarea
- Review list: username, stars, date, comment
- Average rating and total count display
- Auto-refresh after submission

---

## Phase 3 - Scale/Operations

### 3-11: Audit Log Archival
**Commit**: 588c840
**Files changed**: backend/src/server.ts

- **90-day retention policy**: Configurable via AUDIT_RETENTION_DAYS
- **Automatic cleanup**: Runs on startup (30s delay) + every 24 hours
- **Admin endpoints**:
  - GET /api/v1/admin/audit-stats: Total, recent, and pending archival counts
  - POST /api/v1/admin/archive-audit: Manual trigger
- Interval cleanup on SIGTERM
- requireAdmin helper for admin-only route protection

### 3-12: Incremental Deck Updates
**Commit**: 588c840
**Files changed**: backend/src/server.ts

- **Change tracking hook**: onSend hook logs deck change events
  - Controlled by DECK_CHANGE_TRACKING env var
- **Changelog endpoint**: GET /api/v1/decks/:id/changelog
  - Returns published version history with card counts and changelogs
  - Authenticated access
- Foundation for future diff-based incremental updates

---

## Version Summary

| Phase | Feature | Commits | Files Changed |
|-------|---------|---------|---------------|
| 0 | Bug fixes + modularization + IDB migration | 1 | 20+ |
| 1-3 | Password change UI | 1 | 3 |
| 1-4 | FSRS settings enhancement | 1 | 3 |
| 1-5 | Deck favorites | 1 | 6 |
| 1-6 | Tag system enhancement | 1 | 6 |
| 1-7 | Global search | 1 | 3 |
| 2-8 | Redis rate limiting | 1 | 2 |
| 2-9 | User registration | 1 | 5 |
| 2-10 | Deck reviews | 1 | 3 |
| 3-11/12 | Audit archival + incremental updates | 1 | 1 |
| **Total** | | **10** | **~50** |

---

## Remaining Known Issues

1. **CRLF line endings**: All files use CRLF, may cause issues with some tools
2. **No bundler**: All modules share global scope, function name collisions possible
3. **Backend TypeScript**: Not included in npm run check (uses tsx watch for dev)
4. **Market auto-login**: Saved credentials auto-fill but don't auto-submit
5. **IndexedDB dual-write**: May cause data inconsistency if one write fails silently
6. **Review form**: No confirmation dialog before submitting review
7. **Tag color cycle**: Clicking cycles through all 10 colors; no custom color picker

---

## Feature Suggestions for Future Development

### High Priority

1. **Offline mode for market**: Cache deck listings locally for browsing without connection
2. **Deck import/export**: Standard Anki (.apkg) format support for interoperability
3. **Multi-device sync**: WebDAV improvements + optional peer-to-peer sync
4. **Dark mode**: CSS variable-based theme switching
5. **Keyboard shortcuts panel**: Show all available shortcuts in a help modal

### Medium Priority

6. **Spaced repetition statistics**: Detailed learning analytics dashboard
7. **Card templates**: Reusable card type templates for faster card creation
8. **Deck collaboration**: Share edit access with other users
9. **Mobile responsive**: Improve layout for tablet/small screen use
10. **Plugin system**: Allow third-party extensions via a plugin API

### Low Priority

11. **AI card generation**: Use LLM to generate flashcards from pasted text
12. **Voice input**: Speech-to-text for card question/answer creation
13. **Gamification**: Streaks, badges, and leaderboards for learning motivation
14. **Markdown preview toggle**: Split view for card editor
15. **Custom FSRS parameters**: Allow advanced users to tune algorithm weights

### Backend Infrastructure

16. **WebSocket support**: Real-time notifications for deck updates and reviews
17. **CDN integration**: Serve deck assets from CDN for faster downloads
18. **Metrics dashboard**: Prometheus/Grafana integration for monitoring
19. **Backup verification**: Automated restore testing from WebDAV backups
20. **API versioning**: Proper versioned API routes for backward compatibility


---

## Critical Bug Fix - 2026-07-22

### Bug: Application data loss / frozen UI (CRITICAL)
**Commit**: c0fe7fa
**Files changed**: src/modules/kr-review.js, src/renderer.js, package.json

**Root cause**: During Phase 0-1 modularization, document.addEventListener('DOMContentLoaded', init) was left in kr-review.js (line 409). However, init() is defined in kr-settings.js which loads AFTER kr-review.js in index.html. When the browser executed kr-review.js, the init identifier was not yet in the global scope, causing a ReferenceError: init is not defined. This:

1. Prevented the DOMContentLoaded listener from being registered
2. Stopped kr-review.js execution (functions after line 409 never defined)
3. Caused init() to never run - state was never loaded from IndexedDB
4. Left the UI without event bindings (app appeared frozen/unclickable)

**Fix**: 
- Removed stale ddEventListener from kr-review.js
- Added init() bootstrap to renderer.js (last loaded script) with eadyState check
- Extended 
pm run check to cover renderer.js, fsrs-adapter.js, and market-login-characters.js

**Data recovery**: No data was actually lost - it was a loading issue. IndexedDB, persistent storage, and localStorage all retain copies. After this fix, init() properly loads state from all sources with priority selection.


### Bug Fix v2: init() Robust Overhaul (d55dfa3)

**Problem**: Even after restoring the init() call in renderer.js, the app may still fail if any step inside init() throws an unhandled error. The original init() had zero try/catch protection.

**Fix**: Complete rewrite of init() with:
- 4-phase architecture: data loading -> data selection -> data application -> UI init
- Every step wrapped in independent try/catch
- Console.log diagnostics at each phase ([INIT] prefix)
- safeCall() wrapper for all UI panel setup functions
- bootstrap() wrapper in renderer.js with emergency render fallback

**Verification**: Electron state.json confirmed 1221 cards (3.2MB) intact. Data was never lost - only a loading/rendering issue.
