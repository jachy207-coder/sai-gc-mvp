/**
 * Simulador local de Google Apps Script para probar la app sin desplegarla.
 * Ejecuta Code.gs + Logic.gs + Seed.gs con una hoja de cálculo en memoria.
 *
 *   node tools/servidor-local.js            → http://localhost:8787  (marcación)
 *                                             http://localhost:8787/?page=panel (panel, PIN 2026)
 *   FAKE_NOW="2026-11-16T08:03:00-05:00" node tools/servidor-local.js   (simular hora)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'apps-script');
const PORT = Number(process.env.PORT || 8787);
let desfase = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW).getTime() - Date.now() : 0;
const ahora = () => new Date(Date.now() + desfase);

/* ---------------- Hoja de cálculo en memoria ---------------- */
function crearHoja(nombre, id) {
  const datos = [];
  const sh = {
    _datos: datos,
    getName: () => nombre,
    getSheetId: () => id,
    getLastRow: () => datos.length,
    getMaxRows: () => Math.max(1000, datos.length),
    appendRow: (fila) => { datos.push(fila.map((v) => String(v))); return sh; },
    setFrozenRows: () => sh,
    autoResizeColumns: () => sh,
    clear: () => { datos.length = 0; return sh; },
    getRange: (r, c, nr = 1, nc = 1) => {
      const rango = {
        getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const fila = datos[r - 1 + i] || []; const v = fila[c - 1 + j]; return v === undefined ? '' : String(v);
        })),
        setValues: (vals) => {
          vals.forEach((fila, i) => {
            while (datos.length < r + i) datos.push([]);
            fila.forEach((v, j) => { datos[r - 1 + i][c - 1 + j] = String(v); });
          });
          return rango;
        },
        setValue: (v) => rango.setValues([[v]]),
      };
      ['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat', 'setFontSize'].forEach((m) => { rango[m] = () => rango; });
      return rango;
    },
  };
  return sh;
}
const hojas = [];
const libro = {
  getSheetByName: (n) => hojas.find((h) => h.getName() === n) || null,
  insertSheet: (n) => { const h = crearHoja(n, hojas.length + 1); hojas.push(h); return h; },
  getSheets: () => hojas.slice(),
  deleteSheet: (h) => hojas.splice(hojas.indexOf(h), 1),
  setSpreadsheetTimeZone: () => { },
  getUrl: () => 'http://localhost:' + PORT + '/hoja',
};

/* ---------------- Servicios de Apps Script simulados ---------------- */
function formatDate(fecha, tz, fmt) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha).map((x) => [x.type, x.value]));
  return fmt.replace('yyyy', p.year).replace('yy', p.year.slice(2)).replace('MM', p.month).replace('dd', p.day)
    .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
}
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + desfase); }
  static now() { return RealDate.now() + desfase; }
}
const ctx = {
  console, Date: FakeDate, JSON, Math, String, Number, Array, Object, Error, RegExp, Intl,
  SpreadsheetApp: { getActiveSpreadsheet: () => libro },
  Utilities: { formatDate, base64Encode: (b) => Buffer.from(b).toString('base64') },
  LockService: { getScriptLock: () => ({ waitLock: () => { }, releaseLock: () => { } }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => { } }) },
  DriveApp: { getFileById: () => { throw new Error('sin Drive en local'); } },
  ScriptApp: { getService: () => ({ getUrl: () => 'http://localhost:' + PORT + '/' }) },
};
vm.createContext(ctx);
['Logic.gs', 'Seed.gs', 'Code.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f }));
console.log(vm.runInContext('setup()', ctx));

// DNIs ficticios SOLO para pruebas locales
if (process.env.DNI_DEMO !== '0') {
  const doc = libro.getSheetByName('Docentes')._datos;
  doc.slice(1).forEach((f, i) => { f[0] = String(70000001 + i); });
  console.log('DNIs de prueba: 70000001 (' + doc[1][1] + '), 70000002 (' + doc[2][1] + ') … 700000' + String(doc.length - 1).padStart(2, '0'));
}

/* ---------------- Plantillas HTML (scriptlets) ---------------- */
function render(archivo, vars) {
  let html = fs.readFileSync(path.join(DIR, archivo + '.html'), 'utf8');
  html = html.replace(/<\?!=\s*include\('(\w+)'\);?\s*\?>/g, (_, n) => fs.readFileSync(path.join(DIR, n + '.html'), 'utf8'));
  html = html.replace(/<\?=\s*(\w+)\s*\?>/g, (_, v) => String(vars[v] ?? ''));
  const shim = `<script>
  window.google = { script: { run: (function mk(ok, err) {
    return new Proxy({}, { get(_, fn) {
      if (fn === 'withSuccessHandler') return (f) => mk(f, err);
      if (fn === 'withFailureHandler') return (f) => mk(ok, f);
      return (...args) => fetch('/api/' + fn, { method: 'POST', body: JSON.stringify(args) })
        .then((r) => r.json()).then((j) => j.error ? err && err(new Error(j.error)) : ok && ok(j.result))
        .catch((e) => err && err(e));
    } });
  })() } };
  </script>`;
  return html.replace('<head>', '<head>' + shim);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const fn = url.pathname.slice(5);
      try {
        const result = ctx[fn](...JSON.parse(body || '[]'));
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ result }));
      } catch (e) {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  if (url.pathname === '/__hora') { desfase = new RealDate(url.searchParams.get('t')).getTime() - RealDate.now(); res.end('ok'); return; }
  if (url.pathname === '/hoja') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(Object.fromEntries(hojas.map((h) => [h.getName(), h._datos])), null, 1)); return;
  }
  const page = url.searchParams.get('page') === 'panel' ? 'Dashboard' : 'Index';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(render(page, { dniInicial: ctx.extraerDni(url.searchParams.get('dni') || '') || '', appUrl: 'http://localhost:' + PORT + '/' }));
}).listen(PORT, () => console.log('Simulador en http://localhost:' + PORT + '  (hora simulada: ' + formatDate(ahora(), 'America/Lima', 'yyyy-MM-dd HH:mm') + ')'));
