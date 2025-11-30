// ui.js — small helper for animations & theme toggles

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const themeBtn = document.getElementById('themeBtn');
  const installBtn = document.getElementById('installBtn');
  const log = document.getElementById('log');

  // pulsing effect for start button
  let pulse;
  function setPulsing(on){
    startBtn.style.transition = 'transform 160ms';
    if(on){
      pulse = setInterval(()=> {
        startBtn.style.transform = (startBtn.style.transform === 'scale(1.02)') ? 'scale(1)' : 'scale(1.02)';
      }, 700);
    } else {
      clearInterval(pulse); startBtn.style.transform = 'scale(1)';
    }
  }
  setPulsing(false);

  // Theme toggle (soft dark)
  let dark = false;
  themeBtn.addEventListener('click', () => {
    dark = !dark;
    if(dark){
      document.documentElement.style.setProperty('--panel','#3c2f2a');
      document.documentElement.style.setProperty('--bg','#1f1b1a');
      document.body.style.color = '#F5ECE6';
      setPulsing(true);
    } else {
      document.documentElement.style.setProperty('--panel','#FFEFD5');
      document.documentElement.style.setProperty('--bg','#FFF7EE');
      document.body.style.color = 'var(--muted)';
      setPulsing(false);
    }
  });

  // show install prompt when available
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if(choice.outcome === 'accepted') {
      log.textContent += `[${new Date().toLocaleTimeString()}] App installed\n`;
    }
    installBtn.hidden = true;
    deferredPrompt = null;
  });

  // small helper to write logs from other modules (global)
  window.UKCOZY = {
    log: (msg) => {
      log.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
      log.scrollTop = log.scrollHeight;
    },
    setStartPulsing: setPulsing
  };
});
