'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (handler) => {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),

  listBooks: () => ipcRenderer.invoke('library:list'),
  createBook: (payload) => ipcRenderer.invoke('book:create', payload),
  openBook: (bookId) => ipcRenderer.invoke('book:open', bookId),
  saveBook: (payload) => ipcRenderer.invoke('book:save', payload),
  deleteBook: (bookId) => ipcRenderer.invoke('book:delete', bookId),
  revealBook: (bookId) => ipcRenderer.invoke('book:reveal', bookId),

  readChapter: (payload) => ipcRenderer.invoke('chapter:read', payload),
  writeChapter: (payload) => ipcRenderer.invoke('chapter:write', payload),
  deleteChapter: (payload) => ipcRenderer.invoke('chapter:delete', payload),

  exportBook: (payload) => ipcRenderer.invoke('export:book', payload),
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),

  aiModels: (ai) => ipcRenderer.invoke('ai:models', ai),
  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  aiCancel: () => ipcRenderer.invoke('ai:cancel'),
  onAiChunk: on('ai:chunk'),
  onAiDone: on('ai:done'),
  onAiError: on('ai:error')
});
