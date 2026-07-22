/**
 * kr-documents.js - Document tree, editor, knowledge home, LaTeX, lightbox
 * Dependencies: kr-core.js, kr-state.js, kr-cards.js (markdownToHtml, cardHtml)
 * Provides: saveDoc, loadDoc, renderKnowledgeHome, renderTree, switchDoc,
 *           duplicateTreeItem, exportDocument, trashDoc, outline, editorCommand,
 *           renderLatexInHtml, openImageLightbox, insertImage, handleEditorPaste
 */
function saveDoc() { const doc = activeDoc(); if (!doc) return; doc.html = restoreLatexForStorage(els.noteEditor.innerHTML); doc.updatedAt = new Date().toISOString(); save(); }
function loadDoc() { const doc = activeDoc(); const source = doc?.html || '<h1>未命名文档</h1><p>开始记录你的知识。</p>'; els.noteEditor.innerHTML = /(^|\n)#{1,6}\s|(^|\n)[-*+]\s/.test(source) ? markdownToHtml(source) : renderLatexInHtml(source); els.noteEditor.scrollTop = 0; outline(); updateEditorWordCount(); }
function updateEditorWordCount() { const text = String(els.noteEditor?.innerText || '').replace(/\s/g, ''); $('#editorWordCount').textContent = `${text.length}字`; }
function openKnowledgeHome() { saveDoc(); libraryMode = 'home'; document.querySelector('.document-workbench').classList.add('home-mode'); $('#knowledgeHomeNav').classList.add('active'); $('#knowledgeAddButton').setAttribute('aria-expanded', 'false'); closeKnowledgeAddMenu(); renderKnowledgeHome(); renderTree(); }
function openDocumentEditor(docId = state.activeDocId) { if (docId) switchDoc(docId, true); libraryMode = 'editor'; document.querySelector('.document-workbench').classList.remove('home-mode'); $('#knowledgeHomeNav').classList.remove('active'); loadDoc(); renderTree(); }
function toggleKnowledgeAddMenu(event) { event.stopPropagation(); const menu = $('#knowledgeAddMenu'); const button = $('#knowledgeAddButton'); const open = !menu.classList.contains('open'); closeKnowledgeAddMenu(); if (!open) return; const rect = button.getBoundingClientRect(); menu.style.position = 'fixed'; menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`; menu.style.top = `${rect.bottom + 8}px`; menu.classList.add('open'); button.setAttribute('aria-expanded', 'true'); }
function closeKnowledgeAddMenu() { const menu = $('#knowledgeAddMenu'); menu?.classList.remove('open'); $('#knowledgeAddButton')?.setAttribute('aria-expanded', 'false'); }
function documentMatches(doc) { return !documentQuery || [doc.title, state.folders.find((folder) => folder.id === doc.folderId)?.name || ''].join(' ').toLowerCase().includes(documentQuery); }
function highlightText(value, query) { const safe = esc(value); const term = String(query || '').trim(); if (!term) return safe; const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return safe.replace(new RegExp(pattern, 'ig'), (match) => `<mark class="search-highlight">${match}</mark>`); }
function highlightHtml(value, query) { const term = String(query || '').trim(); if (!term) return value; const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return String(value).split(/(<[^>]+>)/g).map((part) => part.startsWith('<') ? part : part.replace(new RegExp(pattern, 'ig'), (match) => `<mark class="search-highlight">${match}</mark>`)).join(''); }
function documentUpdatedAt(doc) { return new Date(doc.updatedAt || doc.createdAt || 0); }
function formatDocumentUpdatedAt(doc) { const value = documentUpdatedAt(doc); if (Number.isNaN(value.getTime())) return '未记录时间'; const now = new Date(); const sameDay = value.toDateString() === now.toDateString(); if (sameDay) return `今天 ${value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`; const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); if (value.toDateString() === yesterday.toDateString()) return `昨天 ${value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`; return value.getFullYear() === now.getFullYear() ? value.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : value.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
function renderKnowledgeHome() { const list = $('#knowledgeDocumentList'); if (!list) return; const docs = state.documents.filter(documentMatches).sort((a, b) => documentUpdatedAt(b) - documentUpdatedAt(a)); $('#knowledgeDocumentCount').textContent = state.documents.length; list.innerHTML = docs.length ? docs.map((doc) => `<button type="button" class="knowledge-document-row" data-knowledge-doc="${esc(doc.id)}"><span class="knowledge-document-name">${highlightText(doc.title, documentQuery)}</span><span class="knowledge-document-line" aria-hidden="true"></span><time>${formatDocumentUpdatedAt(doc)}</time></button>`).join('') : '<div class="knowledge-empty-result">没有找到匹配的文章</div>'; list.querySelectorAll('[data-knowledge-doc]').forEach((button) => button.addEventListener('click', () => openDocumentEditor(button.dataset.knowledgeDoc))); }
function toggleOutline() { const grid = document.querySelector('.doc-body-grid'); const pane = $('#outlinePane'); const button = $('#toggleOutlineButton'); const collapsed = grid.classList.toggle('outline-collapsed'); pane.classList.toggle('is-collapsed', collapsed); button.classList.toggle('active', collapsed); button.title = collapsed ? '展开大纲' : '收起大纲'; }
function toggleReview() { const grid = document.querySelector('.doc-body-grid'); const dock = $('#reviewDock'); const button = $('#toggleReviewButton'); const collapsed = grid.classList.toggle('review-collapsed'); dock.classList.toggle('is-collapsed', collapsed); button.classList.toggle('active', collapsed); button.title = collapsed ? '展开复习栏' : '收起复习栏'; }
function editorCommand(command, value) { focusEditorSelection(); if (command === 'formatBlock') { if (value === 'blockquote') toggleQuoteBlock(); else document.execCommand('formatBlock', false, `<${value}>`); } else if (command === 'createLink') { const url = prompt('链接地址', 'https://'); if (!url) return; document.execCommand('createLink', false, url); } else if (command === 'fontSize') { document.execCommand('fontSize', false, '7'); els.noteEditor.querySelectorAll('font[size="7"]').forEach((node) => { const span = document.createElement('span'); span.style.fontSize = `${value}px`; span.innerHTML = node.innerHTML; node.replaceWith(span); }); } else if (command === 'grayBlock') { toggleGrayBlock(); } else if (command === 'hiliteColor' && value === 'transparent') { document.execCommand('removeFormat', false, null); } else if (command === 'clearFormat') { document.execCommand('removeFormat', false, null); document.execCommand('formatBlock', false, '<p>'); } else document.execCommand(command, false, value || null); els.noteEditor.focus(); saveDoc(); outline(); }
function toggleQuoteBlock() { const selection = window.getSelection(); const node = selection?.anchorNode?.nodeType === 1 ? selection.anchorNode : selection?.anchorNode?.parentElement; const quote = node?.closest?.('.editor-quote'); if (quote && els.noteEditor.contains(quote)) { const paragraph = document.createElement('p'); paragraph.innerHTML = quote.innerHTML; quote.replaceWith(paragraph); return; } const source = node?.closest?.('p,h1,h2,h3,h4,h5,h6,li'); if (!source || !els.noteEditor.contains(source)) return; const block = document.createElement('div'); block.className = 'editor-quote'; block.innerHTML = source.innerHTML || '<br>'; source.replaceWith(block); const range = document.createRange(); range.selectNodeContents(block); range.collapse(false); selection?.removeAllRanges(); selection?.addRange(range); }
function focusEditorSelection() { els.noteEditor.focus(); if (savedSelection) { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(savedSelection); } }
let savedSelection = null;
function outline() { const headings = [...els.noteEditor.querySelectorAll('h1,h2,h3,h4,h5,h6')]; els.outlineList.innerHTML = headings.map((heading, i) => { heading.id = `heading-${i}`; return `<button class="${heading.tagName.toLowerCase()}" title="${esc(heading.textContent || '未命名')}" data-heading="${heading.id}">${esc(heading.textContent || '未命名')}</button>`; }).join(''); els.outlineList.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { const heading = document.getElementById(button.dataset.heading); const paper = document.querySelector('.paper'); if (!heading || !paper) return; paper.scrollTo({ top: Math.max(0, heading.offsetTop - 28), behavior: 'smooth' }); })); const doc = activeDoc(); const folder = state.folders.find((item) => item.id === doc?.folderId); $('#docCrumbFolder').textContent = folder?.name || '未分组'; $('#docCrumbTitle').textContent = doc?.title || '未命名文档'; }
function markdownImageMarkup(url, alt = '图片') {
  const safeUrl = markdownUrl(url, '');
  if (!safeUrl) return esc(url);
  return `<img src="${safeUrl}" alt="${esc(alt || '图片')}" loading="lazy" referrerpolicy="no-referrer">`;
}
function latexMarkup(value, display = false) {
  const source = String(value || '').trim();
  if (!source) return '';
  if (!window.katex) return esc(display ? `\\[${source}\\]` : `$${source}$`);
  try {
    const rendered = window.katex.renderToString(source, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' });
    return `<span data-latex-source="${esc(source)}" data-latex-display="${display}">${rendered}</span>`;
  } catch {
    return `<span class="latex-error">${esc(display ? `\\[${source}\\]` : `$${source}$`)}</span>`;
  }
}
function markdownInline(value, options = {}) {
  const tokens = [];
  const token = (html) => {
    const marker = `\uE000${tokens.length}\uE001`;
    tokens.push(html);
    return marker;
  };
  let source = String(value ?? '');

  // Protect TeX before escaping Markdown so fractions, text commands, and display equations render safely.
  source = source.replace(/\\?\$\$([\s\S]*?)\\?\$\$/g, (_, formula) => token(latexMarkup(formula, true)));
  source = source.replace(/\\\[([\s\S]*?)\\\]/g, (_, formula) => token(latexMarkup(formula, true)));
  source = source.replace(/\\\(([\s\S]*?)\\\)/g, (_, formula) => token(latexMarkup(formula)));
  source = source.replace(/\\?\$([^$\n]+?)\$/g, (_, formula) => token(latexMarkup(formula)));

  // Reserve images and links before escaping so ampersands in query strings are not double-escaped.
  source = source.replace(/!\[([^\]]*)\]\(\s*<?([^)>\s]+)>?\s*\)/g, (_, alt, url) => token(markdownImageMarkup(url, alt)));
  source = source.replace(/\[([^\]]+)\]\(\s*<?([^)>\s]+)>?\s*\)/g, (_, label, url) => {
    const safeUrl = markdownUrl(url, '#');
    return token(`<a href="${safeUrl}" target="_blank" rel="noreferrer">${esc(label)}</a>`);
  });

  // Some imported cards contain the image URL without Markdown image syntax.
  source = source.replace(/https?:\/\/[^\s<>"'`]*\.(?:png|jpe?g|gif|webp|svg|avif)(?:\?[^\s<>"'`#]*)?(?:#[^\s<>"'`]*)?(?=$|[\s)\]},.!?;:'"])/gi, (url) => token(markdownImageMarkup(url)));
  source = source.replace(/https?:\/\/[^\s<>"'`]+/gi, (url) => {
    const safeUrl = markdownUrl(url.replace(/[.,!?;:'\"\]})]+$/g, ''), '#');
    return safeUrl === '#' ? esc(url) : token(`<a href="${safeUrl}" target="_blank" rel="noreferrer">${esc(url)}</a>`);
  });

  let html = esc(source)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
  tokens.forEach((value, index) => {
    html = html.replace(`\uE000${index}\uE001`, value);
  });
  return options.noteEntries ? html.replace(/\[([^\]]+)\]/g, '<span class="note-link-hint">[$1]</span>') : html;
}
function markdownToHtml(markdown, options = {}) { const lines = String(markdown || '').replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').split('\n'); const out = []; let list = null; let inCode = false; let codeLines = []; const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } }; const closeCode = () => { if (inCode) { out.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`); codeLines = []; inCode = false; } }; const escapeHtml = (value) => markdownInline(value, options); lines.forEach((line) => { const value = line.replace(/\t/g, '  ').trimEnd(); if (/^\s*```/.test(value)) { closeList(); if (inCode) closeCode(); else inCode = true; return; } if (inCode) { codeLines.push(value); return; } if (!value.trim()) { closeList(); return; } let match = value.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/); if (match) { closeList(); const level = Number(match[1].length); out.push(`<h${level}>${escapeHtml(match[2])}</h${level}>`); return; } if (options.noteEntries && (match = value.match(/^\s*(专题|真题|例句)\s*(.*)$/))) { closeList(); const label = match[1]; const labelClass = label === '专题' ? 'topic' : label === '真题' ? 'question' : 'example'; out.push(`<p class="note-entry"><span class="note-entry-label ${labelClass}">${label}</span><span class="note-entry-body">${escapeHtml(match[2])}</span></p>`); return; } match = value.match(/^\s*([-*+])\s+(.+)$/); if (match) { if (list !== 'ul') { closeList(); list = 'ul'; out.push('<ul>'); } out.push(`<li>${escapeHtml(match[2])}</li>`); return; } match = value.match(/^\s*(\d+)[.)]\s+(.+)$/); if (match) { if (list !== 'ol') { closeList(); list = 'ol'; out.push('<ol>'); } out.push(`<li>${escapeHtml(match[2])}</li>`); return; } if (/^\s*>/.test(value)) { closeList(); out.push(`<blockquote>${escapeHtml(value.replace(/^\s*>\s?/, ''))}</blockquote>`); return; } if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(value)) { closeList(); out.push('<hr>'); return; } closeList(); out.push(`<p>${escapeHtml(value)}</p>`); }); closeList(); closeCode(); return out.join(''); }
function sanitizeClipboardHtml(html) { const doc = new DOMParser().parseFromString(html, 'text/html'); doc.querySelectorAll('script,style,meta,link,iframe,object,form').forEach((node) => node.remove()); doc.querySelectorAll('*').forEach((node) => { [...node.attributes].forEach((attribute) => { if (attribute.name.toLowerCase().startsWith('on')) node.removeAttribute(attribute.name); if (attribute.name === 'href' && !/^(https?:|mailto:|#)/i.test(attribute.value)) node.removeAttribute(attribute.name); if (attribute.name === 'src' && !/^(https?:|data:image\/)/i.test(attribute.value)) node.removeAttribute(attribute.name); }); }); return doc.body.innerHTML; }
function handleEditorPaste(event) { const clipboard = event.clipboardData; const markdown = clipboard?.getData('text/markdown') || ''; const plain = clipboard?.getData('text/plain') || ''; const html = clipboard?.getData('text/html') || ''; const source = markdown.trim() || plain.trim(); if (!source && !html.trim()) return; const hasStructuredHtml = /<(h[1-6]|ul|ol|blockquote|pre|table|img|a)\b/i.test(html); const looksLikeMarkdown = /(^|\n)\s*#{1,6}\s+|(^|\n)\s*[-*+]\s+|(^|\n)\s*\d+[.)]\s+|\*\*[^*]+\*\*|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)/.test(source); if (!hasStructuredHtml && !looksLikeMarkdown) return; event.preventDefault(); focusEditorSelection(); document.execCommand('insertHTML', false, hasStructuredHtml ? sanitizeClipboardHtml(html) : markdownToHtml(source)); saveDoc(); outline(); }
function toggleGrayBlock() { const selection = window.getSelection(); const node = selection?.anchorNode?.nodeType === 1 ? selection.anchorNode : selection?.anchorNode?.parentElement; const block = node?.closest?.('.gray-block'); if (block && els.noteEditor.contains(block)) { const paragraph = document.createElement('p'); paragraph.innerHTML = block.innerHTML; block.replaceWith(paragraph); return; } const source = node?.closest?.('p,h1,h2,h3,h4,h5,h6,blockquote,li'); if (!source || !els.noteEditor.contains(source)) return; const gray = document.createElement('div'); gray.className = 'gray-block'; gray.innerHTML = source.innerHTML || '<br>'; source.replaceWith(gray); const range = document.createRange(); range.selectNodeContents(gray); range.collapse(false); selection?.removeAllRanges(); selection?.addRange(range); }
function handleEditorKeydown(event) { const anchor = window.getSelection()?.anchorNode; const node = anchor?.nodeType === 1 ? anchor : anchor?.parentElement; const block = node?.closest?.('.gray-block'); if (block && els.noteEditor.contains(block) && event.key === 'Enter') { event.preventDefault(); const br = document.createElement('br'); const range = window.getSelection().getRangeAt(0); range.deleteContents(); range.insertNode(br); range.setStartAfter(br); range.collapse(true); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); saveDoc(); outline(); } }
function handleEditorClick(event) { const link = event.target.closest('a'); if (!link || !els.noteEditor.contains(link)) return; event.preventDefault(); const url = link.href; if (url && /^https?:/i.test(url)) window.reviewBridge.openExternal(url); }
function openImageLightbox(image) {
  let dialog = $('#imageLightbox');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'imageLightbox';
    dialog.className = 'image-lightbox';
    dialog.innerHTML = '<form method="dialog"><button type="submit" class="image-lightbox-close" aria-label="关闭图片预览">×</button></form><img alt="" />';
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    document.body.appendChild(dialog);
  }
  const preview = dialog.querySelector('img');
  preview.src = image.currentSrc || image.src;
  preview.alt = image.alt || '图片预览';
  if (!dialog.open) dialog.showModal();
}
function handleImagePreviewClick(event) {
  const image = event.target.closest?.('img');
  if (!image || image.closest('#imageLightbox')) return;
  const scope = image.closest('.editor, .question-title, .option-button, .explanation, .note-answer-content, .card-note-preview, .market-detail-body');
  if (!scope) return;
  event.preventDefault();
  event.stopPropagation();
  openImageLightbox(image);
}
function insertImage() { const url = prompt('图片地址', 'https://'); if (!url) return; const caption = prompt('图片注释（可选）', ''); focusEditorSelection(); document.execCommand('insertHTML', false, `<figure class="editor-image"><img src="${esc(url)}" alt="插入图片"><figcaption contenteditable="true">${esc(caption)}</figcaption></figure><p><br></p>`); saveDoc(); outline(); }
function rememberSelection() { const selection = window.getSelection(); const text = selection?.toString().trim() || ''; if (selection?.rangeCount && els.noteEditor.contains(selection.anchorNode)) savedSelection = selection.getRangeAt(0).cloneRange(); if (text) state.extractedText = text; }
function renderTree() { const tree = $('#documentTree'); tree.innerHTML = ''; const opened = renderTree.opened || (renderTree.opened = new Set(state.folders.map((folder) => folder.id))); state.folders.forEach((folder) => { const folderDocs = state.documents.filter((doc) => doc.folderId === folder.id && documentMatches(doc)); if (documentQuery && !folderDocs.length && !folder.name.toLowerCase().includes(documentQuery)) return; const section = document.createElement('div'); section.className = 'tree-section'; const head = document.createElement('div'); head.className = 'tree-folder-row'; head.innerHTML = '<button class="tree-caret" title="展开或折叠"><svg><use href="#i-chevron-down"></use></svg></button><strong></strong>'; head.querySelector('strong').textContent = folder.name; head.appendChild(actionButton('folder', folder.id)); head.ondblclick = () => openRename('folder', folder.id); head.onclick = (event) => { if (event.target.closest('.tree-more-button') || event.target.closest('.tree-caret')) return; opened.has(folder.id) ? opened.delete(folder.id) : opened.add(folder.id); renderTree(); }; head.querySelector('.tree-caret').onclick = () => { opened.has(folder.id) ? opened.delete(folder.id) : opened.add(folder.id); renderTree(); }; head.ondragover = (event) => { event.preventDefault(); head.classList.add('drag-over'); }; head.ondragleave = () => head.classList.remove('drag-over'); head.ondrop = (event) => { event.preventDefault(); moveDoc(event.dataTransfer.getData('doc-id'), folder.id); }; section.appendChild(head); if (opened.has(folder.id) || documentQuery) folderDocs.forEach((doc) => section.appendChild(docRow(doc))); tree.appendChild(section); }); const loose = state.documents.filter((doc) => !doc.folderId && documentMatches(doc)); if (loose.length) { const section = document.createElement('div'); section.className = 'tree-section'; section.innerHTML = '<div class="tree-folder-row loose-folder-row"><strong>未分组文档</strong></div>'; loose.forEach((doc) => section.appendChild(docRow(doc))); tree.appendChild(section); } if (!tree.children.length) tree.innerHTML = '<div class="tree-empty">没有匹配的文章</div>'; }
function docRow(doc) { const row = document.createElement('div'); row.className = `tree-doc-row${doc.id === state.activeDocId && libraryMode === 'editor' ? ' active' : ''}`; row.draggable = true; row.innerHTML = '<span class="tree-doc-title"></span>'; row.querySelector('.tree-doc-title').innerHTML = highlightText(doc.title, documentQuery); row.appendChild(actionButton('document', doc.id)); row.onclick = (event) => { if (!event.target.closest('.tree-more-button')) openDocumentEditor(doc.id); }; row.ondblclick = () => openRename('document', doc.id); row.ondragstart = (event) => event.dataTransfer.setData('doc-id', doc.id); return row; }
function actionButton(type, targetId) { const button = document.createElement('button'); button.type = 'button'; button.className = 'tree-more-button'; button.title = '更多操作'; button.innerHTML = '<svg><use href="#i-more-vertical"></use></svg>'; button.onclick = (event) => { event.stopPropagation(); openTreeMenu(button, type, targetId); }; return button; }
function openTreeMenu(anchor, type, targetId) { closeTreeMenus(); const menu = document.createElement('div'); menu.className = 'tree-context-menu'; menu.innerHTML = type === 'document' ? '<button data-action="rename">重命名</button><button data-action="edit">编辑文章</button><hr><button data-action="remove">移出目录</button><hr><button data-action="copy">复制</button><button data-action="move">移动…</button><button data-action="export">导出…</button><button data-action="pin">置顶文档</button><hr><button data-action="delete" class="danger">删除</button>' : '<button data-action="rename">重命名</button><button data-action="copy">复制</button><hr><button data-action="delete" class="danger">删除</button>'; document.body.appendChild(menu); const rect = anchor.getBoundingClientRect(); menu.style.top = `${Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4)}px`; menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.left))}px`; menu.querySelectorAll('[data-action]').forEach((item) => item.onclick = () => handleTreeAction(item.dataset.action, type, targetId, menu)); menu.addEventListener('click', (event) => event.stopPropagation()); document.addEventListener('click', closeTreeMenus, { once: true }); }
function closeTreeMenus() { $$('.tree-context-menu').forEach((menu) => menu.remove()); }
function handleTreeAction(action, type, targetId, menu) { menu.remove(); if (action === 'rename') return openRename(type, targetId); if (action === 'edit') return openDocumentEditor(targetId); if (action === 'remove') return moveDoc(targetId, null); if (action === 'move') return openMoveDocument(targetId); if (action === 'delete') return type === 'document' ? trashDoc(targetId) : trashFolder(targetId); if (action === 'copy') return duplicateTreeItem(type, targetId); if (action === 'copy-link') return copyDocumentLink(targetId); if (action === 'export') return exportDocument(targetId); if (action === 'pin') return pinDocument(targetId); if (action === 'new-tab') return openDocumentEditor(targetId); }
function duplicateTreeItem(type, targetId) { const now = new Date().toISOString(); if (type === 'document') { const source = state.documents.find((doc) => doc.id === targetId); if (!source) return; state.documents.push({ ...structuredClone(source), id: id('doc'), title: `${source.title} 副本`, createdAt: now, updatedAt: now }); } else { const source = state.folders.find((folder) => folder.id === targetId); if (!source) return; const copyId = id('folder'); state.folders.push({ ...structuredClone(source), id: copyId, name: `${source.name} 副本` }); state.documents.filter((doc) => doc.folderId === targetId).forEach((doc) => state.documents.push({ ...structuredClone(doc), id: id('doc'), folderId: copyId, title: `${doc.title} 副本`, createdAt: now, updatedAt: now })); } save(); refresh(); toast('已创建副本。'); }
function exportDocument(docId) { const doc = state.documents.find((item) => item.id === docId); if (!doc) return; const blob = new Blob([doc.html || ''], { type: 'text/html;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${doc.title || '文章'}.html`; link.click(); URL.revokeObjectURL(url); toast('文章已导出。'); }
function pinDocument(docId) { const doc = state.documents.find((item) => item.id === docId); if (!doc) return; doc.pinned = !doc.pinned; save(); refresh(); toast(doc.pinned ? '文章已置顶。' : '已取消置顶。'); }
function openMoveDocument(docId) { actionTarget = { type: 'document', id: docId }; fill($('#moveFolderSelect'), ['未分组', ...state.folders.map((folder) => folder.name)]); const doc = state.documents.find((item) => item.id === docId); $('#moveFolderSelect').value = state.folders.find((folder) => folder.id === doc?.folderId)?.name || '未分组'; syncCustomSelect($('#moveFolderSelect')); $('#moveDocumentModal').showModal(); }
function moveDocumentFromModal(event) { event.preventDefault(); const doc = state.documents.find((item) => item.id === actionTarget?.id); if (!doc) return; const name = $('#moveFolderSelect').value; doc.folderId = state.folders.find((folder) => folder.name === name)?.id || null; save(); $('#moveDocumentModal').close(); refresh(); toast('文章已移动。'); }
function switchDoc(docId, force = false) { if (docId === state.activeDocId && !force) return; saveDoc(); state.activeDocId = docId; state.extractedText = ''; loadDoc(); save(); renderTree(); renderKnowledgeHome(); }
function moveDoc(docId, folderId) { const doc = state.documents.find((item) => item.id === docId); if (!doc || doc.folderId === folderId) return; doc.folderId = folderId || null; save(); renderTree(); toast('文档已移动。'); }
function rootDrop(event) { event.preventDefault(); event.currentTarget.classList.remove('drag-over'); moveDoc(event.dataTransfer.getData('doc-id'), null); }
function openRename(mode, targetId) { createMode = mode; renameTargetId = targetId; const target = mode === 'folder' ? state.folders.find((item) => item.id === targetId) : state.documents.find((item) => item.id === targetId); if (!target) return; $('#createModalTitle').textContent = mode === 'folder' ? '重命名分组' : '重命名文章'; $('#createNameInput').value = target.name || target.title; $('#createFolderLabel').style.display = 'none'; els.createModal.showModal(); }
function openCreate(mode) { createMode = mode; renameTargetId = ''; $('#createModalTitle').textContent = mode === 'folder' ? '新建分组' : '新建文章'; $('#createNameInput').value = ''; $('#createFolderLabel').style.display = mode === 'folder' ? 'none' : 'grid'; $('#createFolderSelect').innerHTML = '<option value="">未分组</option>' + state.folders.map((folder) => `<option value="${folder.id}">${esc(folder.name)}</option>`).join(''); $('#createFolderSelect').value = activeDoc()?.folderId || ''; els.createModal.showModal(); closeKnowledgeAddMenu(); }
function createItem(event) { event.preventDefault(); const name = $('#createNameInput').value.trim(); if (!name) return toast('请输入名称。'); const isRenaming = Boolean(renameTargetId); if (isRenaming) { if (createMode === 'folder') { const folder = state.folders.find((item) => item.id === renameTargetId); if (state.folders.some((item) => item.id !== renameTargetId && item.name === name)) return toast('分组名称已存在。'); if (folder) folder.name = name; } else { const doc = state.documents.find((item) => item.id === renameTargetId); if (state.documents.some((item) => item.id !== renameTargetId && item.title === name)) return toast('文章名称已存在。'); if (doc) { doc.title = name; doc.updatedAt = new Date().toISOString(); } } } else if (createMode === 'folder') { if (state.folders.some((folder) => folder.name === name)) return toast('分组已存在。'); state.folders.push({ id: id('folder'), name, color: ['#2f7d64', '#28a9c7', '#8b73d6', '#d88746'][state.folders.length % 4] }); } else { const now = new Date().toISOString(); const doc = { id: id('doc'), folderId: $('#createFolderSelect').value || null, title: name, html: `<h1>${esc(name)}</h1><p>开始记录你的知识。</p>`, createdAt: now, updatedAt: now }; state.documents.push(doc); state.activeDocId = doc.id; } save(); els.createModal.close(); renameTargetId = ''; if (!isRenaming && createMode === 'document') { libraryMode = 'editor'; document.querySelector('.document-workbench').classList.remove('home-mode'); } loadDoc(); refresh(); toast(isRenaming ? '名称已更新。' : createMode === 'folder' ? '分组已创建。' : '文章已创建。'); }
function trashDoc(docId) { const doc = state.documents.find((item) => item.id === docId); if (!doc) return; openDeleteConfirm('document', docId, `删除文档“${doc.title}”？`, '文档将移入回收站，之后仍可恢复。'); }
function trashFolder(folderId) { const folder = state.folders.find((item) => item.id === folderId); if (!folder) return; const count = state.documents.filter((doc) => doc.folderId === folderId).length; openDeleteConfirm('folder', folderId, `删除文件夹“${folder.name}”？`, count ? `其中 ${count} 篇文档将随文件夹移入回收站。` : '文件夹将移入回收站，之后仍可恢复。'); }
function openDeleteConfirm(type, targetId, title, description, actionLabel = type === 'card-order' ? '确认' : '确认删除') { const modal = $('#deleteGroupModal'); if (!modal) return; modal.dataset.deleteType = type; modal.dataset.deleteId = targetId; $('#deleteGroupTitle').textContent = title; $('#deleteGroupDescription').textContent = description; $('#confirmDeleteGroupButton').textContent = actionLabel; modal.showModal(); }
function confirmDeleteTarget() {
  const modal = $('#deleteGroupModal');
  const type = modal?.dataset.deleteType;
  const targetId = modal?.dataset.deleteId;
  if (!type || !targetId) return;
  if (type === 'card-order') { modal.close(); confirmCardOrderChange(); return; }
  if (type === 'relearn-card-group') { modal.close(); confirmRelearnCardGroup(targetId); return; }
  modal.close();
  if (type === 'document') {
    const at = state.documents.findIndex((doc) => doc.id === targetId);
    if (at < 0) return;
    state.trash.documents.push(state.documents.splice(at, 1)[0]);
    if (state.activeDocId === targetId) state.activeDocId = state.documents[0]?.id || '';
  } else if (type === 'folder') {
    const at = state.folders.findIndex((folder) => folder.id === targetId);
    if (at < 0) return;
    const folder = state.folders.splice(at, 1)[0];
    const documents = state.documents.filter((doc) => doc.folderId === targetId);
    state.documents = state.documents.filter((doc) => doc.folderId !== targetId);
    state.trash.folders.push({ folder, documents });
    if (documents.some((doc) => doc.id === state.activeDocId)) state.activeDocId = state.documents[0]?.id || '';
  } else if (type === 'card') {
    const at = state.cards.findIndex((card) => card.id === targetId);
    if (at < 0) return;
    state.trash.cards.push(state.cards.splice(at, 1)[0]);
    if (state.selectedCardId === targetId) state.selectedCardId = state.cards[0]?.id || '';
  } else if (type === 'cards') {
    const ids = new Set(targetId.split(','));
    state.trash.cards.push(...state.cards.filter((card) => ids.has(card.id)));
    state.cards = state.cards.filter((card) => !ids.has(card.id));
    selectedCardIds.clear();
  } else if (type === 'trash-item') {
    state.trash[trashTab].splice(Number(targetId), 1);
  } else if (type === 'trash-all') {
    state.trash[trashTab] = [];
  } else if (type === 'card-group') {
    const cards = state.cards.filter((card) => card.folder === targetId);
    state.trash.cards.push(...cards);
    state.cards = state.cards.filter((card) => card.folder !== targetId);
    state.groups = state.groups.filter((item) => item !== targetId);
    if (els.folderFilter.value === targetId) els.folderFilter.value = '全部文件夹';
    cards.forEach((card) => selectedCardIds.delete(card.id));
  }
  save();
  loadDoc();
  refresh();
  toast('内容已移入回收站。');
}