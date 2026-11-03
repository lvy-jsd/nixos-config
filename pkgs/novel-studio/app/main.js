'use strict';

/*
 * Novel Studio - Electron main process.
 *
 * Owns everything that touches the disk or the network:
 *   - a JSON config in the Electron userData directory
 *   - a library of books, one directory per book, chapters as plain .md files
 *   - daily snapshots so a bad editing session can never destroy a draft
 *   - a streaming proxy to an OpenAI-compatible or Ollama chat endpoint
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const Store = require('./renderer/store.js');

app.setName('novel-studio');

const RENDERER_DIR = path.join(__dirname, 'renderer');
const CHAPTER_DIR = 'chapters';
const SNAPSHOT_DIR = '.snapshots';
const MAX_SNAPSHOTS = 7;

let mainWindow = null;
let aiAbort = null;

/* ------------------------------------------------------------------ config */

function homeDir() {
  try {
    return app.getPath('home');
  } catch {
    return process.env.HOME || '/';
  }
}

function defaultLibraryRoot() {
  try {
    return path.join(app.getPath('documents'), 'NovelStudio');
  } catch {
    return path.join(homeDir(), 'NovelStudio');
  }
}

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function defaultConfig() {
  return {
    libraryRoot: defaultLibraryRoot(),
    lastBookId: null,
    ai: {
      protocol: 'openai', // 'openai' | 'ollama'
      baseUrl: 'http://127.0.0.1:11434',
      apiKey: '',
      model: '',
      temperature: 0.9,
      maxContextChars: 1800
    },
    editor: {
      fontSize: 18,
      lineHeight: 1.9,
      autoSaveMs: 800
    }
  };
}

function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch === undefined ? base : patch;
  if (typeof base === 'object' && base && typeof patch === 'object' && patch) {
    const out = { ...base };
    for (const key of Object.keys(patch)) out[key] = deepMerge(base[key], patch[key]);
    return out;
  }
  return patch === undefined ? base : patch;
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return deepMerge(defaultConfig(), JSON.parse(raw));
  } catch {
    return defaultConfig();
  }
}

function saveConfig(config) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

/* ------------------------------------------------------------------ paths */

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function safeId(id) {
  if (typeof id !== 'string' || !/^[^/\\\0]+$/.test(id) || id === '.' || id === '..') {
    throw new Error('非法标识符: ' + id);
  }
  return id;
}

function bookPath(bookId) {
  const cfg = loadConfig();
  return path.join(cfg.libraryRoot, safeId(bookId));
}

function uniqueBookDir(root, slug) {
  let candidate = slug;
  let n = 2;
  while (fs.existsSync(path.join(root, candidate))) {
    candidate = `${slug}-${n}`;
    n += 1;
  }
  return candidate;
}

function chapterFile(bookId, chapterId) {
  return path.join(bookPath(bookId), CHAPTER_DIR, `${safeId(chapterId)}.md`);
}

/* ------------------------------------------------------------------ books */

async function listBooks() {
  const cfg = loadConfig();
  await ensureDir(cfg.libraryRoot);
  const entries = await fsp.readdir(cfg.libraryRoot, { withFileTypes: true });
  const books = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const metaFile = path.join(cfg.libraryRoot, entry.name, 'book.json');
    try {
      const book = JSON.parse(await fsp.readFile(metaFile, 'utf8'));
      let words = 0;
      for (const ch of book.chapters || []) words += ch.words || 0;
      books.push({
        id: entry.name,
        title: book.title || entry.name,
        author: book.author || '',
        chapters: (book.chapters || []).length,
        words,
        updatedAt: book.updatedAt || ''
      });
    } catch {
      /* not a book directory, ignore */
    }
  }
  books.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return books;
}

async function writeBook(bookId, book) {
  const dir = bookPath(bookId);
  await ensureDir(dir);
  book.updatedAt = new Date().toISOString();
  await fsp.writeFile(path.join(dir, 'book.json'), JSON.stringify(book, null, 2), 'utf8');
  return book;
}

/** Copy the book into .snapshots/<today>/ the first time it is saved each day. */
async function snapshotIfNeeded(bookId) {
  const dir = bookPath(bookId);
  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(dir, SNAPSHOT_DIR, stamp);
  if (fs.existsSync(target)) return;
  try {
    await ensureDir(target);
    await fsp.copyFile(path.join(dir, 'book.json'), path.join(target, 'book.json'));
    const chapters = path.join(dir, CHAPTER_DIR);
    if (fs.existsSync(chapters)) {
      await fsp.cp(chapters, path.join(target, CHAPTER_DIR), { recursive: true });
    }
    const all = (await fsp.readdir(path.join(dir, SNAPSHOT_DIR))).sort();
    while (all.length > MAX_SNAPSHOTS) {
      const old = all.shift();
      await fsp.rm(path.join(dir, SNAPSHOT_DIR, old), { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('[novel-studio] snapshot failed:', err.message);
  }
}

/* ---------------------------------------------------------------- AI proxy */

function normalizeBase(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function endpoint(config, suffix) {
  const base = normalizeBase(config.baseUrl);
  if (!base) throw new Error('尚未配置 AI 服务地址');
  return base + suffix;
}

function authHeaders(config) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

async function listModels(aiConfig) {
  const protocol = aiConfig.protocol === 'ollama' ? 'ollama' : 'openai';
  const suffix = protocol === 'ollama' ? '/api/tags' : '/models';
  const res = await fetch(endpoint(aiConfig, suffix), {
    headers: authHeaders(aiConfig),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (protocol === 'ollama') {
    return (data.models || []).map((m) => m.name).filter(Boolean);
  }
  return (data.data || []).map((m) => m.id).filter(Boolean);
}

/** Consume an SSE / NDJSON stream and push text deltas to the renderer. */
async function streamChat(sender, requestId, aiConfig, messages) {
  const protocol = aiConfig.protocol === 'ollama' ? 'ollama' : 'openai';
  const url = endpoint(aiConfig, protocol === 'ollama' ? '/api/chat' : '/chat/completions');
  const body =
    protocol === 'ollama'
      ? {
          model: aiConfig.model,
          messages,
          stream: true,
          options: { temperature: Number(aiConfig.temperature) || 0.9 }
        }
      : {
          model: aiConfig.model,
          messages,
          stream: true,
          temperature: Number(aiConfig.temperature) || 0.9
        };

  aiAbort = new AbortController();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(aiConfig),
      body: JSON.stringify(body),
      signal: aiAbort.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      sender.send('ai:done', { requestId, aborted: true });
      return;
    }
    throw new Error(`无法连接 ${url} - ${err.message}`);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400);
    throw new Error(`AI 服务返回 HTTP ${res.status} ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const emit = (obj) => {
    let text = '';
    if (protocol === 'ollama') {
      text = (obj.message && obj.message.content) || obj.response || '';
    } else {
      const choice = (obj.choices && obj.choices[0]) || {};
      text = (choice.delta && choice.delta.content) || (choice.message && choice.message.content) || '';
    }
    if (text) {
      full += text;
      sender.send('ai:chunk', { requestId, text });
    }
  };

  const drain = (flush) => {
    const parts = buffer.split('\n');
    buffer = flush ? '' : parts.pop();
    for (let line of parts) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith('data:')) line = line.slice(5).trim();
      if (!line || line === '[DONE]') continue;
      try {
        emit(JSON.parse(line));
      } catch {
        /* keep going: partial or non-JSON keepalive line */
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drain(false);
    }
    buffer += decoder.decode();
    drain(true);
    sender.send('ai:done', { requestId, text: full });
  } catch (err) {
    if (err.name === 'AbortError' || (aiAbort && aiAbort.signal.aborted)) {
      sender.send('ai:done', { requestId, aborted: true, text: full });
    } else {
      throw err;
    }
  } finally {
    aiAbort = null;
  }
}

/* ------------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('config:get', () => loadConfig());
  ipcMain.handle('config:set', (_e, patch) => saveConfig(deepMerge(loadConfig(), patch || {})));

  ipcMain.handle('library:list', () => listBooks());

  ipcMain.handle('book:create', async (_e, { title, author }) => {
    const cfg = loadConfig();
    const root = await ensureDir(cfg.libraryRoot);
    const bookId = uniqueBookDir(root, Store.slugify(title || '未命名作品'));
    const now = new Date().toISOString();
    const chapterId = 'c-' + Date.now().toString(36);
    const book = {
      title: String(title || bookId),
      author: author || '',
      synopsis: '',
      createdAt: now,
      updatedAt: now,
      chapters: [
        {
          id: chapterId,
          title: '第一章',
          volume: '',
          words: 0,
          target: 0,
          createdAt: now,
          updatedAt: now
        }
      ],
      characters: [],
      world: [],
      outline: '',
      daily: {}
    };
    await ensureDir(path.join(root, bookId, CHAPTER_DIR));
    await fsp.writeFile(path.join(root, bookId, CHAPTER_DIR, `${chapterId}.md`), '', 'utf8');
    await writeBook(bookId, book);
    return { id: bookId, book };
  });

  ipcMain.handle('book:open', async (_e, bookId) => {
    const dir = bookPath(bookId);
    const book = JSON.parse(await fsp.readFile(path.join(dir, 'book.json'), 'utf8'));
    book.characters = book.characters || [];
    book.world = book.world || [];
    book.daily = book.daily || {};
    book.outline = book.outline || '';
    book.synopsis = book.synopsis || '';
    book.chapters = book.chapters || [];
    return book;
  });

  ipcMain.handle('book:save', async (_e, { bookId, book }) => {
    await snapshotIfNeeded(bookId);
    return writeBook(bookId, book);
  });

  ipcMain.handle('book:delete', async (_e, bookId) => {
    const dir = bookPath(bookId);
    await shell.trashItem(dir);
    return true;
  });

  ipcMain.handle('chapter:read', async (_e, { bookId, chapterId }) => {
    try {
      return await fsp.readFile(chapterFile(bookId, chapterId), 'utf8');
    } catch {
      return '';
    }
  });

  ipcMain.handle('chapter:write', async (_e, { bookId, chapterId, content }) => {
    const file = chapterFile(bookId, chapterId);
    await ensureDir(path.dirname(file));
    await fsp.writeFile(file, content == null ? '' : String(content), 'utf8');
    return true;
  });

  ipcMain.handle('chapter:delete', async (_e, { bookId, chapterId }) => {
    const file = chapterFile(bookId, chapterId);
    if (fs.existsSync(file)) await shell.trashItem(file);
    return true;
  });

  ipcMain.handle('book:reveal', async (_e, bookId) => {
    shell.openPath(bookPath(bookId));
    return true;
  });

  ipcMain.handle('export:book', async (_e, { bookId, book, format, contents }) => {
    const ext = format === 'md' ? 'md' : 'txt';
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出作品',
      defaultPath: `${book.title || 'novel'}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    });
    if (canceled || !filePath) return { saved: false };
    const text = Store.exportBookText(book, contents || {}, ext);
    await fsp.writeFile(filePath, text, 'utf8');
    return { saved: true, filePath };
  });

  ipcMain.handle('file:open', async (_e, filePath) => {
    if (filePath) shell.openPath(filePath);
    return true;
  });

  ipcMain.handle('ai:models', async (_e, aiConfig) => listModels(aiConfig || loadConfig().ai));

  ipcMain.handle('ai:chat', async (event, { requestId, messages, ai }) => {
    const cfg = ai || loadConfig().ai;
    if (!cfg.model) throw new Error('尚未选择模型，请到设置里填写模型名');
    try {
      await streamChat(event.sender, requestId, cfg, messages);
      return { ok: true };
    } catch (err) {
      event.sender.send('ai:error', { requestId, message: err.message });
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ai:cancel', () => {
    if (aiAbort) aiAbort.abort();
    return true;
  });
}

/* ---------------------------------------------------------------- window */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#303446',
    title: 'Novel Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(RENDERER_DIR, 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
