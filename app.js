const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 320,
    resizable: false,
    webPreferences: {
      // Modo seguro de produção:
      // - renderer sem acesso direto ao Node.js
      // - bridge controlada no preload para IPC explícito
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Guarda a instância do cliente Steam (se inicializada)
let steamClient = null;

function writeSteamAppId(appid) {
  const value = `${String(appid).trim()}\n`;
  const targets = [
    path.join(app.getAppPath(), 'steam_appid.txt'),
    path.join(process.cwd(), 'steam_appid.txt'),
    path.join(path.dirname(process.execPath), 'steam_appid.txt'),
  ];

  const written = [];
  const errors = [];

  for (const target of targets) {
    try {
      fs.writeFileSync(target, value, 'utf8');
      written.push(target);
    } catch (err) {
      errors.push(`${target}: ${err && err.message ? err.message : 'erro desconhecido'}`);
    }
  }

  return { written, errors };
}

/**
 * IPC: Recebe pedido para iniciar o "farm".
 * Fluxo:
 * - Recebe um AppID do renderer via `start-farm`.
 * - Cria/reescreve `steam_appid.txt` na raiz da aplicação (app.getAppPath()).
 * - Tenta inicializar a Steam API local via `steamworks.js`.
 * - Responde ao renderer com `farm-started` e envia status via `steam-status`.
 */
ipcMain.handle('start-farm', async (_, appid) => {
  try {
    const normalizedAppId = Number(String(appid).trim());
    if (!Number.isInteger(normalizedAppId) || normalizedAppId <= 0) {
      const payload = { success: false, error: 'AppID invalido.' };
      if (mainWindow) mainWindow.webContents.send('steam-status', false);
      return payload;
    }

    const appIdWriteResult = writeSteamAppId(normalizedAppId);

    // Tenta carregar e inicializar steamworks.js.
    let initError = null;
    try {
      const steamworks = require('steamworks.js');

      // Na versao 0.4.x a API correta e `init(appId?)`.
      if (steamworks && typeof steamworks.init === 'function') {
        steamClient = steamworks.init(normalizedAppId);
      } else {
        steamClient = null;
        const keys = steamworks && typeof steamworks === 'object' ? Object.keys(steamworks).join(', ') : 'sem exportacoes';
        initError = `API steamworks.js nao reconhecida. Exportacoes: ${keys}`;
      }
    } catch (err) {
      const msg = err && err.message ? err.message : 'erro desconhecido';
      console.error('Falha ao carregar/inicializar steamworks.js:', msg);
      initError = msg;
      steamClient = null;
    }

    const initialized = !!steamClient;
    return {
      success: initialized,
      error: initialized
        ? null
        : initError || 'Nao foi possivel inicializar a Steam API local para este AppID.',
      appidPaths: appIdWriteResult.written,
      appidWriteErrors: appIdWriteResult.errors,
    };
  } catch (err) {
    console.error(err);
    const payload = { success: false, error: err.message };
    if (mainWindow) mainWindow.webContents.send('steam-status', false);
    return payload;
  } finally {
    if (mainWindow) {
      const ok = !!steamClient;
      mainWindow.webContents.send('steam-status', ok);
    }
  }
});

/**
 * IPC: Recebe pedido para parar o farm.
 * - Faz shutdown da API Steam (se disponível) e limpa estado.
 */
ipcMain.handle('stop-farm', () => {
  try {
    if (steamClient) {
      try {
        if (typeof steamClient.shutdown === 'function') steamClient.shutdown();
      } catch (e) {
        console.warn('Erro ao chamar shutdown:', e && e.message);
      }
    }

    steamClient = null;
    if (mainWindow) mainWindow.webContents.send('steam-status', false);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
