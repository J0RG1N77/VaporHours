const { contextBridge, ipcRenderer } = require('electron');

// Bridge segura: expomos apenas os métodos estritamente necessários.
// O renderer não acessa `ipcRenderer` diretamente.
contextBridge.exposeInMainWorld('vaporHours', {
  getLibrary: () => ipcRenderer.invoke('get-library'),
  getMyGames: () => ipcRenderer.invoke('get-library'),
  startFarm: (appid) => ipcRenderer.invoke('start-farm', appid),
  stopFarm: () => ipcRenderer.invoke('stop-farm'),
  onSteamStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_, status) => callback(Boolean(status));
    ipcRenderer.on('steam-status', listener);

    // Permite remover listener para evitar leaks.
    return () => ipcRenderer.removeListener('steam-status', listener);
  },
  onStopResults: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_, info) => callback(info);
    ipcRenderer.on('stop-results', listener);

    return () => ipcRenderer.removeListener('stop-results', listener);
  },
});
