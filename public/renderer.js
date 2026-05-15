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

    card.innerHTML = `
      <img class="game-card__cover" src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/library_600x900.jpg" alt="${game.name}" loading="lazy" />
      <div class="game-card__fade"></div>
      <div class="game-card__meta">
        <strong class="game-card__title">${game.name}</strong>
        <span class="game-card__appid">AppID ${game.appId}</span>
      </div>
    `;
    // fallback: se a capa não carregar, usamos um SVG inline como placeholder
    const svgPlaceholder = `data:image/svg+xml;utf8,` + encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='900'>` +
      `<rect width='100%' height='100%' fill='%23101821'/>` +
      `<text x='50%' y='50%' font-size='20' fill='%2399a9b8' text-anchor='middle' dominant-baseline='middle'>Sem capa</text>` +
      `</svg>`
    );

    // depois de injetar, conectamos o handler de erro
    setTimeout(() => {
      const img = card.querySelector('.game-card__cover');
      if (img) {
        img.addEventListener('error', () => {
          img.src = svgPlaceholder;
          img.style.objectFit = 'contain';
        });
      }
    }, 0);

    card.addEventListener('click', () => {
      if (running || isRestarting) return;
      startGame(game);
    });

    gamesGrid.appendChild(card);
  });

  libraryHint.textContent = `${safeGames.length} jogos encontrados na biblioteca Steam local.`;
  startBtn.disabled = true;
  gamesGrid.classList.remove('is-disabled');
}

async function loadMyGames() {
  libraryHint.textContent = 'Carregando biblioteca Steam...';

  const result = await window.vaporHours.getLibrary();
  if (result && result.success) {
    renderGameCards(result.games);
    return;
  }

  const error = result && result.error ? result.error : 'sem detalhes';
  renderGameCards([]);
  libraryHint.textContent = `Falha ao carregar biblioteca: ${error}`;
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
    startBtn.disabled = false;
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
  startBtn.disabled = true;
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
  startBtn.textContent = 'Encerrando sessão...';
  hint.textContent = 'Encerrando sessão...';
  setButtonMode(false);
  setControlsDisabled(true);

  const stop = await window.vaporHours.stopFarm();
  if (stop && stop.success) {
    stopTimer();
    localPlayerName = 'Nao';
    activeGame = null;
    
    // Opcional: mostre detalhes da limpeza quando o main enviar.
    let shutdownInfo = 'Encerrando...\n\n';
    if (stop.shutdownDiag) {
      shutdownInfo += `Shutdown:\n`;
      shutdownInfo += `- hadClient: ${stop.shutdownDiag.hadClient}\n`;
      shutdownInfo += `- hadShutdownMethod: ${stop.shutdownDiag.hadShutdownMethod}\n`;
      shutdownInfo += `- shutdownCalled: ${stop.shutdownDiag.shutdownCalled}\n`;
      shutdownInfo += `- error: ${stop.shutdownDiag.error}\n\n`;
    }
    if (stop.deleted && stop.deleted.length) {
      shutdownInfo += `Arquivos removidos: ${stop.deleted.length}\n`;
    }
    hint.textContent = shutdownInfo;
    
    const unsub = window.vaporHours.onStopResults((info) => {
      if (info && info.deleted && info.deleted.length) {
        hint.textContent = `Arquivos removidos: ${info.deleted.length}`;
      } else if (info && info.deleteErrors && info.deleteErrors.length) {
        hint.textContent = `Erro ao remover arquivos: ${info.deleteErrors[0].error}`;
      }
      unsub();
    });

    return;
  }

  const stopError = stop && stop.error ? stop.error : 'sem detalhes';
  isRestarting = false;
  setControlsDisabled(false);
  setButtonMode(false);
  startBtn.textContent = 'Start';
  hint.textContent = `Falha ao parar: ${stopError}`;
});

window.vaporHours.onSteamStatus((ok) => {
  steamStatus.textContent = ok ? localPlayerName : steamPersonaName;
});

setButtonMode(false);
startBtn.disabled = true;
gamesGrid.classList.remove('is-disabled');
loadMyGames();
loadSteamUser();
