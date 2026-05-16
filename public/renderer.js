const gamesGrid = document.getElementById('games-grid');
const startBtn = document.getElementById('startBtn');
const steamStatus = document.getElementById('steamStatus');
const libraryHint = document.getElementById('libraryHint');
const hint = document.getElementById('hint');
const timerEl = document.getElementById('timer');

let running = false;
let seconds = 0;
let interval = null;
let isRestarting = false;
let localPlayerName = 'Nao';
let steamPersonaName = 'Nao';
let activeGame = null;

function setControlsDisabled(disabled) {
  startBtn.disabled = disabled;
  gamesGrid.classList.toggle('is-disabled', disabled);
}

function setButtonMode(isRunning) {
  startBtn.classList.remove('btn-start', 'btn-stop');
  startBtn.classList.add(isRunning ? 'btn-stop' : 'btn-start');
}

function refreshStartButtonState() {
  // Enquanto o farm está ativo, o botão precisa permanecer habilitado para permitir Stop.
  if (running) {
    startBtn.disabled = false;
    return;
  }

  // Fora do estado de farm, o botão só fica habilitado quando houver uma ação válida.
  startBtn.disabled = isRestarting || !activeGame;
}

function formatTime(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function startTimer() {
  seconds = 0;
  timerEl.textContent = formatTime(seconds);

  if (interval) clearInterval(interval);
  interval = setInterval(() => {
    seconds += 1;
    timerEl.textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  if (interval) clearInterval(interval);
  interval = null;
}

function renderGameCards(games) {
  const safeGames = Array.isArray(games) ? games : [];

  gamesGrid.innerHTML = '';

  if (!safeGames.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'grid-empty';
    emptyState.textContent = 'Nenhum jogo encontrado na biblioteca local';
    gamesGrid.appendChild(emptyState);
    libraryHint.textContent = 'Abra a Steam e verifique se sua biblioteca está disponível.';
    startBtn.disabled = true;
    return;
  }

  safeGames.forEach((game) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'game-card';
    card.dataset.appId = String(game.appId);
    card.dataset.gameName = game.name;

    const cover = document.createElement('img');
    cover.className = 'game-card__cover';
    cover.loading = 'lazy';
    cover.alt = String(game.name || 'Jogo da biblioteca');
    cover.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/library_600x900.jpg`;

    const fade = document.createElement('div');
    fade.className = 'game-card__fade';

    const meta = document.createElement('div');
    meta.className = 'game-card__meta';

    const title = document.createElement('strong');
    title.className = 'game-card__title';
    title.textContent = String(game.name || 'Jogo sem nome');

    const appId = document.createElement('span');
    appId.className = 'game-card__appid';
    appId.textContent = `AppID ${game.appId}`;

    meta.appendChild(title);
    meta.appendChild(appId);
    card.appendChild(cover);
    card.appendChild(fade);
    card.appendChild(meta);

    // fallback: se a capa não carregar, usamos um SVG inline como placeholder
    const svgPlaceholder = `data:image/svg+xml;utf8,` + encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='900'>` +
      `<rect width='100%' height='100%' fill='%23101821'/>` +
      `<text x='50%' y='50%' font-size='20' fill='%2399a9b8' text-anchor='middle' dominant-baseline='middle'>Sem capa</text>` +
      `</svg>`
    );

    cover.addEventListener('error', () => {
      cover.src = svgPlaceholder;
      cover.style.objectFit = 'contain';
    });

    card.addEventListener('click', () => {
      if (running || isRestarting) return;
      startGame(game);
    });

    gamesGrid.appendChild(card);
  });

  libraryHint.textContent = `${safeGames.length} jogos encontrados na biblioteca Steam local.`;
  gamesGrid.classList.remove('is-disabled');
  refreshStartButtonState();
}

let allGamesCache = [];

function applySearchFilter(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return allGamesCache.slice();

  return allGamesCache.filter((g) => {
    const name = String(g.name || '').toLowerCase();
    const id = String(g.appId || '');
    return name.includes(q) || id.includes(q);
  });
}

async function loadMyGames() {
  libraryHint.textContent = 'Carregando biblioteca Steam...';

  const result = await window.vaporHours.getLibrary();
  if (result && result.success) {
    allGamesCache = Array.isArray(result.games) ? result.games : [];
    renderGameCards(allGamesCache.slice());
    return;
  }

  const error = result && result.error ? result.error : 'sem detalhes';
  allGamesCache = [];
  renderGameCards([]);
  libraryHint.textContent = `Falha ao carregar biblioteca: ${error}`;
}

// Busca: debounce simples
let searchTimeout = null;
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');

function doSearch(q) {
  const filtered = applySearchFilter(q);
  renderGameCards(filtered);
}

if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const v = e.target.value || '';
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => doSearch(v), 180);
  });
}

if (searchClear) {
  searchClear.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    doSearch('');
    if (searchInput) searchInput.focus();
  });
}

async function loadSteamUser() {
  const result = await window.vaporHours.getSteamUser();

  if (result && result.success && result.personaName) {
    steamPersonaName = result.personaName;
    if (!running) {
      steamStatus.textContent = steamPersonaName;
    }
    return;
  }

  steamPersonaName = 'Nao';
  if (!running) {
    steamStatus.textContent = 'Nao';
  }
}

async function startGame(game) {
  if (!game || isRestarting || running) return;

  activeGame = game;
  setControlsDisabled(true);
  hint.textContent = `Iniciando ${game.name}...`;

  const data = await window.vaporHours.startFarm(String(game.appId));
  if (data && data.success) {
    running = true;
    localPlayerName = data && data.diagnostics && data.diagnostics.localPlayerName
      ? data.diagnostics.localPlayerName
      : 'Desconhecido';
    startBtn.textContent = 'Stop';
    setButtonMode(true);
    refreshStartButtonState();
    gamesGrid.classList.add('is-disabled');
    hint.textContent = `Farm iniciada em ${game.name}.`;
    steamStatus.textContent = localPlayerName;
    startTimer();
    return;
  }

  activeGame = null;
  const error = data && data.error ? data.error : 'sem detalhes';
  hint.textContent = `Falha: ${error}`;
  alert(`Falha ao iniciar: ${error}`);
  refreshStartButtonState();
  gamesGrid.classList.remove('is-disabled');
}

startBtn.addEventListener('click', async () => {
  if (isRestarting) return;

  if (!running) {
    if (!activeGame) {
      alert('Clique em um jogo da biblioteca para iniciar.');
      return;
    }

    await startGame(activeGame);
    return;
  }

  // Ao parar, bloqueamos a interface imediatamente para evitar cliques repetidos
  // enquanto o main process limpa a sessao e encerra o app.
  isRestarting = true;
  running = false;
  startBtn.textContent = 'Encerrando farm...';
  hint.textContent = 'Encerrando farm...';
  setButtonMode(false);
  setControlsDisabled(true);

  const stop = await window.vaporHours.stopFarm();
  if (stop && stop.success) {
    stopTimer();
    localPlayerName = 'Nao';
    activeGame = null;

    hint.textContent = 'Encerrando farm...';

    return;
  }

  const stopError = stop && stop.error ? stop.error : 'sem detalhes';
  isRestarting = false;
  setControlsDisabled(false);
  setButtonMode(false);
  startBtn.textContent = 'Start';
  hint.textContent = `Falha ao parar: ${stopError}`;
  refreshStartButtonState();
});

window.vaporHours.onSteamStatus((ok) => {
  steamStatus.textContent = ok ? localPlayerName : steamPersonaName;
});

setButtonMode(false);
refreshStartButtonState();
gamesGrid.classList.remove('is-disabled');
loadMyGames();
loadSteamUser();
