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

// Guarda a instância do cliente Steam (se inicializada)
let steamClient = null;

// Invalidação de sessão por artefato: removemos qualquer steam_appid.txt
// remanescente antes de iniciar para que a execução sempre comece limpa.
const steamAppIdTargets = [
  path.join(app.getAppPath(), 'steam_appid.txt'),
  path.join(process.cwd(), 'steam_appid.txt'),
  path.join(path.dirname(process.execPath), 'steam_appid.txt'),
];

for (const target of steamAppIdTargets) {
  try {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  } catch (err) {
    console.warn('Nao foi possivel limpar steam_appid.txt na inicializacao:', target, err && err.message);
  }
}

function shutdownSteamClient() {
  if (!steamClient) return { hadClient: false };

  const shutdownDiag = {
    hadClient: true,
    hadShutdownMethod: false,
    shutdownCalled: false,
    error: null,
  };

  try {
    const steamworks = require('steamworks.js');
    if (typeof steamworks.shutdown === 'function') {
      steamworks.shutdown();
      shutdownDiag.hadShutdownMethod = true;
      shutdownDiag.shutdownCalled = true;
      console.log('steamworks.shutdown() executado com sucesso');
    } else {
      console.warn('steamworks nao tem metodo shutdown. Disponíveis:', Object.keys(steamworks || {}));
    }
  } catch (e) {
    shutdownDiag.error = e && e.message ? e.message : String(e);
    console.warn('Erro ao chamar shutdown:', shutdownDiag.error);
  } finally {
    steamClient = null;
  }

  return shutdownDiag;
}

app.on('window-all-closed', function () {
  // Garante cleanup da Steam antes de encerrar a aplicacao.
  shutdownSteamClient();
  for (const target of steamAppIdTargets) {
    try {
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    } catch (err) {
      console.warn('Nao foi possivel remover steam_appid.txt no encerramento:', target, err && err.message);
    }
  }
  if (process.platform !== 'darwin') app.quit();
});

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
    const diag = {
      exports: null,
      restartAppIfNecessary: null,
      initSucceeded: false,
      clientKeys: null,
      localPlayerName: null,
      initStack: null,
    };
    try {
      const steamworks = require('steamworks.js');
      try { diag.exports = Object.keys(steamworks); } catch (e) { diag.exports = String(e && e.message); }

      // Tentativa de chamar restartAppIfNecessary (pode reiniciar o Steam/processo)
      try {
        if (typeof steamworks.restartAppIfNecessary === 'function') {
          diag.restartAppIfNecessary = !!steamworks.restartAppIfNecessary(normalizedAppId);
        }
      } catch (e) {
        diag.restartAppIfNecessary = `error: ${e && e.message}`;
      }

      // Na versao 0.4.x a API correta e `init(appId?)`.
      if (steamworks && typeof steamworks.init === 'function') {
        try {
          steamClient = steamworks.init(normalizedAppId);
          diag.initSucceeded = !!steamClient;
          try { diag.clientKeys = Object.keys(steamClient || {}); } catch (e) { diag.clientKeys = String(e && e.message); }
          // tenta ler nome do jogador local, se disponivel
          try {
            if (steamClient && steamClient.localplayer && typeof steamClient.localplayer.getName === 'function') {
              diag.localPlayerName = steamClient.localplayer.getName();
            }
          } catch (e) {
            diag.localPlayerName = `error: ${e && e.message}`;
          }
        } catch (e) {
          initError = e && e.message ? e.message : String(e);
          diag.initStack = e && e.stack ? e.stack : String(e);
          steamClient = null;
        }
      } else {
        steamClient = null;
        const keys = steamworks && typeof steamworks === 'object' ? Object.keys(steamworks).join(', ') : 'sem exportacoes';
        initError = `API steamworks.js nao reconhecida. Exportacoes: ${keys}`;
      }
    } catch (err) {
      const msg = err && err.message ? err.message : 'erro desconhecido';
      console.error('Falha ao carregar/inicializar steamworks.js:', msg);
      initError = msg;
      try { diag.initStack = err && err.stack ? err.stack : String(err); } catch(e){}
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
      diagnostics: diag,
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
    const shutdownDiag = shutdownSteamClient();
    if (mainWindow) mainWindow.webContents.send('steam-status', false);

    const deleted = [];
    const deleteErrors = [];

    for (const target of steamAppIdTargets) {
      try {
        if (fs.existsSync(target)) {
          fs.unlinkSync(target);
          deleted.push(target);
        }
      } catch (err) {
        deleteErrors.push({ target, error: err && err.message ? err.message : String(err) });
        console.warn('Falha ao remover steam_appid.txt antes do relaunch:', target, err && err.message);
      }
    }

    // Envia detalhes ao renderer para diagnostico.
    if (mainWindow) {
      try {
        mainWindow.webContents.send('stop-results', { deleted, deleteErrors, shutdownDiag });
      } catch (e) {
        console.warn('Nao foi possivel enviar stop-results ao renderer:', e && e.message);
      }
    }

    // Encerramos de fato o processo para que a Steam marque a sessão como parada.
    // O relaunch imediato mantinha o jogo em execução, então o Stop agora apenas fecha.
    setTimeout(() => {
      app.quit();
    }, 500);

    return { success: true, closing: true, deleted, deleteErrors, shutdownDiag };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
