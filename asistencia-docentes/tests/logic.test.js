// Pruebas de reglas de negocio: node --test asistencia-docentes/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../apps-script/Logic.gs');

function cargarHorario() {
  const csv = fs.readFileSync(path.join(__dirname, '../datos/horario_monte_azul_2026.csv'), 'utf8').trim().split('\n');
  const enc = csv.shift().split(',');
  return csv.map((l) => Object.fromEntries(l.split(',').map((v, i) => [enc[i], v])));
}

test('toMin / fmtMin', () => {
  assert.equal(L.toMin('08:05'), 485);
  assert.equal(L.toMin('8:05'), 485);
  assert.equal(L.toMin(''), null);
  assert.equal(L.toMin('25:00'), null);
  assert.equal(L.fmtMin(485), '08:05');
});

test('diaDeFecha: lunes 16/11/2026 inicia el piloto', () => {
  assert.equal(L.diaDeFecha('2026-11-16'), 'LUNES');
  assert.equal(L.diaDeFecha('2026-11-21'), 'SABADO');
});

test('extraerDni acepta DNI, texto y URL del QR', () => {
  assert.equal(L.extraerDni('08579858'), '08579858');
  assert.equal(L.extraerDni('https://script.google.com/macros/s/X/exec?dni=12345678'), '12345678');
  assert.equal(L.extraerDni('1234'), null);
});

test('tolerancia de 5 minutos', () => {
  const b = [{ id: 'A', inicio: '08:00', fin: '10:00' }, { id: 'B', inicio: '10:15', fin: '12:00' }];
  assert.deepEqual(L.evaluarIngreso('08:05', b, 5), { estado: 'PUNTUAL', minTarde: 0, referencia: '08:00' });
  assert.deepEqual(L.evaluarIngreso('08:06', b, 5), { estado: 'TARDANZA', minTarde: 6, referencia: '08:00' });
  assert.equal(L.evaluarIngreso('07:40', b, 5).estado, 'PUNTUAL');
  assert.equal(L.evaluarIngreso('09:00', [], 5).estado, 'SIN HORARIO');
});

test('horas cronológicas corroboradas con el horario', () => {
  const b = [{ id: 'A', inicio: '08:00', fin: '10:00' }, { id: 'B', inicio: '10:15', fin: '12:00' }];
  const h = L.calcularHoras('08:10', '11:30', b);
  assert.equal(h.marcadas, 3.33);
  assert.equal(h.programadas, 3.75);
  assert.equal(h.efectivas, 3.08); // 1:50 + 1:15 = 3:05
  assert.deepEqual(h.detalle.map((d) => d.horas), [1.833, 1.25]);
  // Llega antes y se va después: solo cuenta lo programado
  assert.equal(L.calcularHoras('07:30', '12:30', b).efectivas, 3.75);
});

test('clases simultáneas (ej. Jordy lunes 13:00 en 3 salones) no duplican horas', () => {
  const b = [
    { id: 'AI', inicio: '13:00', fin: '14:00' },
    { id: 'CR', inicio: '13:00', fin: '14:00' },
    { id: 'AV', inicio: '13:00', fin: '14:00' }
  ];
  const h = L.calcularHoras('12:55', '14:00', b);
  assert.equal(h.efectivas, 1);
  assert.equal(h.programadas, 1);
  assert.deepEqual(h.detalle.map((d) => d.horas), [0.333, 0.333, 0.333]);
});

test('estados de bloques para el panel', () => {
  const bloques = [
    { id: 'A', salon: 'S1', curso: 'X', inicio: '08:00', fin: '10:00', docente: 'Ana' },
    { id: 'B', salon: 'S2', curso: 'Y', inicio: '08:00', fin: '10:00', docente: 'Beto' },
    { id: 'C', salon: 'S3', curso: 'Z', inicio: '10:15', fin: '12:00', docente: 'Ana' },
    { id: 'D', salon: 'S4', curso: 'W', inicio: '08:00', fin: '09:00', docente: 'Caro' },
    { id: 'E', salon: 'S5', curso: 'P', inicio: '11:00', fin: '12:00', docente: '' },
    { id: 'F', salon: 'S6', curso: 'Q', inicio: '08:00', fin: '09:00', docente: 'Dani' }
  ];
  const marc = [
    { docente: 'Ana', inicio: '07:58', fin: '', bloques: ['A', 'C'], reemplazos: [] },
    { docente: 'Eva', inicio: '07:55', fin: '', bloques: [], reemplazos: ['D'] },
    { docente: 'Dani', inicio: '07:50', fin: '07:55', bloques: ['F'], reemplazos: [] } // salió antes
  ];
  const e = Object.fromEntries(L.estadoBloques(bloques, marc, '09:30').map((x) => [x.id, x.estado]));
  assert.deepEqual(e, { A: 'EN CLASE', B: 'SIN MARCAR', C: 'CONFIRMADO', D: 'REEMPLAZO', E: 'SIN DOCENTE', F: 'NO DICTADO' });
  const tarde = Object.fromEntries(L.estadoBloques(bloques, marc, '23:59').map((x) => [x.id, x.estado]));
  assert.equal(tarde.B, 'NO DICTADO');
  assert.equal(tarde.A, 'DICTADO');
});

test('resumen mensual: Docente | Mes | Salón | horas', () => {
  const clases = [
    { fecha: '2026-11-16', salon: 'ANUAL INTEGRAL', docente: 'Ana', dni: '1', tipo: 'TITULAR', horas: '2' },
    { fecha: '2026-11-17', salon: 'ANUAL INTEGRAL', docente: 'Ana', dni: '1', tipo: 'TITULAR', horas: '1.75' },
    { fecha: '2026-11-17', salon: 'LÍDERES 5-6', docente: 'Ana', dni: '1', tipo: 'REEMPLAZO', horas: '1' },
    { fecha: '2026-12-01', salon: 'ANUAL INTEGRAL', docente: 'Ana', dni: '1', tipo: 'TITULAR', horas: '2' }
  ];
  const marc = [{ fecha: '2026-11-16', docente: 'Ana', estado: 'TARDANZA', minTarde: '7' }];
  const r = L.resumenMensual(clases, '2026-11', marc);
  assert.equal(r.length, 2);
  assert.deepEqual(
    r.map((f) => [f.salon, f.horas, f.clases, f.dias, f.reemplazos, f.tardanzas, f.minTarde]),
    [['ANUAL INTEGRAL', 3.75, 2, 2, 0, 1, 7], ['LÍDERES 5-6', 1, 1, 1, 1, 1, 7]]
  );
});

test('horario base: bloques válidos y sin cruces por salón', () => {
  const h = cargarHorario();
  assert.equal(h.length, 95);
  const ids = new Set();
  for (const b of h) {
    assert.ok(!ids.has(b.id), 'ID duplicado ' + b.id); ids.add(b.id);
    assert.ok(L.toMin(b.fin) > L.toMin(b.inicio), 'bloque inválido ' + b.id);
    assert.ok(L.DIAS.includes(b.dia), 'día inválido ' + b.id);
  }
  for (const s of new Set(h.map((b) => b.salon + '|' + b.dia))) {
    const [salon, dia] = s.split('|');
    const lista = h.filter((b) => b.salon === salon && b.dia === dia).sort((a, b) => L.toMin(a.inicio) - L.toMin(b.inicio));
    for (let i = 1; i < lista.length; i++) assert.ok(L.toMin(lista[i].inicio) >= L.toMin(lista[i - 1].fin), 'cruce en ' + s);
  }
  // Un docente no debe estar en dos salones a la vez
  for (const s of new Set(h.filter((b) => b.docente).map((b) => b.docente + '|' + b.dia))) {
    const [doc, dia] = s.split('|');
    const lista = h.filter((b) => b.docente === doc && b.dia === dia).sort((a, b) => L.toMin(a.inicio) - L.toMin(b.inicio));
    for (let i = 1; i < lista.length; i++) {
      if (L.toMin(lista[i].inicio) < L.toMin(lista[i - 1].fin)) console.log('  ⚠ cruce de docente:', doc, dia, lista[i - 1].id, lista[i].id);
    }
  }
});
