// Pruebas de: actualización de datos, marcación por coordinación, horario editable, descarga de QR y vista móvil.
// Uso: (simulador corriendo con FAKE_NOW=2026-11-16T08:10:00-05:00) node tests/e2e_v2.js [carpeta_capturas]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2] || '.';
const BASE = 'http://localhost:8787';
const hora = (t) => fetch(BASE + '/__hora?t=' + encodeURIComponent('2026-11-16T' + t + ':00-05:00'));
const js = async (code) => { const r = await (await fetch(BASE + '/__js', { method: 'POST', body: code })).json(); if (r.error) throw new Error(r.error); return r.result; };
const assert = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓ ' + m); };

async function entrarPanel(page) {
  await page.goto(BASE + '/?page=panel');
  await page.fill('#pin', '2026'); await page.click('#btn-login');
  await page.waitForSelector('#kpis .kpi');
}

(async () => {
  console.log('1) setup() actualiza datos sin borrar lo existente');
  await js(`(function(){
    var d = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Docentes')._datos;
    d.forEach(function(r){ if (r[1]==='Yuli Cucho') { r[1]='Yuly'; r[4]=''; } if (r[1]==='Jhon Vásquez') { r[4]=''; r[0]='71234567'; } });
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Horario')._datos.forEach(function(r){ if (r[6]==='Yuli Cucho') r[6]='Yuly'; });
  })()`);
  const msg = await js('setup()');
  console.log('    ' + msg);
  const doc = await js(`JSON.stringify(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Docentes')._datos)`).then(JSON.parse);
  const yuli = doc.find((r) => r[1] === 'Yuli Cucho'), jhon = doc.find((r) => r[1] === 'Jhon Vásquez');
  assert(yuli && yuli[4] === '920005517', 'Yuly → Yuli Cucho con celular 920005517');
  assert(jhon[4] === '957239619' && jhon[0] === '71234567', 'Jhon Vásquez: celular completado y su DNI existente NO se borró');
  const hor = await js(`JSON.stringify(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Horario')._datos)`).then(JSON.parse);
  assert(hor.filter((r) => r[6] === 'Yuli Cucho').length === 2 && !hor.some((r) => r[6] === 'Yuly'), 'Horario: bloques de Yuly renombrados');
  assert((await js('setup()')).includes('ya estaban al día'), 'setup() es repetible (segunda vez no cambia nada)');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  page.on('pageerror', (e) => { throw e; });
  page.on('dialog', (d) => d.accept());

  console.log('2) Coordinación marca asistencia');
  await hora('08:10');
  await entrarPanel(page);
  await page.click('[data-tab="marcar"]');
  await page.waitForSelector('.doc-card');
  await page.screenshot({ path: OUT + '/v2_1_marcar_lista.png' });
  await page.click('.doc-card:has-text("Jhon Vásquez") [data-d]');
  await page.waitForSelector('#c-hora');
  await page.fill('#c-hora', '07:55');
  await page.screenshot({ path: OUT + '/v2_2_marcar_modal.png' });
  await page.click('#c-marcar');
  await page.waitForSelector('#toast:not(.oculto)');
  assert((await page.textContent('#toast')).includes('Ingreso de Jhon Vásquez a las 07:55'), 'ingreso registrado por coordinación con hora corregida 07:55');
  await page.waitForSelector('.doc-card:has-text("Jhon Vásquez") >> text=En el colegio desde 07:55');
  assert(true, 'tarjeta muestra “En el colegio desde 07:55”');
  await page.click('.doc-card:has-text("Jordi San Miguel") [data-d]');
  await page.waitForSelector('#c-hora'); await page.fill('#c-hora', '09:30'); await page.click('#c-marcar');
  await page.waitForSelector('#c-err:not(.oculto)');
  assert((await page.textContent('#c-err')).includes('hora futura'), 'rechaza una hora futura');
  await page.click('#modal-cerrar');
  await hora('11:05');
  await page.click('[data-tab="hoy"]'); await page.click('[data-tab="marcar"]');
  await page.waitForSelector('.doc-card:has-text("Jhon Vásquez") >> text=Salida');
  await page.click('.doc-card:has-text("Jhon Vásquez") [data-d]');
  await page.waitForSelector('#c-hora');
  await page.click('#c-marcar');
  await page.waitForSelector('#toast:not(.oculto) >> text=Salida');
  assert((await page.textContent('#toast')).includes('2.75 h dictadas'), 'salida por coordinación: 2.75 h dictadas');
  const marc = await js(`JSON.stringify(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Marcaciones')._datos)`).then(JSON.parse);
  assert(marc[1][12] === 'Coordinación', 'la marcación queda registrada como “Coordinación”');

  console.log('3) Horario editable');
  await page.click('[data-tab="horario"]');
  await page.waitForSelector('.bq');
  assert((await page.inputValue('#h-sel')) === 'ANUAL INTEGRAL', 'vista por salón: Anual Integral');
  await page.screenshot({ path: OUT + '/v2_3_horario.png', fullPage: true });
  await page.click('.bq[data-id="AI-SA-3"]');
  await page.waitForSelector('#f-doc');
  await page.selectOption('#f-doc', 'Alan Sosa');
  await page.screenshot({ path: OUT + '/v2_4_horario_editar.png' });
  await page.click('#f-guardar');
  await page.waitForSelector('#toast:not(.oculto) >> text=Cambios guardados');
  const h1 = await js(`JSON.stringify(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Horario')._datos.filter(function(r){return r[0]==='AI-SA-3'})[0])`).then(JSON.parse);
  assert(h1[6] === 'Alan Sosa', 'editar: Prácticas del sábado asignadas a Alan Sosa (mismo ID)');
  await page.click('[data-nuevo="SABADO"]');
  await page.waitForSelector('#f-curso');
  await page.fill('#f-ini', '12:15'); await page.fill('#f-fin', '13:00'); await page.fill('#f-curso', 'Tutoría');
  await page.click('#f-guardar');
  await page.waitForSelector('#toast:not(.oculto) >> text=Bloque agregado');
  await page.waitForSelector('.bq[data-id="AI-SA-4"]');
  assert(true, 'agregar: nuevo bloque AI-SA-4 (TUTORÍA sábado 12:15–13:00)');
  await page.click('[data-nuevo="SABADO"]');
  await page.waitForSelector('#f-curso');
  await page.fill('#f-ini', '09:00'); await page.fill('#f-fin', '10:30'); await page.fill('#f-curso', 'X');
  await page.click('#f-guardar');
  await page.waitForSelector('#f-err:not(.oculto)');
  assert((await page.textContent('#f-err')).includes('mismo salón'), 'valida cruces en el mismo salón');
  await page.click('#modal-cerrar');
  await page.click('.bq[data-id="AI-SA-4"]'); await page.waitForSelector('#f-eliminar'); await page.click('#f-eliminar');
  await page.waitForSelector('#toast:not(.oculto) >> text=eliminado');
  assert((await page.locator('.bq[data-id="AI-SA-4"]').count()) === 0, 'eliminar bloque');
  await page.click('#h-modo [data-m="docente"]');
  await page.selectOption('#h-sel', 'Jordi San Miguel');
  assert((await page.locator('.bq').count()) === 7, 'vista por docente: Jordi tiene 7 bloques');

  console.log('4) Fotochecks QR descargables');
  await page.click('[data-tab="qr"]');
  await page.waitForSelector('[data-png]');
  await page.waitForTimeout(400);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-png="0"]')]);
  const ruta = OUT + '/' + dl.suggestedFilename();
  await dl.saveAs(ruta);
  assert(/^Fotocheck_QR_.*\.png$/.test(dl.suggestedFilename()) && fs.statSync(ruta).size > 15000, 'descarga PNG individual: ' + dl.suggestedFilename());
  await page.screenshot({ path: OUT + '/v2_5_qr.png' });
  page.on('popup', (p) => p.close());
  await page.click('#btn-zip');
  await page.waitForSelector('#qr-msg >> text=fotochecks listos', { timeout: 60000 });
  const drv = await (await fetch(BASE + '/__drive')).json();
  const carp = drv.find((c) => c.nombre.startsWith('Fotochecks QR'));
  assert(carp && carp.archivos.filter((n) => n.endsWith('.png')).length >= 20 && carp.archivos.includes('Fotochecks_QR_CVI.zip'), 'ZIP en Drive con ' + carp.archivos.length + ' archivos');

  console.log('5) Celular: sin desborde horizontal en ninguna pestaña');
  const m = await browser.newPage({ ...devices['iPhone 13'] });
  m.on('pageerror', (e) => { throw e; });
  await entrarPanel(m);
  for (const t of ['hoy', 'marcar', 'horario', 'reporte', 'qr']) {
    await m.click(`[data-tab="${t}"]`);
    await m.waitForTimeout(700);
    const r = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
    assert(r.sw <= r.w && r.bw <= r.w, `pestaña ${t}: ancho ${r.sw}px ≤ ${r.w}px`);
    await m.screenshot({ path: OUT + `/v2_m_${t}.png`, fullPage: true });
  }
  await m.click('[data-tab="horario"]'); await m.waitForSelector('.bq'); await m.click('.bq >> nth=0');
  await m.waitForSelector('#f-doc'); await m.screenshot({ path: OUT + '/v2_m_horario_modal.png' });
  await m.goto(BASE + '/'); await m.waitForTimeout(300);
  const ri = await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  assert(ri, 'página de marcación sin desborde');
  await browser.close();
  console.log('\nE2E v2 OK');
})().catch((e) => { console.error(e); process.exit(1); });
