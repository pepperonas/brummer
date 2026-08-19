// Brummer -- Einstieg. Verbindet Eingabe, Netz und Darstellung.
import { Net, INTERP_MS } from './net.js';
import { Renderer, SLOT_COLORS } from './render.js';
import { Input } from './input.js';
import { TICK_HZ, DT, BITE, BARK, SNIFF, SNIFF as SN, DIG, houseFor, ARENA } from '../../shared/sim.js';

const $ = s => document.querySelector(s);
const canvas = $('#game');
const net = new Net();
const input = new Input(canvas);
let renderer = null, running = false, revealUntil = 0;
let lastCd = { bite: 0, bark: 0, nose: 0 };

const store = {
  get name() { return localStorage.getItem('br-name') || ''; },
  set name(v) { localStorage.setItem('br-name', v); },
  get code() { return localStorage.getItem('br-code') || ''; },
  set code(v) { localStorage.setItem('br-code', v); },
};

// ------------------------------------------------------------- Laden
async function loadAtlas() {
  const json = await (await fetch('/assets/atlas.json')).json();
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = '/assets/atlas.png'; });
  return { img, json };
}

// ------------------------------------------------------------- Meldungen
function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'msg ' + kind;
  el.textContent = text;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ------------------------------------------------------------- Ereignisse
net.onEvent = ev => {
  if (!renderer) return;
  const mine = ev.id === net.you || ev.a === net.you || ev.b === net.you;
  switch (ev.e) {
    case 'bite': {
      renderer.spawn('bite', ev.x, ev.y, { life: 0.35, a0: Math.random() * 6 });
      renderer.dust(ev.x, ev.y, 4, 34);
      if (ev.b === net.you) toast(ev.stole ? 'Gebissen — Knochen weg!' : 'Gebissen!', 'bad');
      else if (ev.a === net.you) toast(ev.stole ? 'Knochen geklaut!' : 'Biss sitzt', 'good');
      break;
    }
    case 'bark':
      renderer.spawn('bark', ev.x, ev.y, { life: 0.5, r: BARK.radius });
      break;
    case 'deliver':
      renderer.spawn('score', ev.x, ev.y, { life: 1.1, text: '+1' });
      if (ev.id === net.you) toast('Knochen abgeliefert · ' + ev.score, 'good');
      break;
    case 'dig':
      renderer.dust(ev.x, ev.y, 10, 60);
      if (ev.id === net.you) toast('Depot gehoben: ' + ev.n + ' Knochen', 'good');
      break;
    case 'grab':
      if (ev.id === net.you) renderer.spawn('score', net.me.x, net.me.y, { life: .7, text: 'Knochen!' });
      break;
    case 'round':
      if (ev.phase === 'over') showOver(ev.board);
      else hideOver();
      break;
    case 'err':
      toast(ev.msg, 'bad');
      break;
  }
};
net.onMeta = () => drawBoard();
net.onClose = () => { if (running) { toast('Verbindung getrennt', 'bad'); setTimeout(leave, 900); } };

// ------------------------------------------------------------- HUD
function drawBoard() {
  const rows = net.scoreboard();
  $('#board').innerHTML = rows.map(r =>
    `<li class="${r.you ? 'me' : ''} ${r.bot ? 'bot' : ''}">
       <span class="dot" style="background:${SLOT_COLORS[r.slot % 8]}"></span>
       <span class="nm">${esc(r.name)}</span><span class="sc">${r.score}</span>
     </li>`).join('');
}
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function updateHud() {
  const me = net.me;
  if (!me) return;
  const mm = Math.floor(net.phaseT / 60), ss = String(Math.floor(net.phaseT % 60)).padStart(2, '0');
  $('#timer').textContent = `${mm}:${ss}`;
  const bar = $('#stam');
  bar.style.width = Math.round(me.stam) + '%';
  bar.classList.toggle('low', me.stam < 30);
  setCd('#cd-bite', me.biteCd, BITE.cd);
  setCd('#cd-bark', me.barkCd, BARK.cd);
  setCd('#cd-nose', me.sniffCd, SNIFF.cd);
}
function setCd(sel, left, total) {
  const el = $(sel);
  const ready = left <= 0.001;
  el.classList.toggle('cool', !ready);
  el.classList.toggle('ready', ready);
}

function showOver(board) {
  if (!board) return;
  $('#over-board').innerHTML = board.slice(0, 8).map((b, i) =>
    `<li class="${i === 0 ? 'win' : ''}">
       <span class="dot" style="background:${SLOT_COLORS[b.id % 8]};width:10px;height:10px;border-radius:50%"></span>
       <span class="n">${esc(b.name)}${b.bot ? ' ·' : ''}</span>
       <span class="s">${b.score}</span>
     </li>`).join('');
  $('#over').hidden = false;
  loadLeaderboard();
}
function hideOver() { $('#over').hidden = true; }

// ------------------------------------------------------------- Schleife
let acc = 0, last = 0;
function loop(ts) {
  if (!running) return;
  const now = ts / 1000;
  const dt = Math.min(0.1, last ? now - last : 0);
  last = now;

  // Eingabe im festen Takt senden -- gleiche Frequenz wie der Server rechnet
  acc += dt;
  let steps = 0;
  while (acc >= DT && steps < 4) { acc -= DT; steps++; net.sendInput(input.read()); }

  const players = net.view();
  const me = players.find(p => p.you);

  // Zeigersteuerung: Richtung je Bild neu berechnen, damit der Hund dem Zeiger
  // FOLGT und nicht nur einmal losläuft.
  input.setAim(me && renderer && input.mouse.inside
    ? renderer.aimDelta(input.mouse.x, input.mouse.y, me.x, me.y)
    : null);
  if (me) renderer.follow(me.x, me.y, dt);

  // Staub und Erde kommen aus dem Renderer -- dort liegen Schritt- und
  // Schlagphase, also faellt beides auf den FUSSTRITT bzw. den Schuerfer statt
  // nach Wuerfel. Der alte Wurf hier haing an der Bildrate des Geraets: bei
  // 144 Hz das 2,4-fache eines 60-Hz-Geraets.
  // Zielmarke: ohne sie sieht man beim Klick-Laufen nicht, wohin der Hund will.
  if (input.mouse.held && input.mouse.inside && input.aim && input.aim.dist > 24) {
    const [wx, wy] = renderer.toWorld(input.mouse.x, input.mouse.y);
    renderer.spawn('aim', wx, wy, { life: 0.001 });   // eine Runde sichtbar
  }

  // Schnueffeln macht Depots sichtbar
  if (me && me.sniff) {
    revealUntil = performance.now() + 300;
    if (Math.random() < 0.25) renderer.spawn('scent', me.x, me.y, { life: 1.1, r: SNIFF.radius * 0.5 });
  }

  renderer.render({
    players,
    bones: net.bonesView(),
    caches: net.caches,
    revealed: performance.now() < revealUntil,
    slots: [...net.meta.keys()],
  }, dt);

  updateHud();
  if (net._boardT === undefined || ts - net._boardT > 400) { net._boardT = ts; drawBoard(); }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------- Ablauf
async function play(roomCode) {
  const name = ($('#name').value || 'Tyson').trim().slice(0, 14);
  store.name = name;
  $('#btn-play').disabled = true;
  $('#btn-play').textContent = 'Verbinde …';
  try {
    if (!renderer) {
      const { img, json } = await loadAtlas();
      renderer = new Renderer(canvas, img, json);
    }
  } catch (e) {
    $('#btn-play').disabled = false;
    $('#btn-play').textContent = 'Spielen';
    return toast('Grafik konnte nicht geladen werden', 'bad');
  }
  net.connect(name, roomCode, store.code);
  const t0 = Date.now();
  const wait = setInterval(() => {
    if (net.connected) {
      clearInterval(wait);
      if (net.code) store.code = net.code;
      $('#menu').hidden = true;
      $('#hud').hidden = false;
      $('#touch').hidden = !matchMedia('(pointer: coarse)').matches;
      $('#btn-play').disabled = false;
      $('#btn-play').textContent = 'Spielen';
      running = true; last = 0; acc = 0;
      checkOrientation();
      requestAnimationFrame(loop);
      $('#arena-code').textContent = net.room;
      toast('Arena ' + net.room);
    } else if (Date.now() - t0 > 6000) {
      clearInterval(wait);
      $('#btn-play').disabled = false;
      $('#btn-play').textContent = 'Spielen';
      toast('Keine Verbindung zum Server', 'bad');
    }
  }, 80);
}

function leave() {
  running = false;
  net.disconnect();
  net.buffer = []; net.pending = []; net.me = null; net.connected = false;
  $('#hud').hidden = true;
  $('#over').hidden = true;
  $('#menu').hidden = false;
  $('#rotate').hidden = true;
  loadLeaderboard();
}

async function loadLeaderboard() {
  try {
    const r = await (await fetch('/api/leaderboard')).json();
    const el = $('#lb-list');
    if (!r.top || !r.top.length) { el.innerHTML = '<li class="empty">Noch niemand. Sei der Erste.</li>'; return; }
    el.innerHTML = r.top.slice(0, 8).map((p, i) =>
      `<li><span class="r">${i + 1}.</span><span class="n">${esc(p.name)}</span><span class="s">${p.score}</span></li>`).join('');
  } catch {}
}

// ------------------------------------------------------------- Anbindung
$('#name').value = store.name;
$('#btn-play').onclick = () => play('');
// Arena-Code antippen kopiert ihn -- er existiert nur, um ihn weiterzugeben.
$('#arena').onclick = async (e) => {
  const el = $('#arena');
  const code = $('#arena-code').textContent.trim();
  if (!code || code === '····') return;
  let ok = false;
  try { await navigator.clipboard.writeText(code); ok = true; } catch { ok = false; }
  if (!ok) {
    // Aelteres Safari/iOS ohne Clipboard-API: ueber ein Hilfsfeld
    try {
      const t = document.createElement('textarea');
      t.value = code; t.setAttribute('readonly', '');
      t.style.cssText = 'position:fixed;top:-100px;opacity:0';
      document.body.appendChild(t); t.select();
      ok = document.execCommand('copy');
      t.remove();
    } catch { ok = false; }
  }
  toast(ok ? 'Arena-Code ' + code + ' kopiert' : 'Code: ' + code);
  el.classList.toggle('ok', ok);
  setTimeout(() => el.classList.remove('ok'), 900);
  // ⚠️ Fokus abgeben: sonst laege er auf dem Knopf, und die Leertaste wuerde
  // ihn erneut ausloesen statt zu beissen.
  el.blur();
};

$('#btn-join').onclick = () => play(($('#room').value || '').toUpperCase().replace(/[^A-Z2-9]/g, ''));
$('#room').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });
$('#name').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-play').click(); });
$('#btn-leave').onclick = leave;
input.onPause = () => { if (running) leave(); };

for (const [id, key] of [['t-bite', 'bite'], ['t-bark', 'bark'], ['t-nose', 'nose'], ['t-run', 'run']]) {
  const el = $('#' + id);
  const on = e => { e.preventDefault(); input.pressTouch(key); };
  const off = e => { e.preventDefault(); input.touchBtn[key] = false; };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}

function checkOrientation() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const hochkant = innerHeight > innerWidth;
  $('#rotate').hidden = !(touch && hochkant && running);
}
addEventListener('resize', () => { renderer && renderer.resize(); checkOrientation(); });
addEventListener('orientationchange', () => setTimeout(checkOrientation, 120));
loadLeaderboard();

// Debug-Zugang: erlaubt Messungen im laufenden Spiel (Browser-Tests nutzen ihn).
window.__br = { get net() { return net; }, get renderer() { return renderer; }, input, get running() { return running; } };
