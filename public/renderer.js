const appidInput = document.getElementById('appid');
const startBtn = document.getElementById('startBtn');
const steamStatus = document.getElementById('steamStatus');
const hint = document.getElementById('hint');
const timerEl = document.getElementById('timer');

let running = false;
let seconds = 0;
let interval = null;

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
  const appid = appidInput.value.trim();

  if (!running) {
    if (!appid) {
      alert('Informe um AppID');
      return;
    }

    const data = await window.vaporHours.startFarm(appid);
    if (data && data.success) {
      running = true;
      startBtn.textContent = 'Stop';
      setButtonMode(true);
      hint.textContent = 'Steam API inicializada com sucesso.';
      startTimer();
      return;
    }

    const error = data && data.error ? data.error : 'sem detalhes';
    hint.textContent = `Falha: ${error}`;
    alert(`Falha ao iniciar: ${error}`);
    return;
  }

  const stop = await window.vaporHours.stopFarm();
  if (stop && stop.success) {
    running = false;
    startBtn.textContent = 'Start';
    setButtonMode(false);
    hint.textContent = 'Farm parado.';
    stopTimer();
    return;
  }

  const stopError = stop && stop.error ? stop.error : 'sem detalhes';
  hint.textContent = `Falha ao parar: ${stopError}`;
});

window.vaporHours.onSteamStatus((ok) => {
  steamStatus.textContent = ok ? 'Sim' : 'Nao';
});

setButtonMode(false);
