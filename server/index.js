// Brummer -- HTTP (Client + API) und WebSocket (Spiel) in EINEM Prozess.
// nginx ist reiner Vermittler, es gibt kein zweites Webroot.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { TICK_HZ, DT } from '../shared/sim.js';
import { Room, MAX } from './room.js';
import { ensurePlayer, recordRound, leaderboard, stats, newCode } from './db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 4263);
const HOST = process.env.BIND_ADDRESS || '127.0.0.1';
const PUBLIC = process.env.PUBLIC_DIR || path.join(HERE, 'public');

// ---------------------------------------------------------------- Raeume
const rooms = new Map();
const codeOf = new Map();          // ws -> {room, id, code}

function roomCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = new Room(code, board => recordRound(code, board));
    rooms.set(code, r);
  }
  return r;
}

function quickRoom() {
  for (const r of rooms.values()) if (!r.isFull()) return r;
  return getRoom(roomCode());
}

// ------------------------------------------------------------------ HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
};

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(s);
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('nope'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA: alles Unbekannte auf index.html
      const idx = path.join(PUBLIC, 'index.html');
      return fs.readFile(idx, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('nicht gefunden'); }
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
        res.end(buf);
      });
    }
    const ext = path.extname(file);
    // Gehashte Bundles duerfen ewig liegen, index.html NIE -- sonst faehrt der
    // Browser nach einem Deploy stundenlang das alte Bundle (Hauslektion).
    const hashed = /\/assets\/.+-[A-Za-z0-9_]{8,}\.(js|css)$/.test(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/health') {
    return json(res, 200, { ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.humans(), 0) });
  }
  if (u.pathname === '/api/leaderboard') return json(res, 200, { top: leaderboard(20) });
  if (u.pathname === '/api/me') {
    const c = (u.searchParams.get('code') || '').toUpperCase();
    return json(res, 200, { me: c ? stats(c) : null });
  }
  if (u.pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 2000) req.destroy(); });
    return req.on('end', () => {
      let name = 'Hund', code = null;
      try { const j = JSON.parse(body || '{}'); name = String(j.name || 'Hund').slice(0, 14); code = j.code; } catch {}
      const row = ensurePlayer(code, name);
      json(res, 200, { code: row.code, name: row.name });
    });
  }
  serveStatic(req, res, u.pathname);
});

// -------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join') {
      if (codeOf.has(ws)) return;
      const name = String(m.name || 'Hund').slice(0, 14).trim() || 'Hund';
      const want = String(m.room || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4);
      const room = want ? getRoom(want) : quickRoom();
      if (room.isFull()) return send(ws, { t: 'err', msg: 'Arena ist voll' });
      const id = 'h' + Math.random().toString(36).slice(2, 10);
      const p = room.addHuman(id, name, ws);
      if (!p) return send(ws, { t: 'err', msg: 'Arena ist voll' });
      room.balanceBots();
      const acct = ensurePlayer(m.code, name);
      // Der Code MUSS am Spieler haengen: die Rundentabelle wird spaeter aus
      // room.players gebaut, und ohne Code schreibt recordRound nichts.
      p.code = acct.code;
      codeOf.set(ws, { room, id, code: acct.code });
      send(ws, { t: 'hello', you: p.slot, room: room.code, code: acct.code, tickHz: TICK_HZ });
      send(ws, room.meta());
      for (const c of room.conns.values()) if (c !== ws) send(c, room.meta());
      return;
    }

    const ctx = codeOf.get(ws);
    if (!ctx) return;
    if (m.t === 'in') ctx.room.setInput(ctx.id, m);
    else if (m.t === 'ping') send(ws, { t: 'pong', c: m.c });
  });

  ws.on('close', () => {
    const ctx = codeOf.get(ws);
    if (!ctx) return;
    codeOf.delete(ws);
    ctx.room.remove(ctx.id);
    ctx.room.balanceBots();
    for (const c of ctx.room.conns.values()) send(c, ctx.room.meta());
    if (ctx.room.humans() === 0) {
      // Raum abraeumen, damit keine leeren Arenen mitrechnen
      ctx.room.balanceBots();
      if (rooms.size > 1) rooms.delete(ctx.room.code);
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

// ------------------------------------------------------------------ Takt
let acc = 0, last = process.hrtime.bigint();
setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9;
  last = now;
  let steps = 0;
  while (acc >= DT && steps < 5) { acc -= DT; steps++;
    for (const r of rooms.values()) r.step();
  }
  if (!steps) return;
  for (const r of rooms.values()) {
    if (!r.conns.size) { r.flushEvents(); continue; }
    const snap = r.snapshot();
    const s = JSON.stringify(snap);
    for (const ws of r.conns.values()) if (ws.readyState === 1) ws.send(s);
    r.flushEvents();
  }
}, 1000 / TICK_HZ);

server.listen(PORT, HOST, () => {
  console.log(`brummer laeuft auf http://${HOST}:${PORT}  (Takt ${TICK_HZ} Hz)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.log('ende'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500); });
}
