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

/* ---------------- Horario: validación y edición ---------------- */

/**
 * Valida un bloque antes de guardarlo.
 *  - errores: impiden guardar (datos incompletos, horas inválidas, cruce en el mismo salón).
 *  - avisos: se puede guardar igual (ej. docente en dos salones a la vez = clases juntas).
 */
function validarBloque(b, horario) {
  var errores = [], avisos = [];
  var dia = norm(b.dia).toUpperCase();
  if (!String(b.salon || '').trim()) errores.push('Indica el salón.');
  if (DIAS.indexOf(dia) < 1) errores.push('Elige un día de lunes a sábado.');
  if (!String(b.curso || '').trim()) errores.push('Indica el curso.');
  var ini = toMin(b.inicio), fin = toMin(b.fin);
  if (ini === null || fin === null) errores.push('Las horas deben tener el formato HH:mm.');
  else if (fin <= ini) errores.push('La hora de fin debe ser mayor que la de inicio.');
  if (errores.length) return { errores: errores, avisos: avisos };
  (horario || []).forEach(function (o) {
    if (o.id === b.id || norm(o.dia).toUpperCase() !== dia) return;
    var cruza = toMin(o.inicio) < fin && toMin(o.fin) > ini;
    if (!cruza) return;
    if (norm(o.salon) === norm(b.salon)) {
      errores.push('Se cruza con ' + o.curso + ' (' + o.inicio + '–' + o.fin + ') en el mismo salón.');
    } else if (b.docente && norm(o.docente) === norm(b.docente)) {
      avisos.push(b.docente + ' también tiene ' + o.curso + ' en ' + o.salon + ' (' + o.inicio + '–' + o.fin + '). Se contará como clase conjunta.');
    }
  });
  return { errores: errores, avisos: avisos };
}

/** Prefijo de salón para IDs: "ANUAL INTEGRAL" → AI, "LÍDERES 5-6" → LI. */
function prefijoSalon(salon) {
  var palabras = norm(salon).toUpperCase().split(' ').filter(function (w) { return /^[A-Z]+$/.test(w); });
  if (!palabras.length) return 'SA';
  return palabras.length >= 2 ? palabras[0][0] + palabras[1][0] : palabras[0].slice(0, 2);
}

/** Genera un ID nuevo y único: PREFIJO-DIA-N (ej. AI-LU-6). */
function nuevoIdBloque(salon, dia, horario) {
  var base = prefijoSalon(salon) + '-' + norm(dia).toUpperCase().slice(0, 2) + '-';
  var usados = {};
  (horario || []).forEach(function (h) { usados[h.id] = true; });
  var n = 1;
  while (usados[base + n]) n++;
  return base + n;
}

/* ---------------- Docentes: validación ---------------- */

/**
 * Valida los datos de un docente antes de guardarlo.
 * @param d           {dni, docente, nombreCompleto, especialidad, celular, correo, activo}
 * @param docentes    lista actual
 * @param nombreAnterior  nombre corto antes de editar ('' si es nuevo)
 */
function validarDocente(d, docentes, nombreAnterior) {
  var errores = [];
  var nombre = String(d.docente || '').trim();
  var dni = String(d.dni || '').replace(/\D/g, '');
  var cel = String(d.celular || '').replace(/\D/g, '').replace(/^51(\d{9})$/, '$1');
  if (!nombre) errores.push('Escribe el nombre corto del docente (como aparecerá en el horario).');
  if (d.dni && dni.length !== 8) errores.push('El DNI debe tener 8 dígitos.');
  if (d.celular && (cel.length !== 9 || cel[0] !== '9')) errores.push('El celular debe tener 9 dígitos y empezar con 9.');
  if (d.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.correo).trim())) errores.push('El correo no es válido.');
  if (!dni && !cel) errores.push('Registra al menos el DNI o el celular (con eso marca su asistencia).');
  var otros = (docentes || []).filter(function (x) { return norm(x.docente) !== norm(nombreAnterior || ''); });
  otros.forEach(function (x) {
    if (nombre && norm(x.docente) === norm(nombre)) errores.push('Ya existe un docente llamado "' + x.docente + '".');
    if (dni && String(x.dni || '').replace(/\D/g, '') === dni) errores.push('El DNI ' + dni + ' ya está registrado para ' + x.docente + '.');
    if (cel && String(x.celular || '').replace(/\D/g, '') === cel) errores.push('El celular ' + cel + ' ya está registrado para ' + x.docente + '.');
  });
  return { errores: errores, dni: dni, celular: cel, docente: nombre };
}

// Exportar para pruebas en Node (ignorado en Apps Script).
if (typeof module !== 'undefined') {
  module.exports = {
    DIAS: DIAS, OBSERVACIONES: OBSERVACIONES, toMin: toMin, fmtMin: fmtMin, diaDeFecha: diaDeFecha, norm: norm,
    extraerDni: extraerDni, bloquesDelDia: bloquesDelDia, evaluarIngreso: evaluarIngreso,
    horasSuperpuestas: horasSuperpuestas, calcularHoras: calcularHoras,
    estadoBloques: estadoBloques, resumenMensual: resumenMensual,
    validarBloque: validarBloque, prefijoSalon: prefijoSalon, nuevoIdBloque: nuevoIdBloque, validarDocente: validarDocente
  };
}
