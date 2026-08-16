// Preload script (sandbox: true — only the contextBridge/ipcRenderer subset of
// electron is available here). Exposes window.__soaDesktop, the single
// desktop-bridge entry the renderer uses (app/lib/desktopBridge.ts
// isDesktopBridge() checks isDesktop):
//   storeInit:       invoke 'desktop:store-init'  -> full store snapshot
//   storeOp:         invoke 'desktop:store-op'    -> applies one of the 6 mutators
//   settingsLoad:    sendSync 'desktop:settings-load' -> cached settings JSON
//                    (cold paths only: module mount / analysis start)
//   settingsSaveAsync: invoke 'desktop:settings-save-async' -> cache + persist
//                    via child. Async on purpose: sendSync inside React event
//                    handlers intermittently deadlocks the renderer (sync Mojo
//                    cond_wait; 08-16-desktop-app empirical finding).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__soaDesktop', {
  isDesktop: true,
  storeInit: () => ipcRenderer.invoke('desktop:store-init'),
  storeOp: (op, args) => ipcRenderer.invoke('desktop:store-op', op, args),
  settingsLoad: () => ipcRenderer.sendSync('desktop:settings-load'),
  settingsSaveAsync: (json) => ipcRenderer.invoke('desktop:settings-save-async', json),
});
