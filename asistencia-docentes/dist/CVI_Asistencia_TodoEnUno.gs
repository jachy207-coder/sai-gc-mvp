/**
 * CVI Monte Azul · Control de Asistencia Docente — ARCHIVO ÚNICO (generado).
 * INICIO DEL ARCHIVO (no debe haber nada encima de esta línea).
 * Pega TODO este contenido en Extensiones → Apps Script → Código.gs de la hoja
 * "CVI Asistencia Docente - Monte Azul (piloto)", guarda, ejecuta setup() e implementa como aplicación web.
 */

/* ========================= Logic.gs ========================= */
/**
 * Logic.gs — Reglas de negocio puras (sin APIs de Google).
 * Se pueden probar en Node: ver tests/logic.test.js
 *
 * Convenciones:
 *  - Horas como texto "HH:mm" (24 h). Minutos desde medianoche para cálculos.
 *  - Días: LUNES, MARTES, MIERCOLES, JUEVES, VIERNES, SABADO, DOMINGO (sin tildes).
 */

var DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
var DIAS_LABEL = {
  DOMINGO: 'Domingo', LUNES: 'Lunes', MARTES: 'Martes', MIERCOLES: 'Miércoles',
  JUEVES: 'Jueves', VIERNES: 'Viernes', SABADO: 'Sábado'
};

var OBSERVACIONES = [
  'Tardanza justificada',
  'Permiso',
  'Salida anticipada',
  'Reemplazo de docente',
  'Clase de recuperación',
  'Salud',
  'Problema de transporte',
  'Otro'
];

/** "8:05" | "08:05" | Date-like → minutos desde 00:00. Devuelve null si no es válido. */
function toMin(hhmm) {
  if (hhmm === null || hhmm === undefined || hhmm === '') return null;
  var m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  var h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** minutos → "HH:mm" */
function fmtMin(min) {
  if (min === null || min === undefined) return '';
  var h = Math.floor(min / 60), m = min % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

/** Redondea horas a 2 decimales. */
function round2(n) { return Math.round(n * 100) / 100; }

/** "2026-11-16" → "LUNES" (sin depender de la zona horaria). */
function diaDeFecha(isoDate) {
  var p = String(isoDate).split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return DIAS[d.getUTCDay()];
}

/** Normaliza texto para comparar nombres (sin tildes, minúsculas, espacios simples). */
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Extrae el código de marcación de lo que se escriba o escanee (texto, URL de QR, etc.):
 * DNI (8 dígitos) o celular (9 dígitos).
 */
function extraerDni(texto) {
  var s = String(texto || '');
  var url = s.match(/[?&]dni=(\d{8,9})(?!\d)/i);
  if (url) return url[1];
  var m = s.replace(/[\s-]/g, '').match(/\d{8,9}/);
  return m ? m[0] : null;
}

/** Bloques del horario para un día (opcionalmente de un docente), ordenados por hora. */
function bloquesDelDia(horario, dia, docente) {
  var nd = docente ? norm(docente) : null;
  return horario
    .filter(function (b) { return b.dia === dia && (!nd || norm(b.docente) === nd); })
    .sort(function (a, b) { return toMin(a.inicio) - toMin(b.inicio) || String(a.salon).localeCompare(b.salon); });
}

/**
 * Evalúa la puntualidad de un ingreso contra el primer bloque seleccionado.
 * @return {{estado:string, minTarde:number, referencia:string}}
 */
function evaluarIngreso(horaIngreso, bloques, toleranciaMin) {
  var tol = Number(toleranciaMin || 0);
  var ing = toMin(horaIngreso);
  if (!bloques || !bloques.length) return { estado: 'SIN HORARIO', minTarde: 0, referencia: '' };
  var primero = bloques.slice().sort(function (a, b) { return toMin(a.inicio) - toMin(b.inicio); })[0];
  var ref = toMin(primero.inicio);
  var diff = ing - ref;
  if (diff <= tol) return { estado: 'PUNTUAL', minTarde: 0, referencia: primero.inicio };
  return { estado: 'TARDANZA', minTarde: diff, referencia: primero.inicio };
}

/** Horas (decimales) en que [ini, fin] se superpone con el bloque. */
function horasSuperpuestas(ini, fin, bloque) {
  var a = Math.max(toMin(ini), toMin(bloque.inicio));
  var b = Math.min(toMin(fin), toMin(bloque.fin));
  return b > a ? round2((b - a) / 60) : 0;
}

/** Minutos cubiertos por al menos un bloque (sin contar dos veces los simultáneos). */
function minutosUnion(bloques) {
  var tramos = bloques.map(function (b) { return [toMin(b.inicio), toMin(b.fin)]; }).sort(function (x, y) { return x[0] - y[0]; });
  var total = 0, ca = null, cz = null;
  tramos.forEach(function (t) {
    if (ca === null || t[0] > cz) { if (ca !== null) total += cz - ca; ca = t[0]; cz = t[1]; } else cz = Math.max(cz, t[1]);
  });
  if (ca !== null) total += cz - ca;
  return total;
}

/** Duración en horas de un bloque. */
function horasBloque(b) { return round2((toMin(b.fin) - toMin(b.inicio)) / 60); }

/**
 * Calcula horas de una marcación cerrada.
 *  - marcadas: tiempo total entre ingreso y salida (horas cronológicas).
 *  - efectivas: tiempo marcado que coincide con las clases seleccionadas (corroborado con horario).
 *  - programadas: suma de la duración de las clases seleccionadas.
 */
function calcularHoras(ini, fin, bloques) {
  bloques = bloques || [];
  var a = toMin(ini), z = toMin(fin);
  var marcadas = Math.max(0, round2((z - a) / 60));
  // Minuto a minuto: si el docente tiene salones simultáneos (clases juntas), ese minuto se
  // cuenta UNA sola vez y se reparte entre los salones, para no duplicar horas de pago.
  var minutos = bloques.map(function () { return 0; });
  var unionMin = 0;
  for (var t = a; t < z; t++) {
    var activos = [];
    bloques.forEach(function (b, i) { if (t >= toMin(b.inicio) && t < toMin(b.fin)) activos.push(i); });
    if (!activos.length) continue;
    unionMin += 1;
    activos.forEach(function (i) { minutos[i] += 1 / activos.length; });
  }
  var detalle = bloques.map(function (b, i) {
    return { id: b.id, horas: Math.round(minutos[i] / 60 * 1000) / 1000, programadas: horasBloque(b) };
  });
  var efectivas = round2(unionMin / 60);
  var programadas = round2(minutosUnion(bloques) / 60);
  return { marcadas: marcadas, efectivas: efectivas, programadas: programadas, detalle: detalle };
}

/**
 * Estado de cada bloque del día para el dashboard.
 * @param bloques  bloques del día
 * @param marcaciones  marcaciones del día [{dni, docente, inicio, fin, bloques:[id], reemplazos:[id]}]
 * @param ahora  "HH:mm" (hora actual; si la fecha es pasada usar "23:59")
 */
function estadoBloques(bloques, marcaciones, ahora) {
  var now = toMin(ahora);
  return bloques.map(function (b) {
    var quien = null, tipo = null, enCurso = false;
    marcaciones.forEach(function (m) {
      var esTitular = (m.bloques || []).indexOf(b.id) >= 0;
      var esReemp = (m.reemplazos || []).indexOf(b.id) >= 0;
      if (!esTitular && !esReemp) return;
      // Solo cuenta si la marcación se cruza con el bloque (o sigue abierta).
      var cubre = toMin(m.inicio) < toMin(b.fin) && (!m.fin || toMin(m.fin) > toMin(b.inicio));
      if (!cubre || quien) return;
      quien = m.docente; tipo = esReemp ? 'REEMPLAZO' : 'TITULAR';
      enCurso = !m.fin;
    });
    var estado;
    if (quien) {
      if (now < toMin(b.inicio)) estado = 'CONFIRMADO';
      else if (now < toMin(b.fin) && enCurso) estado = tipo === 'REEMPLAZO' ? 'REEMPLAZO' : 'EN CLASE';
      else estado = tipo === 'REEMPLAZO' ? 'REEMPLAZO' : 'DICTADO';
    } else if (!b.docente) {
      estado = 'SIN DOCENTE';
    } else if (now < toMin(b.inicio)) {
      estado = 'PROGRAMADO';
    } else if (now < toMin(b.fin)) {
      estado = 'SIN MARCAR';
    } else {
      estado = 'NO DICTADO';
    }
    return {
      id: b.id, salon: b.salon, curso: b.curso, inicio: b.inicio, fin: b.fin,
      titular: b.docente, dicto: quien, tipo: tipo, estado: estado
    };
  });
}

/**
 * Resumen para pagos: Docente | Mes | Salón | N.º horas dictadas.
 * @param clases filas de la hoja Clases [{fecha, salon, docente, tipo, horas, ...}]
 * @param mes "2026-11"
 */
function resumenMensual(clases, mes, marcaciones) {
  var mapa = {};
  clases.forEach(function (c) {
    if (String(c.fecha).slice(0, 7) !== mes) return;
    var k = c.docente + '||' + c.salon;
    if (!mapa[k]) mapa[k] = { docente: c.docente, dni: c.dni, mes: mes, salon: c.salon, horas: 0, clases: 0, reemplazos: 0, dias: {} };
    mapa[k].horas = round2(mapa[k].horas + Number(c.horas || 0));
    mapa[k].clases += 1;
    if (c.tipo === 'REEMPLAZO') mapa[k].reemplazos += 1;
    mapa[k].dias[c.fecha] = true;
  });
  var tard = {};
  (marcaciones || []).forEach(function (m) {
    if (String(m.fecha).slice(0, 7) !== mes) return;
    if (!tard[m.docente]) tard[m.docente] = { n: 0, min: 0 };
    if (m.estado === 'TARDANZA') { tard[m.docente].n += 1; tard[m.docente].min += Number(m.minTarde || 0); }
  });
  var filas = Object.keys(mapa).map(function (k) {
    var r = mapa[k];
    r.dias = Object.keys(r.dias).length;
    r.tardanzas = tard[r.docente] ? tard[r.docente].n : 0;
    r.minTarde = tard[r.docente] ? tard[r.docente].min : 0;
    return r;
  });
  filas.sort(function (a, b) { return a.docente.localeCompare(b.docente) || a.salon.localeCompare(b.salon); });
  return filas;
}

// Exportar para pruebas en Node (ignorado en Apps Script).
if (typeof module !== 'undefined') {
  module.exports = {
    DIAS: DIAS, OBSERVACIONES: OBSERVACIONES, toMin: toMin, fmtMin: fmtMin, diaDeFecha: diaDeFecha, norm: norm,
    extraerDni: extraerDni, bloquesDelDia: bloquesDelDia, evaluarIngreso: evaluarIngreso,
    horasSuperpuestas: horasSuperpuestas, calcularHoras: calcularHoras,
    estadoBloques: estadoBloques, resumenMensual: resumenMensual
  };
}

/* ========================= Seed.gs ========================= */
/** Seed.gs — GENERADO por tools/generar_seed.py. No editar a mano.
 *  Datos base: horario por salón 2026 (HORARIO MONTE AZUL 2026 - 21.03.26.xlsx)
 *  y docentes encontrados en el horario. Solo se usan en setup() si las hojas están vacías. */

var SEED_HORARIO = [
  ["AI-LU-1", "ANUAL INTEGRAL", "LUNES", "08:00", "10:00", "TRIGONOMETRÍA", "Jhon Vásquez", ""],
  ["AI-LU-2", "ANUAL INTEGRAL", "LUNES", "10:15", "11:00", "TRIGONOMETRÍA", "Jhon Vásquez", ""],
  ["AI-LU-3", "ANUAL INTEGRAL", "LUNES", "11:00", "12:00", "BIOLOGÍA", "Susan Adama", ""],
  ["AI-LU-4", "ANUAL INTEGRAL", "LUNES", "12:15", "13:00", "BIOLOGÍA", "Susan Adama", "Celda compartida con Educ. Física: confirmar reparto"],
  ["AI-LU-5", "ANUAL INTEGRAL", "LUNES", "13:00", "14:00", "EDUC. FÍSICA", "Jordi San Miguel", "Celda compartida con Biología: confirmar reparto"],
  ["AI-MA-1", "ANUAL INTEGRAL", "MARTES", "08:00", "09:30", "RAZ. MATEMÁTICO", "Jhonatan Hilario", ""],
  ["AI-MA-2", "ANUAL INTEGRAL", "MARTES", "09:30", "10:00", "ARITMÉTICA", "Jhon Quispe", "Docente no indicado en celda: asumido"],
  ["AI-MA-3", "ANUAL INTEGRAL", "MARTES", "10:15", "12:00", "ARITMÉTICA", "Jhon Quispe", ""],
  ["AI-MA-4", "ANUAL INTEGRAL", "MARTES", "12:15", "12:30", "ARITMÉTICA", "Jhon Quispe", "Docente no indicado en celda: asumido"],
  ["AI-MA-5", "ANUAL INTEGRAL", "MARTES", "12:30", "14:00", "LENGUAJE", "Ivonne Solórzano", ""],
  ["AI-MI-1", "ANUAL INTEGRAL", "MIERCOLES", "08:00", "10:00", "RAZ. VERBAL", "Ivonne Solórzano", ""],
  ["AI-MI-2", "ANUAL INTEGRAL", "MIERCOLES", "10:15", "11:00", "INGLÉS", "Ivonne Solórzano", ""],
  ["AI-MI-3", "ANUAL INTEGRAL", "MIERCOLES", "11:00", "12:00", "QUÍMICA", "Redoberto Martin", ""],
  ["AI-MI-4", "ANUAL INTEGRAL", "MIERCOLES", "12:15", "14:00", "QUÍMICA", "Redoberto Martin", ""],
  ["AI-JU-1", "ANUAL INTEGRAL", "JUEVES", "08:00", "10:00", "ÁLGEBRA", "Alberto Yanac", ""],
  ["AI-JU-2", "ANUAL INTEGRAL", "JUEVES", "10:15", "12:00", "GEOGRAFÍA", "Wilber Escobar", ""],
  ["AI-JU-3", "ANUAL INTEGRAL", "JUEVES", "12:15", "14:00", "HISTORIA", "Wilber Escobar", ""],
  ["AI-VI-1", "ANUAL INTEGRAL", "VIERNES", "08:00", "10:00", "FÍSICA", "Jorge Adama", ""],
  ["AI-VI-2", "ANUAL INTEGRAL", "VIERNES", "10:15", "11:00", "FÍSICA", "Jorge Adama", ""],
  ["AI-VI-3", "ANUAL INTEGRAL", "VIERNES", "11:00", "12:00", "ECONOMÍA", "Fabián Vargas", ""],
  ["AI-VI-4", "ANUAL INTEGRAL", "VIERNES", "12:15", "12:30", "ECONOMÍA", "Fabián Vargas", ""],
  ["AI-VI-5", "ANUAL INTEGRAL", "VIERNES", "12:30", "14:00", "FILOSOFÍA", "Fabián Vargas", ""],
  ["AI-SA-1", "ANUAL INTEGRAL", "SABADO", "08:00", "10:00", "GEOMETRÍA", "Alan Sosa", ""],
  ["AI-SA-2", "ANUAL INTEGRAL", "SABADO", "10:15", "11:00", "GEOMETRÍA", "Alan Sosa", ""],
  ["AI-SA-3", "ANUAL INTEGRAL", "SABADO", "11:00", "12:00", "PRÁCTICAS", "", "Sin docente asignado"],
  ["LI-LU-1", "LÍDERES 5-6", "LUNES", "08:00", "09:00", "AJEDREZ", "Jordi San Miguel", ""],
  ["LI-LU-2", "LÍDERES 5-6", "LUNES", "09:00", "10:00", "EDUC. FÍSICA", "Jordi San Miguel", ""],
  ["LI-LU-3", "LÍDERES 5-6", "LUNES", "10:15", "11:00", "FÍSICA", "Susan Adama", "Celda compartida con Arte: confirmar reparto"],
  ["LI-LU-4", "LÍDERES 5-6", "LUNES", "11:00", "12:00", "ARTE", "Erika Ramírez", "Celda compartida con Física: confirmar reparto"],
  ["LI-LU-5", "LÍDERES 5-6", "LUNES", "12:15", "13:00", "CALIGRAFÍA", "Erika Ramírez", "Celda compartida con Biología: confirmar reparto"],
  ["LI-LU-6", "LÍDERES 5-6", "LUNES", "13:00", "14:00", "BIOLOGÍA", "Susan Adama", "Celda compartida con Caligrafía: confirmar reparto"],
  ["LI-MA-1", "LÍDERES 5-6", "MARTES", "08:00", "09:30", "RAZ. VERBAL", "Ivonne Solórzano", ""],
  ["LI-MA-2", "LÍDERES 5-6", "MARTES", "09:30", "11:30", "LENGUAJE", "Ivonne Solórzano", ""],
  ["LI-MA-3", "LÍDERES 5-6", "MARTES", "11:30", "12:00", "INGLÉS", "Ivonne Solórzano", "Docente no indicado en celda: asumido"],
  ["LI-MA-4", "LÍDERES 5-6", "MARTES", "12:15", "12:30", "INGLÉS", "Ivonne Solórzano", "Docente no indicado en celda: asumido"],
  ["LI-MA-5", "LÍDERES 5-6", "MARTES", "12:30", "14:00", "TUTORÍA", "Alanis Cárdenas", "Tutora del salón: asumido"],
  ["LI-MI-1", "LÍDERES 5-6", "MIERCOLES", "08:00", "10:00", "QUÍMICA", "Susan Adama", ""],
  ["LI-MI-2", "LÍDERES 5-6", "MIERCOLES", "10:15", "11:00", "PLAN LECTOR", "Susan Adama", ""],
  ["LI-MI-3", "LÍDERES 5-6", "MIERCOLES", "11:00", "12:00", "COMPUTACIÓN", "Erika Ramírez", ""],
  ["LI-MI-4", "LÍDERES 5-6", "MIERCOLES", "12:15", "14:00", "GEOMETRÍA", "Susan Adama", ""],
  ["LI-JU-1", "LÍDERES 5-6", "JUEVES", "08:00", "10:00", "HISTORIA", "Wilber Escobar", ""],
  ["LI-JU-2", "LÍDERES 5-6", "JUEVES", "10:15", "12:00", "ÁLGEBRA", "Alberto Yanac", ""],
  ["LI-JU-3", "LÍDERES 5-6", "JUEVES", "12:15", "14:00", "TRIGONOMETRÍA", "Alberto Yanac", ""],
  ["LI-VI-1", "LÍDERES 5-6", "VIERNES", "08:00", "10:00", "GEOGRAFÍA", "Fabián Vargas", ""],
  ["LI-VI-2", "LÍDERES 5-6", "VIERNES", "10:15", "12:00", "RAZ. MATEMÁTICO", "Yuly", ""],
  ["LI-VI-3", "LÍDERES 5-6", "VIERNES", "12:15", "14:00", "ARITMÉTICA", "Yuly", ""],
  ["CR-LU-1", "CREADORES 3-4", "LUNES", "08:00", "10:00", "ARITMÉTICA", "Nicol Vallejos", ""],
  ["CR-LU-2", "CREADORES 3-4", "LUNES", "10:15", "12:00", "RAZ. MATEMÁTICO", "Nicol Vallejos", ""],
  ["CR-LU-3", "CREADORES 3-4", "LUNES", "12:15", "13:00", "AJEDREZ", "Jordi San Miguel", ""],
  ["CR-LU-4", "CREADORES 3-4", "LUNES", "13:00", "14:00", "EDUC. FÍSICA", "Jordi San Miguel", ""],
  ["CR-MA-1", "CREADORES 3-4", "MARTES", "08:00", "10:00", "LENGUAJE", "Nicol Vallejos", ""],
  ["CR-MA-2", "CREADORES 3-4", "MARTES", "10:15", "12:00", "BIOLOGÍA", "Nicol Vallejos", ""],
  ["CR-MA-3", "CREADORES 3-4", "MARTES", "12:15", "14:00", "RAZ. VERBAL", "Nicol Vallejos", ""],
  ["CR-MI-1", "CREADORES 3-4", "MIERCOLES", "08:00", "10:00", "GEOMETRÍA", "Justin Guillén", ""],
  ["CR-MI-2", "CREADORES 3-4", "MIERCOLES", "10:15", "12:00", "HISTORIA DEL PERÚ", "Nicol Vallejos", ""],
  ["CR-MI-3", "CREADORES 3-4", "MIERCOLES", "12:15", "14:00", "CALIGRAFÍA Y PLAN LECTOR", "Nicol Vallejos", ""],
  ["CR-JU-1", "CREADORES 3-4", "JUEVES", "08:00", "10:00", "ÁLGEBRA", "Nicol Vallejos", ""],
  ["CR-JU-2", "CREADORES 3-4", "JUEVES", "10:15", "11:00", "INGLÉS", "Ivonne Solórzano", "Docente no indicado en celda: asumido"],
  ["CR-JU-3", "CREADORES 3-4", "JUEVES", "11:00", "12:00", "COMPUTACIÓN", "Erika Ramírez", ""],
  ["CR-JU-4", "CREADORES 3-4", "JUEVES", "12:15", "14:00", "FÍSICA", "Nicol Vallejos", ""],
  ["CR-VI-1", "CREADORES 3-4", "VIERNES", "08:00", "10:00", "GEOGRAFÍA", "Nicol Vallejos", ""],
  ["CR-VI-2", "CREADORES 3-4", "VIERNES", "10:15", "12:00", "QUÍMICA", "Nicol Vallejos", ""],
  ["CR-VI-3", "CREADORES 3-4", "VIERNES", "12:15", "13:00", "ARITMÉTICA", "Nicol Vallejos", ""],
  ["CR-VI-4", "CREADORES 3-4", "VIERNES", "13:00", "14:00", "ARTE", "Nicol Vallejos", ""],
  ["AV-LU-1", "AVENTUREROS 1-2", "LUNES", "08:00", "10:00", "LENGUAJE", "Marleny Landeo", "Polidocencia: tutora del salón"],
  ["AV-LU-2", "AVENTUREROS 1-2", "LUNES", "10:15", "12:00", "ARITMÉTICA", "Marleny Landeo", ""],
  ["AV-LU-3", "AVENTUREROS 1-2", "LUNES", "12:15", "13:00", "AJEDREZ", "Jordi San Miguel", ""],
  ["AV-LU-4", "AVENTUREROS 1-2", "LUNES", "13:00", "14:00", "EDUC. FÍSICA", "Jordi San Miguel", ""],
  ["AV-MA-1", "AVENTUREROS 1-2", "MARTES", "08:00", "10:00", "RAZ. MATEMÁTICO", "Marleny Landeo", ""],
  ["AV-MA-2", "AVENTUREROS 1-2", "MARTES", "10:15", "12:00", "GEOMETRÍA", "Marleny Landeo", ""],
  ["AV-MA-3", "AVENTUREROS 1-2", "MARTES", "12:15", "13:00", "CALIGRAFÍA", "Marleny Landeo", ""],
  ["AV-MA-4", "AVENTUREROS 1-2", "MARTES", "13:00", "14:00", "RAZ. VERBAL", "Marleny Landeo", ""],
  ["AV-MI-1", "AVENTUREROS 1-2", "MIERCOLES", "08:00", "09:00", "REDACCIÓN Y PRODUCCIÓN DE TEXTOS", "Marleny Landeo", ""],
  ["AV-MI-2", "AVENTUREROS 1-2", "MIERCOLES", "09:00", "10:00", "PLAN LECTOR", "Marleny Landeo", ""],
  ["AV-MI-3", "AVENTUREROS 1-2", "MIERCOLES", "10:15", "12:00", "ARITMÉTICA", "Marleny Landeo", ""],
  ["AV-MI-4", "AVENTUREROS 1-2", "MIERCOLES", "12:15", "14:00", "CIENCIA Y TECNOLOGÍA", "Marleny Landeo", ""],
  ["AV-JU-1", "AVENTUREROS 1-2", "JUEVES", "08:00", "10:00", "ÁLGEBRA", "Marleny Landeo", ""],
  ["AV-JU-2", "AVENTUREROS 1-2", "JUEVES", "10:15", "11:00", "COMPUTACIÓN", "Erika Ramírez", ""],
  ["AV-JU-3", "AVENTUREROS 1-2", "JUEVES", "11:00", "12:00", "LENGUAJE", "Marleny Landeo", ""],
  ["AV-JU-4", "AVENTUREROS 1-2", "JUEVES", "12:15", "13:00", "PERSONAL SOCIAL", "Marleny Landeo", ""],
  ["AV-JU-5", "AVENTUREROS 1-2", "JUEVES", "13:00", "14:00", "ARTE", "Marleny Landeo", ""],
  ["AV-VI-1", "AVENTUREROS 1-2", "VIERNES", "08:00", "10:00", "LENGUAJE", "Marleny Landeo", ""],
  ["AV-VI-2", "AVENTUREROS 1-2", "VIERNES", "10:15", "12:00", "PERSONAL SOCIAL", "Marleny Landeo", ""],
  ["AV-VI-3", "AVENTUREROS 1-2", "VIERNES", "12:15", "13:00", "INGLÉS", "Marleny Landeo", ""],
  ["AV-VI-4", "AVENTUREROS 1-2", "VIERNES", "13:00", "14:00", "EXPRESIÓN ORAL", "Marleny Landeo", ""],
  ["EX-LU-1", "EXPLORADORES 4-5", "LUNES", "08:00", "13:00", "JORNADA INICIAL", "Ariana Cancino", "Tutora de inicial"],
  ["EX-MA-1", "EXPLORADORES 4-5", "MARTES", "08:00", "13:00", "JORNADA INICIAL", "Ariana Cancino", "Tutora de inicial"],
  ["EX-MI-1", "EXPLORADORES 4-5", "MIERCOLES", "08:00", "13:00", "JORNADA INICIAL", "Ariana Cancino", "Tutora de inicial"],
  ["EX-JU-1", "EXPLORADORES 4-5", "JUEVES", "08:00", "13:00", "JORNADA INICIAL", "Ariana Cancino", "Tutora de inicial"],
  ["EX-VI-1", "EXPLORADORES 4-5", "VIERNES", "08:00", "13:00", "JORNADA INICIAL", "Ariana Cancino", "Tutora de inicial"],
  ["PE-LU-1", "PEQUEÑINES 3", "LUNES", "08:00", "13:00", "JORNADA INICIAL", "Cherceni Floridas", "Tutora de inicial"],
  ["PE-MA-1", "PEQUEÑINES 3", "MARTES", "08:00", "13:00", "JORNADA INICIAL", "Cherceni Floridas", "Tutora de inicial"],
  ["PE-MI-1", "PEQUEÑINES 3", "MIERCOLES", "08:00", "13:00", "JORNADA INICIAL", "Cherceni Floridas", "Tutora de inicial"],
  ["PE-JU-1", "PEQUEÑINES 3", "JUEVES", "08:00", "13:00", "JORNADA INICIAL", "Cherceni Floridas", "Tutora de inicial"],
  ["PE-VI-1", "PEQUEÑINES 3", "VIERNES", "08:00", "13:00", "JORNADA INICIAL", "Cherceni Floridas", "Tutora de inicial"]
];

var SEED_DOCENTES = [
  ["", "Jhon Vásquez", "", "Trigonometría", "", "", "SI"],
  ["", "Jhonatan Hilario", "Jhonatan Hilario Maldonado", "Raz. Matemático", "940509635", "jhonatan_19847@hotmail.com", "SI"],
  ["", "Ivonne Solórzano", "Ivonne Taira Solorzano Amacifuen", "Lenguaje, Raz. Verbal, Inglés", "925841033", "solorzano.taira@gmail.com", "SI"],
  ["", "Alberto Yanac", "Alberto Calixto Yanac Hurtado", "Álgebra y Trigonometría", "946234715", "alberto.yanac.h@uni.pe", "SI"],
  ["", "Jorge Adama", "", "Física", "", "", "SI"],
  ["", "Alan Sosa", "Alan Paul Sosa Cauti", "Geometría", "938898881", "paulsosa32@hotmail.com", "SI"],
  ["", "Jhon Quispe", "Jhon Marcy Quispe Yaganqui", "Aritmética", "902061340", "jhonmqy@gmail.com", "SI"],
  ["", "Wilber Escobar", "Wilber Escobar Navarro", "Historia y Geografía", "965700105", "wilber.escobar@unmsm.edu.pe", "SI"],
  ["", "Susan Adama", "", "Ciencias", "", "", "SI"],
  ["", "Jordi San Miguel", "Jordi Cristofer San Miguel Ibarra", "Educ. Física y Ajedrez", "920577362", "jordisanmiguel24@gmail.com", "SI"],
  ["", "Redoberto Martin", "Redoberto Martin Aguirre", "Química", "926526458", "redobaldo@gmail.com", "SI"],
  ["", "Fabián Vargas", "Fabián Azarías Vargas Silva", "Geografía, Filosofía y Economía", "986025541", "fabianazarias.380@gmail.com", "SI"],
  ["", "Erika Ramírez", "Erika Beatriz Ramírez Montesinos", "Arte y Computación", "963559152", "erikamontesinos1984@gmail.com", "SI"],
  ["", "Yuly", "", "Matemática", "", "", "SI"],
  ["", "Nicol Vallejos", "Nicol Andrea Vallejos Suárez", "Polidocencia Creadores 3-4", "906608891", "nicolvallejos05@gmail.com", "SI"],
  ["", "Justin Guillén", "Justin Anthony Guillén López", "Geometría", "987702349", "justinguillenlopez.sjb@gmail.com", "SI"],
  ["", "Marleny Landeo", "Marleny Landeo Daniel", "Polidocencia Aventureros 1-2", "931000890", "marlenylandeodaniel@gmail.com", "SI"],
  ["", "Alanis Cárdenas", "Alanis Romina Cárdenas Tambo", "Tutoría Líderes 5-6", "941072934", "alanina.miau@gmail.com", "SI"],
  ["", "Ariana Cancino", "Ariana Naomi Cancino Guardamino", "Inicial Exploradores 4-5", "982391670", "cancinoariana71@gmail.com", "SI"],
  ["", "Cherceni Floridas", "Cherceni Alexandra Floridas Piña", "Inicial Pequeñines 3", "970414409", "cherceni1234floridas@gmail.com", "SI"],
  ["", "Alexander Yanac", "Alexander Yanac Hurtado", "Física y Trigonometría", "920077386", "alexanderyanachurtado@gmail.com", "NO"],
  ["", "Mitzi Matias", "Mitzi Marjorie Matias Rodriguez", "Comunicación", "941112806", "mitzimatias7@gmail.com", "NO"],
  ["", "María Narciso", "María de Jesús Narciso Quispe", "Ciencias Sociales", "987801210", "esxoterika@gmail.com", "NO"],
  ["", "Jeremy Loarte", "Jeremy Imanol Loarte Fuentes Rivera", "", "978420702", "jeremyloarte3@gmail.com", "NO"],
  ["", "Gladys Rodas", "Gladys Milagros Rodas Zapana", "Inglés", "937589188", "gmilagrosrodas24@gmail.com", "NO"],
  ["", "Kevin Albán", "Kevin Alexis Albán Becerra", "Educ. Física", "923073349", "kevinalban15@gmail.com", "NO"]
];

/* ========================= Code.gs ========================= */
/**
 * CVI Monte Azul — Control de Asistencia Docente (piloto 16/11/2026)
 * Backend en Google Apps Script. Los datos viven en la hoja de cálculo vinculada.
 *
 * Páginas:
 *   <URL de la app>              → Marcación (DNI / QR)
 *   <URL de la app>?page=panel   → Panel en tiempo real + reportes (con PIN)
 */

var TZ = 'America/Lima';
// Hoja de datos (se usa si el script no está vinculado a la hoja).
var SHEET_ID = '1OACwpEZr4D1KEGePQIO4_MCItTWOAUnMbPeL5iOfx2U';

var HOJAS = {
  CONFIG: 'Config',
  DOCENTES: 'Docentes',
  HORARIO: 'Horario',
  MARCACIONES: 'Marcaciones',
  CLASES: 'Clases dictadas',
  REPORTE: 'Reporte mensual'
};

// Esquemas: [clave interna, encabezado visible, formato texto?]
var ESQUEMAS = {
  Config: [['clave', 'Clave', true], ['valor', 'Valor', true], ['descripcion', 'Descripción', true]],
  Docentes: [['dni', 'DNI', true], ['docente', 'Docente (igual que en Horario)', true], ['nombreCompleto', 'Nombre completo', true],
    ['especialidad', 'Especialidad', true], ['celular', 'Celular', true], ['correo', 'Correo', true], ['activo', 'Activo (SI/NO)', true]],
  Horario: [['id', 'ID', true], ['salon', 'Salón', true], ['dia', 'Día', true], ['inicio', 'Inicio', true], ['fin', 'Fin', true],
    ['curso', 'Curso', true], ['docente', 'Docente', true], ['nota', 'Nota', true]],
  Marcaciones: [['id', 'ID', true], ['fecha', 'Fecha', true], ['dni', 'DNI', true], ['docente', 'Docente', true],
    ['inicio', 'Hora ingreso', true], ['fin', 'Hora salida', true], ['estado', 'Estado ingreso', true], ['minTarde', 'Min. tardanza', false],
    ['bloques', 'Clases propias (IDs)', true], ['reemplazos', 'Reemplazos (IDs)', true], ['obs', 'Observación', true],
    ['obsDetalle', 'Detalle observación', true], ['dispositivo', 'Dispositivo', true], ['horasMarcadas', 'Horas marcadas', false],
    ['horasEfectivas', 'Horas dictadas', false], ['horasProgramadas', 'Horas programadas', false], ['registrado', 'Registrado', true]],
  'Clases dictadas': [['fecha', 'Fecha', true], ['mes', 'Mes', true], ['marcacion', 'Marcación', true], ['bloque', 'Bloque', true],
    ['salon', 'Salón', true], ['curso', 'Curso', true], ['titular', 'Docente titular', true], ['docente', 'Docente que dictó', true],
    ['dni', 'DNI', true], ['tipo', 'Tipo', true], ['inicio', 'Inicio programado', true], ['fin', 'Fin programado', true],
    ['horas', 'Horas dictadas', false]]
};

var CONFIG_DEFAULT = [
  ['SEDE', 'Monte Azul', 'Nombre de la sede'],
  ['TOLERANCIA_MIN', '5', 'Minutos de tolerancia para considerar puntual'],
  ['PIN_PANEL', '2026', 'PIN para entrar al panel (cámbialo)'],
  ['LOGO_FILE_ID', '1lq4fr6oIeE7kkoQ33l6qUpzjJWS8mx3u', 'ID en Drive del logo CVI 2025 actualizado'],
  ['FECHA_INICIO', '2026-11-16', 'Inicio del piloto'],
  ['PERMITIR_CELULAR', 'SI', 'SI = se puede marcar desde el celular']
];

/* ============================ Web app ============================ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var page = p.page === 'panel' ? 'Dashboard' : 'Index';
  // En la versión "todo en uno" (dist/) el HTML viene embebido en __HTML.
  var t = typeof __HTML !== 'undefined' ? HtmlService.createTemplate(__HTML[page]) : HtmlService.createTemplateFromFile(page);
  t.dniInicial = extraerDni(p.dni || '') || '';
  t.appUrl = ScriptApp.getService().getUrl();
  return t.evaluate()
    .setTitle(page === 'Dashboard' ? 'Panel de Asistencia · CVI' : 'Asistencia Docente · CVI')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(nombre) {
  if (typeof __HTML !== 'undefined') return __HTML[nombre];
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/* ============================ Utilidades de hoja ============================ */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID); }

function hoja_(nombre) {
  var sh = ss_().getSheetByName(nombre);
  if (!sh) throw new Error('Falta la hoja "' + nombre + '". Ejecuta setup() desde el editor de Apps Script.');
  return sh;
}

function leer_(nombre) {
  var sh = hoja_(nombre);
  var esquema = ESQUEMAS[nombre];
  var n = sh.getLastRow();
  if (n < 2) return [];
  var vals = sh.getRange(2, 1, n - 1, esquema.length).getDisplayValues();
  return vals
    .filter(function (r) { return r.join('').trim() !== ''; })
    .map(function (r, i) {
      var o = { _fila: i + 2 };
      esquema.forEach(function (c, j) { o[c[0]] = String(r[j]).trim(); });
      return o;
    });
}

function filaDe_(nombre, obj) {
  return ESQUEMAS[nombre].map(function (c) {
    var v = obj[c[0]];
    if (Array.isArray(v)) v = v.join(',');
    return v === undefined || v === null ? '' : v;
  });
}

function agregar_(nombre, obj) {
  var sh = hoja_(nombre);
  sh.appendRow(filaDe_(nombre, obj));
}

function config_() {
  var c = {};
  CONFIG_DEFAULT.forEach(function (d) { c[d[0]] = d[1]; });
  try { leer_(HOJAS.CONFIG).forEach(function (r) { if (r.clave) c[r.clave] = r.valor; }); } catch (e) { }
  return c;
}

function hoy_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function ahora_() { return Utilities.formatDate(new Date(), TZ, 'HH:mm'); }
function sello_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function normCel_(v) { return String(v || '').replace(/\.0+$/, '').replace(/\D/g, '').replace(/^51(\d{9})$/, '$1'); }

function normDni_(v) {
  var s = String(v || '').replace(/\.0+$/, '').replace(/\D/g, '');
  if (s.length === 7) s = '0' + s; // Sheets a veces borra el 0 inicial
  return s;
}

function horario_() {
  return leer_(HOJAS.HORARIO).map(function (h) {
    h.dia = norm(h.dia).toUpperCase();
    h.inicio = fmtMin(toMin(h.inicio));
    h.fin = fmtMin(toMin(h.fin));
    return h;
  }).filter(function (h) { return h.id && toMin(h.inicio) !== null && toMin(h.fin) !== null; });
}

function docentes_() {
  return leer_(HOJAS.DOCENTES).map(function (d) {
    d.dni = normDni_(d.dni);
    d.celular = normCel_(d.celular);
    d.activo = norm(d.activo) !== 'no';
    return d;
  });
}

function marcacionesDe_(fecha) {
  return leer_(HOJAS.MARCACIONES).filter(function (m) { return m.fecha === fecha; }).map(parseMarcacion_);
}

function parseMarcacion_(m) {
  m.bloques = m.bloques ? m.bloques.split(',').filter(String) : [];
  m.reemplazos = m.reemplazos ? m.reemplazos.split(',').filter(String) : [];
  m.dni = normDni_(m.dni);
  return m;
}

/* ============================ API: Marcación ============================ */

function getInfo() {
  var c = config_();
  var fecha = hoy_();
  return {
    sede: c.SEDE, fecha: fecha, dia: diaDeFecha(fecha), hora: ahora_(),
    epoch: Date.now(), tolerancia: Number(c.TOLERANCIA_MIN), observaciones: OBSERVACIONES,
    permitirCelular: norm(c.PERMITIR_CELULAR) !== 'no'
  };
}

function getLogo() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('logo');
  if (hit) return hit;
  try {
    var id = config_().LOGO_FILE_ID;
    var f = DriveApp.getFileById(id);
    var blob = f.getThumbnail() || f.getBlob();
    var url = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
    if (url.length < 95000) cache.put('logo', url, 21600);
    return url;
  } catch (e) {
    return '';
  }
}

function buscarDocente(texto) {
  var cod = extraerDni(texto) || normDni_(texto);
  if (!cod || (cod.length !== 8 && cod.length !== 9)) return { ok: false, error: 'Ingresa tu DNI (8 dígitos) o tu celular (9 dígitos).' };
  // Se identifica por DNI (8 dígitos) o, mientras no se registre el DNI, por celular (9 dígitos).
  var doc = docentes_().filter(function (d) { return cod.length === 8 ? d.dni === cod : d.celular === cod; })[0];
  if (!doc) return { ok: false, error: (cod.length === 8 ? 'El DNI ' : 'El celular ') + cod + ' no está registrado. Comunícate con coordinación.' };
  var dni = doc.dni || doc.celular; // identificador que se guarda en las marcaciones
  if (!doc.activo) return { ok: false, error: 'El docente está inactivo. Comunícate con coordinación.' };

  var fecha = hoy_(), dia = diaDeFecha(fecha);
  var todos = bloquesDelDia(horario_(), dia);
  var propios = todos.filter(function (b) { return norm(b.docente) === norm(doc.docente); });
  var otros = todos.filter(function (b) { return norm(b.docente) !== norm(doc.docente); });
  var marc = marcacionesDe_(fecha);
  var mias = marc.filter(function (m) { return m.dni === dni; });
  var abierta = mias.filter(function (m) { return !m.fin; })[0] || null;

  // Bloques ya tomados por otros docentes hoy (para no duplicar reemplazos)
  var tomados = {};
  marc.forEach(function (m) {
    if (m.dni === dni) return;
    m.bloques.concat(m.reemplazos).forEach(function (id) { tomados[id] = m.docente; });
  });

  return {
    ok: true, dni: dni, docente: doc.docente, especialidad: doc.especialidad,
    fecha: fecha, dia: dia, hora: ahora_(),
    propios: propios, otros: otros.map(function (b) { b.tomadoPor = tomados[b.id] || ''; return b; }),
    abierta: abierta, cerradasHoy: mias.filter(function (m) { return m.fin; }).length
  };
}

function marcarIngreso(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var info = buscarDocente(p.dni);
    if (!info.ok) return info;
    if (info.abierta) return { ok: false, error: 'Ya tienes un ingreso abierto desde las ' + info.abierta.inicio + '. Marca tu salida.' };
    var c = config_();
    if (norm(c.PERMITIR_CELULAR) === 'no' && p.dispositivo === 'Celular') {
      return { ok: false, error: 'La marcación desde celular está deshabilitada. Usa la computadora del colegio.' };
    }
    var ids = (p.bloques || []).concat(p.reemplazos || []);
    if (!ids.length && !p.obs) return { ok: false, error: 'Selecciona al menos un salón o indica una observación.' };
    if (p.obs === 'Otro' && !String(p.obsDetalle || '').trim()) return { ok: false, error: 'Escribe el detalle de la observación.' };

    var hora = ahora_();
    var todos = info.propios.concat(info.otros);
    var sel = todos.filter(function (b) { return ids.indexOf(b.id) >= 0; });
    var ev = evaluarIngreso(hora, sel, Number(c.TOLERANCIA_MIN));
    var id = 'M' + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') + info.dni.slice(-3);
    agregar_(HOJAS.MARCACIONES, {
      id: id, fecha: info.fecha, dni: info.dni, docente: info.docente, inicio: hora, fin: '',
      estado: ev.estado, minTarde: ev.minTarde, bloques: p.bloques || [], reemplazos: p.reemplazos || [],
      obs: p.obs || '', obsDetalle: p.obsDetalle || '', dispositivo: p.dispositivo || '', registrado: sello_()
    });
    return { ok: true, tipo: 'INGRESO', hora: hora, docente: info.docente, estado: ev.estado, minTarde: ev.minTarde, referencia: ev.referencia, clases: sel };
  } finally {
    lock.releaseLock();
  }
}

function marcarSalida(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var info = buscarDocente(p.dni);
    if (!info.ok) return info;
    var m = info.abierta;
    if (!m) return { ok: false, error: 'No tienes un ingreso abierto hoy.' };
    if (p.obs === 'Otro' && !String(p.obsDetalle || '').trim()) return { ok: false, error: 'Escribe el detalle de la observación.' };

    var hora = ahora_();
    var propios = p.bloques || m.bloques;
    var reemp = p.reemplazos || m.reemplazos;
    var todos = info.propios.concat(info.otros);
    var porId = {};
    todos.forEach(function (b) { porId[b.id] = b; });
    var sel = propios.concat(reemp).map(function (id) { return porId[id]; }).filter(Boolean);
    var h = calcularHoras(m.inicio, hora, sel);

    var obs = [m.obs, p.obs].filter(String).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' | ');
    var det = [m.obsDetalle, p.obsDetalle].filter(String).join(' | ');
    var sh = hoja_(HOJAS.MARCACIONES);
    var fila = filaDe_(HOJAS.MARCACIONES, {
      id: m.id, fecha: m.fecha, dni: m.dni, docente: m.docente, inicio: m.inicio, fin: hora,
      estado: m.estado, minTarde: m.minTarde, bloques: propios, reemplazos: reemp, obs: obs, obsDetalle: det,
      dispositivo: m.dispositivo, horasMarcadas: h.marcadas, horasEfectivas: h.efectivas,
      horasProgramadas: h.programadas, registrado: m.registrado + ' / salida ' + sello_()
    });
    sh.getRange(m._fila, 1, 1, fila.length).setValues([fila]);

    var shC = hoja_(HOJAS.CLASES);
    var filas = sel.map(function (b) {
      var det = h.detalle.filter(function (d) { return d.id === b.id; })[0];
      return filaDe_(HOJAS.CLASES, {
        fecha: m.fecha, mes: m.fecha.slice(0, 7), marcacion: m.id, bloque: b.id, salon: b.salon, curso: b.curso,
        titular: b.docente, docente: m.docente, dni: m.dni, tipo: reemp.indexOf(b.id) >= 0 ? 'REEMPLAZO' : 'TITULAR',
        inicio: b.inicio, fin: b.fin, horas: det ? det.horas : 0
      });
    });
    if (filas.length) shC.getRange(shC.getLastRow() + 1, 1, filas.length, filas[0].length).setValues(filas);

    return { ok: true, tipo: 'SALIDA', hora: hora, inicio: m.inicio, docente: m.docente, horas: h, clases: sel };
  } finally {
    lock.releaseLock();
  }
}

/* ============================ API: Panel (requiere PIN) ============================ */

function validarPin_(pin) {
  if (String(pin || '') !== String(config_().PIN_PANEL)) throw new Error('PIN incorrecto');
}

function loginPanel(pin) {
  validarPin_(pin);
  return { ok: true, sede: config_().SEDE, hoy: hoy_() };
}

function getPanel(pin, fecha) {
  validarPin_(pin);
  fecha = fecha || hoy_();
  var esHoy = fecha === hoy_();
  var ahora = esHoy ? ahora_() : (fecha < hoy_() ? '23:59' : '00:00');
  var dia = diaDeFecha(fecha);
  var bloques = bloquesDelDia(horario_(), dia);
  var marc = marcacionesDe_(fecha);
  var estados = estadoBloques(bloques, marc, ahora);
  var docs = docentes_();

  var programados = {};
  bloques.forEach(function (b) { if (b.docente) programados[norm(b.docente)] = b.docente; });
  var presentes = marc.filter(function (m) { return !m.fin; });
  var llegaron = {};
  marc.forEach(function (m) { llegaron[norm(m.docente)] = true; });
  var faltan = Object.keys(programados).filter(function (k) { return !llegaron[k]; }).map(function (k) {
    var primero = bloques.filter(function (b) { return norm(b.docente) === k; })[0];
    return { docente: programados[k], desde: primero ? primero.inicio : '', salon: primero ? primero.salon : '',
      atrasado: primero ? toMin(ahora) > toMin(primero.inicio) + Number(config_().TOLERANCIA_MIN) : false };
  }).sort(function (a, b) { return toMin(a.desde) - toMin(b.desde); });

  var cuenta = function (est) { return estados.filter(function (e) { return e.estado === est; }).length; };
  return {
    fecha: fecha, dia: dia, hora: ahora_(), esHoy: esHoy,
    kpi: {
      programados: Object.keys(programados).length,
      llegaron: Object.keys(programados).filter(function (k) { return llegaron[k]; }).length,
      presentes: presentes.length,
      puntuales: marc.filter(function (m) { return m.estado === 'PUNTUAL'; }).length,
      tardanzas: marc.filter(function (m) { return m.estado === 'TARDANZA'; }).length,
      bloques: estados.length,
      dictados: cuenta('DICTADO') + cuenta('EN CLASE') + cuenta('REEMPLAZO'),
      noDictados: cuenta('NO DICTADO'),
      sinMarcar: cuenta('SIN MARCAR')
    },
    bloques: estados,
    marcaciones: marc.map(function (m) { delete m._fila; return m; }),
    faltan: faltan,
    docentesSinDni: docs.filter(function (d) { return d.activo && !d.dni; }).map(function (d) { return d.docente; })
  };
}

function getReporte(pin, mes) {
  validarPin_(pin);
  mes = mes || hoy_().slice(0, 7);
  var clases = leer_(HOJAS.CLASES);
  var marc = leer_(HOJAS.MARCACIONES);
  var filas = resumenMensual(clases, mes, marc);
  var detalle = clases.filter(function (c) { return c.mes === mes || String(c.fecha).slice(0, 7) === mes; })
    .map(function (c) { delete c._fila; return c; });
  return { mes: mes, filas: filas, detalle: detalle };
}

function exportarReporte(pin, mes) {
  var r = getReporte(pin, mes);
  var ss = ss_();
  var sh = ss.getSheetByName(HOJAS.REPORTE) || ss.insertSheet(HOJAS.REPORTE);
  sh.clear();
  var enc = ['Docente', 'Mes', 'Salón', 'N.º horas dictadas', 'Clases', 'Días', 'Reemplazos', 'Tardanzas (mes)', 'Min. tardanza (mes)'];
  var datos = r.filas.map(function (f) { return [f.docente, f.mes, f.salon, f.horas, f.clases, f.dias, f.reemplazos, f.tardanzas, f.minTarde]; });
  sh.getRange(1, 1).setValue('REPORTE DE HORAS DICTADAS · ' + config_().SEDE + ' · ' + r.mes).setFontWeight('bold').setFontSize(13);
  sh.getRange(3, 1, 1, enc.length).setValues([enc]).setFontWeight('bold').setBackground('#920000').setFontColor('#ffffff');
  if (datos.length) sh.getRange(4, 1, datos.length, enc.length).setValues(datos);
  sh.autoResizeColumns(1, enc.length);
  sh.setFrozenRows(3);
  return { ok: true, filas: datos.length, url: ss.getUrl() + '#gid=' + sh.getSheetId() };
}

function getDocentesQR(pin) {
  validarPin_(pin);
  return { appUrl: ScriptApp.getService().getUrl(), docentes: docentes_().filter(function (d) { return d.activo; }) };
}

/* ============================ Instalación ============================ */

/** Ejecutar UNA vez desde el editor: crea hojas, formatos y carga horario/docentes base. */
function setup() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(ESQUEMAS).forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    var esq = ESQUEMAS[nombre];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, esq.length).setValues([esq.map(function (c) { return c[1]; })]);
    }
    sh.getRange(1, 1, 1, esq.length).setFontWeight('bold').setBackground('#000000').setFontColor('#eebe4f');
    sh.setFrozenRows(1);
    esq.forEach(function (c, j) { if (c[2]) sh.getRange(1, j + 1, sh.getMaxRows(), 1).setNumberFormat('@'); });
  });
  var cfg = hoja_(HOJAS.CONFIG);
  if (cfg.getLastRow() < 2) cfg.getRange(2, 1, CONFIG_DEFAULT.length, 3).setValues(CONFIG_DEFAULT);
  var doc = hoja_(HOJAS.DOCENTES);
  if (doc.getLastRow() < 2) doc.getRange(2, 1, SEED_DOCENTES.length, SEED_DOCENTES[0].length).setValues(SEED_DOCENTES);
  var hor = hoja_(HOJAS.HORARIO);
  if (hor.getLastRow() < 2) hor.getRange(2, 1, SEED_HORARIO.length, SEED_HORARIO[0].length).setValues(SEED_HORARIO);
  var def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  return 'Listo: hojas creadas. Completa los DNI en la hoja "Docentes".';
}

/* ========================= Pantallas (HTML) ========================= */
var __HTML = {
  Index: [
    "<!DOCTYPE html>",
    "<html lang=\"es\">",
    "<head>",
    "<base target=\"_top\">",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>Asistencia Docente · CVI</title>",
    "<?!= include('Styles'); ?>",
    "<style>",
    "  /* ---------- Paso 1: DNI ---------- */",
    "  .bienvenida { text-align: center; margin: 8px 0 20px; }",
    "  .bienvenida h1 { font-family: 'Cantata One', serif; font-size: 30px; }",
    "  .bienvenida p { margin: 6px 0 0; color: var(--texto-2); }",
    "  .dni-box { max-width: 420px; margin: 0 auto; }",
    "  .dni-input {",
    "    width: 100%; text-align: center; font-size: 40px; font-weight: 800; letter-spacing: .18em;",
    "    padding: 16px 10px 16px calc(10px + .25em); border-radius: 16px; border: 2px solid var(--borde); background: var(--blanco);",
    "    font-variant-numeric: tabular-nums; outline: none;",
    "  }",
    "  .dni-input:focus { border-color: var(--rojo); box-shadow: 0 0 0 4px rgba(146,0,0,.12); }",
    "  .dni-input::placeholder { color: #cfc8bd; letter-spacing: .02em; font-size: 26px; font-weight: 600; }",
    "  .teclado { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 16px; }",
    "  .tecla {",
    "    height: 64px; border-radius: 14px; border: 1px solid var(--borde); background: var(--blanco); font-size: 26px; font-weight: 700;",
    "    cursor: pointer; box-shadow: 0 1px 0 rgba(0,0,0,.04);",
    "  }",
    "  .tecla:active { background: var(--amarillo-suave); }",
    "  .tecla.ok { background: var(--rojo); color: var(--blanco); border-color: var(--rojo); font-size: 20px; }",
    "  .tecla.borrar { font-size: 20px; color: var(--texto-2); }",
    "  .ayuda-qr { display: flex; gap: 12px; align-items: center; margin-top: 18px; padding: 14px; border-radius: 14px; background: var(--amarillo-suave); color: #5d4300; font-size: 14px; }",
    "  .ayuda-qr svg { flex: none; }",
    "",
    "  /* ---------- Paso 2: Docente ---------- */",
    "  .docente-head { display: flex; gap: 16px; align-items: center; }",
    "  .avatar {",
    "    width: 64px; height: 64px; border-radius: 50%; background: var(--rojo); color: var(--blanco);",
    "    display: grid; place-items: center; font-weight: 800; font-size: 24px; flex: none; border: 3px solid var(--amarillo);",
    "  }",
    "  .docente-head h2 { font-size: 24px; }",
    "  .docente-head .esp { color: var(--texto-2); font-size: 14px; }",
    "  .estado-hoy { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; }",
    "",
    "  .clases { display: grid; gap: 10px; }",
    "  .clase {",
    "    display: flex; gap: 14px; align-items: center; padding: 14px 16px; border-radius: 14px; border: 2px solid var(--borde);",
    "    background: var(--blanco); cursor: pointer; user-select: none; transition: border-color .15s, background .15s;",
    "  }",
    "  .clase input { display: none; }",
    "  .clase .check {",
    "    width: 28px; height: 28px; border-radius: 8px; border: 2px solid #c9c1b5; flex: none; display: grid; place-items: center;",
    "    color: transparent; background: var(--blanco);",
    "  }",
    "  .clase.sel { border-color: var(--rojo); background: #fffafa; }",
    "  .clase.sel .check { background: var(--rojo); border-color: var(--rojo); color: var(--blanco); }",
    "  .clase.bloq { opacity: .45; cursor: not-allowed; }",
    "  .clase .info { flex: 1; min-width: 0; }",
    "  .clase .salon { font-weight: 800; font-size: 17px; }",
    "  .clase .curso { color: var(--texto-2); font-size: 14px; }",
    "  .clase .hora { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 15px; text-align: right; white-space: nowrap; }",
    "  .clase .hora small { display: block; font-weight: 500; color: var(--texto-2); font-size: 12px; }",
    "  .vacio { padding: 16px; border-radius: 14px; background: var(--gris-suave); color: var(--texto-2); font-size: 15px; }",
    "",
    "  .reemplazo-toggle {",
    "    width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center;",
    "    background: var(--blanco); border: 2px dashed #cfc6b8; border-radius: 14px; padding: 14px 16px; cursor: pointer; font-weight: 700;",
    "  }",
    "  .reemplazo-toggle .flecha { transition: transform .2s; }",
    "  .reemplazo-toggle.abierto .flecha { transform: rotate(180deg); }",
    "  .grupo-salon { font-size: 13px; font-weight: 700; color: var(--rojo); margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .05em; }",
    "",
    "  .obs-chips { display: flex; flex-wrap: wrap; gap: 8px; }",
    "  .obs-chip {",
    "    border: 2px solid var(--borde); background: var(--blanco); border-radius: 999px; padding: 9px 14px; font-weight: 600; font-size: 14px; cursor: pointer;",
    "  }",
    "  .obs-chip.sel { border-color: var(--negro); background: var(--negro); color: var(--amarillo); }",
    "  textarea { width: 100%; min-height: 84px; border-radius: 12px; border: 2px solid var(--borde); padding: 12px; margin-top: 10px; resize: vertical; outline: none; }",
    "  textarea:focus { border-color: var(--rojo); }",
    "",
    "  .acciones { position: sticky; bottom: 0; padding: 16px 0 4px; background: linear-gradient(to top, var(--fondo) 75%, rgba(245,242,236,0)); margin-top: 18px; }",
    "  .acciones .resumen { text-align: center; font-size: 14px; color: var(--texto-2); margin-bottom: 8px; }",
    "",
    "  /* ---------- Paso 3: Confirmación ---------- */",
    "  .listo { text-align: center; padding: 34px 22px; }",
    "  .listo .icono { width: 96px; height: 96px; border-radius: 50%; margin: 0 auto 16px; display: grid; place-items: center; }",
    "  .listo .icono.ingreso { background: var(--ok-suave); color: var(--ok); }",
    "  .listo .icono.salida { background: var(--amarillo-suave); color: #7a5600; }",
    "  .listo h2 { font-family: 'Cantata One', serif; font-size: 28px; }",
    "  .listo .hora-grande { font-size: 56px; font-weight: 800; font-variant-numeric: tabular-nums; margin: 8px 0; }",
    "  .metricas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0; }",
    "  .metrica { background: var(--fondo); border-radius: 12px; padding: 12px 8px; }",
    "  .metrica .v { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; }",
    "  .metrica .l { font-size: 12px; color: var(--texto-2); }",
    "  .lista-clases { text-align: left; margin: 12px auto 0; max-width: 420px; display: grid; gap: 6px; }",
    "  .lista-clases div { padding: 10px 12px; background: var(--fondo); border-radius: 10px; font-size: 14px; display: flex; justify-content: space-between; gap: 10px; }",
    "  .cuenta { margin-top: 18px; font-size: 13px; color: var(--texto-2); }",
    "",
    "  .pie { text-align: center; font-size: 12px; color: var(--gris); margin-top: 26px; }",
    "  .pie a { color: var(--gris); }",
    "  @media (max-width: 560px) {",
    "    .bienvenida h1 { font-size: 24px; }",
    "    .dni-input { font-size: 30px; }",
    "    .tecla { height: 56px; }",
    "    .listo .hora-grande { font-size: 44px; }",
    "  }",
    "</style>",
    "</head>",
    "<body>",
    "  <header class=\"topbar\">",
    "    <div class=\"logo\" id=\"logo\"><span class=\"fallback\">CVI</span></div>",
    "    <div class=\"titulo\">",
    "      <div class=\"nombre\">César Vallejo Ingenieros</div>",
    "      <div class=\"sub\">Sede <span id=\"sede\">Monte Azul</span> · Asistencia docente</div>",
    "    </div>",
    "    <div class=\"reloj\"><div class=\"h\" id=\"reloj\">--:--:--</div><div class=\"f\" id=\"fecha\"></div></div>",
    "  </header>",
    "",
    "  <main class=\"contenedor\">",
    "    <!-- PASO 1: DNI -->",
    "    <section id=\"paso-dni\">",
    "      <div class=\"bienvenida\">",
    "        <h1>Marca tu asistencia</h1>",
    "        <p>Escribe tu DNI o tu celular, o escanea tu código QR</p>",
    "      </div>",
    "      <div class=\"dni-box\">",
    "        <input id=\"dni\" class=\"dni-input\" inputmode=\"numeric\" autocomplete=\"off\" maxlength=\"40\" placeholder=\"DNI o celular\" aria-label=\"DNI o celular\">",
    "        <div class=\"teclado\" id=\"teclado\"></div>",
    "        <div id=\"error-dni\" class=\"alerta oculto\"></div>",
    "        <div class=\"ayuda-qr\">",
    "          <svg width=\"34\" height=\"34\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/><path d=\"M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3\"/></svg>",
    "          <div><b>¿Tienes tu fotocheck con QR?</b> Escanéalo con la cámara de tu celular y se abrirá esta página con tu DNI listo.</div>",
    "        </div>",
    "      </div>",
    "    </section>",
    "",
    "    <!-- PASO 2: Docente -->",
    "    <section id=\"paso-docente\" class=\"oculto\">",
    "      <div class=\"tarjeta pad\">",
    "        <div class=\"docente-head\">",
    "          <div class=\"avatar\" id=\"avatar\">--</div>",
    "          <div>",
    "            <h2 id=\"nombre-docente\">—</h2>",
    "            <div class=\"esp\" id=\"esp-docente\"></div>",
    "            <div class=\"estado-hoy\" id=\"estado-hoy\"></div>",
    "          </div>",
    "        </div>",
    "      </div>",
    "",
    "      <div class=\"h-seccion\" id=\"titulo-clases\">Tus salones de hoy</div>",
    "      <div class=\"clases\" id=\"lista-propias\"></div>",
    "",
    "      <div style=\"margin-top:12px\">",
    "        <button class=\"reemplazo-toggle\" id=\"btn-reemplazo\" type=\"button\">",
    "          <span>🔁 ¿Vas a cubrir la clase de otro docente? <span class=\"muted\" style=\"font-weight:500\">(reemplazo)</span></span>",
    "          <svg class=\"flecha\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\"><path d=\"m6 9 6 6 6-6\"/></svg>",
    "        </button>",
    "        <div id=\"lista-reemplazos\" class=\"oculto\"></div>",
    "      </div>",
    "",
    "      <div class=\"h-seccion\">Observación <span style=\"text-transform:none;font-weight:500\">(opcional)</span></div>",
    "      <div class=\"obs-chips\" id=\"obs-chips\"></div>",
    "      <textarea id=\"obs-detalle\" class=\"oculto\" placeholder=\"Escribe aquí tu comentario…\"></textarea>",
    "",
    "      <div id=\"error-marca\" class=\"alerta oculto\"></div>",
    "",
    "      <div class=\"acciones\">",
    "        <div class=\"resumen\" id=\"resumen-sel\"></div>",
    "        <button class=\"btn btn-rojo btn-grande\" id=\"btn-marcar\" type=\"button\">Marcar ingreso</button>",
    "        <div style=\"text-align:center\"><button class=\"link\" id=\"btn-cancelar\" type=\"button\">No soy yo · volver</button></div>",
    "      </div>",
    "    </section>",
    "",
    "    <!-- PASO 3: Listo -->",
    "    <section id=\"paso-listo\" class=\"oculto\">",
    "      <div class=\"tarjeta listo\">",
    "        <div class=\"icono ingreso\" id=\"listo-icono\">",
    "          <svg width=\"52\" height=\"52\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\"><path d=\"M20 6 9 17l-5-5\"/></svg>",
    "        </div>",
    "        <h2 id=\"listo-titulo\">¡Ingreso registrado!</h2>",
    "        <div class=\"muted\" id=\"listo-nombre\"></div>",
    "        <div class=\"hora-grande\" id=\"listo-hora\">--:--</div>",
    "        <div id=\"listo-estado\"></div>",
    "        <div class=\"metricas oculto\" id=\"listo-metricas\"></div>",
    "        <div class=\"lista-clases\" id=\"listo-clases\"></div>",
    "        <div style=\"margin-top:22px\"><button class=\"btn btn-negro\" id=\"btn-listo\" type=\"button\" style=\"min-width:200px\">Listo</button></div>",
    "        <div class=\"cuenta\" id=\"cuenta\"></div>",
    "      </div>",
    "    </section>",
    "",
    "    <div class=\"pie\">CVI Monte Azul · Control de asistencia docente · Piloto 2026</div>",
    "  </main>",
    "",
    "<script>",
    "(function () {",
    "  var DNI_INICIAL = '<?= dniInicial ?>';",
    "  var estado = { info: null, docente: null, obs: '', offset: 0, timer: null };",
    "  var $ = function (id) { return document.getElementById(id); };",
    "  var DIAS = { LUNES: 'lunes', MARTES: 'martes', MIERCOLES: 'miércoles', JUEVES: 'jueves', VIERNES: 'viernes', SABADO: 'sábado', DOMINGO: 'domingo' };",
    "  var esCelular = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);",
    "",
    "  function api(fn) {",
    "    var args = Array.prototype.slice.call(arguments, 1);",
    "    return new Promise(function (ok, mal) {",
    "      var r = google.script.run.withSuccessHandler(ok).withFailureHandler(function (e) { mal(e && e.message ? e : new Error(String(e))); });",
    "      r[fn].apply(r, args);",
    "    });",
    "  }",
    "  function esc(s) { return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[c]; }); }",
    "  function iniciales(n) { return String(n).split(/\\s+/).filter(Boolean).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase(); }",
    "  function mostrar(paso) { ['paso-dni', 'paso-docente', 'paso-listo'].forEach(function (p) { $(p).classList.toggle('oculto', p !== paso); }); window.scrollTo(0, 0); }",
    "  function error(id, msg) { var el = $(id); el.textContent = msg || ''; el.classList.toggle('oculto', !msg); }",
    "  function extraerDni(t) { var s = String(t || ''); var u = s.match(/[?&]dni=(\\d{8,9})(?!\\d)/i); if (u) return u[1]; var m = s.replace(/[\\s-]/g, '').match(/\\d{8,9}/); return m ? m[0] : null; }",
    "",
    "  /* ---------- Reloj sincronizado con el servidor ---------- */",
    "  function tic() {",
    "    var d = new Date(Date.now() + estado.offset);",
    "    var lima = new Date(d.toLocaleString('en-US', { timeZone: 'America/Lima' }));",
    "    var p = function (n) { return (n < 10 ? '0' : '') + n; };",
    "    $('reloj').textContent = p(lima.getHours()) + ':' + p(lima.getMinutes()) + ':' + p(lima.getSeconds());",
    "    $('fecha').textContent = lima.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });",
    "  }",
    "  setInterval(tic, 1000); tic();",
    "",
    "  api('getInfo').then(function (i) {",
    "    estado.info = i; estado.offset = i.epoch - Date.now(); $('sede').textContent = i.sede; tic(); pintarObs();",
    "  }).catch(function () {});",
    "  api('getLogo').then(function (url) { if (url) $('logo').innerHTML = '<img alt=\"Logo CVI\" src=\"' + url + '\">'; }).catch(function () {});",
    "",
    "  /* ---------- Paso 1: teclado DNI ---------- */",
    "  var teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];",
    "  $('teclado').innerHTML = teclas.map(function (t) {",
    "    var cls = t === 'OK' ? 'tecla ok' : t === '⌫' ? 'tecla borrar' : 'tecla';",
    "    return '<button type=\"button\" class=\"' + cls + '\" data-t=\"' + t + '\">' + (t === 'OK' ? 'Continuar' : t) + '</button>';",
    "  }).join('');",
    "  $('teclado').addEventListener('click', function (e) {",
    "    var b = e.target.closest('[data-t]'); if (!b) return;",
    "    var t = b.getAttribute('data-t'), inp = $('dni');",
    "    if (t === '⌫') inp.value = inp.value.slice(0, -1);",
    "    else if (t === 'OK') buscar();",
    "    else if (inp.value.replace(/\\D/g, '').length < 9) inp.value = inp.value.replace(/\\D/g, '') + t;",
    "    error('error-dni');",
    "  });",
    "  $('dni').addEventListener('keydown', function (e) { if (e.key === 'Enter') buscar(); });",
    "  $('dni').addEventListener('input', function () {",
    "    error('error-dni');",
    "    var inp = $('dni');",
    "    // Un lector QR USB \"escribe\" la URL completa: extraemos el DNI.",
    "    if (/dni=|http/i.test(inp.value)) { var d = extraerDni(inp.value); if (d) { inp.value = d; buscar(); } }",
    "  });",
    "",
    "  function buscar() {",
    "    var dni = extraerDni($('dni').value) || $('dni').value.replace(/\\D/g, '');",
    "    if (dni.length !== 8 && dni.length !== 9) { error('error-dni', 'Escribe tu DNI (8 dígitos) o tu celular (9 dígitos).'); return; }",
    "    var ok = document.querySelector('.tecla.ok'); ok.disabled = true; ok.innerHTML = '<span class=\"spinner\"></span>';",
    "    api('buscarDocente', dni).then(function (r) {",
    "      if (!r.ok) { error('error-dni', r.error); return; }",
    "      estado.docente = r; pintarDocente();",
    "    }).catch(function (e) { error('error-dni', 'Sin conexión con el servidor. Intenta de nuevo. (' + e.message + ')'); })",
    "      .then(function () { ok.disabled = false; ok.textContent = 'Continuar'; });",
    "  }",
    "",
    "  /* ---------- Paso 2 ---------- */",
    "  function tarjetaClase(b, opts) {",
    "    var bloqueada = opts.bloqueada;",
    "    return '<label class=\"clase' + (opts.sel ? ' sel' : '') + (bloqueada ? ' bloq' : '') + '\" data-id=\"' + esc(b.id) + '\" data-tipo=\"' + opts.tipo + '\">' +",
    "      '<input type=\"checkbox\"' + (opts.sel ? ' checked' : '') + (bloqueada ? ' disabled' : '') + '>' +",
    "      '<span class=\"check\"><svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.5\"><path d=\"M20 6 9 17l-5-5\"/></svg></span>' +",
    "      '<span class=\"info\"><div class=\"salon\">' + esc(b.salon) + '</div><div class=\"curso\">' + esc(b.curso) +",
    "      (opts.tipo === 'R' ? ' · titular: ' + esc(b.docente || 'sin docente') : '') +",
    "      (bloqueada ? ' · ya lo marcó ' + esc(b.tomadoPor) : '') + '</div></span>' +",
    "      '<span class=\"hora\">' + esc(b.inicio) + ' – ' + esc(b.fin) + '<small>' + duracion(b) + '</small></span></label>';",
    "  }",
    "  function duracion(b) {",
    "    var m = function (h) { var p = h.split(':'); return +p[0] * 60 + +p[1]; };",
    "    var d = m(b.fin) - m(b.inicio); var h = Math.floor(d / 60), mi = d % 60;",
    "    return (h ? h + ' h' : '') + (mi ? ' ' + mi + ' min' : '');",
    "  }",
    "",
    "  function pintarDocente() {",
    "    var d = estado.docente, ab = d.abierta;",
    "    $('avatar').textContent = iniciales(d.docente);",
    "    $('nombre-docente').textContent = d.docente;",
    "    $('esp-docente').textContent = d.especialidad || '';",
    "    var chips = [];",
    "    if (ab) {",
    "      chips.push('<span class=\"chip ' + (ab.estado === 'TARDANZA' ? 'warn' : 'ok') + '\"><span class=\"punto\"></span>Ingresaste ' + esc(ab.inicio) +",
    "        ' · ' + (ab.estado === 'TARDANZA' ? 'tardanza ' + esc(ab.minTarde) + ' min' : 'puntual') + '</span>');",
    "    } else {",
    "      chips.push('<span class=\"chip\"><span class=\"punto\"></span>Aún no marcas ingreso</span>');",
    "    }",
    "    if (d.cerradasHoy) chips.push('<span class=\"chip oscuro\">' + d.cerradasHoy + ' marcación(es) cerrada(s) hoy</span>');",
    "    $('estado-hoy').innerHTML = chips.join('');",
    "    $('titulo-clases').textContent = (ab ? 'Salones que dictaste hoy' : 'Marca los salones que dictarás hoy') + ' · ' + (DIAS[d.dia] || '');",
    "",
    "    var selPropias = ab ? ab.bloques : d.propios.map(function (b) { return b.id; });",
    "    var selReemp = ab ? ab.reemplazos : [];",
    "    $('lista-propias').innerHTML = d.propios.length",
    "      ? d.propios.map(function (b) { return tarjetaClase(b, { sel: selPropias.indexOf(b.id) >= 0, tipo: 'P' }); }).join('')",
    "      : '<div class=\"vacio\">No tienes clases programadas hoy en el horario. Si vienes a reemplazar a un colega, usa la opción de abajo.</div>';",
    "",
    "    var grupos = {};",
    "    d.otros.forEach(function (b) { (grupos[b.salon] = grupos[b.salon] || []).push(b); });",
    "    $('lista-reemplazos').innerHTML = Object.keys(grupos).length ? Object.keys(grupos).map(function (s) {",
    "      return '<div class=\"grupo-salon\">' + esc(s) + '</div><div class=\"clases\">' + grupos[s].map(function (b) {",
    "        return tarjetaClase(b, { sel: selReemp.indexOf(b.id) >= 0, tipo: 'R', bloqueada: !!b.tomadoPor && selReemp.indexOf(b.id) < 0 });",
    "      }).join('') + '</div>';",
    "    }).join('') : '<div class=\"vacio\" style=\"margin-top:10px\">No hay otras clases hoy.</div>';",
    "    var abrir = selReemp.length > 0 || !d.propios.length;",
    "    $('lista-reemplazos').classList.toggle('oculto', !abrir);",
    "    $('btn-reemplazo').classList.toggle('abierto', abrir);",
    "",
    "    estado.obs = ''; $('obs-detalle').value = ''; pintarObs();",
    "    error('error-marca');",
    "    var btn = $('btn-marcar');",
    "    btn.className = 'btn btn-grande ' + (ab ? 'btn-negro' : 'btn-rojo');",
    "    actualizarResumen();",
    "    mostrar('paso-docente');",
    "  }",
    "",
    "  function pintarObs() {",
    "    var lista = (estado.info && estado.info.observaciones) || ['Tardanza justificada', 'Permiso', 'Salida anticipada', 'Reemplazo de docente', 'Clase de recuperación', 'Salud', 'Problema de transporte', 'Otro'];",
    "    $('obs-chips').innerHTML = ['Ninguna'].concat(lista).map(function (o) {",
    "      var sel = (o === 'Ninguna' && !estado.obs) || o === estado.obs;",
    "      return '<button type=\"button\" class=\"obs-chip' + (sel ? ' sel' : '') + '\" data-o=\"' + esc(o) + '\">' + esc(o) + '</button>';",
    "    }).join('');",
    "    $('obs-detalle').classList.toggle('oculto', estado.obs !== 'Otro');",
    "  }",
    "  $('obs-chips').addEventListener('click', function (e) {",
    "    var b = e.target.closest('[data-o]'); if (!b) return;",
    "    var o = b.getAttribute('data-o'); estado.obs = o === 'Ninguna' ? '' : o; pintarObs();",
    "    if (estado.obs === 'Otro') $('obs-detalle').focus();",
    "  });",
    "",
    "  document.addEventListener('click', function (e) {",
    "    var c = e.target.closest('.clase'); if (!c || c.classList.contains('bloq')) return;",
    "    e.preventDefault();",
    "    var inp = c.querySelector('input'); inp.checked = !inp.checked; c.classList.toggle('sel', inp.checked);",
    "    actualizarResumen();",
    "  });",
    "  $('btn-reemplazo').addEventListener('click', function () {",
    "    var l = $('lista-reemplazos'); l.classList.toggle('oculto'); this.classList.toggle('abierto', !l.classList.contains('oculto'));",
    "  });",
    "",
    "  function seleccion() {",
    "    var p = [], r = [];",
    "    document.querySelectorAll('.clase.sel').forEach(function (c) { (c.getAttribute('data-tipo') === 'R' ? r : p).push(c.getAttribute('data-id')); });",
    "    return { bloques: p, reemplazos: r };",
    "  }",
    "  function actualizarResumen() {",
    "    var s = seleccion(), n = s.bloques.length + s.reemplazos.length, ab = estado.docente && estado.docente.abierta;",
    "    $('resumen-sel').textContent = n ? n + ' salón(es) seleccionado(s)' + (s.reemplazos.length ? ' · ' + s.reemplazos.length + ' reemplazo(s)' : '') : 'Selecciona al menos un salón';",
    "    $('btn-marcar').innerHTML = (ab ? '⏹ Marcar SALIDA' : '▶ Marcar INGRESO') + ' · <span id=\"hora-btn\">' + $('reloj').textContent.slice(0, 5) + '</span>';",
    "  }",
    "  setInterval(function () { var h = $('hora-btn'); if (h) h.textContent = $('reloj').textContent.slice(0, 5); }, 1000);",
    "",
    "  $('btn-cancelar').addEventListener('click', reiniciar);",
    "",
    "  $('btn-marcar').addEventListener('click', function () {",
    "    var d = estado.docente, s = seleccion(), btn = this;",
    "    if (!s.bloques.length && !s.reemplazos.length && !estado.obs) { error('error-marca', 'Selecciona al menos un salón o indica una observación.'); return; }",
    "    if (estado.obs === 'Otro' && !$('obs-detalle').value.trim()) { error('error-marca', 'Escribe el detalle de tu observación.'); return; }",
    "    var payload = { dni: d.dni, bloques: s.bloques, reemplazos: s.reemplazos, obs: estado.obs, obsDetalle: $('obs-detalle').value.trim(), dispositivo: esCelular ? 'Celular' : 'PC' };",
    "    btn.disabled = true; btn.innerHTML = '<span class=\"spinner\"></span> Registrando…';",
    "    api(d.abierta ? 'marcarSalida' : 'marcarIngreso', payload).then(function (r) {",
    "      if (!r.ok) { error('error-marca', r.error); return; }",
    "      pintarListo(r);",
    "    }).catch(function (e) { error('error-marca', 'No se pudo registrar: ' + e.message); })",
    "      .then(function () { btn.disabled = false; actualizarResumen(); });",
    "  });",
    "",
    "  /* ---------- Paso 3 ---------- */",
    "  function pintarListo(r) {",
    "    var ingreso = r.tipo === 'INGRESO';",
    "    $('listo-icono').className = 'icono ' + (ingreso ? 'ingreso' : 'salida');",
    "    $('listo-titulo').textContent = ingreso ? '¡Ingreso registrado!' : '¡Salida registrada!';",
    "    $('listo-nombre').textContent = (ingreso ? 'Bienvenido(a), ' : 'Hasta pronto, ') + r.docente;",
    "    $('listo-hora').textContent = r.hora;",
    "    if (ingreso) {",
    "      $('listo-estado').innerHTML = r.estado === 'TARDANZA'",
    "        ? '<span class=\"chip warn\"><span class=\"punto\"></span>Tardanza de ' + r.minTarde + ' min (inicio ' + esc(r.referencia) + ')</span>'",
    "        : r.estado === 'PUNTUAL' ? '<span class=\"chip ok\"><span class=\"punto\"></span>Puntual</span>' : '<span class=\"chip\">Sin clase programada</span>';",
    "      $('listo-metricas').classList.add('oculto');",
    "    } else {",
    "      $('listo-estado').innerHTML = '<span class=\"chip oscuro\">Ingreso ' + esc(r.inicio) + ' → Salida ' + esc(r.hora) + '</span>';",
    "      $('listo-metricas').innerHTML =",
    "        '<div class=\"metrica\"><div class=\"v\">' + r.horas.efectivas.toFixed(2) + '</div><div class=\"l\">Horas dictadas</div></div>' +",
    "        '<div class=\"metrica\"><div class=\"v\">' + r.horas.programadas.toFixed(2) + '</div><div class=\"l\">Horas programadas</div></div>' +",
    "        '<div class=\"metrica\"><div class=\"v\">' + r.horas.marcadas.toFixed(2) + '</div><div class=\"l\">Horas en el colegio</div></div>';",
    "      $('listo-metricas').classList.remove('oculto');",
    "    }",
    "    $('listo-clases').innerHTML = (r.clases || []).map(function (b) {",
    "      return '<div><b>' + esc(b.salon) + '</b><span class=\"muted\">' + esc(b.curso) + ' · ' + esc(b.inicio) + '–' + esc(b.fin) + '</span></div>';",
    "    }).join('');",
    "    mostrar('paso-listo');",
    "    var s = 10; $('cuenta').textContent = 'Volviendo al inicio en ' + s + ' s';",
    "    clearInterval(estado.timer);",
    "    estado.timer = setInterval(function () { s--; $('cuenta').textContent = 'Volviendo al inicio en ' + s + ' s'; if (s <= 0) reiniciar(); }, 1000);",
    "  }",
    "  $('btn-listo').addEventListener('click', reiniciar);",
    "",
    "  function reiniciar() {",
    "    clearInterval(estado.timer); estado.docente = null; $('dni').value = ''; error('error-dni'); mostrar('paso-dni');",
    "    if (!esCelular) $('dni').focus();",
    "  }",
    "",
    "  if (DNI_INICIAL) { $('dni').value = DNI_INICIAL; buscar(); } else if (!esCelular) { $('dni').focus(); }",
    "})();",
    "</script>",
    "</body>",
    "</html>",
    ""
  ].join('\n'),
  Dashboard: [
    "<!DOCTYPE html>",
    "<html lang=\"es\">",
    "<head>",
    "<base target=\"_top\">",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>Panel de Asistencia · CVI</title>",
    "<?!= include('Styles'); ?>",
    "<script src=\"https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js\"></script>",
    "<style>",
    "  .contenedor { max-width: 1240px; }",
    "  .login { max-width: 380px; margin: 60px auto; text-align: center; }",
    "  .login h1 { font-family: 'Cantata One', serif; font-size: 26px; margin-bottom: 6px; }",
    "  .login input { width: 100%; text-align: center; font-size: 28px; letter-spacing: .3em; padding: 14px; border-radius: 14px; border: 2px solid var(--borde); margin: 18px 0 12px; outline: none; }",
    "  .login input:focus { border-color: var(--rojo); }",
    "",
    "  .tabs { display: flex; gap: 6px; background: var(--blanco); padding: 6px; border-radius: 14px; border: 1px solid var(--borde); width: max-content; max-width: 100%; overflow-x: auto; }",
    "  .tab { border: 0; background: none; padding: 10px 16px; border-radius: 10px; font-weight: 700; cursor: pointer; color: var(--texto-2); white-space: nowrap; }",
    "  .tab.activo { background: var(--negro); color: var(--amarillo); }",
    "  .barra { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 18px; }",
    "  .controles { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }",
    "  .controles input[type=date], .controles input[type=month] { padding: 9px 12px; border-radius: 10px; border: 1px solid var(--borde); background: var(--blanco); }",
    "  .vivo { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--texto-2); }",
    "  .vivo .punto { width: 10px; height: 10px; border-radius: 50%; background: #2bb15a; box-shadow: 0 0 0 0 rgba(43,177,90,.6); animation: pulso 2s infinite; }",
    "  .vivo.pausa .punto { background: var(--gris); animation: none; }",
    "  @keyframes pulso { 0% { box-shadow: 0 0 0 0 rgba(43,177,90,.5); } 70% { box-shadow: 0 0 0 10px rgba(43,177,90,0); } 100% { box-shadow: 0 0 0 0 rgba(43,177,90,0); } }",
    "",
    "  .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }",
    "  .kpi { padding: 16px; }",
    "  .kpi .l { font-size: 13px; color: var(--texto-2); font-weight: 600; }",
    "  .kpi .v { font-size: 34px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; margin-top: 4px; }",
    "  .kpi .v small { font-size: 16px; color: var(--texto-2); font-weight: 600; }",
    "  .kpi .barra-p { height: 6px; border-radius: 3px; background: var(--gris-suave); margin-top: 10px; overflow: hidden; }",
    "  .kpi .barra-p span { display: block; height: 100%; background: var(--rojo); }",
    "  .kpi.destacado { background: var(--negro); color: var(--blanco); border-color: var(--negro); }",
    "  .kpi.destacado .l { color: var(--amarillo); }",
    "  .kpi.alerta-k .v { color: var(--rojo); }",
    "",
    "  .seccion-t { display: flex; justify-content: space-between; align-items: baseline; margin: 26px 0 12px; gap: 10px; flex-wrap: wrap; }",
    "  .seccion-t h2 { font-family: 'Cantata One', serif; font-size: 20px; }",
    "  .leyenda { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--texto-2); }",
    "  .leyenda i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 5px; vertical-align: -2px; }",
    "",
    "  /* Línea de tiempo por salón */",
    "  .timeline { overflow-x: auto; }",
    "  .tl-inner { min-width: 860px; padding: 14px 16px 10px; }",
    "  .tl-escala, .tl-fila { display: grid; grid-template-columns: 150px 1fr; align-items: center; }",
    "  .tl-escala .marcas { position: relative; height: 22px; font-size: 11px; color: var(--texto-2); }",
    "  .tl-escala .marcas span { position: absolute; transform: translateX(-50%); font-variant-numeric: tabular-nums; }",
    "  .tl-fila { min-height: 54px; border-top: 1px solid var(--gris-suave); }",
    "  .tl-salon { font-weight: 800; font-size: 13px; padding-right: 10px; }",
    "  .tl-pista { position: relative; height: 44px; }",
    "  .tl-ahora { position: absolute; top: -6px; bottom: -6px; width: 2px; background: var(--rojo); z-index: 3; }",
    "  .tl-fila:nth-child(2) .tl-ahora::before { content: 'Ahora'; position: absolute; top: -14px; left: -14px; font-size: 10px; font-weight: 800; color: var(--rojo); }",
    "  .blq {",
    "    position: absolute; top: 4px; bottom: 4px; border-radius: 8px; padding: 4px 7px; overflow: hidden; font-size: 11px; line-height: 1.2;",
    "    border: 1px solid transparent; cursor: default;",
    "  }",
    "  .blq b { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11.5px; }",
    "  .blq span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: .85; }",
    "  .e-DICTADO { background: #2e8b4e; color: #fff; }",
    "  .e-EN-CLASE { background: #1f7a3a; color: #fff; box-shadow: 0 0 0 2px #9be0b0 inset; }",
    "  .e-REEMPLAZO { background: var(--amarillo); color: #3d2c00; }",
    "  .e-CONFIRMADO { background: var(--ok-suave); color: var(--ok); border-color: #9fd3ae; }",
    "  .e-PROGRAMADO { background: var(--gris-suave); color: var(--texto-2); border-color: #ddd5c9; }",
    "  .e-SIN-MARCAR { background: #ffe1e1; color: var(--rojo); border-color: #f2a5a5; }",
    "  .e-NO-DICTADO { background: var(--rojo); color: #fff; }",
    "  .e-SIN-DOCENTE { background: repeating-linear-gradient(45deg, #f1ede6, #f1ede6 6px, #e6e0d6 6px, #e6e0d6 12px); color: var(--texto-2); }",
    "",
    "  .dos-col { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; align-items: start; }",
    "  table { width: 100%; border-collapse: collapse; font-size: 14px; }",
    "  th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--texto-2); padding: 10px 12px; border-bottom: 2px solid var(--borde); white-space: nowrap; }",
    "  td { padding: 10px 12px; border-bottom: 1px solid var(--gris-suave); vertical-align: top; }",
    "  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }",
    "  tr.subtotal td { background: var(--amarillo-suave); font-weight: 700; }",
    "  tr.total td { background: var(--negro); color: var(--amarillo); font-weight: 800; }",
    "  .tabla-scroll { overflow-x: auto; }",
    "  .vacio-t { padding: 28px; text-align: center; color: var(--texto-2); }",
    "  .pend { display: flex; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--gris-suave); }",
    "  .pend:last-child { border-bottom: 0; }",
    "  .pend .n { font-weight: 700; }",
    "  .pend .d { font-size: 13px; color: var(--texto-2); }",
    "",
    "  .qr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }",
    "  .fotocheck { background: var(--blanco); border-radius: 14px; overflow: hidden; border: 1px solid var(--borde); text-align: center; break-inside: avoid; }",
    "  .fotocheck .cab { background: var(--negro); color: var(--amarillo); padding: 10px; font-family: 'Cantata One', serif; font-size: 14px; border-bottom: 3px solid var(--amarillo); }",
    "  .fotocheck .qr { padding: 14px; display: grid; place-items: center; min-height: 190px; }",
    "  .fotocheck .qr img, .fotocheck .qr canvas { width: 170px !important; height: 170px !important; }",
    "  .fotocheck .nom { font-weight: 800; font-size: 16px; padding: 0 10px; }",
    "  .fotocheck .dni { font-size: 13px; color: var(--texto-2); padding: 2px 10px 14px; }",
    "  .fotocheck .sin { color: var(--rojo); font-weight: 700; font-size: 13px; padding: 30px 10px; }",
    "",
    "  @media (max-width: 1000px) { .kpis { grid-template-columns: repeat(3, 1fr); } .dos-col { grid-template-columns: 1fr; } }",
    "  @media (max-width: 560px) { .kpis { grid-template-columns: repeat(2, 1fr); } .kpi .v { font-size: 28px; } }",
    "  @media print {",
    "    .topbar, .barra, .tabs, .no-print { display: none !important; }",
    "    body { background: #fff; }",
    "    .qr-grid { grid-template-columns: repeat(3, 1fr); }",
    "  }",
    "</style>",
    "</head>",
    "<body>",
    "  <header class=\"topbar\">",
    "    <div class=\"logo\" id=\"logo\"><span class=\"fallback\">CVI</span></div>",
    "    <div class=\"titulo\">",
    "      <div class=\"nombre\">Panel de Asistencia Docente</div>",
    "      <div class=\"sub\">César Vallejo Ingenieros · Sede <span id=\"sede\">Monte Azul</span></div>",
    "    </div>",
    "    <div class=\"reloj\"><div class=\"h\" id=\"reloj\">--:--</div><div class=\"f\" id=\"fecha-hoy\"></div></div>",
    "  </header>",
    "",
    "  <main class=\"contenedor\">",
    "    <!-- Login -->",
    "    <section id=\"v-login\" class=\"login\">",
    "      <div class=\"tarjeta pad\">",
    "        <h1>Acceso coordinación</h1>",
    "        <div class=\"muted\">Ingresa el PIN del panel</div>",
    "        <input id=\"pin\" type=\"password\" inputmode=\"numeric\" autocomplete=\"off\" placeholder=\"••••\">",
    "        <button class=\"btn btn-rojo btn-grande\" id=\"btn-login\" type=\"button\">Entrar</button>",
    "        <div id=\"error-login\" class=\"alerta oculto\"></div>",
    "      </div>",
    "    </section>",
    "",
    "    <section id=\"v-app\" class=\"oculto\">",
    "      <div class=\"barra\">",
    "        <div class=\"tabs\" role=\"tablist\">",
    "          <button class=\"tab activo\" data-tab=\"hoy\" type=\"button\">📍 En vivo</button>",
    "          <button class=\"tab\" data-tab=\"reporte\" type=\"button\">📊 Reporte mensual</button>",
    "          <button class=\"tab\" data-tab=\"qr\" type=\"button\">🪪 Fotochecks QR</button>",
    "        </div>",
    "        <div class=\"controles\">",
    "          <button class=\"btn btn-claro\" id=\"btn-marcacion\" type=\"button\" style=\"padding:9px 14px\">Abrir marcación ↗</button>",
    "          <button class=\"link\" id=\"btn-salir\" type=\"button\">Salir</button>",
    "        </div>",
    "      </div>",
    "",
    "      <!-- EN VIVO -->",
    "      <div id=\"t-hoy\">",
    "        <div class=\"barra\" style=\"margin-bottom:12px\">",
    "          <div class=\"controles\">",
    "            <input type=\"date\" id=\"f-fecha\">",
    "            <span class=\"vivo\" id=\"vivo\"><span class=\"punto\"></span><span id=\"vivo-txt\">Conectando…</span></span>",
    "          </div>",
    "          <div id=\"aviso-dni\"></div>",
    "        </div>",
    "        <div class=\"kpis\" id=\"kpis\"></div>",
    "",
    "        <div class=\"seccion-t\">",
    "          <h2>Salones del día</h2>",
    "          <div class=\"leyenda\">",
    "            <span><i class=\"e-EN-CLASE\"></i>En clase</span><span><i class=\"e-DICTADO\"></i>Dictado</span><span><i class=\"e-REEMPLAZO\"></i>Reemplazo</span>",
    "            <span><i class=\"e-CONFIRMADO\"></i>Confirmado</span><span><i class=\"e-PROGRAMADO\"></i>Programado</span>",
    "            <span><i class=\"e-SIN-MARCAR\"></i>Sin marcar</span><span><i class=\"e-NO-DICTADO\"></i>No dictado</span>",
    "          </div>",
    "        </div>",
    "        <div class=\"tarjeta timeline\"><div class=\"tl-inner\" id=\"timeline\"></div></div>",
    "",
    "        <div class=\"dos-col\" style=\"margin-top:16px\">",
    "          <div>",
    "            <div class=\"seccion-t\"><h2>Marcaciones</h2><span class=\"muted\" id=\"n-marc\"></span></div>",
    "            <div class=\"tarjeta tabla-scroll\"><table id=\"tabla-marc\"></table></div>",
    "          </div>",
    "          <div>",
    "            <div class=\"seccion-t\"><h2>Aún no llegan</h2></div>",
    "            <div class=\"tarjeta\" id=\"pendientes\"></div>",
    "          </div>",
    "        </div>",
    "      </div>",
    "",
    "      <!-- REPORTE -->",
    "      <div id=\"t-reporte\" class=\"oculto\">",
    "        <div class=\"barra\">",
    "          <div class=\"controles\">",
    "            <input type=\"month\" id=\"f-mes\">",
    "            <button class=\"btn btn-negro\" id=\"btn-exportar\" type=\"button\" style=\"padding:10px 16px\">Guardar en hoja “Reporte mensual”</button>",
    "            <button class=\"btn btn-claro\" id=\"btn-csv\" type=\"button\" style=\"padding:10px 16px\">Descargar CSV</button>",
    "          </div>",
    "          <span class=\"muted\" id=\"rep-msg\"></span>",
    "        </div>",
    "        <div class=\"kpis\" id=\"rep-kpis\" style=\"grid-template-columns:repeat(4,1fr)\"></div>",
    "        <div class=\"seccion-t\"><h2>Horas dictadas por docente y salón</h2><span class=\"muted\">Base para la gestión de pagos</span></div>",
    "        <div class=\"tarjeta tabla-scroll\"><table id=\"tabla-rep\"></table></div>",
    "      </div>",
    "",
    "      <!-- QR -->",
    "      <div id=\"t-qr\" class=\"oculto\">",
    "        <div class=\"barra\">",
    "          <div class=\"muted\" style=\"max-width:640px\">Cada código abre la página de marcación con el DNI del docente. Imprime y entrega uno a cada docente; lo escanean con la cámara del celular o con un lector QR en la computadora.</div>",
    "          <button class=\"btn btn-rojo\" id=\"btn-imprimir\" type=\"button\" style=\"padding:10px 16px\">🖨 Imprimir fotochecks</button>",
    "        </div>",
    "        <div class=\"qr-grid\" id=\"qr-grid\"></div>",
    "      </div>",
    "    </section>",
    "  </main>",
    "",
    "<script>",
    "(function () {",
    "  var $ = function (id) { return document.getElementById(id); };",
    "  var S = { pin: '', fecha: '', mes: '', timer: null, reporte: null, appUrl: '<?= appUrl ?>' };",
    "  var DIAS = { LUNES: 'Lunes', MARTES: 'Martes', MIERCOLES: 'Miércoles', JUEVES: 'Jueves', VIERNES: 'Viernes', SABADO: 'Sábado', DOMINGO: 'Domingo' };",
    "  var INICIO = 8 * 60, FIN = 14 * 60;",
    "",
    "  function api(fn) {",
    "    var args = Array.prototype.slice.call(arguments, 1);",
    "    return new Promise(function (ok, mal) {",
    "      var r = google.script.run.withSuccessHandler(ok).withFailureHandler(function (e) { mal(e && e.message ? e : new Error(String(e))); });",
    "      r[fn].apply(r, args);",
    "    });",
    "  }",
    "  function esc(s) { return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[c]; }); }",
    "  function min(h) { var p = String(h).split(':'); return +p[0] * 60 + +p[1]; }",
    "  function n2(v) { return Number(v || 0).toFixed(2); }",
    "  function guardarPin(p) { try { sessionStorage.setItem('cvi_pin', p); } catch (e) { } }",
    "  function leerPin() { try { return sessionStorage.getItem('cvi_pin') || ''; } catch (e) { return ''; } }",
    "",
    "  function tic() {",
    "    var d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));",
    "    $('reloj').textContent = d.toTimeString().slice(0, 5);",
    "    $('fecha-hoy').textContent = d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });",
    "  }",
    "  setInterval(tic, 1000); tic();",
    "  api('getLogo').then(function (u) { if (u) $('logo').innerHTML = '<img alt=\"Logo CVI\" src=\"' + u + '\">'; }).catch(function () { });",
    "",
    "  /* ---------- Login ---------- */",
    "  function entrar(pin) {",
    "    $('btn-login').disabled = true;",
    "    return api('loginPanel', pin).then(function (r) {",
    "      S.pin = pin; guardarPin(pin); $('sede').textContent = r.sede;",
    "      S.fecha = r.hoy; S.mes = r.hoy.slice(0, 7); $('f-fecha').value = S.fecha; $('f-mes').value = S.mes;",
    "      $('v-login').classList.add('oculto'); $('v-app').classList.remove('oculto');",
    "      cargarHoy(); S.timer = setInterval(cargarHoy, 30000);",
    "    }).catch(function (e) {",
    "      $('error-login').textContent = e.message.indexOf('PIN') >= 0 ? 'PIN incorrecto' : e.message; $('error-login').classList.remove('oculto');",
    "    }).then(function () { $('btn-login').disabled = false; });",
    "  }",
    "  $('btn-login').addEventListener('click', function () { entrar($('pin').value.trim()); });",
    "  $('pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(this.value.trim()); });",
    "  $('btn-salir').addEventListener('click', function () { guardarPin(''); location.reload(); });",
    "  $('btn-marcacion').addEventListener('click', function () { window.open(S.appUrl, '_blank'); });",
    "  if (leerPin()) entrar(leerPin());",
    "",
    "  /* ---------- Tabs ---------- */",
    "  document.querySelector('.tabs').addEventListener('click', function (e) {",
    "    var b = e.target.closest('[data-tab]'); if (!b) return;",
    "    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('activo', t === b); });",
    "    ['hoy', 'reporte', 'qr'].forEach(function (t) { $('t-' + t).classList.toggle('oculto', t !== b.getAttribute('data-tab')); });",
    "    if (b.getAttribute('data-tab') === 'reporte') cargarReporte();",
    "    if (b.getAttribute('data-tab') === 'qr') cargarQR();",
    "  });",
    "",
    "  /* ---------- En vivo ---------- */",
    "  $('f-fecha').addEventListener('change', function () { S.fecha = this.value; cargarHoy(); });",
    "",
    "  function cargarHoy() {",
    "    if ($('t-hoy').classList.contains('oculto')) return;",
    "    api('getPanel', S.pin, S.fecha).then(pintarHoy).catch(function (e) {",
    "      $('vivo').classList.add('pausa'); $('vivo-txt').textContent = 'Sin conexión · reintentando (' + e.message + ')';",
    "    });",
    "  }",
    "",
    "  function kpi(l, v, extra, cls, pct) {",
    "    return '<div class=\"tarjeta kpi ' + (cls || '') + '\"><div class=\"l\">' + l + '</div><div class=\"v\">' + v + (extra ? ' <small>' + extra + '</small>' : '') + '</div>' +",
    "      (pct != null ? '<div class=\"barra-p\"><span style=\"width:' + Math.min(100, pct) + '%\"></span></div>' : '') + '</div>';",
    "  }",
    "",
    "  function pintarHoy(d) {",
    "    $('vivo').classList.toggle('pausa', !d.esHoy);",
    "    $('vivo-txt').textContent = d.esHoy ? 'En vivo · actualizado ' + d.hora + ' · cada 30 s' : DIAS[d.dia] + ' ' + d.fecha + ' (histórico)';",
    "    $('aviso-dni').innerHTML = d.docentesSinDni.length",
    "      ? '<span class=\"chip rojo\" title=\"' + esc(d.docentesSinDni.join(', ')) + '\">⚠ ' + d.docentesSinDni.length + ' docente(s) sin DNI (marcan con su celular)</span>' : '';",
    "    var k = d.kpi;",
    "    $('kpis').innerHTML =",
    "      kpi('Docentes que llegaron', k.llegaron, 'de ' + k.programados, 'destacado', k.programados ? k.llegaron / k.programados * 100 : 0) +",
    "      kpi('En el colegio ahora', k.presentes) +",
    "      kpi('Puntuales', k.puntuales) +",
    "      kpi('Tardanzas', k.tardanzas, '', k.tardanzas ? 'alerta-k' : '') +",
    "      kpi('Clases dictadas', k.dictados, 'de ' + k.bloques, '', k.bloques ? k.dictados / k.bloques * 100 : 0) +",
    "      kpi('Sin dictar / sin marcar', k.noDictados + k.sinMarcar, '', (k.noDictados + k.sinMarcar) ? 'alerta-k' : '');",
    "    pintarTimeline(d);",
    "    pintarMarcaciones(d);",
    "    $('pendientes').innerHTML = d.faltan.length ? d.faltan.map(function (f) {",
    "      return '<div class=\"pend\"><div><div class=\"n\">' + esc(f.docente) + '</div><div class=\"d\">' + esc(f.salon) + ' · desde ' + esc(f.desde) + '</div></div>' +",
    "        '<div>' + (f.atrasado ? '<span class=\"chip rojo\">Atrasado</span>' : '<span class=\"chip\">Por llegar</span>') + '</div></div>';",
    "    }).join('') : '<div class=\"vacio-t\">✅ Todos los docentes programados ya marcaron.</div>';",
    "  }",
    "",
    "  function pintarTimeline(d) {",
    "    if (!d.bloques.length) { $('timeline').innerHTML = '<div class=\"vacio-t\">No hay clases programadas este día.</div>'; return; }",
    "    var ini = Math.min(INICIO, Math.min.apply(null, d.bloques.map(function (b) { return min(b.inicio); })));",
    "    var fin = Math.max(FIN, Math.max.apply(null, d.bloques.map(function (b) { return min(b.fin); })));",
    "    var pct = function (m) { return ((m - ini) / (fin - ini) * 100).toFixed(3) + '%'; };",
    "    var marcas = '';",
    "    for (var h = Math.ceil(ini / 60) * 60; h <= fin; h += 60) marcas += '<span style=\"left:' + pct(h) + '\">' + (h / 60) + ':00</span>';",
    "    var salones = [];",
    "    d.bloques.forEach(function (b) { if (salones.indexOf(b.salon) < 0) salones.push(b.salon); });",
    "    var ahora = d.esHoy && min(d.hora) >= ini && min(d.hora) <= fin ? '<div class=\"tl-ahora\" style=\"left:' + pct(min(d.hora)) + '\"></div>' : '';",
    "    $('timeline').innerHTML = '<div class=\"tl-escala\"><div></div><div class=\"marcas\">' + marcas + '</div></div>' + salones.map(function (s) {",
    "      return '<div class=\"tl-fila\"><div class=\"tl-salon\">' + esc(s) + '</div><div class=\"tl-pista\">' + ahora + d.bloques.filter(function (b) { return b.salon === s; }).map(function (b) {",
    "        var quien = b.dicto ? (b.tipo === 'REEMPLAZO' ? '↻ ' + b.dicto : b.dicto) : (b.titular || 'Sin docente');",
    "        var tip = b.salon + ' · ' + b.curso + '\\n' + b.inicio + '–' + b.fin + '\\nTitular: ' + (b.titular || '—') + (b.dicto ? '\\nDictó: ' + b.dicto : '') + '\\nEstado: ' + b.estado;",
    "        return '<div class=\"blq e-' + b.estado.replace(/ /g, '-') + '\" style=\"left:' + pct(min(b.inicio)) + ';width:calc(' + pct(min(b.fin)) + ' - ' + pct(min(b.inicio)) + ' - 3px)\" title=\"' + esc(tip) + '\">' +",
    "          '<b>' + esc(b.curso) + '</b><span>' + esc(quien) + '</span></div>';",
    "      }).join('') + '</div></div>';",
    "    }).join('');",
    "  }",
    "",
    "  function pintarMarcaciones(d) {",
    "    var porId = {}; d.bloques.forEach(function (b) { porId[b.id] = b; });",
    "    $('n-marc').textContent = d.marcaciones.length + ' registro(s)';",
    "    if (!d.marcaciones.length) { $('tabla-marc').innerHTML = '<tr><td class=\"vacio-t\">Aún no hay marcaciones este día.</td></tr>'; return; }",
    "    var filas = d.marcaciones.slice().sort(function (a, b) { return min(a.inicio) - min(b.inicio); }).map(function (m) {",
    "      var salones = m.bloques.map(function (id) { return porId[id] ? porId[id].salon : id; })",
    "        .concat(m.reemplazos.map(function (id) { return '↻ ' + (porId[id] ? porId[id].salon : id); }));",
    "      var uniq = salones.filter(function (v, i, a) { return a.indexOf(v) === i; });",
    "      var est = m.estado === 'TARDANZA' ? '<span class=\"chip warn\">Tarde ' + esc(m.minTarde) + ' min</span>' : m.estado === 'PUNTUAL' ? '<span class=\"chip ok\">Puntual</span>' : '<span class=\"chip\">' + esc(m.estado) + '</span>';",
    "      return '<tr><td><b>' + esc(m.docente) + '</b><div class=\"muted\" style=\"font-size:12px\">' + esc(m.dispositivo) + '</div></td>' +",
    "        '<td class=\"num\">' + esc(m.inicio) + '</td><td class=\"num\">' + (m.fin ? esc(m.fin) : '<span class=\"chip ok\"><span class=\"punto\"></span>En el colegio</span>') + '</td>' +",
    "        '<td>' + est + '</td><td>' + esc(uniq.join(', ')) + '</td><td class=\"num\">' + (m.fin ? n2(m.horasEfectivas) : '—') + '</td>' +",
    "        '<td>' + esc([m.obs, m.obsDetalle].filter(Boolean).join(': ')) + '</td></tr>';",
    "    });",
    "    $('tabla-marc').innerHTML = '<thead><tr><th>Docente</th><th class=\"num\">Ingreso</th><th class=\"num\">Salida</th><th>Estado</th><th>Salones</th><th class=\"num\">Horas</th><th>Observación</th></tr></thead><tbody>' + filas.join('') + '</tbody>';",
    "  }",
    "",
    "  /* ---------- Reporte ---------- */",
    "  $('f-mes').addEventListener('change', function () { S.mes = this.value; cargarReporte(); });",
    "  function cargarReporte() {",
    "    $('rep-msg').textContent = 'Cargando…';",
    "    api('getReporte', S.pin, S.mes).then(function (r) { S.reporte = r; pintarReporte(r); $('rep-msg').textContent = ''; })",
    "      .catch(function (e) { $('rep-msg').textContent = 'Error: ' + e.message; });",
    "  }",
    "  function pintarReporte(r) {",
    "    var tot = r.filas.reduce(function (s, f) { return s + f.horas; }, 0);",
    "    var docs = {}; r.filas.forEach(function (f) { docs[f.docente] = true; });",
    "    var reemp = r.filas.reduce(function (s, f) { return s + f.reemplazos; }, 0);",
    "    var clases = r.filas.reduce(function (s, f) { return s + f.clases; }, 0);",
    "    $('rep-kpis').innerHTML = kpi('Horas dictadas (mes)', n2(tot), '', 'destacado') + kpi('Docentes', Object.keys(docs).length) + kpi('Clases registradas', clases) + kpi('Reemplazos', reemp);",
    "    if (!r.filas.length) { $('tabla-rep').innerHTML = '<tr><td class=\"vacio-t\">No hay clases dictadas registradas en ' + esc(r.mes) + '.</td></tr>'; return; }",
    "    var html = '<thead><tr><th>Docente</th><th>Mes</th><th>Salón</th><th class=\"num\">N.º horas dictadas</th><th class=\"num\">Clases</th><th class=\"num\">Días</th><th class=\"num\">Reemplazos</th><th class=\"num\">Tardanzas</th></tr></thead><tbody>';",
    "    var actual = null, sub = 0;",
    "    r.filas.forEach(function (f, i) {",
    "      if (actual !== null && actual !== f.docente) { html += '<tr class=\"subtotal\"><td colspan=\"3\">Total ' + esc(actual) + '</td><td class=\"num\">' + n2(sub) + '</td><td colspan=\"4\"></td></tr>'; sub = 0; }",
    "      actual = f.docente; sub += f.horas;",
    "      html += '<tr><td><b>' + esc(f.docente) + '</b></td><td>' + esc(f.mes) + '</td><td>' + esc(f.salon) + '</td><td class=\"num\"><b>' + n2(f.horas) + '</b></td><td class=\"num\">' + f.clases +",
    "        '</td><td class=\"num\">' + f.dias + '</td><td class=\"num\">' + f.reemplazos + '</td><td class=\"num\">' + (f.tardanzas ? f.tardanzas + ' (' + f.minTarde + ' min)' : '0') + '</td></tr>';",
    "    });",
    "    html += '<tr class=\"subtotal\"><td colspan=\"3\">Total ' + esc(actual) + '</td><td class=\"num\">' + n2(sub) + '</td><td colspan=\"4\"></td></tr>';",
    "    html += '<tr class=\"total\"><td colspan=\"3\">TOTAL GENERAL</td><td class=\"num\">' + n2(tot) + '</td><td colspan=\"4\"></td></tr></tbody>';",
    "    $('tabla-rep').innerHTML = html;",
    "  }",
    "  $('btn-exportar').addEventListener('click', function () {",
    "    var b = this; b.disabled = true; $('rep-msg').textContent = 'Guardando…';",
    "    api('exportarReporte', S.pin, S.mes).then(function (r) { $('rep-msg').innerHTML = '✅ ' + r.filas + ' fila(s) guardadas. <a href=\"' + r.url + '\" target=\"_blank\">Abrir hoja</a>'; })",
    "      .catch(function (e) { $('rep-msg').textContent = 'Error: ' + e.message; }).then(function () { b.disabled = false; });",
    "  });",
    "  $('btn-csv').addEventListener('click', function () {",
    "    if (!S.reporte) return;",
    "    var q = function (v) { return '\"' + String(v).replace(/\"/g, '\"\"') + '\"'; };",
    "    var lineas = [['Docente', 'Mes', 'Salón', 'N.º horas dictadas', 'Clases', 'Días', 'Reemplazos', 'Tardanzas', 'Min. tardanza'].map(q).join(',')].concat(",
    "      S.reporte.filas.map(function (f) { return [f.docente, f.mes, f.salon, n2(f.horas), f.clases, f.dias, f.reemplazos, f.tardanzas, f.minTarde].map(q).join(','); }));",
    "    var a = document.createElement('a');",
    "    a.href = URL.createObjectURL(new Blob(['﻿' + lineas.join('\\n')], { type: 'text/csv;charset=utf-8' }));",
    "    a.download = 'horas_docentes_' + S.mes + '.csv'; a.click();",
    "  });",
    "",
    "  /* ---------- QR ---------- */",
    "  function cargarQR() {",
    "    $('qr-grid').innerHTML = '<div class=\"muted\">Cargando…</div>';",
    "    api('getDocentesQR', S.pin).then(function (r) {",
    "      $('qr-grid').innerHTML = r.docentes.map(function (d, i) {",
    "        return '<div class=\"fotocheck\"><div class=\"cab\">CVI · Monte Azul</div>' +",
    "          ((d.dni || d.celular) ? '<div class=\"qr\" id=\"qr-' + i + '\"></div>' : '<div class=\"qr\"><div class=\"sin\">Falta registrar el DNI<br>en la hoja “Docentes”</div></div>') +",
    "          '<div class=\"nom\">' + esc(d.docente) + '</div><div class=\"dni\">' + (d.dni ? 'DNI ' + esc(d.dni) : d.celular ? 'Cel. ' + esc(d.celular) + ' (falta DNI)' : '&nbsp;') + '</div></div>';",
    "      }).join('');",
    "      r.docentes.forEach(function (d, i) {",
    "        var cod = d.dni || d.celular; if (!cod || typeof QRCode === 'undefined') return;",
    "        new QRCode($('qr-' + i), { text: (r.appUrl || S.appUrl) + '?dni=' + cod, width: 340, height: 340, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });",
    "      });",
    "    }).catch(function (e) { $('qr-grid').innerHTML = '<div class=\"alerta\">' + esc(e.message) + '</div>'; });",
    "  }",
    "  $('btn-imprimir').addEventListener('click', function () { window.print(); });",
    "})();",
    "</script>",
    "</body>",
    "</html>",
    ""
  ].join('\n'),
  Styles: [
    "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">",
    "<link href=\"https://fonts.googleapis.com/css2?family=Cantata+One&family=Inter:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\">",
    "<style>",
    "  :root {",
    "    --negro: #000000;",
    "    --rojo: #920000;",
    "    --rojo-2: #b31212;",
    "    --rojo-suave: #f7e6e6;",
    "    --amarillo: #eebe4f;",
    "    --amarillo-suave: #fbf1d8;",
    "    --blanco: #ffffff;",
    "    --fondo: #f5f2ec;",
    "    --tarjeta: #ffffff;",
    "    --texto: #1b1b1b;",
    "    --texto-2: #5c5752;",
    "    --borde: #e4ddd2;",
    "    --ok: #1f7a3a;",
    "    --ok-suave: #e3f3e8;",
    "    --warn: #a86200;",
    "    --warn-suave: #fdf0d9;",
    "    --gris: #8a847c;",
    "    --gris-suave: #efebe5;",
    "    --radio: 16px;",
    "    --sombra: 0 1px 2px rgba(0,0,0,.06), 0 6px 20px rgba(0,0,0,.06);",
    "  }",
    "  * { box-sizing: border-box; }",
    "  html, body { margin: 0; padding: 0; }",
    "  body {",
    "    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;",
    "    background: var(--fondo); color: var(--texto); font-size: 16px; line-height: 1.45;",
    "    -webkit-font-smoothing: antialiased; min-height: 100vh;",
    "  }",
    "  button, input, textarea, select { font: inherit; color: inherit; }",
    "  .marca { font-family: 'Cantata One', Georgia, serif; letter-spacing: .01em; }",
    "",
    "  /* ---------- Barra superior ---------- */",
    "  .topbar {",
    "    background: var(--negro); color: var(--blanco);",
    "    border-bottom: 4px solid var(--amarillo);",
    "    padding: 12px 20px; display: flex; align-items: center; gap: 14px;",
    "  }",
    "  .topbar .logo {",
    "    width: 52px; height: 52px; border-radius: 12px; background: var(--blanco);",
    "    display: grid; place-items: center; overflow: hidden; flex: none;",
    "  }",
    "  .topbar .logo img { width: 100%; height: 100%; object-fit: contain; }",
    "  .topbar .logo .fallback { color: var(--rojo); font-family: 'Cantata One', serif; font-size: 18px; font-weight: 700; }",
    "  .topbar .titulo { flex: 1; min-width: 0; }",
    "  .topbar .titulo .nombre { font-family: 'Cantata One', serif; font-size: 18px; color: var(--amarillo); line-height: 1.1; }",
    "  .topbar .titulo .sub { font-size: 13px; color: #d9d4cc; margin-top: 2px; }",
    "  .reloj { text-align: right; flex: none; }",
    "  .reloj .h { font-variant-numeric: tabular-nums; font-size: 26px; font-weight: 800; letter-spacing: .02em; }",
    "  .reloj .f { font-size: 12px; color: #d9d4cc; text-transform: capitalize; }",
    "",
    "  /* ---------- Componentes ---------- */",
    "  .contenedor { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }",
    "  .tarjeta { background: var(--tarjeta); border-radius: var(--radio); box-shadow: var(--sombra); border: 1px solid var(--borde); }",
    "  .pad { padding: 22px; }",
    "  h1, h2, h3 { margin: 0; }",
    "  .h-seccion { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--texto-2); margin: 22px 0 10px; }",
    "  .muted { color: var(--texto-2); }",
    "  .chip {",
    "    display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;",
    "    font-size: 13px; font-weight: 600; background: var(--gris-suave); color: var(--texto-2); white-space: nowrap;",
    "  }",
    "  .chip.ok { background: var(--ok-suave); color: var(--ok); }",
    "  .chip.warn { background: var(--warn-suave); color: var(--warn); }",
    "  .chip.rojo { background: var(--rojo-suave); color: var(--rojo); }",
    "  .chip.oscuro { background: var(--negro); color: var(--amarillo); }",
    "  .chip .punto { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }",
    "",
    "  .btn {",
    "    border: 0; border-radius: 14px; padding: 14px 20px; font-weight: 700; cursor: pointer;",
    "    display: inline-flex; align-items: center; justify-content: center; gap: 10px; transition: transform .05s, filter .15s;",
    "  }",
    "  .btn:active { transform: scale(.98); }",
    "  .btn:disabled { opacity: .5; cursor: not-allowed; }",
    "  .btn-rojo { background: var(--rojo); color: var(--blanco); }",
    "  .btn-rojo:hover:not(:disabled) { filter: brightness(1.12); }",
    "  .btn-negro { background: var(--negro); color: var(--amarillo); }",
    "  .btn-amarillo { background: var(--amarillo); color: var(--negro); }",
    "  .btn-claro { background: var(--gris-suave); color: var(--texto); }",
    "  .btn-grande { width: 100%; font-size: 20px; padding: 20px; border-radius: 16px; }",
    "  .link { background: none; border: 0; color: var(--rojo); font-weight: 600; cursor: pointer; padding: 8px; text-decoration: underline; }",
    "",
    "  .alerta { padding: 12px 16px; border-radius: 12px; background: var(--rojo-suave); color: var(--rojo); font-weight: 600; margin-top: 14px; }",
    "  .alerta.info { background: var(--amarillo-suave); color: #6b4d00; }",
    "",
    "  .spinner { width: 22px; height: 22px; border: 3px solid rgba(255,255,255,.35); border-top-color: currentColor; border-radius: 50%; animation: gira .8s linear infinite; }",
    "  @keyframes gira { to { transform: rotate(360deg); } }",
    "  .oculto { display: none !important; }",
    "",
    "  @media (max-width: 560px) {",
    "    .topbar { padding: 10px 14px; gap: 10px; }",
    "    .topbar .logo { width: 42px; height: 42px; }",
    "    .topbar .titulo .nombre { font-size: 15px; }",
    "    .topbar .titulo .sub { font-size: 12px; }",
    "    .reloj .h { font-size: 20px; }",
    "    .pad { padding: 18px; }",
    "  }",
    "</style>",
    ""
  ].join('\n')
};
/* ==================== FIN DEL ARCHIVO (no debe haber nada debajo de esta línea) ==================== */
