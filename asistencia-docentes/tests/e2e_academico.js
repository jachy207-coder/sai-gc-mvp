// Control académico de punta a punta (simulador con FAKE_NOW=2026-11-23T07:58:00-05:00, semana de clase 29).
// Uso: node tests/e2e_academico.js [carpeta_capturas]
const { chromium, devices } = require('playwright');
const OUT = process.argv[2] || '.';
const BASE = 'http://localhost:8787';
const hora = (t) => fetch(BASE + '/__hora?t=' + encodeURIComponent('2026-11-23T' + t + ':00-05:00'));
const js = async (code) => { const r = await (await fetch(BASE + '/__js', { method: 'POST', body: code })).json(); if (r.error) throw new Error(r.error); return r.result; };
const hoja = async (n) => JSON.parse(await js(`JSON.stringify(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('${n}')._datos)`));
const assert = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓ ' + m); };

async function marcar(page, dni) {
  await page.goto(BASE + '/');
  await page.fill('#dni', dni); await page.click('.tecla.ok');
  await page.waitForSelector('#paso-docente:not(.oculto)');
  await page.click('#btn-marcar');
  await page.waitForSelector('#paso-listo:not(.oculto)');
}

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => { throw e; });
  page.on('dialog', (d) => d.accept());

  console.log('1) Hojas del control académico creadas por setup()');
  const tem = await hoja('Temario'), cur = await hoja('Cursos'), cal = await hoja('Calendario');
  assert(tem.length - 1 === 480 && cur.length - 1 === 15 && cal.length - 1 === 43, 'Temario 480 temas · Cursos 15 · Calendario 43 semanas');

  console.log('2) Docente: al marcar salida registra el tema (sugerido = 29)');
  await hora('07:58'); await marcar(page, '70000001'); // Jhon Vásquez – Trigonometría
  await hora('11:05'); await marcar(page, '70000001');
  await page.waitForSelector('.tema-card');
  const sel = await page.$eval('.tema-card .sel-tema', (s) => s.options[s.selectedIndex].text);
  assert(sel.startsWith('29 · Transformaciones trigonométricas II'), 'sugiere el tema 29: ' + sel.trim());
  assert(!(await page.textContent('#cuenta')), 'la cuenta regresiva se pausa mientras registra');
  await page.click('.tema-card [data-t="PARCIAL"]'); await page.fill('.tema-card .obs', 'Faltó la práctica');
  await page.screenshot({ path: OUT + '/ac_1_registro_tema.png', fullPage: true });
  await page.click('#btn-guardar-temas');
  await page.waitForSelector('#listo-temas >> text=registrado');
  let lec = await hoja('Leccionario');
  assert(lec.length === 2 && lec[1][5] === 'Trigonometría' && lec[1][9] === '29' && lec[1][12] === 'PARCIAL' && lec[1][15] === 'DOCENTE', 'Leccionario: Trigonometría · tema 29 · PARCIAL · DOCENTE');

  console.log('3) "Más tarde" y recordatorio al volver a ingresar el DNI');
  await hora('10:10'); await marcar(page, '70000009'); // Susan Adama
  await hora('12:05'); await marcar(page, '70000009');
  await page.waitForSelector('.tema-card');
  const cursosForm = await page.$$eval('.tema-card .cab b', (x) => x.map((e) => e.textContent));
  assert(cursosForm.length === 1 && cursosForm[0] === 'Biología', 'solo pide el curso con temario (Biología AI), no Líderes');
  await page.click('#btn-omitir-temas');
  await page.goto(BASE + '/'); await page.fill('#dni', '70000009'); await page.click('.tecla.ok');
  await page.waitForSelector('.pendiente-banner');
  assert((await page.textContent('.pendiente-banner')).includes('1 clase(s) de hoy sin tema'), 'muestra recordatorio de tema pendiente');
  await page.click('#btn-reg-pend'); await page.waitForSelector('#form-pend .tema-card');
  await page.click('#btn-guardar-temas'); await page.waitForSelector('#form-pend >> text=registrado');
  lec = await hoja('Leccionario');
  assert(lec.some((r) => r[5] === 'Biología' && r[9] === '29' && r[12] === 'COMPLETADO'), 'Biología tema 29 COMPLETADO');

  console.log('4) Panel → Académico');
  await page.goto(BASE + '/?page=panel'); await page.fill('#pin', '91515'); await page.click('#btn-login');
  await page.waitForSelector('#kpis .kpi');
  await page.click('[data-tab="academico"]'); await page.waitForSelector('.ac-card');
  assert((await page.textContent('#ac-semana')).includes('Semana 29 de 32'), 'semana 29 de 32 · boletín 8');
  assert((await page.locator('.ac-card').count()) === 15, '15 cursos con su avance');
  assert((await page.textContent('.ac-card[data-curso="AI-BIO"]')).includes('Va en el tema 29'), 'Biología va en el tema 29');
  assert((await page.locator('.ac-card[data-curso="AI-TRI"] .barra32 span.p').count()) === 1, 'Trigonometría muestra el tema 29 como parcial');
  await page.click('.ac-card[data-curso="AI-FIS"]'); await page.waitForSelector('#cd-base');
  await page.fill('#cd-base', '25'); await page.click('#cd-base-ok');
  await page.waitForSelector('.ac-card.ROJO[data-curso="AI-FIS"]');
  assert(true, 'Física con avance inicial 25 → semáforo ROJO (3 temas de atraso)');
  await page.waitForSelector('.tema-fila');
  await page.screenshot({ path: OUT + '/ac_3_detalle_curso.png' });
  await page.click('#modal-cerrar');
  assert((await page.textContent('#ac-alertas')).includes('Física: 3 temas de atraso'), 'alerta de atraso');
  await page.screenshot({ path: OUT + '/ac_2_avance.png', fullPage: true });

  console.log('5) Completar un tema "por confirmar" del temario');
  await page.click('.ac-card[data-curso="AI-HIS"]'); await page.waitForSelector('[data-tema="AI-HIS-25"]');
  await page.click('[data-tema="AI-HIS-25"] [data-edit]');
  await page.fill('[data-tema="AI-HIS-25"] input', 'Guerra con Chile'); await page.press('[data-tema="AI-HIS-25"] input', 'Enter');
  await page.waitForSelector('#toast:not(.oculto) >> text=Tema 25 actualizado');
  const h25 = (await hoja('Temario')).find((r) => r[0] === 'AI-HIS-25');
  assert(h25[5] === 'Guerra con Chile' && h25[6] === 'OK', 'Historia 25 = "Guerra con Chile" (confirmado)');
  await page.click('#modal-cerrar');

  console.log('6) Leccionario: validar, corregir y registrar por coordinación');
  await page.click('#ac-vista [data-v="lecc"]'); await page.waitForSelector('#lc-tabla [data-val]');
  await page.click('#lc-tabla tr:has-text("Trigonometría") [data-val]');
  await page.waitForSelector('#toast:not(.oculto) >> text=validado');
  await page.click('#lc-tabla tr:has-text("Biología") [data-cor]'); await page.waitForSelector('#cr-tema option[value="29"]', { state: 'attached' });
  await page.selectOption('#cr-tipo', 'REPASO'); await page.click('#cr-ok');
  await page.waitForSelector('#toast:not(.oculto) >> text=corregido');
  await page.click('#lc-nuevo'); await page.waitForSelector('#rc-tema option[value="1"]', { state: 'attached' });
  await page.selectOption('#rc-curso', 'AI-QUI'); await page.waitForSelector('#rc-tema option:has-text("Cinética")', { state: 'attached' });
  await page.fill('#rc-doc', 'Redoberto Martin'); await page.click('#rc-ok');
  await page.waitForSelector('#toast:not(.oculto) >> text=Tema registrado');
  lec = await hoja('Leccionario');
  const bio = lec.find((r) => r[5] === 'Biología'), qui = lec.find((r) => r[5] === 'Química'), tri = lec.find((r) => r[5] === 'Trigonometría');
  assert(tri[16] === 'VALIDADO' && bio[16] === 'CORREGIDO' && bio[12] === 'REPASO' && qui[9] === '29' && qui[15] === 'COORDINACIÓN', 'validado · corregido (→ REPASO) · Química 29 por coordinación');
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/ac_4_leccionario.png', fullPage: true });

  console.log('7) Calendario y vista móvil');
  await page.click('#ac-vista [data-v="cal"]'); await page.waitForSelector('#cal-tabla tr.sem-actual');
  assert((await page.textContent('#cal-tabla tr.sem-actual')).includes('29'), 'calendario resalta la semana actual (29)');
  const m = await b.newPage({ ...devices['iPhone 13'] });
  m.on('pageerror', (e) => { throw e; });
  await m.goto(BASE + '/?page=panel'); await m.fill('#pin', '91515'); await m.click('#btn-login'); await m.waitForSelector('#kpis .kpi');
  await m.click('[data-tab="academico"]'); await m.waitForSelector('.ac-card'); await m.waitForTimeout(300);
  const w = await m.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert(w[0] <= w[1], `Académico en celular sin desborde (${w[0]} ≤ ${w[1]})`);
  await m.screenshot({ path: OUT + '/ac_5_movil.png' });
  for (const v of ['lecc', 'cal']) { await m.click(`#ac-vista [data-v="${v}"]`); await m.waitForTimeout(500);
    const w2 = await m.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); assert(w2[0] <= w2[1], `vista ${v} sin desborde`); }
  await hora('13:00'); await m.goto(BASE + '/?dni=70000005'); // Jorge Adama (Física) — sin clase hoy
  await b.close();
  console.log('\nE2E académico OK');
})().catch((e) => { console.error(e); process.exit(1); });
