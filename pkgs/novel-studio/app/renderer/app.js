'use strict';

(function () {
  const S = window.Store;
  const api = window.api;

  const $ = (id) => document.getElementById(id);

  const state = {
    config: null,
    books: [],
    book: null,
    bookId: null,
    chapterId: null,
    lastWords: 0,
    saveTimer: null,
    dirty: false,
    focus: false,
    ai: {
      action: 'continue',
      busy: false,
      output: '',
      requestId: null,
      selection: { start: 0, end: 0 }
    }
  };

  /* ------------------------------------------------------------- utilities */

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  function setStatus(text, cls) {
    const el = $('saveState');
    el.textContent = text;
    el.className = cls || '';
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const key of Object.keys(props)) {
        if (key === 'class') node.className = props[key];
        else if (key === 'text') node.textContent = props[key];
        else if (key === 'dataset') Object.assign(node.dataset, props[key]);
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), props[key]);
        else node.setAttribute(key, props[key]);
      }
    }
    (children || []).forEach((child) => child && node.appendChild(child));
    return node;
  }

  const editor = () => $('editor');
  const currentChapter = () => {
    if (!state.book || !state.chapterId) return null;
    const i = S.chapterIndex(state.book, state.chapterId);
    return i < 0 ? null : state.book.chapters[i];
  };

  /* --------------------------------------------------------------- startup */

  async function init() {
    state.config = await api.getConfig();
    applyEditorConfig();
    bindEvents();
    await refreshBooks();
    if (state.config.lastBookId) {
      try {
        await openBook(state.config.lastBookId);
      } catch (err) {
        console.warn(err);
      }
    }
    if (!state.book) {
      renderChapters();
      editor().disabled = true;
      openOverlay('libraryOverlay');
    }
    updateAiLabel();
  }

  function applyEditorConfig() {
    const cfg = state.config.editor || {};
    document.documentElement.style.setProperty('--editor-font-size', (cfg.fontSize || 18) + 'px');
    document.documentElement.style.setProperty('--editor-line-height', cfg.lineHeight || 1.9);
  }

  /* ---------------------------------------------------------------- library */

  async function refreshBooks() {
    state.books = await api.listBooks();
    renderLibrary();
  }

  function renderLibrary() {
    const grid = $('bookGrid');
    grid.innerHTML = '';
    $('libraryRootHint').textContent = state.config.libraryRoot;

    if (!state.books.length) {
      grid.appendChild(el('div', { class: 'empty-hint', text: '书库还是空的，点右下角「新建作品」开始。' }));
      return;
    }

    for (const book of state.books) {
      const card = el('div', { class: 'book-card', onclick: () => openBook(book.id) }, [
        el('h4', { text: book.title }),
        el('div', { class: 'meta', text: (book.author || '未署名') + ' · ' + S.fmtNum(book.words) + ' 字' }),
        el('div', { class: 'meta', text: book.chapters + ' 章 · ' + String(book.updatedAt || '').slice(0, 10) })
      ]);
      const del = el('button', {
        class: 'del icon-btn',
        title: '移到回收站',
        text: '×',
        onclick: async (event) => {
          event.stopPropagation();
          if (!confirm(`删除《${book.title}》？\n\n整本书会移到系统回收站，可以从那里恢复。`)) return;
          await api.deleteBook(book.id);
          if (state.bookId === book.id) {
            state.book = null;
            state.bookId = null;
            state.chapterId = null;
            editor().value = '';
            renderChapters();
            updateStats();
          }
          await refreshBooks();
          toast('已移到回收站');
        }
      });
      card.appendChild(del);
      grid.appendChild(card);
    }
  }

  async function openBook(bookId) {
    await flushSave();
    const book = await api.openBook(bookId);
    state.book = book;
    state.bookId = bookId;
    state.chapterId = null;
    editor().disabled = false;

    state.config = await api.setConfig({ lastBookId: bookId });

    $('bookTitle').textContent = book.title || '未命名作品';
    $('bookAuthor').textContent = book.author || '未署名';
    $('synopsis').value = book.synopsis || '';
    $('outline').value = book.outline || '';

    closeOverlay('libraryOverlay');
    renderChapters();
    renderCast();
    renderWorld();
    updateStats();

    if (book.chapters.length) await selectChapter(book.chapters[0].id);
    else {
      $('chapterTitle').value = '';
      editor().value = '';
      await newChapter();
    }
  }

  function renderChapters() {
    const list = $('chapterList');
    list.innerHTML = '';
    if (!state.book || !state.book.chapters.length) {
      list.appendChild(el('div', { class: 'empty-hint', text: '还没有章节' }));
      return;
    }
    let volume = null;
    for (const chapter of state.book.chapters) {
      if (chapter.volume && chapter.volume !== volume) {
        volume = chapter.volume;
        list.appendChild(el('div', { class: 'volume-label', text: volume }));
      }
      const item = el(
        'div',
        {
          class: 'chapter-item' + (chapter.id === state.chapterId ? ' active' : ''),
          dataset: { id: chapter.id },
          onclick: () => selectChapter(chapter.id)
        },
        [
          el('span', { class: 'c-title', text: chapter.title }),
          el('span', { class: 'c-words', text: chapter.words ? S.fmtNum(chapter.words) : '' }),
          el('button', {
            class: 'c-del',
            text: '×',
            title: '删除章节',
            onclick: async (event) => {
              event.stopPropagation();
              await deleteChapter(chapter.id);
            }
          })
        ]
      );
      list.appendChild(item);
    }
  }

  function updateChapterRow(chapter) {
    const row = document.querySelector(`.chapter-item[data-id="${CSS.escape(chapter.id)}"] .c-words`);
    if (row) row.textContent = chapter.words ? S.fmtNum(chapter.words) : '';
  }

  async function selectChapter(chapterId) {
    if (state.chapterId === chapterId) return;
    await flushSave();
    const chapter = state.book.chapters.find((c) => c.id === chapterId);
    if (!chapter) return;

    const content = await api.readChapter({ bookId: state.bookId, chapterId });
    state.chapterId = chapterId;
    editor().value = content;
    state.lastWords = S.countWords(content);
    $('chapterTitle').value = chapter.title;
    $('chapterTarget').value = chapter.target || '';

    document.querySelectorAll('.chapter-item').forEach((node) => {
      node.classList.toggle('active', node.dataset.id === chapterId);
    });
    updateCounts();
    editor().focus();
    setStatus('就绪');
  }

  async function newChapter() {
    if (!state.book) return;
    await flushSave();
    const chapter = S.createChapter('第 ' + (state.book.chapters.length + 1) + ' 章');
    const last = state.book.chapters[state.book.chapters.length - 1];
    chapter.volume = last ? last.volume || '' : '';
    state.book.chapters.push(chapter);
    await api.writeChapter({ bookId: state.bookId, chapterId: chapter.id, content: '' });
    state.chapterId = null;
    renderChapters();
    await selectChapter(chapter.id);
    await flushSave();
    $('chapterTitle').select();
  }

  async function deleteChapter(chapterId) {
    const chapter = state.book.chapters.find((c) => c.id === chapterId);
    if (!chapter) return;
    if (!confirm(`删除「${chapter.title}」？\n\n章节文件会移到系统回收站。`)) return;
    if (state.chapterId === chapterId) await flushSave();
    await api.deleteChapter({ bookId: state.bookId, chapterId });
    state.book.chapters = state.book.chapters.filter((c) => c.id !== chapterId);
    if (state.chapterId === chapterId) {
      state.chapterId = null;
      editor().value = '';
      $('chapterTitle').value = '';
      const next = state.book.chapters[0];
      if (next) await selectChapter(next.id);
    }
    renderChapters();
    await flushSaveBook();
    updateStats();
  }

  async function createBook(title, author) {
    const { id, book } = await api.createBook({ title, author });
    await refreshBooks();
    await openBook(id);
    toast('已创建《' + book.title + '》');
  }

  /* ------------------------------------------------------------------ save */

  function markDirty() {
    state.dirty = true;
    setStatus('正在输入…', 'dirty');
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    const delay = (state.config.editor && state.config.editor.autoSaveMs) || 800;
    state.saveTimer = setTimeout(() => {
      flushSave();
    }, delay);
  }

  async function flushSaveBook() {
    if (!state.book || !state.bookId) return;
    try {
      await api.saveBook({ bookId: state.bookId, book: state.book });
    } catch (err) {
      setStatus('保存失败：' + err.message, 'error');
    }
  }

  async function flushSave() {
    if (!state.book || !state.bookId) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    try {
      if (state.chapterId) {
        await api.writeChapter({
          bookId: state.bookId,
          chapterId: state.chapterId,
          content: editor().value
        });
      }
      await flushSaveBook();
      state.dirty = false;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      setStatus('已保存 ' + hh + ':' + mm, 'saved');
    } catch (err) {
      setStatus('保存失败：' + err.message, 'error');
    }
  }

  /* ----------------------------------------------------------------- stats */

  function updateCounts() {
    const chapter = currentChapter();
    const words = S.countWords(editor().value);
    const target = chapter && chapter.target ? chapter.target : 0;
    $('chapterCount').textContent = target
      ? S.fmtNum(words) + ' / ' + S.fmtNum(target)
      : S.fmtNum(words) + ' 字';
    updateStats();
  }

  function updateStats() {
    if (!state.book) {
      $('statWords').textContent = '0 字';
      $('statToday').textContent = '0 字';
      $('statChapters').textContent = '0';
      return;
    }
    const stats = S.bookStats(state.book);
    $('statWords').textContent = S.fmtNum(stats.words) + ' 字';
    $('statToday').textContent = S.fmtNum(stats.today) + ' 字';
    $('statChapters').textContent = String(stats.chapters);
  }

  function updateCaret() {
    const node = editor();
    const before = node.value.slice(0, node.selectionStart);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    $('caretInfo').textContent = `第 ${line} 行，第 ${col} 列`;
  }

  /* ------------------------------------------------------------------ cards */

  function bindCardField(kind, item, field, node) {
    node.addEventListener('input', () => {
      item[field] = node.value;
      state.dirty = true;
      scheduleSave();
      if (kind && field === 'name') updateAiContextHint();
    });
  }

  function renderCardList(listId, kind, items) {
    const list = $(listId);
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(el('div', { class: 'empty-hint', text: '还没有条目，点「添加」。' }));
      return;
    }
    for (const item of items) {
      const name = el('input', { placeholder: kind === 'cast' ? '人物名' : '设定项' });
      name.value = item.name || '';
      bindCardField(kind, item, 'name', name);

      let role = null;
      const topChildren = [name];
      if (kind === 'cast') {
        role = el('input', { placeholder: '身份 / 关系', class: 'role' });
        role.value = item.role || '';
        role.style.width = '110px';
        role.style.flex = 'none';
        bindCardField(kind, item, 'role', role);
        topChildren.push(role);
      }
      topChildren.push(
        el('button', {
          class: 'c-del',
          text: '×',
          title: '删除',
          onclick: () => {
            items.splice(items.indexOf(item), 1);
            state.dirty = true;
            scheduleSave();
            renderCardList(listId, kind, items);
          }
        })
      );

      const desc = el('textarea', { placeholder: kind === 'cast' ? '性格、动机、说话习惯、与主角的关系…' : '规则、地点、势力、历史…' });
      desc.value = item.desc || '';
      bindCardField(kind, item, 'desc', desc);

      list.appendChild(el('div', { class: 'card' }, [el('div', { class: 'card-top' }, topChildren), desc]));
    }
  }

  function renderCast() {
    if (!state.book) return;
    renderCardList('castList', 'cast', state.book.characters);
  }

  function renderWorld() {
    if (!state.book) return;
    renderCardList('worldList', 'world', state.book.world);
  }

  function addCast() {
    if (!state.book) return;
    state.book.characters.push({ id: S.uid('p'), name: '', role: '', desc: '' });
    renderCast();
    state.dirty = true;
    scheduleSave();
  }

  function addWorld() {
    if (!state.book) return;
    state.book.world.push({ id: S.uid('w'), name: '', desc: '' });
    renderWorld();
    state.dirty = true;
    scheduleSave();
  }

  function updateAiContextHint() {
    if (!state.book) return;
    const cast = state.book.characters.filter((c) => c.name).length;
    const world = state.book.world.filter((w) => w.name).length;
    $('aiModelLabel').title = `人物 ${cast} 条，设定 ${world} 条将随请求发送`;
  }

  /* --------------------------------------------------------------------- AI */

  function getSelection() {
    const node = editor();
    return { start: node.selectionStart, end: node.selectionEnd, text: node.value.slice(node.selectionStart, node.selectionEnd) };
  }

  function buildMessages(action) {
    const book = state.book;
    const aiCfg = state.config.ai;
    const content = editor().value;
    const sel = state.ai.selection;
    const selected = content.slice(sel.start, sel.end);
    const budget = Math.max(200, aiCfg.maxContextChars || 1800);
    const tail = content.slice(Math.max(0, content.length - budget));

    const cast = (book.characters || [])
      .filter((c) => c.name || c.desc)
      .map((c) => `- ${c.name || '未命名'}${c.role ? '（' + c.role + '）' : ''}：${c.desc || ''}`)
      .join('\n');
    const world = (book.world || [])
      .filter((w) => w.name || w.desc)
      .map((w) => `- ${w.name || '未命名'}：${w.desc || ''}`)
      .join('\n');

    const system = [
      '你是一位资深中文小说写作助手，正在协助作者完成一部长篇作品。',
      '硬性要求：只输出可以直接放进正文的内容；不要任何解释、前言、结语或 Markdown 标记；不要复述作者的要求；保持与原文一致的人称、时态、语感和文风。',
      '作品：《' + (book.title || '未命名') + '》',
      book.synopsis ? '梗概：' + book.synopsis : '',
      book.outline ? '大纲：\n' + book.outline.slice(0, 1600) : '',
      cast ? '人物：\n' + cast : '',
      world ? '世界观：\n' + world : ''
    ]
      .filter(Boolean)
      .join('\n\n');

    const extra = $('aiPrompt').value.trim();
    const note = extra ? `\n\n额外要求：${extra}` : '';
    const chapter = currentChapter();
    const chapterName = chapter ? chapter.title : '当前章节';

    let user = '';
    let mode = 'insert';

    switch (action) {
      case 'continue':
        user =
          `下面是《${book.title}》「${chapterName}」已经写好的文字。请从结尾处无缝续写约 300 字：保持叙事视角和语感，推进情节，不要总结，不要收尾。\n\n----- 前文 -----\n${tail || '（本章还没写任何内容，请开启本章开头）'}` +
          note;
        mode = 'insert';
        break;
      case 'polish':
        user = `请润色下面这段文字：修正语病与重复用词，让句子更有节奏，保持原意、篇幅和信息量不变。直接输出润色后的正文。\n\n----- 原文 -----\n${selected}` + note;
        mode = 'replace';
        break;
      case 'expand':
        user = `请把下面这段文字扩写，补充具体的动作、感官细节与心理活动，篇幅约为原文的两倍；不要添加情节转折，直接输出扩写后的正文。\n\n----- 原文 -----\n${selected || tail}` + note;
        mode = selected ? 'replace' : 'insert';
        break;
      case 'condense':
        user = `请精简下面这段文字，删去冗余与套话，让信息密度更高，篇幅约为原文的七成；直接输出精简后的正文。\n\n----- 原文 -----\n${selected || tail}` + note;
        mode = selected ? 'replace' : 'insert';
        break;
      case 'outline':
        user = `请为「${chapterName}」拟一份分节大纲，5 到 8 条，每条一句话，用「1. 2. 3.」编号。可以参考已写内容：\n\n${tail}` + note;
        mode = 'display';
        break;
      case 'name':
        user = `请给出 8 个中文${extra || '人物姓名'}候选，每个后面用一句话说明气质与寓意，按「名字 —— 说明」的格式逐行列出。` + (extra ? '' : '\n\n作品背景：\n' + tail);
        mode = 'display';
        break;
      case 'critique':
        user = `请以资深编辑的身份点评下面这段文字：具体指出节奏、人物动机、对白、视角、信息密度上的问题，并给出可执行的修改建议。分条列出，不要重写正文。\n\n----- 原文 -----\n${selected || tail}` + note;
        mode = 'display';
        break;
      default:
        user = (extra || '请就当前章节给出建议。') + '\n\n----- 当前内容 -----\n' + (selected || tail);
        mode = 'display';
    }

    return { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], mode };
  }

  function requireContext(action) {
    const raw = editor().value;
    if (!raw.trim()) {
      toast('先写一点内容再用 AI');
      return false;
    }
    if (['polish', 'expand', 'condense'].includes(action) && state.ai.selection.end <= state.ai.selection.start) {
      state.ai.selection = { start: Math.max(0, raw.length - 500), end: raw.length };
      toast('未选中内容，将处理正文末尾一段');
    }
    return true;
  }

  async function runAi(action) {
    if (!state.book) return toast('先打开或新建一部作品');
    if (state.ai.busy) return;
    if (!state.config.ai.model) {
      openSettings();
      return toast('先到设置里配置推理服务和模型');
    }
    state.ai.selection = getSelection();
    if (!requireContext(action)) return;

    const { messages, mode } = buildMessages(action);
    state.ai.mode = mode;
    state.ai.action = action;
    state.ai.output = '';
    state.ai.busy = true;
    state.ai.requestId = 'r' + Date.now();

    const out = $('aiOutput');
    out.textContent = '';
    out.classList.add('streaming');
    $('btnAiRun').disabled = true;
    $('btnAiStop').disabled = false;
    setActiveChip(action);

    try {
      await api.aiChat({ requestId: state.ai.requestId, messages, ai: state.config.ai });
    } catch (err) {
      finishAi('生成失败：' + err.message);
    }
  }

  function setActiveChip(action) {
    document.querySelectorAll('#aiChips .chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.action === action);
    });
  }

  function finishAi(errorMessage) {
    state.ai.busy = false;
    $('btnAiRun').disabled = false;
    $('btnAiStop').disabled = true;
    const out = $('aiOutput');
    out.classList.remove('streaming');
    if (errorMessage) {
      out.textContent = errorMessage;
      out.style.color = 'var(--red)';
    } else {
      out.style.color = '';
    }
  }

  function insertAt(text, replace) {
    const node = editor();
    const sel = state.ai.selection;
    if (replace && sel.end > sel.start) {
      node.setRangeText(text, sel.start, sel.end, 'end');
    } else {
      const pos = node.selectionStart;
      node.setRangeText(text, pos, pos, 'end');
    }
    node.focus();
    node.dispatchEvent(new Event('input'));
  }

  /* ---------------------------------------------------------------- overlay */

  function openOverlay(id) {
    $(id).hidden = false;
  }

  function closeOverlay(id) {
    $(id).hidden = true;
  }

  function openSettings() {
    const cfg = state.config;
    $('cfgRoot').value = cfg.libraryRoot;
    $('cfgFontSize').value = cfg.editor.fontSize;
    $('cfgProtocol').value = cfg.ai.protocol;
    $('cfgBaseUrl').value = cfg.ai.baseUrl || '';
    $('cfgApiKey').value = cfg.ai.apiKey || '';
    $('cfgModel').value = cfg.ai.model || '';
    $('cfgTemp').value = cfg.ai.temperature;
    $('cfgContext').value = cfg.ai.maxContextChars;
    $('aiTestResult').textContent = '';
    openOverlay('settingsOverlay');
  }

  async function saveSettings() {
    const patch = {
      libraryRoot: $('cfgRoot').value.trim() || state.config.libraryRoot,
      editor: { fontSize: Number($('cfgFontSize').value) || 18 },
      ai: {
        protocol: $('cfgProtocol').value,
        baseUrl: $('cfgBaseUrl').value.trim(),
        apiKey: $('cfgApiKey').value,
        model: $('cfgModel').value.trim(),
        temperature: Number($('cfgTemp').value),
        maxContextChars: Number($('cfgContext').value) || 1800
      }
    };
    state.config = await api.setConfig(patch);
    applyEditorConfig();
    updateAiLabel();
    closeOverlay('settingsOverlay');
    await refreshBooks();
    toast('设置已保存');
  }

  function updateAiLabel() {
    const ai = state.config.ai;
    $('aiModelLabel').textContent = ai.model ? ai.model : '未配置模型';
  }

  function readSettingsForm() {
    return {
      protocol: $('cfgProtocol').value,
      baseUrl: $('cfgBaseUrl').value.trim(),
      apiKey: $('cfgApiKey').value
    };
  }

  async function testConnection() {
    const result = $('aiTestResult');
    result.textContent = '连接中…';
    result.style.color = 'var(--overlay0)';
    try {
      const models = await api.aiModels(readSettingsForm());
      const list = $('modelOptions');
      list.innerHTML = '';
      models.forEach((name) => list.appendChild(el('option', { value: name })));
      if (models.length) {
        result.textContent = `成功，发现 ${models.length} 个模型`;
        result.style.color = 'var(--green)';
        if (!$('cfgModel').value) $('cfgModel').value = models[0];
      } else {
        result.textContent = '连接成功，但没有返回模型';
        result.style.color = 'var(--yellow)';
      }
    } catch (err) {
      result.textContent = '失败：' + err.message;
      result.style.color = 'var(--red)';
    }
  }

  /* ----------------------------------------------------------------- events */

  function bindEvents() {
    const node = editor();

    node.addEventListener('input', () => {
      const chapter = currentChapter();
      const words = S.countWords(node.value);
      if (chapter) {
        const delta = words - state.lastWords;
        if (delta > 0) S.trackDelta(state.book, delta);
        chapter.words = words;
        chapter.updatedAt = new Date().toISOString();
        updateChapterRow(chapter);
      }
      state.lastWords = words;
      updateCounts();
      updateCaret();
      markDirty();
      scheduleSave();
    });

    node.addEventListener('keyup', updateCaret);
    node.addEventListener('click', updateCaret);

    $('chapterTitle').addEventListener('input', () => {
      const chapter = currentChapter();
      if (!chapter) return;
      chapter.title = $('chapterTitle').value || '未命名章节';
      const row = document.querySelector(`.chapter-item[data-id="${CSS.escape(chapter.id)}"] .c-title`);
      if (row) row.textContent = chapter.title;
      markDirty();
      scheduleSave();
    });

    $('chapterTarget').addEventListener('input', () => {
      const chapter = currentChapter();
      if (!chapter) return;
      chapter.target = Number($('chapterTarget').value) || 0;
      updateCounts();
      scheduleSave();
    });

    $('btnLibrary').addEventListener('click', async () => {
      await refreshBooks();
      openOverlay('libraryOverlay');
    });

    $('btnNewBook').addEventListener('click', () => openOverlay('newBookOverlay'));
    $('btnNewBook2').addEventListener('click', () => openOverlay('newBookOverlay'));

    $('btnCreateBook').addEventListener('click', async () => {
      const title = $('newTitle').value.trim();
      if (!title) return toast('请填写书名');
      const author = $('newAuthor').value.trim();
      await createBook(title, author);
      $('newTitle').value = '';
      $('newAuthor').value = '';
      closeOverlay('newBookOverlay');
    });

    $('btnNewChapter').addEventListener('click', newChapter);
    $('btnSettings').addEventListener('click', openSettings);
    $('btnSaveSettings').addEventListener('click', saveSettings);
    $('btnListModels').addEventListener('click', testConnection);
    $('btnReveal').addEventListener('click', () => {
      if (state.bookId) api.revealBook(state.bookId);
    });

    $('btnFocus').addEventListener('click', () => {
      state.focus = !state.focus;
      $('app').classList.toggle('focus-mode', state.focus);
      $('btnFocus').classList.toggle('accent', state.focus);
      node.focus();
    });

    const toggleInspector = () => {
      const hidden = $('app').classList.toggle('no-inspector');
      $('btnInspector').classList.toggle('accent', !hidden);
    };
    $('btnInspector').addEventListener('click', toggleInspector);
    $('btnCloseInspector').addEventListener('click', () => {
      $('app').classList.add('no-inspector');
      $('btnInspector').classList.remove('accent');
    });

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.pane').forEach((pane) => {
          pane.classList.toggle('active', pane.dataset.pane === tab.dataset.tab);
        });
      });
    });

    $('synopsis').addEventListener('input', () => {
      if (!state.book) return;
      state.book.synopsis = $('synopsis').value;
      scheduleSave();
    });

    $('outline').addEventListener('input', () => {
      if (!state.book) return;
      state.book.outline = $('outline').value;
      scheduleSave();
    });

    $('btnAddCast').addEventListener('click', addCast);
    $('btnAddWorld').addEventListener('click', addWorld);

    document.querySelectorAll('#aiChips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        setActiveChip(chip.dataset.action);
        runAi(chip.dataset.action);
      });
    });

    $('btnAiRun').addEventListener('click', () => runAi(state.ai.action || 'continue'));

    $('btnAiStop').addEventListener('click', () => api.aiCancel());

    $('btnAiInsert').addEventListener('click', () => {
      if (!state.ai.output) return toast('还没有生成内容');
      insertAt(state.ai.output, false);
    });

    $('btnAiReplace').addEventListener('click', () => {
      if (!state.ai.output) return toast('还没有生成内容');
      insertAt(state.ai.output, true);
    });

    $('btnAiCopy').addEventListener('click', async () => {
      if (!state.ai.output) return;
      await navigator.clipboard.writeText(state.ai.output);
      toast('已复制');
    });

    $('btnExport').addEventListener('click', async () => {
      if (!state.book) return toast('先打开一部作品');
      await flushSave();
      const contents = {};
      for (const chapter of state.book.chapters) {
        contents[chapter.id] =
          chapter.id === state.chapterId ? node.value : await api.readChapter({ bookId: state.bookId, chapterId: chapter.id });
      }
      const md = confirm('导出为 Markdown（.md）？\n\n确定 = Markdown\n取消 = 纯文本 TXT');
      const result = await api.exportBook({
        bookId: state.bookId,
        book: state.book,
        format: md ? 'md' : 'txt',
        contents
      });
      if (result.saved) toast('已导出到 ' + result.filePath);
    });

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeOverlay(btn.dataset.close));
    });

    document.querySelectorAll('.overlay').forEach((overlay) => {
      overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) overlay.hidden = true;
      });
    });

    document.addEventListener('keydown', (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key === 's') {
        event.preventDefault();
        flushSave();
      } else if (mod && event.key === 'n') {
        event.preventDefault();
        newChapter();
      } else if (mod && event.key === 'j') {
        event.preventDefault();
        toggleInspector();
      } else if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        $('btnFocus').click();
      } else if (event.key === 'Escape') {
        document.querySelectorAll('.overlay').forEach((overlay) => {
          overlay.hidden = true;
        });
      }
    });

    window.addEventListener('blur', () => {
      if (state.dirty) flushSave();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.dirty) flushSave();
    });

    /* AI streaming -------------------------------------------------------- */
    api.onAiChunk(({ requestId, text }) => {
      if (requestId !== state.ai.requestId) return;
      state.ai.output += text;
      const out = $('aiOutput');
      out.textContent = state.ai.output;
      out.scrollTop = out.scrollHeight;
    });

    api.onAiDone(({ requestId, aborted }) => {
      if (requestId !== state.ai.requestId) return;
      finishAi(aborted ? '已停止' : null);
      if (aborted) toast('已停止生成');
    });

    api.onAiError(({ requestId, message }) => {
      if (requestId !== state.ai.requestId) return;
      finishAi('生成失败：' + message);
    });
  }

  init().catch((err) => {
    console.error(err);
    setStatus('启动失败：' + err.message, 'error');
  });
})();
