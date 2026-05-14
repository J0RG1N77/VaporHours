const { contextBridge, ipcRenderer } = require('electron');

// Bridge segura: expomos apenas os métodos estritamente necessários.
// O renderer não acessa `ipcRenderer` diretamente.
contextBridge.exposeInMainWorld('vaporHours', {
  startFarm: (appid) => ipcRenderer.invoke('start-farm', appid),
  stopFarm: () => ipcRenderer.invoke('stop-farm'),
  onSteamStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_, status) => callback(Boolean(status));
    ipcRenderer.on('steam-status', listener);

    // Permite remover listener para evitar leaks.
    return () => ipcRenderer.removeListener('steam-status', listener);
  },
});
