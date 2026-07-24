/* ═══════════════════════════════════════════════
   kr-autopush.js — Auto-Push Card Operations
   Operations on market deck cards auto-trigger push.
   Cards are frozen during review. Auto-rollback on
   rejection. Auto-sync subscribed decks when online.
   ═══════════════════════════════════════════════ */

// --- Detection helpers ---

function getMarketDeckForFolder(folder) {
  const decks = state.market?.decks || {};
  for (const deckId of Object.keys(decks)) {
    if (decks[deckId].folder === folder) return { deckId, deck: decks[deckId] };
  }
  return null;
}

function isMarketDeckGroup(folder) {
  return Boolean(getMarketDeckForFolder(folder));
}

function isCardFrozen(card) {
  return card.pushStatus && (card.pushStatus.status === 'pushing' || card.pushStatus.status === 'pending');
}

// Refresh market deck list and re-render the grid + profile so card counts
// and deck metadata stay in sync after push operations.
function refreshMarketData() {
  if (!marketUnlocked || !marketToken) return;
  loadMarketDecks()
    .then(() => { renderMarket(); renderProfile(); })
    .catch(() => {});
}

// --- Auto-push orchestrator ---

async function autoPushCard(card, action, snapshot) {
  if (state.settings.localMode) return;
  if (!marketUnlocked || !marketToken) { toast('未登录牌组市场，此更改不会自动推送。'); return; }

  const deckInfo = getMarketDeckForFolder(card.folder);
  if (!deckInfo) return;
  const { deckId, deck } = deckInfo;

  if (isCardFrozen(card)) { toast('此卡片正在审核中，暂时无法操作。'); return; }

  const isExistingMarketCard = card.source && typeof card.source === 'object' && card.source.type === 'market';
  const remoteCardId = isExistingMarketCard ? card.source.remoteCardId : card.id;

  // Freeze the card immediately
  card.pushStatus = {
    status: 'pushing',
    action,
    contributionId: null,
    deckId,
    remoteCardId,
    pushedAt: new Date().toISOString(),
    reviewedAt: null,
    snapshot: snapshot || null,
  };
  save();
  refresh();

  try {
    const cardData = cleanCardForPush(card);
    // For MODIFY/DELETE, use remote card ID in cardData so the remote deck stays consistent
    if (isExistingMarketCard && action !== 'DELETE') cardData.id = remoteCardId;

    const contribution = await collabApi(
      `decks/${encodeURIComponent(deckId)}/card-contributions`,
      { method: 'POST', body: JSON.stringify({ action, cardId: remoteCardId, cardData }) }
    );

    card.pushStatus.contributionId = contribution.id;

    if (contribution.status === 'APPROVED') {
      // Owner auto-approve — immediate unfreeze
      card.pushStatus.status = 'approved';
      card.pushStatus.reviewedAt = contribution.reviewedAt || new Date().toISOString();

      // For ADD: set source so future edits are MODIFY
      if (action === 'ADD' && !isExistingMarketCard) {
        card.source = { type: 'market', deckId, version: deck.version, remoteCardId: card.id, remoteFingerprint: cardFingerprint(card, card.id) };
      }
      // For DELETE approved: remove the card from local state
      if (action === 'DELETE') {
        const idx = state.cards.findIndex((c) => c.id === card.id);
        if (idx >= 0) state.cards.splice(idx, 1);
      }
      toast('卡片更改已自动通过（牌组所有者）并合并。');
    } else {
      // Pending review
      card.pushStatus.status = 'pending';
      // For ADD: set source now so the card is linked
      if (action === 'ADD' && !isExistingMarketCard) {
        card.source = { type: 'market', deckId, version: deck.version, remoteCardId: card.id, remoteFingerprint: cardFingerprint(card, card.id) };
      }
      toast('卡片更改已提交审核，审核通过后自动合并到牌组。');
    }
    save();
    refresh();
    // Refresh market deck list and re-render grid so card counts stay in sync
    refreshMarketData();
    // Schedule a delayed sync of subscribed decks — the backend's mergeCardIntoDeck
    // modifies the package in place without bumping the version, so subscribers
    // need a re-sync to detect sha256 / card-count changes.
    setTimeout(() => {
      marketUpdateCache.clear();
      syncSubscribedDecks().catch(() => {});
    }, 3000);
  } catch (err) {
    const errMsg = err.message || '推送失败';
    // If the deck doesn't exist or isn't published on the server, clean up
    // the stale subscription and unfreeze the card — no point retrying.
    if (/deck not found|only published/i.test(errMsg)) {
      const decks = state.market?.decks || {};
      delete decks[deckId];
      state.market = { ...(state.market || {}), decks };
      card.pushStatus = null;
      save();
      refresh();
      toast('牌组在服务器上不存在，已取消订阅。卡片仍保留在本地，可正常编辑。');
      return;
    }
    // Card not found in the published deck — the deck was updated and this card was removed
    if (/not found in (this |the )deck/i.test(errMsg)) {
      if (action === 'DELETE') {
        const idx = state.cards.findIndex((c) => c.id === card.id);
        if (idx >= 0) state.cards.splice(idx, 1);
        card.pushStatus = null;
        save();
        refresh();
        toast('卡片在服务器牌组中已不存在，已从本地移除。');
        return;
      }
      if (action === 'MODIFY') {
        card.source = '';
        card.pushStatus = null;
        save();
        refresh();
        toast('卡片在服务器牌组中已不存在，已转为本地卡片。');
        return;
      }
    }
    // Duplicate pending contribution — user already has a pending push for this card
    if (/pending contribution/i.test(errMsg)) {
      card.pushStatus = { status: 'pending', action, contributionId: null, deckId, remoteCardId, pushedAt: new Date().toISOString(), reviewedAt: null, snapshot: snapshot || null };
      save();
      refresh();
      toast('此卡片已有待审核的推送，请等待审核完成后再操作。');
      return;
    }
    card.pushStatus.status = 'failed';
    card.pushStatus.error = errMsg;
    save();
    refresh();
    toast(`自动推送失败：${errMsg}。可切换本地模式编辑，或稍后重试。`);
  }
}

// --- Retry failed pushes ---

async function retryFailedPushes() {
  if (!marketUnlocked || !marketToken || !navigator.onLine) return;
  const failed = state.cards.filter((c) => c.pushStatus?.status === 'failed' && c.pushStatus?.deckId);
  for (const card of failed) {
    const action = card.pushStatus.action || 'MODIFY';
    const snapshot = card.pushStatus.snapshot;
    card.pushStatus = null;
    await autoPushCard(card, action, snapshot);
  }
}

// --- Retry a single card's failed push (called from UI) ---

async function retryCardPush(cardId) {
  if (!marketUnlocked || !marketToken) { toast('请先登录牌组市场。'); return; }
  const card = state.cards.find((c) => c.id === cardId);
  if (!card || !card.pushStatus || card.pushStatus.status !== 'failed') return;
  const action = card.pushStatus.action || 'MODIFY';
  const snapshot = card.pushStatus.snapshot;
  card.pushStatus = null;
  save();
  refresh();
  await autoPushCard(card, action, snapshot);
}

// --- Clear a card's push status (convert to local) ---

function clearCardPush(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card || !card.pushStatus) return;
  const wasAdd = card.pushStatus.action === 'ADD';
  card.pushStatus = null;
  // If the failed push was ADD, the card was never on the server — reset source to local
  if (wasAdd && card.source && typeof card.source === 'object') {
    card.source = '';
  }
  save();
  refresh();
  toast('已切换为本地卡片，不再自动推送。');
}

// --- Auto-rollback on rejection ---

function rollbackCard(card) {
  const ps = card.pushStatus;
  if (!ps) return;
  const { action, snapshot } = ps;

  if (action === 'ADD') {
    const idx = state.cards.findIndex((c) => c.id === card.id);
    if (idx >= 0) state.cards.splice(idx, 1);
  } else if (action === 'MODIFY' && snapshot) {
    const idx = state.cards.findIndex((c) => c.id === card.id);
    if (idx >= 0) {
      state.cards[idx] = { ...state.cards[idx], ...snapshot, pushStatus: null };
    }
  } else if (action === 'DELETE') {
    // Card was never actually removed — just unfreeze
    card.pushStatus = null;
  }
}

// --- Contribution status polling ---

let contributionPollTimer = null;
const POLL_INTERVAL = 60000;

async function pollContributionStatus() {
  if (!marketUnlocked || !marketToken || !navigator.onLine) return;
  const pendingCards = state.cards.filter((c) => c.pushStatus?.status === 'pending' && c.pushStatus?.contributionId);
  if (!pendingCards.length) return;

  let contributions = [];
  try {
    contributions = await collabApi('my-contributions');
  } catch (err) {
    return;
  }

  const byId = new Map(contributions.map((c) => [c.id, c]));
  let changed = false;

  for (const card of pendingCards) {
    const cc = byId.get(card.pushStatus.contributionId);
    if (!cc || cc.status === 'PENDING') continue;

    if (cc.status === 'APPROVED') {
      card.pushStatus.status = 'approved';
      card.pushStatus.reviewedAt = cc.reviewedAt || new Date().toISOString();
      if (card.pushStatus.action === 'DELETE') {
        const idx = state.cards.findIndex((c) => c.id === card.id);
        if (idx >= 0) state.cards.splice(idx, 1);
      }
      changed = true;
      toast(`卡片"${(card.question || card.noteContent || '').slice(0, 20)}"的更改已审核通过。`);
    } else if (cc.status === 'REJECTED') {
      rollbackCard(card);
      changed = true;
      toast(`卡片"${(card.question || card.noteContent || '').slice(0, 20)}"的更改被拒绝，已自动回滚。`);
    }
  }

  if (changed) {
    save();
    refresh();
    refreshMarketData();
    syncSubscribedDecks();
  }
}

// --- Auto-sync subscribed decks ---

let deckSyncTimer = null;
const SYNC_INTERVAL = 5 * 60 * 1000;

async function syncSubscribedDecks() {
  if (!marketUnlocked || !marketToken || !navigator.onLine) return;
  const decks = state.market?.decks || {};
  if (Object.keys(decks).length === 0) return;

  // Load fresh deck metadata if any subscribed deck lacks a stored sha256,
  // so we can fall back to card-count comparison for those decks.
  const needsDeckList = Object.values(decks).some((d) => !d.remoteSha256);
  if (needsDeckList) {
    try { await loadMarketDecks(); } catch { /* non-fatal */ }
  }

  let changed = false;
  for (const deckId of Object.keys(decks)) {
    const local = decks[deckId];
    const localVersion = Number(local.version || 0);
    try {
      const update = await checkMarketDeckUpdate(deckId, localVersion);
      if (!update) continue;

      const hasVersionUpdate = update.hasUpdate;
      const hasShaChange = local.remoteSha256 && update.sha256 && local.remoteSha256 !== update.sha256;

      // Fallback: when no sha256 is stored yet, compare card counts.
      let hasCardCountMismatch = false;
      if (!local.remoteSha256 && !hasVersionUpdate) {
        const localCardCount = localMarketCards(deckId).length;
        const remoteDeck = marketDecks.find((d) => d.id === deckId);
        if (remoteDeck && Number(remoteDeck.cards) !== localCardCount) {
          hasCardCountMismatch = true;
        }
      }

      if (!hasVersionUpdate && !hasShaChange && !hasCardCountMismatch) {
        // Store sha256 for future comparisons even if no download is needed.
        if (update.sha256 && !local.remoteSha256) {
          local.remoteSha256 = update.sha256;
          save();
        }
        continue;
      }

      const result = await window.reviewBridge.market.downloadDeck({
        baseUrl: marketApiBase,
        token: marketToken,
        deckId,
        version: update.version || localVersion,
      });
      if (result?.ok) {
        importMarketCards({ id: deckId, title: local.title || local.name || '市场牌组' }, result, local.folder);
        // Store sha256 after importMarketCards (which overwrites the deck entry).
        if (update.sha256) {
          state.market.decks[deckId].remoteSha256 = update.sha256;
          save();
        }
        toast(`牌组"${local.title || local.name || deckId}"已更新到最新版本。`);
        changed = true;
      }
    } catch (err) {
      // If the deck no longer exists on the server (404), clean up the stale subscription
      if (/not found|404|notfound/i.test(err.message || '')) {
        // Re-read current decks — importMarketCards may have replaced state.market.decks
        const freshDecks = state.market?.decks || {};
        delete freshDecks[deckId];
        state.market = { ...(state.market || {}), decks: freshDecks };
        save();
        refresh();
        changed = true;
      }
      // Silent — will retry on next sync cycle for other errors
    }
  }
  if (changed) refreshMarketData();
}

// --- Migrate old "市场 ·" folder prefix to "订阅 ·" ---

function migrateMarketDeckFolders() {
  const decks = state.market?.decks || {};
  let changed = false;
  for (const deckId of Object.keys(decks)) {
    const deck = decks[deckId];
    if (deck.folder && deck.folder.startsWith('市场 · ')) {
      const newFolder = deck.folder.replace(/^市场 · /, '订阅 · ');
      state.cards.forEach((card) => { if (card.folder === deck.folder) card.folder = newFolder; });
      const idx = (state.groups || []).indexOf(deck.folder);
      if (idx >= 0) state.groups[idx] = newFolder;
      deck.folder = newFolder;
      changed = true;
    }
  }
  if (changed) save();
}

// --- Timer and event setup ---

function startAutoPushTimers() {
  migrateMarketDeckFolders();
  if (contributionPollTimer) clearInterval(contributionPollTimer);
  if (deckSyncTimer) clearInterval(deckSyncTimer);
  contributionPollTimer = setInterval(pollContributionStatus, POLL_INTERVAL);
  deckSyncTimer = setInterval(syncSubscribedDecks, SYNC_INTERVAL);

  window.addEventListener('online', () => {
    retryFailedPushes();
    pollContributionStatus();
    syncSubscribedDecks();
  });
}
