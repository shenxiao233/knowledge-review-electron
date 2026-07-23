/**
 * markdown-renderer.js - Markdown 渲染器（基于 marked 库）
 * 依赖: vendor/marked.js (UMD), kr-core.js (esc, latexMarkup, markdownImageMarkup, markdownUrl)
 * 
 * 提供功能:
 * - GFM 完整支持（表格、任务列表、删除线）
 * - LaTeX 公式保护（$...$, $$...$$, \[...\], \(...\)）
 * - 自定义语法（专题/真题/例句）
 * - 嵌套列表
 * - 安全 URL 过滤
 * 
 * 加载顺序: marked.js → markdown-renderer.js → kr-documents.js
 */

(function() {
  // marked 从 UMD 加载为全局对象
  const markedLib = typeof window !== 'undefined' ? window.marked : null;
  if (!markedLib) {
    console.error('[markdown-renderer] marked 库未加载，请检查 vendor/marked.js');
    return;
  }
  const { marked, Renderer } = markedLib;

  /**
   * 将 Markdown 转换为 HTML
   * @param {string} markdown - Markdown 源码
   * @param {Object} options - 选项
   * @param {boolean} options.noteEntries - 是否启用 专题/真题/例句 语法
   * @returns {string} HTML 字符串
   */
  function markdownToHtml(markdown, options) {
    options = options || {};
    const source = String(markdown || '').replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n');

    // Phase 1: LaTeX 保护 - 提取公式并替换为占位符
    const latexMap = {};
    let latexCounter = 0;
    let processed = source;

    // 显示公式 $$...$$ 和 \[...\]
    processed = processed.replace(/\\?\$\$([\s\S]*?)\\?\$\$/g, function(_, formula) {
      var key = '__LATEX_BLOCK_' + (latexCounter++) + '__';
      latexMap[key] = latexMarkup(formula, true);
      return key;
    });
    processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, function(_, formula) {
      var key = '__LATEX_BLOCK_' + (latexCounter++) + '__';
      latexMap[key] = latexMarkup(formula, true);
      return key;
    });

    // 行内公式 \(...\) 和 $...$
    processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, function(_, formula) {
      var key = '__LATEX_INLINE_' + (latexCounter++) + '__';
      latexMap[key] = latexMarkup(formula, false);
      return key;
    });
    processed = processed.replace(/\\?\$([^$\n]+?)\$/g, function(_, formula) {
      var key = '__LATEX_INLINE_' + (latexCounter++) + '__';
      latexMap[key] = latexMarkup(formula, false);
      return key;
    });

    // Phase 2: 预处理自定义语法（专题/真题/例句）
    if (options.noteEntries) {
      processed = processed.replace(/^(\s*)(专题|真题|例句)\s*(.*)$/gm, function(_, indent, label, content) {
        var labelClass = label === '专题' ? 'topic' : label === '真题' ? 'question' : 'example';
        return '<p class="note-entry"><span class="note-entry-label ' + labelClass + '">' + label + '</span><span class="note-entry-body">' + markdownInline(content, options) + '</span></p>';
      });
    }

    // Phase 3: 创建自定义渲染器
    var renderer = new Renderer();

    // 自定义链接渲染（安全 URL + 新窗口打开）
    renderer.link = function(token) {
      var href = token.href || '';
      var title = token.title || '';
      var text = token.text || '';
      var safeUrl = markdownUrl(href, '#');
      var titleAttr = title ? ' title="' + esc(title) + '"' : '';
      return '<a href="' + safeUrl + '" target="_blank" rel="noreferrer"' + titleAttr + '>' + text + '</a>';
    };

    // 自定义图片渲染（安全 URL）
    renderer.image = function(token) {
      var href = token.href || '';
      var alt = token.text || '';
      return markdownImageMarkup(href, alt);
    };

    // 代码块渲染（转义 HTML）
    renderer.code = function(token) {
      var code = token.text || '';
      var lang = token.lang || '';
      var escaped = esc(code);
      var langClass = lang ? ' class="language-' + esc(lang) + '"' : '';
      return '<pre><code' + langClass + '>' + escaped + '</code></pre>';
    };

    // Phase 4: marked 渲染
    var html = marked.parse(processed, {
      renderer: renderer,
      gfm: true,
      breaks: false,
      pedantic: false
    });

    // Phase 5: 还原 LaTeX 占位符
    var keys = Object.keys(latexMap);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      // 转义正则特殊字符
      var escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$' + '&');
      html = html.replace(new RegExp(escapedKey, 'g'), latexMap[key]);
    }

    return html;
  }

  // 导出到全局
  window.markdownToHtml = markdownToHtml;
})();