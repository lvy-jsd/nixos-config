/*
 * Pure data helpers for Novel Studio.
 *
 * Loaded both by the renderer (<script src="store.js">) and by node for tests,
 * so everything here must stay free of DOM and Electron APIs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Store = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
  var LATIN_WORD = /[A-Za-z0-9\u00c0-\u024f]+(?:['’-][A-Za-z0-9\u00c0-\u024f]+)*/g;

  /** Novel word count: every CJK character is one word, every latin run is one word. */
  function countWords(text) {
    if (!text) return 0;
    var cjk = 0;
    var rest = [];
    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      if (CJK.test(ch)) {
        cjk += 1;
        rest.push(' ');
      } else {
        rest.push(ch);
      }
    }
    var latin = rest.join('').match(LATIN_WORD);
    return cjk + (latin ? latin.length : 0);
  }

  function uid(prefix) {
    return (
      (prefix || 'id') +
      '-' +
      Date.now().toString(36) +
      Math.floor(Math.random() * 46656).toString(36)
    );
  }

  /** Directory-safe name that keeps CJK characters readable. */
  function slugify(title) {
    var s = String(title || '')
      .trim()
      // ASCII and full-width variants of the characters Windows rejects
      .replace(/[\\/:*?"<>|／＼：＊？＂＜＞｜\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 60)
      .trim();
    return s || 'untitled';
  }

  function todayStr(date) {
    var d = date || new Date();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  function createBook(title, author) {
    var now = new Date().toISOString();
    return {
      id: '',
      title: title || '未命名作品',
      author: author || '',
      synopsis: '',
      createdAt: now,
      updatedAt: now,
      chapters: [],
      characters: [],
      world: [],
      outline: '',
      daily: {}
    };
  }

  function createChapter(title) {
    var now = new Date().toISOString();
    return {
      id: uid('c'),
      title: title || '新章节',
      volume: '',
      words: 0,
      target: 0,
      createdAt: now,
      updatedAt: now
    };
  }

  function chapterIndex(book, chapterId) {
    for (var i = 0; i < book.chapters.length; i += 1) {
      if (book.chapters[i].id === chapterId) return i;
    }
    return -1;
  }

  function moveChapter(book, chapterId, delta) {
    var i = chapterIndex(book, chapterId);
    var j = i + delta;
    if (i < 0 || j < 0 || j >= book.chapters.length) return false;
    var tmp = book.chapters[i];
    book.chapters[i] = book.chapters[j];
    book.chapters[j] = tmp;
    return true;
  }

  function bookStats(book) {
    var total = 0;
    var today = book.daily && book.daily[todayStr()] ? book.daily[todayStr()] : 0;
    for (var i = 0; i < book.chapters.length; i += 1) total += book.chapters[i].words || 0;
    return { words: total, chapters: book.chapters.length, today: today };
  }

  /** Accumulate today's delta; only growth counts, deletions never subtract. */
  function trackDelta(book, delta) {
    if (!delta || delta <= 0) return;
    book.daily = book.daily || {};
    var key = todayStr();
    book.daily[key] = (book.daily[key] || 0) + delta;
  }

  function exportBookText(book, contents, format) {
    var md = format === 'md';
    var out = [];
    out.push(md ? '# ' + book.title : book.title);
    if (book.author) out.push(md ? '**作者：' + book.author + '**' : '作者：' + book.author);
    if (book.synopsis) {
      out.push('');
      out.push(book.synopsis);
    }
    out.push('');
    var currentVolume = null;
    for (var i = 0; i < book.chapters.length; i += 1) {
      var ch = book.chapters[i];
      if (ch.volume && ch.volume !== currentVolume) {
        currentVolume = ch.volume;
        out.push('');
        out.push(md ? '## ' + ch.volume : '=== ' + ch.volume + ' ===');
        out.push('');
      }
      out.push(md ? '### ' + ch.title : ch.title);
      out.push('');
      var body = (contents && contents[ch.id]) || '';
      out.push(body.replace(/\s+$/, ''));
      out.push('');
      out.push('');
    }
    return out.join('\n');
  }

  function fmtNum(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    countWords: countWords,
    uid: uid,
    slugify: slugify,
    todayStr: todayStr,
    createBook: createBook,
    createChapter: createChapter,
    chapterIndex: chapterIndex,
    moveChapter: moveChapter,
    bookStats: bookStats,
    trackDelta: trackDelta,
    exportBookText: exportBookText,
    fmtNum: fmtNum,
    escapeHtml: escapeHtml
  };
});
