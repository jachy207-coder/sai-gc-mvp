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
  assert.equal(L.extraerDni('982 391 670'), '982391670'); // celular
  assert.equal(L.extraerDni('https://x/exec?dni=931000890'), '931000890');
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

test('horario editable: validación de bloques e IDs nuevos', () => {
  const h = [
    { id: 'AI-LU-1', salon: 'ANUAL INTEGRAL', dia: 'LUNES', inicio: '08:00', fin: '10:00', curso: 'TRIGO', docente: 'Ana' },
    { id: 'CR-LU-1', salon: 'CREADORES 3-4', dia: 'LUNES', inicio: '09:00', fin: '10:00', curso: 'ARTE', docente: 'Beto' }
  ];
  assert.deepEqual(L.validarBloque({ salon: 'ANUAL INTEGRAL', dia: 'LUNES', inicio: '10:15', fin: '11:00', curso: 'X', docente: 'Ana' }, h), { errores: [], avisos: [] });
  assert.match(L.validarBloque({ salon: 'ANUAL INTEGRAL', dia: 'LUNES', inicio: '09:30', fin: '10:30', curso: 'X' }, h).errores[0], /mismo salón/);
  assert.match(L.validarBloque({ salon: 'LÍDERES 5-6', dia: 'LUNES', inicio: '09:30', fin: '10:30', curso: 'X', docente: 'Beto' }, h).avisos[0], /conjunta/);
  assert.match(L.validarBloque({ salon: 'S', dia: 'LUNES', inicio: '11:00', fin: '10:00', curso: 'X' }, h).errores[0], /mayor/);
  assert.equal(L.validarBloque({ salon: 'S', dia: 'DOMINGO', inicio: '08:00', fin: '09:00', curso: 'X' }, h).errores.length, 1);
  // Editar el mismo bloque no se cruza consigo mismo
  assert.deepEqual(L.validarBloque({ ...h[0], fin: '10:15' }, h).errores, []);
  assert.equal(L.prefijoSalon('ANUAL INTEGRAL'), 'AI');
  assert.equal(L.prefijoSalon('LÍDERES 5-6'), 'LI');
  assert.equal(L.prefijoSalon('PEQUEÑINES 3'), 'PE');
  assert.equal(L.nuevoIdBloque('ANUAL INTEGRAL', 'LUNES', h), 'AI-LU-2');
  assert.equal(L.nuevoIdBloque('ANUAL INTEGRAL', 'MIERCOLES', h), 'AI-MI-1');
});

test('docentes: validación al agregar y editar', () => {
  const ds = [{ docente: 'Ana Pérez', dni: '12345678', celular: '987654321' }, { docente: 'Beto', dni: '', celular: '912345678' }];
  assert.deepEqual(L.validarDocente({ docente: 'Carla', dni: '87654321' }, ds, '').errores, []);
  assert.match(L.validarDocente({ docente: 'Carla' }, ds, '').errores[0], /DNI o el celular/);
  assert.match(L.validarDocente({ docente: 'ana pérez', celular: '900000000' }, ds, '').errores[0], /Ya existe/);
  assert.match(L.validarDocente({ docente: 'Carla', dni: '12345678' }, ds, '').errores[0], /ya está registrado para Ana/);
  assert.match(L.validarDocente({ docente: 'Carla', celular: '812345678' }, ds, '').errores[0], /empezar con 9/);
  assert.match(L.validarDocente({ docente: 'Carla', dni: '123' }, ds, '').errores[0], /8 dígitos/);
  assert.match(L.validarDocente({ docente: 'Carla', dni: '87654321', correo: 'x@' }, ds, '').errores[0], /correo/);
  // Editar a Ana sin cambiar sus datos no choca consigo misma
  assert.deepEqual(L.validarDocente({ docente: 'Ana Pérez', dni: '12345678', celular: '+51 987 654 321' }, ds, 'Ana Pérez').errores, []);
  assert.equal(L.validarDocente({ docente: 'X', celular: '+51 987 000 111' }, ds, '').celular, '987000111');
});

function calendarioReal() {
  const csv = fs.readFileSync(path.join(__dirname, '../datos/calendario_academico_2026.csv'), 'utf8').trim().split('\n');
  csv.shift();
  return csv.map((l) => { const c = l.split(','); return { inicio: c[0], fin: c[1], tipo: c[2], nSemana: c[3], boletin: c[4], bimestre: c[5] }; });
}

test('calendario 2026: 32 semanas de clase y tema esperado por fecha', () => {
  const cal = calendarioReal();
  assert.equal(cal.filter((s) => s.tipo === 'CLASE').length, 32);
  // Semana de exámenes mensuales (16–21 nov): no hay tema en curso; deberían ir 28 temas completos
  assert.deepEqual([L.temaEsperado(cal, '2026-11-18').completados, L.temaEsperado(cal, '2026-11-18').enCurso], [28, null]);
  // Lunes 23/11: semana de clase 29 (boletín 8)
  const e = L.temaEsperado(cal, '2026-11-23');
  assert.equal(e.enCurso, 29); assert.equal(e.completados, 28); assert.equal(e.semana.boletin, '8');
  assert.equal(L.temaEsperado(cal, '2026-03-04').enCurso, 1);
  assert.equal(L.temaEsperado(cal, '2026-05-20').semana.tipo, 'VACACIONES');
  assert.equal(L.temaEsperado(cal, '2026-12-17').completados, 31); // la semana 32 cierra el sáb. 19/12
  assert.equal(L.temaEsperado(cal, '2026-12-21').completados, 32);
});

test('avance del curso, tema sugerido y semáforo', () => {
  let a = L.avanceCurso(32, 28, []);
  assert.equal(a.ultimoContinuo, 28); assert.equal(a.siguiente, 29); assert.equal(a.sugerido, 29); assert.equal(a.cobertura, 87.5);
  a = L.avanceCurso(32, 28, [{ n: 29, tipo: 'PARCIAL', fecha: '2026-11-23' }]);
  assert.equal(a.sugerido, 29, 'continúa el tema parcial'); assert.deepEqual(a.parciales, [29]);
  a = L.avanceCurso(32, 28, [{ n: 29, tipo: 'PARCIAL', fecha: '2026-11-23' }, { n: 29, tipo: 'COMPLETADO', fecha: '2026-11-24' }]);
  assert.equal(a.sugerido, 30); assert.deepEqual(a.parciales, []); assert.equal(a.ultimoContinuo, 29);
  a = L.avanceCurso(32, 26, [{ n: 28, tipo: 'COMPLETADO', fecha: '2026-11-23' }]); // se saltó el 27
  assert.equal(a.ultimoContinuo, 26); assert.equal(a.siguiente, 27); assert.equal(a.totalCompletados, 27);
  a = L.avanceCurso(32, 28, [{ n: 29, tipo: 'REPASO', fecha: '2026-11-23' }]);
  assert.equal(a.ultimoContinuo, 28, 'un repaso no completa el tema');
  assert.deepEqual(L.semaforoAtraso(28, 28), { atraso: 0, semaforo: 'VERDE' });
  assert.deepEqual(L.semaforoAtraso(27, 28), { atraso: 1, semaforo: 'AMBAR' });
  assert.deepEqual(L.semaforoAtraso(25, 28), { atraso: 3, semaforo: 'ROJO' });
});

test('bloque del horario → curso del temario (alias)', () => {
  const cursos = [{ id: 'AI-RM', salon: 'ANUAL INTEGRAL', curso: 'Razonamiento Matemático', alias: 'RAZ. MATEMÁTICO|RM' },
    { id: 'AI-ALG', salon: 'ANUAL INTEGRAL', curso: 'Álgebra', alias: 'ÁLGEBRA' }];
  assert.equal(L.cursoDeBloque({ salon: 'ANUAL INTEGRAL', curso: 'RAZ. MATEMÁTICO' }, cursos).id, 'AI-RM');
  assert.equal(L.cursoDeBloque({ salon: 'ANUAL INTEGRAL', curso: 'ALGEBRA' }, cursos).id, 'AI-ALG');
  assert.equal(L.cursoDeBloque({ salon: 'LÍDERES 5-6', curso: 'ÁLGEBRA' }, cursos), null, 'otro salón no aplica');
  assert.equal(L.cursoDeBloque({ salon: 'ANUAL INTEGRAL', curso: 'EDUC. FÍSICA' }, cursos), null);
});

test('temario depurado: 15 cursos × 32 temas, sin huecos ni duplicados', () => {
  const rows = fs.readFileSync(path.join(__dirname, '../datos/temario_anual_integral_2026.csv'), 'utf8').trim().split('\n').slice(1);
  assert.equal(rows.length, 480);
  const porCurso = {};
  rows.forEach((l) => { const c = l.split(','); (porCurso[c[1]] = porCurso[c[1]] || new Set()).add(Number(c[3])); });
  assert.equal(Object.keys(porCurso).length, 15);
  Object.entries(porCurso).forEach(([c, s]) => assert.equal(s.size, 32, c));
});
