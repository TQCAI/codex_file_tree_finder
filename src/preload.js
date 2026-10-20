// Appended only to the native app preload, never to web or MCP sandbox preloads.
require('electron').contextBridge.exposeInMainWorld('__codexFinderBridge', {
  invoke: request => require('electron').ipcRenderer.invoke('codex-finder-menu:v1', request)
});
