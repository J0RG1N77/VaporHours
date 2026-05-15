const appidInput = document.getElementById('appid');
const startBtn = document.getElementById('startBtn');
const steamStatus = document.getElementById('steamStatus');
const hint = document.getElementById('hint');
const timerEl = document.getElementById('timer');

let running = false;
let seconds = 0;
let interval = null;
let isRestarting = false;
let localPlayerName = 'Nao';

function setControlsDisabled(disabled) {
  startBtn.disabled = disabled;
  appidInput.disabled = disabled;
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

startBtn.addEventListener('click', async () => {
  if (isRestarting) return;

  const appid = appidInput.value.trim();

  if (!running) {
    if (!appid) {
      alert('Informe um AppID');
      return;
    }

    const data = await window.vaporHours.startFarm(appid);
    if (data && data.success) {
      running = true;
      localPlayerName = data && data.diagnostics && data.diagnostics.localPlayerName
        ? data.diagnostics.localPlayerName
        : 'Desconhecido';
      startBtn.textContent = 'Stop';
      setButtonMode(true);
      hint.textContent = 'Steam API inicializada com sucesso.';
      steamStatus.textContent = `Steam Conectada: ${localPlayerName}`;
      startTimer();
      return;
    }

    const error = data && data.error ? data.error : 'sem detalhes';
    hint.textContent = `Falha: ${error}`;
    alert(`Falha ao iniciar: ${error}`);
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
  steamStatus.textContent = ok ? `Steam Conectada: ${localPlayerName}` : 'Steam Conectada: Nao';
});

setButtonMode(false);
setControlsDisabled(false);
