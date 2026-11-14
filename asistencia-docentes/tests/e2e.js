// Prueba de punta a punta contra el simulador local (tools/servidor-local.js).
// Uso: node tests/e2e.js [carpeta_capturas]
const { chromium, devices } = require('playwright');
const OUT = process.argv[2] || '.';
const BASE = 'http://localhost:8787';
const hora = (t) => fetch(BASE + '/__hora?t=' + encodeURIComponent('2026-11-16T' + t + ':00-05:00'));
const assert = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓ ' + m); };

async function marcar(page, dni, { reemplazo = null, obs = null, detalle = '', desmarcar = [] } = {}) {
  await page.goto(BASE + '/');
  await page.fill('#dni', dni);
  await page.click('.tecla.ok');
  await page.waitForSelector('#paso-docente:not(.oculto)');
  for (const id of desmarcar) await page.click(`#lista-propias .clase[data-id="${id}"]`);
  if (reemplazo) {
    if (await page.isHidden('#lista-reemplazos')) await page.click('#btn-reemplazo');
    await page.click(`#lista-reemplazos .clase[data-id="${reemplazo}"]`);
  }
  if (obs) { await page.click(`.obs-chip[data-o="${obs}"]`); if (detalle) await page.fill('#obs-detalle', detalle); }
  return page;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => { throw e; });

  console.log('1) 07:58 Jhon Vásquez marca ingreso');
  await hora('07:58');
  await marcar(page, '70000001');
  assert((await page.locator('#lista-propias .clase.sel').count()) === 2, 'sus 2 bloques de Anual Integral vienen marcados');
  await page.screenshot({ path: OUT + '/1_docente_pc.png', fullPage: true });
  await page.click('#btn-marcar');
  await page.waitForSelector('#paso-listo:not(.oculto)');
  assert((await page.textContent('#listo-estado')).includes('Puntual'), 'ingreso puntual');
  await page.screenshot({ path: OUT + '/2_ingreso_ok.png' });

  console.log('2) 07:59 Jordy ingresa (3 salones simultáneos)');
  await hora('07:59');
  await marcar(page, '70000010');
  await page.click('#btn-marcar'); await page.waitForSelector('#paso-listo:not(.oculto)');

  console.log('3) 10:22 Susan Adama llega tarde (primera clase 10:15)');
  await hora('10:22');
  await marcar(page, '70000009', { obs: 'Problema de transporte' });
  await page.click('#btn-marcar'); await page.waitForSelector('#paso-listo:not(.oculto)');
  assert((await page.textContent('#listo-estado')).includes('Tardanza de 7 min'), 'tardanza de 7 min');

  console.log('4) 10:58 Wilber cubre Arte de Erika en Líderes (reemplazo)');
  await hora('10:58');
  await marcar(page, '70000008', { reemplazo: 'LI-LU-4', obs: 'Otro', detalle: 'Erika avisó que no vendrá' });
  await page.click('#btn-marcar'); await page.waitForSelector('#paso-listo:not(.oculto)');
  assert((await page.textContent('#listo-estado')).includes('Puntual'), 'reemplazo puntual (bloque 11:00)');

  console.log('5) 11:20 panel en vivo');
  await hora('11:20');
  await page.goto(BASE + '/?page=panel');
  await page.fill('#pin', '2026'); await page.click('#btn-login');
  await page.waitForSelector('#kpis .kpi');
  await page.waitForTimeout(400);
  const k = await page.textContent('#kpis');
  assert(/Docentes que llegaron\s*3\s*de 8/.test(k), 'KPI: 3 de 8 docentes programados llegaron (Wilber vino solo a reemplazar)');
  assert((await page.locator('.blq.e-REEMPLAZO').count()) === 1, 'timeline muestra 1 reemplazo');
  assert((await page.locator('.blq.e-SIN-MARCAR').count()) >= 1, 'timeline muestra clases sin marcar');
  await page.screenshot({ path: OUT + '/3_panel_vivo.png', fullPage: true });

  console.log('6) 12:05 Jhon Vásquez y Jordy marcan salida');
  await hora('12:05');
  await marcar(page, '70000001');
  assert((await page.textContent('#btn-marcar')).includes('SALIDA'), 'botón cambia a SALIDA');
  await page.click('#btn-marcar'); await page.waitForSelector('#paso-listo:not(.oculto)');
  const m = await page.textContent('#listo-metricas');
  assert(m.includes('2.75'), 'Jhon: 2.75 horas dictadas (08:00–10:00 + 10:15–11:00)');
  await page.screenshot({ path: OUT + '/4_salida.png' });
  await hora('14:02');
  await marcar(page, '70000010');
  await page.click('#btn-marcar'); await page.waitForSelector('#paso-listo:not(.oculto)');
  assert((await page.textContent('#listo-metricas')).includes('3.75'), 'Jordy: 3.75 h = 08:00–10:00 + 12:15–14:00 (salones simultáneos sin duplicar)');

  console.log('7) Reporte mensual');
  await page.goto(BASE + '/?page=panel');
  await page.waitForSelector('#kpis .kpi');
  await page.click('[data-tab="reporte"]');
  await page.waitForSelector('#tabla-rep tr');
  await page.waitForTimeout(300);
  const rep = await page.textContent('#tabla-rep');
  assert(rep.includes('Jhon Vásquez') && rep.includes('2.75'), 'reporte: Jhon Vásquez 2.75 h en Anual Integral');
  assert(rep.includes('TOTAL GENERAL'), 'reporte con total general');
  await page.screenshot({ path: OUT + '/5_reporte.png', fullPage: true });

  await page.click('[data-tab="qr"]');
  await page.waitForSelector('.fotocheck');
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/6_qr.png' });

  console.log('8) Celular: QR abre la página con el DNI');
  const movil = await browser.newPage({ ...devices['iPhone 13'] });
  await hora('12:10');
  await movil.goto(BASE + '/?dni=70000015');
  await movil.waitForSelector('#paso-docente:not(.oculto)');
  assert((await movil.textContent('#nombre-docente')).includes('Nicol'), 'QR con ?dni= carga a la docente directamente');
  await movil.screenshot({ path: OUT + '/7_movil.png', fullPage: true });
  await movil.goto(BASE + '/?dni=931000890');
  await movil.waitForSelector('#paso-docente:not(.oculto)');
  assert((await movil.textContent('#nombre-docente')).includes('Marleny'), 'también se identifica con el celular (sin DNI)');
  await movil.goto(BASE + '/');
  await movil.screenshot({ path: OUT + '/8_movil_inicio.png' });

  const datos = await (await fetch(BASE + '/hoja')).json();
  console.log('\nHoja "Clases dictadas":');
  datos['Clases dictadas'].forEach((f) => console.log('  ' + f.join(' | ')));
  await browser.close();
  console.log('\nE2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
