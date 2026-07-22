# Renderer Module Architecture

> **Version**: 0.1.8-modular  
> **Last updated**: 2026-07-22  
> **Source**: `src/renderer.js` (3010 lines) → 9 modules in `src/modules/`

## Overview

The monolithic `renderer.js` has been split into 9 purpose-driven modules that share the browser's global scope. Each module is loaded via a `<script>` tag in `index.html`, in strict dependency order. No bundler or module system is used — this preserves the original vanilla JS architecture.

## Module Dependency Graph

```
kr-core.js          (foundation — constants, utilities, normalization)
  ↓
kr-state.js         (state management — load, save, hydrate)
  ↓
kr-cards.js         (card CRUD, library, filtering, batch)
  ↓
kr-documents.js     (document tree, editor, LaTeX, lightbox)
  ↓
kr-review.js        (review sessions, FSRS, heatmaps, progress)
  ↓
kr-market.js        (deck market, auth, admin workspace)
  ↓
kr-profile.js       (profile editing, avatar)
  ↓
kr-settings.js      (settings panels, FSRS config, update panel, init)
  ↓
kr-ui.js            (view switching, event binding, WebDAV, keydown)
```

## Load Order (index.html)

```html
<script src="./vendor/katex.min.js"></script>
<script src="./vendor/ts-fsrs.js"></script>
<script src="./review/fsrs-adapter.js"></script>
<!-- Modules (dependency order) -->
<script src="./modules/kr-core.js"></script>
<script src="./modules/kr-state.js"></script>
<script src="./modules/kr-cards.js"></script>
<script src="./modules/kr-documents.js"></script>
<script src="./modules/kr-review.js"></script>
<script src="./modules/kr-market.js"></script>
<script src="./modules/kr-profile.js"></script>
<script src="./modules/kr-settings.js"></script>
<script src="./modules/kr-ui.js"></script>
<!-- Thin entry point -->
<script src="./renderer.js"></script>
<script src="./market-login-characters.js"></script>
```

## Module Details

### 1. kr-core.js (~250 lines)

**Purpose**: Foundation layer — constants, utility functions, sample data, normalization.

**Dependencies**: None (loaded first).

**Key exports** (global scope):
- `$`, `$$` — DOM query helpers
- `id(prefix)` — UUID-based ID generator
- `today()`, `dateKey(date)` — date utilities
- `esc(value)` — HTML entity escaping
- `formatDate(value)` — locale date formatting
- `normCard(card)` — normalize card data structure (calls `window.knowledgeFSRS.migrate`)
- `normDoc(doc)` — normalize document data structure
- `ensureCardOrder(cards)` — sequential ordering within groups
- `groupCards(folder)`, `cardPosition(card)` — card positioning
- `reviewCount(card)`, `reviewCountLabel(card)` — review count helpers
- `sortCardsForDisplay(cards)` — display sorting
- `reviewEventIsActive(event)` — check review event validity
- `reviewEventMatchesGroup(event, group)` — group filtering
- Constants: `KEY`, `OPTS`, `TRUE_FALSE_OPTS`, `CARD_TYPES`, `NOTE_RATINGS`, `DAY`
- Sample data: `sampleDocs`, `sampleFolders`, `sampleCards`, `base`

### 2. kr-state.js (~90 lines)

**Purpose**: State lifecycle — load from storage, save, hydrate, persistent save scheduling.

**Dependencies**: kr-core.js (normCard, normDoc, ensureCardOrder, base, sampleDocs, reviewEventIsActive)

**Key exports**:
- `hydrate(raw)` — reconstruct state from JSON string
- `load()` — load from localStorage
- `save()` — save to localStorage + schedule persistent save
- `saveLegacyLocalStorage()` — emergency save (for localStorage quota errors)
- `schedulePersistentSave(immediate)` — debounce persistent save via `reviewBridge`
- `storageSnapshot()` — JSON snapshot of state (excludes dataDirectory)
- `syncReviewLog()` — rebuild reviewLog from reviewEvents
- `activeDoc()` — get current active document
- `debounce(callback, delay)` — generic debounce utility

**Global variables set at load time**:
- `state` — the application state object (set via `let state = load()`)
- `webdavConfig`, `updateState`, `persistentSaveTimer`, `persistentSaveQueue`

### 3. kr-cards.js (~650 lines)

**Purpose**: Card CRUD, library rendering (masonry layout, virtual scroll), filtering, batch operations.

**Dependencies**: kr-core.js, kr-state.js

**Key exports**:
- `openCard(cardId)` — open card editor modal
- `saveCard(event)` — save card from editor form
- `renderCards(force)` — render card library with masonry layout
- `renderCardSummary()` — render summary statistics
- `cardMarkup(card)` — render single card HTML
- `cardMatches(card)` — filter matching logic
- `renderCardTypeFields()` — update editor form based on card type
- `renderAnswerChoices(selected)` — render answer options
- `cardTypeLabel(type)`, `cardOptionKeys(card)`, `cardMetadataMarkup(card)` — display helpers
- `changeCardOrder(cardId)`, `confirmCardOrderChange()` — reordering
- `renderTags()`, `renderGroupRail()` — sidebar navigation
- `quickCard()` — create card from editor selection
- `deleteCardGroup(group)`, `confirmDeleteCardGroup()` — group deletion
- `insertCardImage(targetId)` — image URL insertion
- `markdownUrl(value, fallback)` — URL validation
- `cardHtml(value)` — Markdown to card HTML
- `noteMarkdownHtml(value)` — Markdown to note HTML
- `masteryMeta(card)`, `masteryScore(card)`, `noteRatingBadge(card)` — mastery display
- `addMasonryCards(items, reset, startIndex)` — masonry layout engine
- `toggleBatchCardMode()` — batch card creation toggle

**Note**: This module intentionally contains both compressed (lines 1687-1709 of original) and expanded (lines 2834-2961) versions of `openCard`, `saveCard`, `renderCardTypeFields`, `renderAnswerChoices`, `cardMarkup`, and `cardMatches`. The expanded versions override the compressed ones at runtime, matching the original monolithic behavior.

### 4. kr-documents.js (~185 lines)

**Purpose**: Document tree rendering, editor operations, knowledge home, LaTeX rendering, image lightbox.

**Dependencies**: kr-core.js, kr-state.js, kr-cards.js (markdownToHtml, markdownInline, cardHtml, highlightHtml, highlightText)

**Key exports**:
- `renderTree()` — render document/folder tree in sidebar
- `renderKnowledgeHome()` — render document list view
- `saveDoc()`, `loadDoc()` — document content persistence
- `switchDoc(docId, force)` — switch active document
- `moveDoc(docId, folderId)` — move document between folders
- `duplicateTreeItem(type, targetId)` — duplicate document or folder
- `exportDocument(docId)` — export as Markdown/JSON
- `pinDocument(docId)` — toggle pin status
- `trashDoc(docId)`, `trashFolder(folderId)` — move to trash
- `openCreate(mode)`, `createItem(event)` — create new folder/document
- `openRename(mode, targetId)` — rename dialog
- `outline()` — document outline from headings
- `editorCommand(command, value)` — rich text editor commands
- `toggleQuoteBlock()`, `toggleGrayBlock()` — block formatting
- `focusEditorSelection()` — restore editor selection
- `renderLatexInHtml(html)` — KaTeX rendering
- `restoreLatexForStorage(html)` — preserve LaTeX source in storage
- `insertImage()` — image URL insertion
- `openImageLightbox(image)` — fullscreen image preview
- `handleEditorPaste(event)` — Markdown paste handling
- `handleEditorKeydown(event)` — keyboard shortcuts
- `sanitizeClipboardHtml(html)` — clipboard HTML cleanup
- `markdownInline(value, options)` — inline Markdown rendering
- `markdownToHtml(markdown, options)` — block Markdown to HTML conversion
- `highlightText(value, query)`, `highlightHtml(value, query)` — search highlighting

### 5. kr-review.js (~390 lines)

**Purpose**: Review session management, FSRS integration, heatmaps, progress tracking.

**Dependencies**: kr-core.js, kr-state.js, kr-cards.js (renderQuestion uses cardHtml)

**Key exports**:
- `buildQueue(force)` — build review queue based on FSRS schedule and settings
- `renderDock()` — render review card in the review dock
- `renderStandalone()` — render standalone review view
- `answerCard(card, selected, submit)` — process card answer
- `next()` — advance to next card in queue
- `retryCurrentReview()` — retry current card
- `finalizeMultiple(card)` — submit multiple-choice answer
- `recordReview(card, rating)` — record FSRS review with rating
- `flashcardReview(rating)` — note card rating handler
- `renderQuestion(box, card, standalone)` — render review question UI
- `renderQuestionOriginal(box, card, standalone)` — alternative question renderer
- `renderHeatmaps()` — render activity heatmaps
- `renderReviewPlanControls()` — render review plan settings
- `renderProgress()` — render progress ring and statistics
- `streak()` — calculate current review streak
- `toast(message)` — show toast notification
- `todayReviewEvents()` — get today's review events
- `totalReviews()` — total review count
- `isDue(card)` — check if card is due for review
- `reviewHistoryPopover` — review history popover
- `handleExternalLinkClick(event)` — open external links in browser
- `ensureUpdatePanel()` — render about/update panel

### 6. kr-market.js (~900 lines)

**Purpose**: Deck market browsing, authentication, admin workspace, deck upload/download.

**Dependencies**: kr-core.js, kr-state.js

**Key exports**:
- `marketApi(path, options)` — authenticated API client
- `marketDecksForDisplay()` — filtered/sorted deck list
- `loadMarketDecks()` — fetch decks from API
- `loadMarketCategories()` — fetch categories from API
- `renderMarket()` — render market grid view
- `showMarketWorkspace()` — switch to market view
- `handleMarketLogin(event)` — authentication handler
- `logoutMarket()` — clear session
- `renderMarketAccountMenu()` — account menu rendering
- `openMarketUpload(group, mode)` — upload dialog
- `marketPublish(deckId)` — publish deck to market
- `importMarketCards(deck, packageData)` — import downloaded deck
- `resolveMarketConflicts()` — handle import conflicts
- `marketDeckHasUpdate(deck)` — check for updates
- `checkMarketDeckUpdate(deckId, localVersion)` — check update availability
- `openAdminWorkspace()` — open admin panel
- `renderAdminWorkspace()` — render admin dashboard
- `bindAdminWorkspaceEvents()` — admin event handlers
- `adminPaginate(items, page)` — pagination helper
- `ensureServerSettingsPanel()` — server URL configuration panel

### 7. kr-profile.js (~50 lines)

**Purpose**: User profile editing, avatar management, deck action routing.

**Dependencies**: kr-core.js, kr-state.js, kr-market.js (openMarketUpload, marketPublish)

**Key exports**:
- `renderProfile()` — render profile view
- `profileData()` — get/create profile from state
- `profileGroups()` — get user's card groups
- `profileGroupCards(group)` — get cards in a group
- `profileDeckMeta(group)` — get deck metadata for a group
- `openProfileEditor()` — open profile edit modal
- `saveProfile(event)` — save profile changes
- `handleProfileAvatar(event)` — avatar upload handler
- `handleProfileDeckAction(event)` — deck action routing (edit/view/publish)

### 8. kr-settings.js (~160 lines)

**Purpose**: Settings panels, FSRS configuration, update management, data recovery.

**Dependencies**: kr-core.js, kr-state.js

**Key exports**:
- `init()` — async application initialization (loads persistent data, hydrates state)
- `cache()` — populate `els` object with DOM element references
- `ensureFSRSSettingsPanel()` — render FSRS settings UI
- `ensureStampSetting()` — render stamp toggle
- `ensureStoragePanel()` — render storage info panel
- `ensureUpdatePanel()` — render update/about panel
- `renderUpdateState()` — update UI based on update status
- `handleUpdateEvent(payload)` — process update events
- `bindUpdateEvents()` — bind update button handlers
- `view(name)` — switch main view (library, market, profile, settings, admin)
- `refresh()` — re-render all views
- `setting(name)` — switch settings tab
- `formatBytes(value)` — file size formatting
- `restoreLatexForStorage(html)` — LaTeX source preservation

### 9. kr-ui.js (~370 lines)

**Purpose**: Event binding, custom select menus, color palettes, WebDAV backup, keyboard shortcuts.

**Dependencies**: All other modules.

**Key exports**:
- `bind()` — bind all DOM event listeners
- `enhanceSelectsPortal()` — custom select dropdown rendering
- `syncCustomSelect(select)` — sync custom select with native select
- `ensureToolbarPalettes()` — color picker palettes for editor
- `closeToolbarPalettes(keep)` — close color pickers
- `positionSelectMenu(trigger, menu, select)` — dropdown positioning
- `closeSelectMenus(except)` — close open dropdowns
- `toggleBatchCardMode()` — batch card mode toggle
- `ensureStoragePanel()` — (called from init)
- WebDAV functions: `backupSnapshot()`, `pushWebDavState()`, `startWebDavPolling()`, `syncWebDavForm()`, `webdavFormPayload()`, `renderWebDavBackupHistory()`, `setWebDavEditing()`, `formatBackupTime()`

## Global State Variables

All global `let`/`const` variables are declared in **kr-core.js** (lines 101-170 of original). Key categories:

| Category | Variables | Module |
|----------|-----------|--------|
| State | `state` | kr-state.js |
| Review queue | `els`, `queue`, `queueKey`, `index`, `answered`, `answer`, `pendingReviewCardId`, `pendingCorrect`, `reviewDisposition`, `reviewDisplayCard`, `reviewSnapshot` | kr-core.js |
| Card UI | `selectedCardIds`, `batchCardMode`, `pendingCardOrder`, `cardPage`, `cardPageSize`, `cardSortDirection`, `cardWheelDrag`, `cardLoadedThrough`, `cardRenderTimer` | kr-core.js |
| Editor | `createMode`, `renameTargetId`, `actionTarget`, `trashTab` | kr-core.js |
| Market | `marketQuery`, `marketCategory`, `marketSort`, `marketSelectedDeck`, `marketToken`, `marketApiBase`, `marketUser`, `marketBusy`, `marketCapabilities`, `marketPage`, `marketPageSize`, `marketTotal`, `adminActiveTab`, `adminPage` | kr-core.js |
| Profile | `profileEditingDeckId` | kr-core.js |

## Key Architecture Patterns

### 1. Global Scope Sharing
All modules share the browser's global scope. Functions declared with `function` keyword and variables declared with `let`/`const` at the top level are accessible to all subsequently loaded modules. This is the same as the original monolithic architecture.

### 2. Function Override Pattern
kr-cards.js intentionally contains both compressed (single-line) and expanded (multi-line) versions of several functions. The expanded versions override the compressed ones when the script executes, matching the original behavior where later definitions win.

### 3. Deferred Execution
Function declarations are hoisted but not executed at parse time. Cross-module dependencies are resolved at call time, not definition time. This means a function in module A can reference a function in module B (loaded later) as long as it's only called after all modules have loaded.

### 4. State Initialization
`let state = load()` in kr-state.js runs immediately when the script loads. This triggers:
1. `load()` → `hydrate()` (uses kr-core.js functions)
2. `syncReviewLog()` (uses `reviewEventIsActive` from kr-core.js)
3. `ensureCardOrder()` (from kr-core.js)

## Adding New Modules

To add a new module:
1. Create `src/modules/kr-newmodule.js` with a header comment
2. Add `<script src="./modules/kr-newmodule.js"></script>` to index.html in the correct position
3. Update `package.json` `scripts.check` to include the new file
4. Update this document

## Validation

Run `npm run check` to validate all modules pass Node.js syntax checking:
```bash
npm run check
```

This runs `node --check` on all module files plus main.js and preload.js.
