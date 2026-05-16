const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const dotenv = require('dotenv');
const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '.env');

dotenv.config({ path: envPath });

let mainWindow;
let loggedSteamContext = null;
let loggedSteamContextPromise = null;
let steamworksRuntime = null;

function createWindow() {
  // Seleciona o ícone apropriado por plataforma a partir dos ícones gerados em build/icons
  const defaultIcon = (process.platform === 'win32')
    ? path.join(__dirname, 'build', 'icons', 'win', 'icon.ico')
    : (process.platform === 'darwin')
      ? path.join(__dirname, 'build', 'icons', 'mac', 'icon.icns')
      : path.join(__dirname, 'build', 'icons', 'png', '512x512.png');
  mainWindow = new BrowserWindow({
    icon: defaultIcon,
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 760,
    resizable: true,
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
  primeLoggedSteamContext().catch(() => {});
  // No Windows, define um AppUserModelId para associar o ícone ao
  // atalho/tarefa do sistema. Ajuste se tiver um AppID reverso próprio.
  if (process.platform === 'win32') {
    try {
      app.setAppUserModelId('com.vaporhours.VaporHours');
    } catch (e) {
      console.warn('Falha ao setar AppUserModelId:', e && e.message ? e.message : e);
    }
  }

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Guarda a instância do cliente Steam (se inicializada)
let steamClient = null;

function normalizeGameList(gameList) {
  if (!Array.isArray(gameList)) return [];

  return gameList
    .map((game) => {
      const appId = Number(game && game.appId);
      const name = String(game && game.name ? game.name : '').trim();

      if (!Number.isInteger(appId) || appId <= 0) return null;

      return {
        appId,
        name: name || `App ${appId}`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' }));
}

function normalizeSteamWebApiGames(games) {
  return normalizeGameList(games.map((game) => ({
    appId: Number(game && game.appid),
    name: String(game && game.name ? game.name : '').trim(),
  })));
}

function getSteamLoginUserFileCandidates() {
  const steamRoots = [
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Steam'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Steam'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Steam'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ].filter(Boolean);

  return [...new Set(steamRoots.map((steamRoot) => path.join(steamRoot, 'config', 'loginusers.vdf')))];
}

function readVdfQuotedValue(content, key) {
  const pattern = new RegExp(`"${key}"\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i');
  const match = content.match(pattern);

  if (!match) return '';

  return match[1]
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseLoggedSteamContextFromLoginUsers(content) {
  const userBlocks = [...content.matchAll(/"(\d{17})"\s*\{([\s\S]*?)\}/g)];

  if (!userBlocks.length) {
    throw new Error('Nao foi possivel encontrar contas no loginusers.vdf.');
  }

  const accounts = userBlocks.map((match) => {
    const steamId = String(match[1]).trim();
    const block = String(match[2] || '');

    return {
      steamId,
      personaName: readVdfQuotedValue(block, 'PersonaName') || readVdfQuotedValue(block, 'AccountName') || '',
      mostRecent: readVdfQuotedValue(block, 'MostRecent') === '1',
      timestamp: Number(readVdfQuotedValue(block, 'Timestamp') || 0),
    };
  });

  const mostRecentAccount = accounts.find((account) => account.mostRecent)
    || accounts.sort((left, right) => right.timestamp - left.timestamp)[0];

  if (!mostRecentAccount || !mostRecentAccount.steamId) {
    throw new Error('Nao foi possivel detectar a conta Steam logada.');
  }

  return {
    steamId: mostRecentAccount.steamId,
    personaName: mostRecentAccount.personaName,
  };
}

function readLoggedSteamContextFromDisk() {
  const candidates = getSteamLoginUserFileCandidates();
  const existingFile = candidates.find((candidate) => fs.existsSync(candidate));

  if (!existingFile) {
    throw new Error('Nao foi possivel localizar o arquivo loginusers.vdf da Steam.');
  }

  const content = fs.readFileSync(existingFile, 'utf8');
  return parseLoggedSteamContextFromLoginUsers(content);
}

function primeLoggedSteamContext() {
  if (!loggedSteamContextPromise) {
    loggedSteamContextPromise = getLoggedSteamContext().catch((err) => {
      loggedSteamContextPromise = null;
      throw err;
    });
  }

  return loggedSteamContextPromise;
}

async function getLoggedSteamContext() {
  if (loggedSteamContext) return loggedSteamContext;
  if (loggedSteamContextPromise) return loggedSteamContextPromise;

  loggedSteamContextPromise = Promise.resolve().then(() => {
    const context = readLoggedSteamContextFromDisk();
    loggedSteamContext = context;
    return loggedSteamContext;
  }).finally(() => {
    loggedSteamContextPromise = null;
  });

  return loggedSteamContextPromise;
}

async function getSteamPersonaName(steamId) {
  const steamWebKey = process.env.STEAM_WEB_KEY;

  if (!steamWebKey) {
    throw new Error('STEAM_WEB_KEY nao configurado.');
  }

  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(steamWebKey)}&steamids=${encodeURIComponent(steamId)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Steam Web API respondeu com status ${response.status}.`);
  }

  const payload = await response.json();
  const player = payload && payload.response && Array.isArray(payload.response.players)
    ? payload.response.players[0]
    : null;

  return player && player.personaname ? String(player.personaname).trim() : '';
}

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
    if (steamworksRuntime && typeof steamworksRuntime.shutdown === 'function') {
      steamworksRuntime.shutdown();
      shutdownDiag.hadShutdownMethod = true;
      shutdownDiag.shutdownCalled = true;
      console.log('steamworks.shutdown() executado com sucesso');
    } else {
      console.warn('steamworks nao tem metodo shutdown.');
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

ipcMain.handle('get-library', async () => {
  try {
    const steamWebKey = process.env.STEAM_WEB_KEY;

    if (!steamWebKey) {
      throw new Error('STEAM_WEB_KEY nao configurado.');
    }

    const { steamId } = await getLoggedSteamContext();

    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(steamWebKey)}&steamid=${encodeURIComponent(steamId)}&format=json&include_appinfo=true&include_played_free_games=true`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Steam Web API respondeu com status ${response.status}.`);
    }

    const payload = await response.json();
    const games = normalizeSteamWebApiGames((payload && payload.response && payload.response.games) || []);

    return { success: true, games };
  } catch (err) {
    const message = err && err.message ? err.message : 'Nao foi possivel carregar a biblioteca Steam.';
    return { success: false, error: message, games: [] };
  }
});

ipcMain.handle('get-steam-user', async () => {
  try {
    const { steamId } = await getLoggedSteamContext();
    const personaName = await getSteamPersonaName(steamId);
    return {
      success: true,
      steamId,
      personaName,
    };
  } catch (err) {
    const message = err && err.message ? err.message : 'Nao foi possivel carregar o usuario Steam.';
    return { success: false, error: message, personaName: '' };
  }
});

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
      steamworksRuntime = steamworks;
      try { diag.exports = Object.keys(steamworks); } catch (e) { diag.exports = String(e && e.message); }

      // Evitamos restartAppIfNecessary para reduzir efeitos colaterais no runtime.
      diag.restartAppIfNecessary = 'skipped';

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

    // Encerramos o processo de fato para que a Steam perceba o fim da sessão.
    setTimeout(() => {
      app.quit();
    }, 1500);

    return { success: true, closing: true, deleted, deleteErrors, shutdownDiag };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
