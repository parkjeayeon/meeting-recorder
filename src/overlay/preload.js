const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', on),
  action: (name) => ipcRenderer.send('overlay:action', name),
  onState: (cb) => ipcRenderer.on('overlay:state', (_e, s) => cb(s)),
  onLevel: (cb) => ipcRenderer.on('overlay:level', (_e, l) => cb(l)),
  onStage: (cb) => ipcRenderer.on('overlay:stage', (_e, s) => cb(s)),
});
