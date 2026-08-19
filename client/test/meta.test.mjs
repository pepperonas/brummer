// Teilbild und Meta-Angaben. Beides faellt still aus: ein falscher Pfad oder
// eine relative og:image-URL merkt man erst, wenn der Link woanders nackt
// aussieht -- und dann haben die Scraper das Ergebnis schon zwischengespeichert.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, '..');
const html = fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8');

const SITE = 'https://brummer.celox.io';

function meta(name) {
  const re = new RegExp(
    `<meta\\s+(?:property|name)="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+content="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

test('og:image ist absolut und liegt wirklich in public/', () => {
  const url = meta('og:image');
  assert.ok(url, 'og:image fehlt');
  assert.ok(url.startsWith('https://'), `og:image muss absolut sein, ist: ${url}`);
  const rel = url.slice(SITE.length);
  assert.ok(fs.existsSync(path.join(CLIENT, 'public', rel)), `${rel} fehlt in public/`);
});

test('die angegebene Bildgroesse stimmt mit der Datei ueberein', () => {
  const buf = fs.readFileSync(path.join(CLIENT, 'public/og.png'));
  // PNG-IHDR: Breite und Hoehe stehen als 32-Bit-Zahlen ab Byte 16.
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  assert.equal(w, Number(meta('og:image:width')));
  assert.equal(h, Number(meta('og:image:height')));
  assert.equal(w, 1200);
  assert.equal(h, 630);           // 1.91:1 -- das Seitenverhaeltnis der Karten
});

test('Twitter braucht die grosse Karte, sonst kommt ein Briefmarkenbild', () => {
  assert.equal(meta('twitter:card'), 'summary_large_image');
  assert.ok(meta('twitter:image')?.startsWith('https://'));
});

test('jedes Bild traegt eine Bildbeschreibung', () => {
  for (const k of ['og:image:alt', 'twitter:image:alt']) {
    assert.ok((meta(k) || '').length > 20, `${k} fehlt oder ist zu duenn`);
  }
});

test('kanonische Adresse und og:url zeigen auf dieselbe Stelle', () => {
  const canon = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)?.[1];
  assert.equal(canon, `${SITE}/`);
  assert.equal(meta('og:url'), canon);
});

test('alle absoluten Verweise nennen die NEUE Adresse', () => {
  assert.equal(html.includes('beissfest'), false, 'alter Name steckt noch im Kopf');
  for (const m of html.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
    const host = m[1];
    assert.ok(
      host === 'brummer.celox.io' || host === 'celox.io' || host === 'schema.org',
      `unerwarteter Host im Kopf: ${host}`);
  }
});

test('strukturierte Daten sind gueltiges JSON und beschreiben das Spiel', () => {
  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(block, 'JSON-LD fehlt');
  const d = JSON.parse(block);                       // wirft bei kaputtem JSON
  assert.equal(d['@type'], 'VideoGame');
  assert.equal(d.url, `${SITE}/`);
  assert.equal(d.image, meta('og:image'));
  assert.equal(d.numberOfPlayers.maxValue, 8);
});

test('Titel und Beschreibung bleiben in brauchbarer Laenge', () => {
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  const desc = meta('description');
  assert.ok(title.length <= 65, `Titel zu lang (${title.length})`);
  assert.ok(desc.length >= 80 && desc.length <= 175, `Beschreibung ${desc.length} Zeichen`);
});
