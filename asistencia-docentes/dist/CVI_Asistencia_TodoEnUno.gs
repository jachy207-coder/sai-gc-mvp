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

/* ---------------- Control académico ---------------- */

var TIPOS_AVANCE = ['COMPLETADO', 'PARCIAL', 'REPASO', 'EVALUACION'];

/** Semana del calendario que contiene la fecha (inicio = lunes, fin = sábado), o null. */
function semanaDeFecha(calendario, fecha) {
  return (calendario || []).filter(function (s) { return s.inicio <= fecha && fecha <= s.fin; })[0] || null;
}

/**
 * Tema esperado según el calendario (1 tema por semana de clase; exámenes y vacaciones no cuentan).
 *  - enCurso: N.º de semana de clase en curso (null si la semana es de exámenes/vacaciones)
 *  - completados: semanas de clase que ya terminaron antes de la fecha → temas que deberían estar completos
 */
function temaEsperado(calendario, fecha) {
  var clases = (calendario || []).filter(function (s) { return s.tipo === 'CLASE'; });
  var completados = clases.filter(function (s) { return s.fin < fecha; }).length;
  var semana = semanaDeFecha(calendario, fecha);
  var enCurso = semana && semana.tipo === 'CLASE' ? Number(semana.nSemana) : null;
  return { completados: completados, enCurso: enCurso, semana: semana, total: clases.length };
}

/**
 * Avance de un curso a partir del leccionario.
 * @param total          temas del curso (32)
 * @param avanceInicial  temas completados antes de usar el sistema (línea base)
 * @param registros      [{n, tipo, fecha}] del leccionario de ese curso
 */
function avanceCurso(total, avanceInicial, registros) {
  var completados = {}, parciales = {};
  var base = Math.max(0, Math.min(Number(avanceInicial) || 0, total));
  for (var i = 1; i <= base; i++) completados[i] = true;
  var orden = (registros || []).slice().sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
  orden.forEach(function (r) {
    var n = Number(r.n);
    if (!n) return;
    if (r.tipo === 'COMPLETADO') completados[n] = true;
    else if (r.tipo === 'PARCIAL') parciales[n] = true;
  });
  Object.keys(completados).forEach(function (n) { delete parciales[n]; });
  var siguiente = 1;
  while (completados[siguiente] && siguiente <= total) siguiente++;
  var ultimo = orden.length ? orden[orden.length - 1] : null;
  // Si el último registro fue un avance parcial de un tema aún no completado, se sugiere continuar ese tema.
  var sugerido = ultimo && ultimo.tipo === 'PARCIAL' && !completados[Number(ultimo.n)] ? Number(ultimo.n) : Math.min(siguiente, total);
  var n = Object.keys(completados).length;
  return {
    completados: Object.keys(completados).map(Number).sort(function (a, b) { return a - b; }),
    parciales: Object.keys(parciales).map(Number).sort(function (a, b) { return a - b; }),
    ultimoContinuo: siguiente - 1, siguiente: siguiente > total ? null : siguiente, sugerido: sugerido,
    cobertura: total ? Math.round(n / total * 1000) / 10 : 0, totalCompletados: n
  };
}

/** Semáforo de atraso: 0 → VERDE, 1 → AMBAR, 2 o más → ROJO. */
function semaforoAtraso(ultimoContinuo, esperadoCompletados) {
  var atraso = Math.max(0, esperadoCompletados - ultimoContinuo);
  return { atraso: atraso, semaforo: atraso === 0 ? 'VERDE' : atraso === 1 ? 'AMBAR' : 'ROJO' };
}

/** Curso del temario que corresponde a un bloque del horario (por salón y nombre/alias del curso). */
function cursoDeBloque(bloque, cursos) {
  var c = norm(bloque.curso);
  return (cursos || []).filter(function (k) {
    if (norm(k.salon) !== norm(bloque.salon)) return false;
    var alias = [k.curso].concat(String(k.alias || '').split('|'));
    return alias.some(function (a) { return a && norm(a) === c; });
  })[0] || null;
}

// Exportar para pruebas en Node (ignorado en Apps Script).
if (typeof module !== 'undefined') {
  module.exports = {
    DIAS: DIAS, OBSERVACIONES: OBSERVACIONES, toMin: toMin, fmtMin: fmtMin, diaDeFecha: diaDeFecha, norm: norm,
    extraerDni: extraerDni, bloquesDelDia: bloquesDelDia, evaluarIngreso: evaluarIngreso,
    horasSuperpuestas: horasSuperpuestas, calcularHoras: calcularHoras,
    estadoBloques: estadoBloques, resumenMensual: resumenMensual,
    validarBloque: validarBloque, prefijoSalon: prefijoSalon, nuevoIdBloque: nuevoIdBloque, validarDocente: validarDocente,
    TIPOS_AVANCE: TIPOS_AVANCE, semanaDeFecha: semanaDeFecha, temaEsperado: temaEsperado, avanceCurso: avanceCurso,
    semaforoAtraso: semaforoAtraso, cursoDeBloque: cursoDeBloque
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
  ["LI-VI-2", "LÍDERES 5-6", "VIERNES", "10:15", "12:00", "RAZ. MATEMÁTICO", "Yuli Cucho", ""],
  ["LI-VI-3", "LÍDERES 5-6", "VIERNES", "12:15", "14:00", "ARITMÉTICA", "Yuli Cucho", ""],
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
  ["", "Jhon Vásquez", "", "Trigonometría", "957239619", "", "SI"],
  ["", "Jhonatan Hilario", "Jhonatan Hilario Maldonado", "Raz. Matemático", "940509635", "jhonatan_19847@hotmail.com", "SI"],
  ["", "Ivonne Solórzano", "Ivonne Taira Solorzano Amacifuen", "Lenguaje, Raz. Verbal, Inglés", "925841033", "solorzano.taira@gmail.com", "SI"],
  ["", "Alberto Yanac", "Alberto Calixto Yanac Hurtado", "Álgebra y Trigonometría", "946234715", "alberto.yanac.h@uni.pe", "SI"],
  ["", "Jorge Adama", "Jorge Víctor Adama Gómez", "Física", "996364672", "", "SI"],
  ["", "Alan Sosa", "Alan Paul Sosa Cauti", "Geometría", "938898881", "paulsosa32@hotmail.com", "SI"],
  ["", "Jhon Quispe", "Jhon Marcy Quispe Yaganqui", "Aritmética", "902061340", "jhonmqy@gmail.com", "SI"],
  ["", "Wilber Escobar", "Wilber Escobar Navarro", "Historia y Geografía", "965700105", "wilber.escobar@unmsm.edu.pe", "SI"],
  ["", "Susan Adama", "", "Ciencias", "941460816", "", "SI"],
  ["", "Jordi San Miguel", "Jordi Cristofer San Miguel Ibarra", "Educ. Física y Ajedrez", "920577362", "jordisanmiguel24@gmail.com", "SI"],
  ["", "Redoberto Martin", "Redoberto Martin Aguirre", "Química", "926526458", "redobaldo@gmail.com", "SI"],
  ["", "Fabián Vargas", "Fabián Azarías Vargas Silva", "Geografía, Filosofía y Economía", "986025541", "fabianazarias.380@gmail.com", "SI"],
  ["", "Erika Ramírez", "Erika Beatriz Ramírez Montesinos", "Arte y Computación", "963559152", "erikamontesinos1984@gmail.com", "SI"],
  ["", "Yuli Cucho", "Yuli Cucho", "Matemática", "920005517", "", "SI"],
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

/* Control académico (Anual Integral 2026): generado por tools/construir_temario.py */
var SEED_CURSOS = [
  ["AI-ALG", "ANUAL INTEGRAL", "Álgebra", "Matemáticas", "ÁLGEBRA", "32", "28", "SI"],
  ["AI-ARI", "ANUAL INTEGRAL", "Aritmética", "Matemáticas", "ARITMÉTICA", "32", "28", "SI"],
  ["AI-GEOM", "ANUAL INTEGRAL", "Geometría", "Matemáticas", "GEOMETRÍA", "32", "28", "SI"],
  ["AI-TRI", "ANUAL INTEGRAL", "Trigonometría", "Matemáticas", "TRIGONOMETRÍA", "32", "28", "SI"],
  ["AI-RM", "ANUAL INTEGRAL", "Razonamiento Matemático", "Aptitud Académica", "RAZ. MATEMÁTICO|RAZONAMIENTO MATEMÁTICO|RM", "32", "28", "SI"],
  ["AI-RV", "ANUAL INTEGRAL", "Razonamiento Verbal", "Aptitud Académica", "RAZ. VERBAL|RAZONAMIENTO VERBAL|RV", "32", "28", "SI"],
  ["AI-FIS", "ANUAL INTEGRAL", "Física", "Ciencias", "FÍSICA", "32", "28", "SI"],
  ["AI-QUI", "ANUAL INTEGRAL", "Química", "Ciencias", "QUÍMICA", "32", "28", "SI"],
  ["AI-BIO", "ANUAL INTEGRAL", "Biología", "Ciencias", "BIOLOGÍA", "32", "28", "SI"],
  ["AI-LEN", "ANUAL INTEGRAL", "Lenguaje", "Letras", "LENGUAJE", "32", "28", "SI"],
  ["AI-ING", "ANUAL INTEGRAL", "Inglés", "Letras", "INGLÉS", "32", "28", "SI"],
  ["AI-HIS", "ANUAL INTEGRAL", "Historia", "Letras", "HISTORIA", "32", "28", "SI"],
  ["AI-GEOG", "ANUAL INTEGRAL", "Geografía", "Letras", "GEOGRAFÍA", "32", "28", "SI"],
  ["AI-ECO", "ANUAL INTEGRAL", "Economía", "Letras", "ECONOMÍA", "32", "28", "SI"],
  ["AI-FIL", "ANUAL INTEGRAL", "Filosofía", "Letras", "FILOSOFÍA", "32", "28", "SI"]
];

var SEED_TEMARIO = [
  ["AI-ALG-01", "AI-ALG", "Álgebra", "1", "1", "Ecuaciones lineales", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-02", "AI-ALG", "Álgebra", "2", "1", "Ecuaciones cuadráticas", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-03", "AI-ALG", "Álgebra", "3", "1", "Sistemas de ecuaciones 2×2", "OK", "Boletín 1 impreso"],
  ["AI-ALG-04", "AI-ALG", "Álgebra", "4", "1", "Potenciación", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-05", "AI-ALG", "Álgebra", "5", "2", "Radicación", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-06", "AI-ALG", "Álgebra", "6", "2", "Productos notables I", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-07", "AI-ALG", "Álgebra", "7", "2", "Productos notables II", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-08", "AI-ALG", "Álgebra", "8", "2", "Polinomios I", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-09", "AI-ALG", "Álgebra", "9", "3", "Polinomios II", "OK", "Boletín 3 impreso"],
  ["AI-ALG-10", "AI-ALG", "Álgebra", "10", "3", "División algebraica", "OK", "Boletín 3 impreso"],
  ["AI-ALG-11", "AI-ALG", "Álgebra", "11", "3", "Factorización I", "OK", "Boletín 3 impreso"],
  ["AI-ALG-12", "AI-ALG", "Álgebra", "12", "3", "Factorización II", "OK", "Boletín 3 impreso"],
  ["AI-ALG-13", "AI-ALG", "Álgebra", "13", "4", "Ecuación lineal y cuadrática", "OK", "Boletín 4 impreso"],
  ["AI-ALG-14", "AI-ALG", "Álgebra", "14", "4", "Teoría de ecuaciones cuadráticas II", "OK", "Boletín 4 impreso"],
  ["AI-ALG-15", "AI-ALG", "Álgebra", "15", "4", "Ecuaciones polinomiales de grado superior", "OK", "Boletín 4 impreso"],
  ["AI-ALG-16", "AI-ALG", "Álgebra", "16", "4", "Ecuación bicuadrada y fraccionaria", "OK", "Boletín 4 impreso"],
  ["AI-ALG-17", "AI-ALG", "Álgebra", "17", "5", "Problemas DECO", "OK", "Boletín 5 impreso"],
  ["AI-ALG-18", "AI-ALG", "Álgebra", "18", "5", "Sistemas de ecuaciones lineales I", "OK", "Boletín 5 impreso"],
  ["AI-ALG-19", "AI-ALG", "Álgebra", "19", "5", "Teoría de sistemas de ecuaciones lineales II", "OK", "Boletín 5 impreso"],
  ["AI-ALG-20", "AI-ALG", "Álgebra", "20", "5", "Problemas tipo DECO", "OK", "Boletín 5 impreso"],
  ["AI-ALG-21", "AI-ALG", "Álgebra", "21", "6", "Introducción a los números reales", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-22", "AI-ALG", "Álgebra", "22", "6", "Desigualdades I", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-23", "AI-ALG", "Álgebra", "23", "6", "Desigualdades II e Inecuación lineal", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-24", "AI-ALG", "Álgebra", "24", "6", "Inecuación cuadrática I", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-25", "AI-ALG", "Álgebra", "25", "7", "Inecuación cuadrática II y Polinomial de grado superior", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-26", "AI-ALG", "Álgebra", "26", "7", "Inecuación polinomial de grado tres", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-27", "AI-ALG", "Álgebra", "27", "7", "Problemas DECO", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-28", "AI-ALG", "Álgebra", "28", "7", "Valor absoluto I", "OK", "Temario Excel (BOL7)"],
  ["AI-ALG-29", "AI-ALG", "Álgebra", "29", "8", "Valor absoluto II", "OK", "Boletín 8 impreso"],
  ["AI-ALG-30", "AI-ALG", "Álgebra", "30", "8", "Logaritmos", "OK", "Boletín 8 impreso"],
  ["AI-ALG-31", "AI-ALG", "Álgebra", "31", "8", "Ecuaciones logarítmicas", "OK", "Boletín 8 impreso"],
  ["AI-ALG-32", "AI-ALG", "Álgebra", "32", "8", "Funciones reales", "OK", "Boletín 8 impreso"],
  ["AI-ARI-01", "AI-ARI", "Aritmética", "1", "1", "Problemas contextualizados en los que intervienen operaciones básicas", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-02", "AI-ARI", "Aritmética", "2", "1", "Razones I", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-03", "AI-ARI", "Aritmética", "3", "1", "Razones II", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-04", "AI-ARI", "Aritmética", "4", "1", "Razones III", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-05", "AI-ARI", "Aritmética", "5", "2", "Regla del tanto por ciento I", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-06", "AI-ARI", "Aritmética", "6", "2", "Regla del tanto por ciento II", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-07", "AI-ARI", "Aritmética", "7", "2", "Magnitudes proporcionales I", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-08", "AI-ARI", "Aritmética", "8", "2", "Magnitudes proporcionales II", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-09", "AI-ARI", "Aritmética", "9", "3", "Magnitudes proporcionales III", "OK", "Boletín 3 impreso"],
  ["AI-ARI-10", "AI-ARI", "Aritmética", "10", "3", "Magnitudes proporcionales IV", "OK", "Boletín 3 impreso"],
  ["AI-ARI-11", "AI-ARI", "Aritmética", "11", "3", "Promedios I", "OK", "Boletín 3 impreso"],
  ["AI-ARI-12", "AI-ARI", "Aritmética", "12", "3", "Promedios II", "OK", "Boletín 3 impreso"],
  ["AI-ARI-13", "AI-ARI", "Aritmética", "13", "4", "Regla de mezcla I", "OK", "Boletín 4 impreso"],
  ["AI-ARI-14", "AI-ARI", "Aritmética", "14", "4", "Regla de mezcla II", "OK", "Boletín 4 impreso"],
  ["AI-ARI-15", "AI-ARI", "Aritmética", "15", "4", "Teoría de conjuntos I", "OK", "Boletín 4 impreso"],
  ["AI-ARI-16", "AI-ARI", "Aritmética", "16", "4", "Teoría de conjuntos II", "OK", "Boletín 4 impreso"],
  ["AI-ARI-17", "AI-ARI", "Aritmética", "17", "5", "Teoría de conjuntos III", "OK", "Boletín 5 impreso"],
  ["AI-ARI-18", "AI-ARI", "Aritmética", "18", "5", "Teoría de conjuntos IV", "OK", "Boletín 5 impreso"],
  ["AI-ARI-19", "AI-ARI", "Aritmética", "19", "5", "Numeración I", "OK", "Boletín 5 impreso"],
  ["AI-ARI-20", "AI-ARI", "Aritmética", "20", "5", "Numeración II", "OK", "Boletín 5 impreso"],
  ["AI-ARI-21", "AI-ARI", "Aritmética", "21", "6", "Numeración III", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-22", "AI-ARI", "Aritmética", "22", "6", "Operaciones fundamentales I", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-23", "AI-ARI", "Aritmética", "23", "6", "Operaciones fundamentales II", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-24", "AI-ARI", "Aritmética", "24", "6", "Sucesiones I", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-25", "AI-ARI", "Aritmética", "25", "7", "Sucesiones II", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-26", "AI-ARI", "Aritmética", "26", "7", "Teoría de divisibilidad I", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-27", "AI-ARI", "Aritmética", "27", "7", "Teoría de divisibilidad II", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-28", "AI-ARI", "Aritmética", "28", "7", "Teoría de divisibilidad III", "OK", "Temario Excel (BOL7)"],
  ["AI-ARI-29", "AI-ARI", "Aritmética", "29", "8", "Números simples y compuestos I", "OK", "Boletín 8 impreso"],
  ["AI-ARI-30", "AI-ARI", "Aritmética", "30", "8", "Números simples y compuestos II", "OK", "Boletín 8 impreso"],
  ["AI-ARI-31", "AI-ARI", "Aritmética", "31", "8", "MCD y MCM I", "OK", "Boletín 8 impreso"],
  ["AI-ARI-32", "AI-ARI", "Aritmética", "32", "8", "MCD y MCM II", "OK", "Boletín 8 impreso"],
  ["AI-GEOM-01", "AI-GEOM", "Geometría", "1", "1", "Segmentos y Triángulo rectángulo", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-02", "AI-GEOM", "Geometría", "2", "1", "Ángulos", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-03", "AI-GEOM", "Geometría", "3", "1", "Posiciones relativas entre dos rectas", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-04", "AI-GEOM", "Geometría", "4", "1", "Triángulos I", "OK", "Boletín 1 impreso"],
  ["AI-GEOM-05", "AI-GEOM", "Geometría", "5", "2", "Triángulos II", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-06", "AI-GEOM", "Geometría", "6", "2", "Triángulos III", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-07", "AI-GEOM", "Geometría", "7", "2", "Congruencia de triángulos", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-08", "AI-GEOM", "Geometría", "8", "2", "Aplicaciones de la congruencia I", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-09", "AI-GEOM", "Geometría", "9", "3", "Aplicaciones de la congruencia II", "OK", "Boletín 3 impreso"],
  ["AI-GEOM-10", "AI-GEOM", "Geometría", "10", "3", "Cuadriláteros I", "OK", "Boletín 3 impreso"],
  ["AI-GEOM-11", "AI-GEOM", "Geometría", "11", "3", "Cuadriláteros II", "OK", "Boletín 3 impreso"],
  ["AI-GEOM-12", "AI-GEOM", "Geometría", "12", "3", "Cuadriláteros III", "OK", "Boletín 3 impreso"],
  ["AI-GEOM-13", "AI-GEOM", "Geometría", "13", "4", "Circunferencia II", "OK", "Boletín 4 impreso"],
  ["AI-GEOM-14", "AI-GEOM", "Geometría", "14", "4", "Circunferencia III", "OK", "Boletín 4 impreso"],
  ["AI-GEOM-15", "AI-GEOM", "Geometría", "15", "4", "Figuras inscritas y circunscritas", "OK", "Boletín 4 impreso"],
  ["AI-GEOM-16", "AI-GEOM", "Geometría", "16", "4", "Puntos notables I", "OK", "Boletín 4 impreso"],
  ["AI-GEOM-17", "AI-GEOM", "Geometría", "17", "5", "Puntos notables II", "OK", "Boletín 5 impreso"],
  ["AI-GEOM-18", "AI-GEOM", "Geometría", "18", "5", "Proporcionalidad de segmentos", "OK", "Boletín 5 impreso"],
  ["AI-GEOM-19", "AI-GEOM", "Geometría", "19", "5", "Semejanza de triángulos", "OK", "Boletín 5 impreso"],
  ["AI-GEOM-20", "AI-GEOM", "Geometría", "20", "5", "Relaciones métricas en la circunferencia", "OK", "Boletín 5 impreso"],
  ["AI-GEOM-21", "AI-GEOM", "Geometría", "21", "6", "Relaciones métricas en el triángulo rectángulo", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-22", "AI-GEOM", "Geometría", "22", "6", "Relaciones métricas en triángulos oblicuángulos", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-23", "AI-GEOM", "Geometría", "23", "6", "Áreas de regiones triangulares", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-24", "AI-GEOM", "Geometría", "24", "6", "Razón de áreas de regiones triangulares", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-25", "AI-GEOM", "Geometría", "25", "7", "Áreas de regiones cuadrangulares", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-26", "AI-GEOM", "Geometría", "26", "7", "Razón de áreas de regiones cuadrangulares", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-27", "AI-GEOM", "Geometría", "27", "7", "Áreas de regiones circulares", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-28", "AI-GEOM", "Geometría", "28", "7", "Geometría del espacio I", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOM-29", "AI-GEOM", "Geometría", "29", "8", "Geometría del espacio II", "OK", "Boletín 8 impreso"],
  ["AI-GEOM-30", "AI-GEOM", "Geometría", "30", "8", "Prisma", "OK", "Boletín 8 impreso"],
  ["AI-GEOM-31", "AI-GEOM", "Geometría", "31", "8", "Cilindro", "OK", "Boletín 8 impreso"],
  ["AI-GEOM-32", "AI-GEOM", "Geometría", "32", "8", "Pirámide", "OK", "Boletín 8 impreso"],
  ["AI-TRI-01", "AI-TRI", "Trigonometría", "1", "1", "Introducción a la trigonometría", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-02", "AI-TRI", "Trigonometría", "2", "1", "Sistemas de medidas angulares", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-03", "AI-TRI", "Trigonometría", "3", "1", "Conversión entre los sistemas de medidas angulares", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-04", "AI-TRI", "Trigonometría", "4", "1", "Longitud de arco", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-05", "AI-TRI", "Trigonometría", "5", "2", "Área de un sector circular", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-06", "AI-TRI", "Trigonometría", "6", "2", "Razones trigonométricas de un ángulo agudo en el triángulo rectángulo", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-07", "AI-TRI", "Trigonometría", "7", "2", "Razones trigonométricas de ángulos agudos notables", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-08", "AI-TRI", "Trigonometría", "8", "2", "Propiedades de las razones trigonométricas", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-09", "AI-TRI", "Trigonometría", "9", "3", "Resolución de triángulos rectángulos I", "OK", "Boletín 3 impreso"],
  ["AI-TRI-10", "AI-TRI", "Trigonometría", "10", "3", "Resolución de triángulos rectángulos II", "OK", "Boletín 3 impreso"],
  ["AI-TRI-11", "AI-TRI", "Trigonometría", "11", "3", "Ángulos verticales", "OK", "Boletín 3 impreso"],
  ["AI-TRI-12", "AI-TRI", "Trigonometría", "12", "3", "Introducción a la geometría analítica", "OK", "Boletín 3 impreso"],
  ["AI-TRI-13", "AI-TRI", "Trigonometría", "13", "4", "Ángulos en posición normal I", "OK", "Boletín 4 impreso"],
  ["AI-TRI-14", "AI-TRI", "Trigonometría", "14", "4", "Ángulos en posición normal II", "OK", "Boletín 4 impreso"],
  ["AI-TRI-15", "AI-TRI", "Trigonometría", "15", "4", "Ángulos en posición normal III", "OK", "Boletín 4 impreso"],
  ["AI-TRI-16", "AI-TRI", "Trigonometría", "16", "4", "Identidades trigonométricas fundamentales I", "OK", "Boletín 4 impreso"],
  ["AI-TRI-17", "AI-TRI", "Trigonometría", "17", "5", "Identidades fundamentales II", "OK", "Boletín 5 impreso"],
  ["AI-TRI-18", "AI-TRI", "Trigonometría", "18", "5", "Identidades fundamentales III", "OK", "Boletín 5 impreso"],
  ["AI-TRI-19", "AI-TRI", "Trigonometría", "19", "5", "Identidades de ángulos compuestos I", "OK", "Boletín 5 impreso"],
  ["AI-TRI-20", "AI-TRI", "Trigonometría", "20", "5", "Identidades de ángulos compuestos II", "OK", "Boletín 5 impreso"],
  ["AI-TRI-21", "AI-TRI", "Trigonometría", "21", "6", "Identidades de ángulos compuestos III", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-22", "AI-TRI", "Trigonometría", "22", "6", "Identidades de ángulos compuestos IV", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-23", "AI-TRI", "Trigonometría", "23", "6", "Reducción al primer cuadrante I", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-24", "AI-TRI", "Trigonometría", "24", "6", "Reducción al primer cuadrante II", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-25", "AI-TRI", "Trigonometría", "25", "7", "Identidades del ángulo doble I", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-26", "AI-TRI", "Trigonometría", "26", "7", "Identidades del ángulo doble II", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-27", "AI-TRI", "Trigonometría", "27", "7", "Identidades del ángulo doble III", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-28", "AI-TRI", "Trigonometría", "28", "7", "Transformaciones trigonométricas I", "OK", "Temario Excel (BOL7)"],
  ["AI-TRI-29", "AI-TRI", "Trigonometría", "29", "8", "Transformaciones trigonométricas II", "OK", "Boletín 8 impreso"],
  ["AI-TRI-30", "AI-TRI", "Trigonometría", "30", "8", "Triángulos oblicuángulos I", "OK", "Boletín 8 impreso"],
  ["AI-TRI-31", "AI-TRI", "Trigonometría", "31", "8", "Triángulos oblicuángulos II", "OK", "Boletín 8 impreso"],
  ["AI-TRI-32", "AI-TRI", "Trigonometría", "32", "8", "Circunferencia trigonométrica I", "OK", "Boletín 8 impreso"],
  ["AI-RM-01", "AI-RM", "Razonamiento Matemático", "1", "1", "Habilidad operativa", "OK", "Boletín 1 impreso"],
  ["AI-RM-02", "AI-RM", "Razonamiento Matemático", "2", "1", "Elementos recreativos", "OK", "Boletín 1 impreso"],
  ["AI-RM-03", "AI-RM", "Razonamiento Matemático", "3", "1", "Situaciones lógicas I", "OK", "Boletín 1 impreso"],
  ["AI-RM-04", "AI-RM", "Razonamiento Matemático", "4", "1", "Situaciones lógicas II", "OK", "Boletín 1 impreso"],
  ["AI-RM-05", "AI-RM", "Razonamiento Matemático", "5", "2", "Situaciones lógicas III", "OK", "Boletín 2 impreso"],
  ["AI-RM-06", "AI-RM", "Razonamiento Matemático", "6", "2", "Situaciones lógicas IV", "OK", "Boletín 2 impreso"],
  ["AI-RM-07", "AI-RM", "Razonamiento Matemático", "7", "2", "Lazos familiares", "OK", "Boletín 2 impreso"],
  ["AI-RM-08", "AI-RM", "Razonamiento Matemático", "8", "2", "Ordenamiento de información I", "OK", "Boletín 2 impreso"],
  ["AI-RM-09", "AI-RM", "Razonamiento Matemático", "9", "3", "Ordenamiento de información II", "OK", "Boletín 3 impreso"],
  ["AI-RM-10", "AI-RM", "Razonamiento Matemático", "10", "3", "Lógica proposicional", "OK", "Boletín 3 impreso"],
  ["AI-RM-11", "AI-RM", "Razonamiento Matemático", "11", "3", "Deducción simple y deducción compuesta", "OK", "Boletín 3 impreso"],
  ["AI-RM-12", "AI-RM", "Razonamiento Matemático", "12", "3", "Lógica de clases", "OK", "Boletín 3 impreso"],
  ["AI-RM-13", "AI-RM", "Razonamiento Matemático", "13", "4", "Verdades y mentiras", "OK", "Boletín 4 impreso"],
  ["AI-RM-14", "AI-RM", "Razonamiento Matemático", "14", "4", "Problemas sobre certezas", "OK", "Boletín 4 impreso"],
  ["AI-RM-15", "AI-RM", "Razonamiento Matemático", "15", "4", "Arreglos numéricos I", "OK", "Boletín 4 impreso"],
  ["AI-RM-16", "AI-RM", "Razonamiento Matemático", "16", "4", "Arreglos numéricos II", "OK", "Boletín 4 impreso"],
  ["AI-RM-17", "AI-RM", "Razonamiento Matemático", "17", "5", "Arreglos numéricos III", "OK", "Boletín 5 impreso"],
  ["AI-RM-18", "AI-RM", "Razonamiento Matemático", "18", "5", "Calendarios I", "OK", "Boletín 5 impreso"],
  ["AI-RM-19", "AI-RM", "Razonamiento Matemático", "19", "5", "Calendarios II", "OK", "Boletín 5 impreso"],
  ["AI-RM-20", "AI-RM", "Razonamiento Matemático", "20", "5", "Inductivo numérico y geométrico", "OK", "Boletín 5 impreso"],
  ["AI-RM-21", "AI-RM", "Razonamiento Matemático", "21", "6", "Inductivo verbal", "OK", "Temario Excel (BOL7)"],
  ["AI-RM-22", "AI-RM", "Razonamiento Matemático", "22", "6", "Rutas y trayectorias", "OK", "Temario Excel (BOL7)"],
  ["AI-RM-23", "AI-RM", "Razonamiento Matemático", "23", "6", "Trazos de figuras", "OK", "Temario Excel (BOL7)"],
  ["AI-RM-24", "AI-RM", "Razonamiento Matemático", "24", "6", "Planteo de ecuaciones I", "OK", "Temario Excel (BOL7)"],
  ["AI-RM-25", "AI-RM", "Razonamiento Matemático", "25", "7", "Planteo de ecuaciones II", "OK", "Boletín 7 impreso"],
  ["AI-RM-26", "AI-RM", "Razonamiento Matemático", "26", "7", "Planteo de ecuaciones III", "OK", "Boletín 7 impreso"],
  ["AI-RM-27", "AI-RM", "Razonamiento Matemático", "27", "7", "Cronometría I", "OK", "Boletín 7 impreso"],
  ["AI-RM-28", "AI-RM", "Razonamiento Matemático", "28", "7", "Cronometría II", "OK", "Boletín 7 impreso"],
  ["AI-RM-29", "AI-RM", "Razonamiento Matemático", "29", "8", "Cronometría III", "OK", "Boletín 8 impreso"],
  ["AI-RM-30", "AI-RM", "Razonamiento Matemático", "30", "8", "Frecuencia de sucesos", "OK", "Boletín 8 impreso"],
  ["AI-RM-31", "AI-RM", "Razonamiento Matemático", "31", "8", "Conteo de figuras y semejanza de figuras", "OK", "Boletín 8 impreso"],
  ["AI-RM-32", "AI-RM", "Razonamiento Matemático", "32", "8", "Áreas y perímetros de regiones planas", "OK", "Boletín 8 impreso"],
  ["AI-RV-01", "AI-RV", "Razonamiento Verbal", "1", "1", "Introducción al curso de Habilidad Verbal", "OK", "Boletín 1 impreso"],
  ["AI-RV-02", "AI-RV", "Razonamiento Verbal", "2", "1", "Naturaleza de la comprensión lectora", "OK", "Boletín 1 impreso"],
  ["AI-RV-03", "AI-RV", "Razonamiento Verbal", "3", "1", "Coherencia y jerarquía textual", "OK", "Boletín 1 impreso"],
  ["AI-RV-04", "AI-RV", "Razonamiento Verbal", "4", "1", "Cohesión textual I", "OK", "Boletín 1 impreso"],
  ["AI-RV-05", "AI-RV", "Razonamiento Verbal", "5", "2", "Cohesión textual II", "OK", "Boletín 2 impreso"],
  ["AI-RV-06", "AI-RV", "Razonamiento Verbal", "6", "2", "Primer taller de lectura", "OK", "Boletín 2 impreso"],
  ["AI-RV-07", "AI-RV", "Razonamiento Verbal", "7", "2", "Primera práctica de reforzamiento", "OK", "Boletín 2 impreso"],
  ["AI-RV-08", "AI-RV", "Razonamiento Verbal", "8", "2", "Método de lectura láser", "OK", "Boletín 2 impreso"],
  ["AI-RV-09", "AI-RV", "Razonamiento Verbal", "9", "3", "Técnicas de lectura I", "OK", "Boletín 3 impreso"],
  ["AI-RV-10", "AI-RV", "Razonamiento Verbal", "10", "3", "Técnicas de lectura II", "OK", "Boletín 3 impreso"],
  ["AI-RV-11", "AI-RV", "Razonamiento Verbal", "11", "3", "Segundo taller de lectura", "OK", "Boletín 3 impreso"],
  ["AI-RV-12", "AI-RV", "Razonamiento Verbal", "12", "3", "Segunda práctica de reforzamiento", "OK", "Boletín 3 impreso"],
  ["AI-RV-13", "AI-RV", "Razonamiento Verbal", "13", "4", "Niveles de comprensión lectora", "OK", "Boletín 4 impreso"],
  ["AI-RV-14", "AI-RV", "Razonamiento Verbal", "14", "4", "Preguntas de sentido contextual", "OK", "Boletín 4 impreso"],
  ["AI-RV-15", "AI-RV", "Razonamiento Verbal", "15", "4", "Preguntas de jerarquía textual", "OK", "Boletín 4 impreso"],
  ["AI-RV-16", "AI-RV", "Razonamiento Verbal", "16", "4", "Tercer taller de lectura", "OK", "Boletín 4 impreso"],
  ["AI-RV-17", "AI-RV", "Razonamiento Verbal", "17", "5", "Tercera práctica de reforzamiento", "OK", "Boletín 5 impreso"],
  ["AI-RV-18", "AI-RV", "Razonamiento Verbal", "18", "5", "Niveles de comprensión lectora (II)", "OK", "Boletín 5 impreso"],
  ["AI-RV-19", "AI-RV", "Razonamiento Verbal", "19", "5", "Preguntas de inferencia", "OK", "Boletín 5 impreso"],
  ["AI-RV-20", "AI-RV", "Razonamiento Verbal", "20", "5", "Preguntas de extrapolación", "OK", "Boletín 5 impreso"],
  ["AI-RV-21", "AI-RV", "Razonamiento Verbal", "21", "6", "Cuarto taller de lectura", "OK", "Temario Excel (BOL7)"],
  ["AI-RV-22", "AI-RV", "Razonamiento Verbal", "22", "6", "Textos expositivos", "OK", "Temario Excel (BOL7)"],
  ["AI-RV-23", "AI-RV", "Razonamiento Verbal", "23", "6", "Textos discontinuos", "OK", "Temario Excel (BOL7)"],
  ["AI-RV-24", "AI-RV", "Razonamiento Verbal", "24", "6", "Textos con gráfico", "OK", "Temario Excel (BOL7)"],
  ["AI-RV-25", "AI-RV", "Razonamiento Verbal", "25", "7", "Textos argumentativos", "OK", "Boletín 7 impreso"],
  ["AI-RV-26", "AI-RV", "Razonamiento Verbal", "26", "7", "Textos dialécticos", "OK", "Boletín 7 impreso"],
  ["AI-RV-27", "AI-RV", "Razonamiento Verbal", "27", "7", "Quinto taller de lectura", "OK", "Boletín 7 impreso"],
  ["AI-RV-28", "AI-RV", "Razonamiento Verbal", "28", "7", "Textos según su estructura jerárquica", "OK", "Boletín 7 impreso"],
  ["AI-RV-29", "AI-RV", "Razonamiento Verbal", "29", "8", "Intención comunicativa y contexto", "OK", "Boletín 8 impreso"],
  ["AI-RV-30", "AI-RV", "Razonamiento Verbal", "30", "8", "Textos literarios", "OK", "Boletín 8 impreso"],
  ["AI-RV-31", "AI-RV", "Razonamiento Verbal", "31", "8", "Textos científicos", "OK", "Boletín 8 impreso"],
  ["AI-RV-32", "AI-RV", "Razonamiento Verbal", "32", "8", "Textos filosóficos", "OK", "Boletín 8 impreso"],
  ["AI-FIS-01", "AI-FIS", "Física", "1", "1", "Análisis dimensional", "OK", "Boletín 1 impreso"],
  ["AI-FIS-02", "AI-FIS", "Física", "2", "1", "Análisis Vectorial I", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-03", "AI-FIS", "Física", "3", "1", "Análisis Vectorial II", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-04", "AI-FIS", "Física", "4", "1", "Cinemática I", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-05", "AI-FIS", "Física", "5", "2", "Cinemática II", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-06", "AI-FIS", "Física", "6", "2", "Cinemática III", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-07", "AI-FIS", "Física", "7", "2", "Cinemática IV", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-08", "AI-FIS", "Física", "8", "2", "Cinemática V", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-09", "AI-FIS", "Física", "9", "3", "Estática I", "OK", "Boletín 3 impreso"],
  ["AI-FIS-10", "AI-FIS", "Física", "10", "3", "Estática II", "OK", "Boletín 3 impreso"],
  ["AI-FIS-11", "AI-FIS", "Física", "11", "3", "Estática III", "OK", "Boletín 3 impreso"],
  ["AI-FIS-12", "AI-FIS", "Física", "12", "3", "Estática IV", "OK", "Boletín 3 impreso"],
  ["AI-FIS-13", "AI-FIS", "Física", "13", "4", "Dinámica I", "OK", "Boletín 4 impreso"],
  ["AI-FIS-14", "AI-FIS", "Física", "14", "4", "Dinámica II", "OK", "Boletín 4 impreso"],
  ["AI-FIS-15", "AI-FIS", "Física", "15", "4", "Trabajo mecánico", "OK", "Boletín 4 impreso"],
  ["AI-FIS-16", "AI-FIS", "Física", "16", "4", "Energía mecánica I", "OK", "Boletín 4 impreso"],
  ["AI-FIS-17", "AI-FIS", "Física", "17", "5", "Energía mecánica II: Potencia mecánica", "OK", "Boletín 5 impreso"],
  ["AI-FIS-18", "AI-FIS", "Física", "18", "5", "Cantidad de movimiento e impulso I", "OK", "Boletín 5 impreso"],
  ["AI-FIS-19", "AI-FIS", "Física", "19", "5", "Cantidad de movimiento e impulso II", "OK", "Boletín 5 impreso"],
  ["AI-FIS-20", "AI-FIS", "Física", "20", "5", "Movimiento Armónico Simple (MAS)", "OK", "Boletín 5 impreso"],
  ["AI-FIS-21", "AI-FIS", "Física", "21", "6", "Oscilaciones II", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-22", "AI-FIS", "Física", "22", "6", "Ondas mecánicas I", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-23", "AI-FIS", "Física", "23", "6", "Ondas mecánicas II", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-24", "AI-FIS", "Física", "24", "6", "Hidrostática I", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-25", "AI-FIS", "Física", "25", "7", "Hidrostática II", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-26", "AI-FIS", "Física", "26", "7", "Fenómenos térmicos I", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-27", "AI-FIS", "Física", "27", "7", "Fenómenos térmicos II", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-28", "AI-FIS", "Física", "28", "7", "Electrostática I", "OK", "Temario Excel (BOL7)"],
  ["AI-FIS-29", "AI-FIS", "Física", "29", "8", "Electrostática II", "OK", "Boletín 8 impreso"],
  ["AI-FIS-30", "AI-FIS", "Física", "30", "8", "Electrostática III", "OK", "Boletín 8 impreso"],
  ["AI-FIS-31", "AI-FIS", "Física", "31", "8", "Electrostática IV", "OK", "Boletín 8 impreso"],
  ["AI-FIS-32", "AI-FIS", "Física", "32", "8", "Electrodinámica I", "OK", "Boletín 8 impreso"],
  ["AI-QUI-01", "AI-QUI", "Química", "1", "1", "Introducción a la Química", "OK", "Boletín 1 impreso"],
  ["AI-QUI-02", "AI-QUI", "Química", "2", "1", "Materia", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-03", "AI-QUI", "Química", "3", "1", "Estructura atómica I", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-04", "AI-QUI", "Química", "4", "1", "Estructura atómica II", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-05", "AI-QUI", "Química", "5", "2", "Estructura electrónica del átomo", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-06", "AI-QUI", "Química", "6", "2", "Configuración electrónica", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-07", "AI-QUI", "Química", "7", "2", "Tabla periódica moderna", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-08", "AI-QUI", "Química", "8", "2", "Propiedades periódicas atómicas", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-09", "AI-QUI", "Química", "9", "3", "Enlace químico I", "OK", "Boletín 3 impreso"],
  ["AI-QUI-10", "AI-QUI", "Química", "10", "3", "Enlace químico II", "OK", "Boletín 3 impreso"],
  ["AI-QUI-11", "AI-QUI", "Química", "11", "3", "Geometría molecular", "OK", "Boletín 3 impreso"],
  ["AI-QUI-12", "AI-QUI", "Química", "12", "3", "Fuerzas intermoleculares", "OK", "Boletín 3 impreso"],
  ["AI-QUI-13", "AI-QUI", "Química", "13", "4", "Nomenclatura inorgánica I", "OK", "Boletín 4 impreso"],
  ["AI-QUI-14", "AI-QUI", "Química", "14", "4", "Nomenclatura inorgánica II", "OK", "Boletín 4 impreso"],
  ["AI-QUI-15", "AI-QUI", "Química", "15", "4", "Nomenclatura inorgánica III", "OK", "Boletín 4 impreso"],
  ["AI-QUI-16", "AI-QUI", "Química", "16", "4", "Cálculos en química I", "OK", "Boletín 4 impreso"],
  ["AI-QUI-17", "AI-QUI", "Química", "17", "5", "Cálculos en química II", "OK", "Boletín 5 impreso"],
  ["AI-QUI-18", "AI-QUI", "Química", "18", "5", "Gases I", "OK", "Boletín 5 impreso"],
  ["AI-QUI-19", "AI-QUI", "Química", "19", "5", "Gases II", "OK", "Boletín 5 impreso"],
  ["AI-QUI-20", "AI-QUI", "Química", "20", "5", "Estado líquido", "OK", "Boletín 5 impreso"],
  ["AI-QUI-21", "AI-QUI", "Química", "21", "6", "Reacciones químicas I", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-22", "AI-QUI", "Química", "22", "6", "Reacciones químicas II", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-23", "AI-QUI", "Química", "23", "6", "Estequiometría I", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-24", "AI-QUI", "Química", "24", "6", "Estequiometría II", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-25", "AI-QUI", "Química", "25", "7", "Peso equivalente", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-26", "AI-QUI", "Química", "26", "7", "Soluciones I", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-27", "AI-QUI", "Química", "27", "7", "Soluciones II", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-28", "AI-QUI", "Química", "28", "7", "Soluciones III", "OK", "Temario Excel (BOL7)"],
  ["AI-QUI-29", "AI-QUI", "Química", "29", "8", "Cinética química", "OK", "Boletín 8 impreso"],
  ["AI-QUI-30", "AI-QUI", "Química", "30", "8", "Equilibrio químico", "OK", "Boletín 8 impreso"],
  ["AI-QUI-31", "AI-QUI", "Química", "31", "8", "Ácidos y bases I", "OK", "Boletín 8 impreso"],
  ["AI-QUI-32", "AI-QUI", "Química", "32", "8", "Ácidos y bases II", "OK", "Boletín 8 impreso"],
  ["AI-BIO-01", "AI-BIO", "Biología", "1", "1", "Ser Vivo y método científico", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-02", "AI-BIO", "Biología", "2", "1", "Bioquímica I: Glúcidos y lípidos", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-03", "AI-BIO", "Biología", "3", "1", "Bioquímica II: Proteínas", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-04", "AI-BIO", "Biología", "4", "1", "Bioquímica III: Ácidos nucleicos", "OK", "Boletín 1 impreso"],
  ["AI-BIO-05", "AI-BIO", "Biología", "5", "2", "Citología I: Teoría celular, pared celular y membrana plasmática", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-06", "AI-BIO", "Biología", "6", "2", "Citología II: citoplasma", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-07", "AI-BIO", "Biología", "7", "2", "Metabolismo celular eucariota I: fotosíntesis", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-08", "AI-BIO", "Biología", "8", "2", "Metabolismo celular eucariota II: respiración celular", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-09", "AI-BIO", "Biología", "9", "3", "Replicación del ADN y expresión génica", "OK", "Boletín 3 impreso"],
  ["AI-BIO-10", "AI-BIO", "Biología", "10", "3", "Ciclo celular eucariota: Mitosis", "OK", "Boletín 3 impreso"],
  ["AI-BIO-11", "AI-BIO", "Biología", "11", "3", "Ciclo celular eucariota: Meiosis", "OK", "Boletín 3 impreso"],
  ["AI-BIO-12", "AI-BIO", "Biología", "12", "3", "Genética I: Genética mendeliana", "OK", "Boletín 3 impreso"],
  ["AI-BIO-13", "AI-BIO", "Biología", "13", "4", "Genética II: Herencia sanguínea y herencia ligada al sexo", "OK", "Boletín 4 impreso"],
  ["AI-BIO-14", "AI-BIO", "Biología", "14", "4", "Citogenética y Bioética", "OK", "Boletín 4 impreso"],
  ["AI-BIO-15", "AI-BIO", "Biología", "15", "4", "Evolución I", "OK", "Boletín 4 impreso"],
  ["AI-BIO-16", "AI-BIO", "Biología", "16", "4", "Evolución II", "OK", "Boletín 4 impreso"],
  ["AI-BIO-17", "AI-BIO", "Biología", "17", "5", "Virus", "OK", "Boletín 5 impreso"],
  ["AI-BIO-18", "AI-BIO", "Biología", "18", "5", "Bacterias", "OK", "Boletín 5 impreso"],
  ["AI-BIO-19", "AI-BIO", "Biología", "19", "5", "Plantas I: Taxonomía", "OK", "Boletín 5 impreso"],
  ["AI-BIO-20", "AI-BIO", "Biología", "20", "5", "Plantas II: Organografía e histología vegetal", "OK", "Boletín 5 impreso"],
  ["AI-BIO-21", "AI-BIO", "Biología", "21", "6", "Plantas III: Reproducción vegetal y Coordinación química vegetal", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-22", "AI-BIO", "Biología", "22", "6", "Animales I: Taxonomía", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-23", "AI-BIO", "Biología", "23", "6", "Animales II: Sistema digestivo animal", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-24", "AI-BIO", "Biología", "24", "6", "Animales III: Circulación animal", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-25", "AI-BIO", "Biología", "25", "7", "Animales IV: Respiración y Excreción animal", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-26", "AI-BIO", "Biología", "26", "7", "Histología humana I", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-27", "AI-BIO", "Biología", "27", "7", "Histología humana II", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-28", "AI-BIO", "Biología", "28", "7", "Histología humana III", "OK", "Temario Excel (BOL7)"],
  ["AI-BIO-29", "AI-BIO", "Biología", "29", "8", "Sistema digestivo humano", "OK", "Boletín 8 impreso"],
  ["AI-BIO-30", "AI-BIO", "Biología", "30", "8", "Sistema cardiovascular humano", "OK", "Boletín 8 impreso"],
  ["AI-BIO-31", "AI-BIO", "Biología", "31", "8", "Sistema respiratorio y excretor humano", "OK", "Boletín 8 impreso"],
  ["AI-BIO-32", "AI-BIO", "Biología", "32", "8", "Sistema nervioso humano", "OK", "Boletín 8 impreso"],
  ["AI-LEN-01", "AI-LEN", "Lenguaje", "1", "1", "La comunicación", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-02", "AI-LEN", "Lenguaje", "2", "1", "El lenguaje", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-03", "AI-LEN", "Lenguaje", "3", "1", "Los planos del lenguaje", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-04", "AI-LEN", "Lenguaje", "4", "1", "La realidad lingüística del Perú", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-05", "AI-LEN", "Lenguaje", "5", "2", "El signo y el signo lingüístico", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-06", "AI-LEN", "Lenguaje", "6", "2", "La semántica", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-07", "AI-LEN", "Lenguaje", "7", "2", "Las relaciones semánticas", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-08", "AI-LEN", "Lenguaje", "8", "2", "La fonología", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-09", "AI-LEN", "Lenguaje", "9", "3", "La fonética", "OK", "Boletín 3 impreso"],
  ["AI-LEN-10", "AI-LEN", "Lenguaje", "10", "3", "Tema 10 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-LEN-11", "AI-LEN", "Lenguaje", "11", "3", "Tema 11 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-LEN-12", "AI-LEN", "Lenguaje", "12", "3", "Tema 12 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-LEN-13", "AI-LEN", "Lenguaje", "13", "4", "Uso de las mayúsculas I", "OK", "Boletín 4 impreso"],
  ["AI-LEN-14", "AI-LEN", "Lenguaje", "14", "4", "Uso de las mayúsculas II", "OK", "Boletín 4 impreso"],
  ["AI-LEN-15", "AI-LEN", "Lenguaje", "15", "4", "Los signos de puntuación I", "OK", "Boletín 4 impreso"],
  ["AI-LEN-16", "AI-LEN", "Lenguaje", "16", "4", "Los signos de puntuación II", "OK", "Boletín 4 impreso"],
  ["AI-LEN-17", "AI-LEN", "Lenguaje", "17", "5", "La morfología", "OK", "Boletín 5 impreso"],
  ["AI-LEN-18", "AI-LEN", "Lenguaje", "18", "5", "Los procesos formativos de palabras", "OK", "Boletín 5 impreso"],
  ["AI-LEN-19", "AI-LEN", "Lenguaje", "19", "5", "El sustantivo", "OK", "Boletín 5 impreso"],
  ["AI-LEN-20", "AI-LEN", "Lenguaje", "20", "5", "Los accidentes del sustantivo", "OK", "Boletín 5 impreso"],
  ["AI-LEN-21", "AI-LEN", "Lenguaje", "21", "6", "El adjetivo", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-22", "AI-LEN", "Lenguaje", "22", "6", "Los determinantes", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-23", "AI-LEN", "Lenguaje", "23", "6", "El pronombre", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-24", "AI-LEN", "Lenguaje", "24", "6", "El verbo: accidentes gramaticales", "OK", "Temario Excel (BOL7)"],
  ["AI-LEN-25", "AI-LEN", "Lenguaje", "25", "7", "Tema 25 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-LEN-26", "AI-LEN", "Lenguaje", "26", "7", "Tema 26 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-LEN-27", "AI-LEN", "Lenguaje", "27", "7", "Tema 27 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-LEN-28", "AI-LEN", "Lenguaje", "28", "7", "Tema 28 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-LEN-29", "AI-LEN", "Lenguaje", "29", "8", "La preposición", "OK", "Boletín 8 impreso"],
  ["AI-LEN-30", "AI-LEN", "Lenguaje", "30", "8", "La conjunción", "OK", "Boletín 8 impreso"],
  ["AI-LEN-31", "AI-LEN", "Lenguaje", "31", "8", "La sintaxis", "OK", "Boletín 8 impreso"],
  ["AI-LEN-32", "AI-LEN", "Lenguaje", "32", "8", "El sujeto", "OK", "Boletín 8 impreso"],
  ["AI-ING-01", "AI-ING", "Inglés", "1", "1", "Greetings and Introductions", "OK", "Boletín 1 impreso"],
  ["AI-ING-02", "AI-ING", "Inglés", "2", "1", "Pronouns", "OK", "Boletín 1 impreso"],
  ["AI-ING-03", "AI-ING", "Inglés", "3", "1", "Present simple of be", "OK", "Boletín 1 impreso"],
  ["AI-ING-04", "AI-ING", "Inglés", "4", "1", "Present simple I", "OK", "Boletín 1 impreso"],
  ["AI-ING-05", "AI-ING", "Inglés", "5", "2", "Present Simple II", "OK", "Temario Excel (BOL7)"],
  ["AI-ING-06", "AI-ING", "Inglés", "6", "2", "Present Continuous", "OK", "Temario Excel (BOL7)"],
  ["AI-ING-07", "AI-ING", "Inglés", "7", "2", "Present Continuos and Present Simple", "OK", "Temario Excel (BOL7)"],
  ["AI-ING-08", "AI-ING", "Inglés", "8", "2", "Past Simple I", "OK", "Temario Excel (BOL7)"],
  ["AI-ING-09", "AI-ING", "Inglés", "9", "3", "Tema 9 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-10", "AI-ING", "Inglés", "10", "3", "Tema 10 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-11", "AI-ING", "Inglés", "11", "3", "Tema 11 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-12", "AI-ING", "Inglés", "12", "3", "Tema 12 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-13", "AI-ING", "Inglés", "13", "4", "Past Simple II", "OK", "Boletín 4 impreso"],
  ["AI-ING-14", "AI-ING", "Inglés", "14", "4", "Past Simple III", "OK", "Boletín 4 impreso"],
  ["AI-ING-15", "AI-ING", "Inglés", "15", "4", "Past Simple IV", "OK", "Boletín 4 impreso"],
  ["AI-ING-16", "AI-ING", "Inglés", "16", "4", "Present Perfect I", "OK", "Boletín 4 impreso"],
  ["AI-ING-17", "AI-ING", "Inglés", "17", "5", "Future Simple I", "OK", "Boletín 5 impreso"],
  ["AI-ING-18", "AI-ING", "Inglés", "18", "5", "Future II", "OK", "Boletín 5 impreso"],
  ["AI-ING-19", "AI-ING", "Inglés", "19", "5", "Review: Verb Tenses", "OK", "Boletín 5 impreso"],
  ["AI-ING-20", "AI-ING", "Inglés", "20", "5", "Prepositions", "OK", "Boletín 5 impreso"],
  ["AI-ING-21", "AI-ING", "Inglés", "21", "6", "Tema 21 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-22", "AI-ING", "Inglés", "22", "6", "Tema 22 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-23", "AI-ING", "Inglés", "23", "6", "Tema 23 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-24", "AI-ING", "Inglés", "24", "6", "Tema 24 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-25", "AI-ING", "Inglés", "25", "7", "Tema 25 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-26", "AI-ING", "Inglés", "26", "7", "Tema 26 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-27", "AI-ING", "Inglés", "27", "7", "Tema 27 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-28", "AI-ING", "Inglés", "28", "7", "Tema 28 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ING-29", "AI-ING", "Inglés", "29", "8", "Modal Verbs II", "OK", "Boletín 8 impreso"],
  ["AI-ING-30", "AI-ING", "Inglés", "30", "8", "Past Perfect", "OK", "Boletín 8 impreso"],
  ["AI-ING-31", "AI-ING", "Inglés", "31", "8", "Relative Clauses I", "OK", "Boletín 8 impreso"],
  ["AI-ING-32", "AI-ING", "Inglés", "32", "8", "Relative Clauses II", "OK", "Boletín 8 impreso"],
  ["AI-HIS-01", "AI-HIS", "Historia", "1", "1", "La Historia y su periodización", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-02", "AI-HIS", "Historia", "2", "1", "Comunidad primitiva en el mundo", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-03", "AI-HIS", "Historia", "3", "1", "Comunidad primitiva en el Perú", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-04", "AI-HIS", "Historia", "4", "1", "Mesopotamia", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-05", "AI-HIS", "Historia", "5", "2", "Formativo", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-06", "AI-HIS", "Historia", "6", "2", "Primer Desarrollo Regional", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-07", "AI-HIS", "Historia", "7", "2", "Grecia", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-08", "AI-HIS", "Historia", "8", "2", "Roma", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-09", "AI-HIS", "Historia", "9", "3", "Wari (Horizonte Medio)", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-HIS-10", "AI-HIS", "Historia", "10", "3", "Edad Media", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-HIS-11", "AI-HIS", "Historia", "11", "3", "Tema 11 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-HIS-12", "AI-HIS", "Historia", "12", "3", "Tema 12 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-HIS-13", "AI-HIS", "Historia", "13", "4", "Incas I", "OK", "Boletín 4 impreso"],
  ["AI-HIS-14", "AI-HIS", "Historia", "14", "4", "Incas II", "OK", "Boletín 4 impreso"],
  ["AI-HIS-15", "AI-HIS", "Historia", "15", "4", "Invasión a América", "OK", "Boletín 4 impreso"],
  ["AI-HIS-16", "AI-HIS", "Historia", "16", "4", "Reforma y Contrarreforma", "OK", "Boletín 4 impreso"],
  ["AI-HIS-17", "AI-HIS", "Historia", "17", "5", "Virreinato I", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-18", "AI-HIS", "Historia", "18", "5", "Virreinato II", "OK", "Boletín 5 impreso"],
  ["AI-HIS-19", "AI-HIS", "Historia", "19", "5", "Primera Revolución Industrial", "OK", "Boletín 5 impreso"],
  ["AI-HIS-20", "AI-HIS", "Historia", "20", "5", "Revolución francesa I", "OK", "Boletín 5 impreso"],
  ["AI-HIS-21", "AI-HIS", "Historia", "21", "6", "Revolución francesa II, Restauración absolutista", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-22", "AI-HIS", "Historia", "22", "6", "Juntas de gobierno y Rebeliones criollas", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-23", "AI-HIS", "Historia", "23", "6", "Corrientes libertadoras", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-24", "AI-HIS", "Historia", "24", "6", "Primer militarismo: República temprana", "OK", "Temario Excel (BOL7)"],
  ["AI-HIS-25", "AI-HIS", "Historia", "25", "7", "Tema 25 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-HIS-26", "AI-HIS", "Historia", "26", "7", "Tema 26 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-HIS-27", "AI-HIS", "Historia", "27", "7", "Tema 27 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-HIS-28", "AI-HIS", "Historia", "28", "7", "Tema 28 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-HIS-29", "AI-HIS", "Historia", "29", "8", "República Aristocrática", "OK", "Boletín 8 impreso"],
  ["AI-HIS-30", "AI-HIS", "Historia", "30", "8", "Primera Guerra Mundial", "OK", "Boletín 8 impreso"],
  ["AI-HIS-31", "AI-HIS", "Historia", "31", "8", "Revolución rusa", "OK", "Boletín 8 impreso"],
  ["AI-HIS-32", "AI-HIS", "Historia", "32", "8", "Oncenio y Tercer Militarismo", "OK", "Boletín 8 impreso"],
  ["AI-GEOG-01", "AI-GEOG", "Geografía", "1", "1", "Ciencia geográfica", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-02", "AI-GEOG", "Geografía", "2", "1", "Movimiento de rotación terrestre", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-03", "AI-GEOG", "Geografía", "3", "1", "Hora internacional", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-04", "AI-GEOG", "Geografía", "4", "1", "Movimiento de traslación terrestre", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-05", "AI-GEOG", "Geografía", "5", "2", "Geodesia", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-06", "AI-GEOG", "Geografía", "6", "2", "Cartografía I", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-07", "AI-GEOG", "Geografía", "7", "2", "Cartografía II", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-08", "AI-GEOG", "Geografía", "8", "2", "Atmósfera", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-09", "AI-GEOG", "Geografía", "9", "3", "Calentamiento global", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-GEOG-10", "AI-GEOG", "Geografía", "10", "3", "Tiempo atmosférico y clima", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-GEOG-11", "AI-GEOG", "Geografía", "11", "3", "Presión atmosférica", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-GEOG-12", "AI-GEOG", "Geografía", "12", "3", "Práctica dirigida", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-GEOG-13", "AI-GEOG", "Geografía", "13", "4", "Clima del Perú I", "OK", "Boletín 4 impreso"],
  ["AI-GEOG-14", "AI-GEOG", "Geografía", "14", "4", "Clima del Perú II", "OK", "Boletín 4 impreso"],
  ["AI-GEOG-15", "AI-GEOG", "Geografía", "15", "4", "Clima del Perú III", "OK", "Boletín 4 impreso"],
  ["AI-GEOG-16", "AI-GEOG", "Geografía", "16", "4", "Geósfera", "OK", "Boletín 4 impreso"],
  ["AI-GEOG-17", "AI-GEOG", "Geografía", "17", "5", "Geodinámica interna", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-18", "AI-GEOG", "Geografía", "18", "5", "Geodinámica externa", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-19", "AI-GEOG", "Geografía", "19", "5", "Relieve costero", "OK", "Boletín 5 impreso"],
  ["AI-GEOG-20", "AI-GEOG", "Geografía", "20", "5", "Relieve andino I", "OK", "Boletín 5 impreso"],
  ["AI-GEOG-21", "AI-GEOG", "Geografía", "21", "6", "Relieve andino II", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-22", "AI-GEOG", "Geografía", "22", "6", "Relieve amazónico", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-23", "AI-GEOG", "Geografía", "23", "6", "Ecosistemas del Perú: 8 regiones", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-24", "AI-GEOG", "Geografía", "24", "6", "Recursos naturales y su problemática", "OK", "Temario Excel (BOL7)"],
  ["AI-GEOG-25", "AI-GEOG", "Geografía", "25", "7", "Tema 25 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-GEOG-26", "AI-GEOG", "Geografía", "26", "7", "Tema 26 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-GEOG-27", "AI-GEOG", "Geografía", "27", "7", "Tema 27 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-GEOG-28", "AI-GEOG", "Geografía", "28", "7", "Tema 28 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-GEOG-29", "AI-GEOG", "Geografía", "29", "8", "Vertiente hidrográfica del Amazonas", "OK", "Boletín 8 impreso"],
  ["AI-GEOG-30", "AI-GEOG", "Geografía", "30", "8", "Mar peruano", "OK", "Boletín 8 impreso"],
  ["AI-GEOG-31", "AI-GEOG", "Geografía", "31", "8", "Fenómeno de El Niño", "OK", "Boletín 8 impreso"],
  ["AI-GEOG-32", "AI-GEOG", "Geografía", "32", "8", "Actividades económicas I", "OK", "Boletín 8 impreso"],
  ["AI-ECO-01", "AI-ECO", "Economía", "1", "1", "Ciencia económica y principios básicos", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-02", "AI-ECO", "Economía", "2", "1", "División de la economía", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-03", "AI-ECO", "Economía", "3", "1", "Necesidades, Ingreso familiar y Pobreza", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-04", "AI-ECO", "Economía", "4", "1", "Bienes servicios", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-05", "AI-ECO", "Economía", "5", "2", "Proceso económico y Sectores productivos", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-06", "AI-ECO", "Economía", "6", "2", "Teoría de la producción", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-07", "AI-ECO", "Economía", "7", "2", "Costos de producción y Frontera de posibilidades de producción", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-08", "AI-ECO", "Economía", "8", "2", "Naturaleza y Capital", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-09", "AI-ECO", "Economía", "9", "3", "Factores productivos: el trabajo y el empleo", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-ECO-10", "AI-ECO", "Economía", "10", "3", "Empresa y ciclo de vida del producto", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-ECO-11", "AI-ECO", "Economía", "11", "3", "Emprendimiento", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-ECO-12", "AI-ECO", "Economía", "12", "3", "Estructuras de mercado", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-ECO-13", "AI-ECO", "Economía", "13", "4", "Teoría de la demanda I", "OK", "Boletín 4 impreso"],
  ["AI-ECO-14", "AI-ECO", "Economía", "14", "4", "Teoría de la demanda II", "OK", "Boletín 4 impreso"],
  ["AI-ECO-15", "AI-ECO", "Economía", "15", "4", "La oferta", "OK", "Boletín 4 impreso"],
  ["AI-ECO-16", "AI-ECO", "Economía", "16", "4", "Equilibrio de mercado", "OK", "Boletín 4 impreso"],
  ["AI-ECO-17", "AI-ECO", "Economía", "17", "5", "Dinero", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-18", "AI-ECO", "Economía", "18", "5", "Inflación", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-19", "AI-ECO", "Economía", "19", "5", "Sistema financiero", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-20", "AI-ECO", "Economía", "20", "5", "Sistema bancario", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-21", "AI-ECO", "Economía", "21", "6", "Sector público", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-22", "AI-ECO", "Economía", "22", "6", "Consumidores, productores y eficiencia de los mercados", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-23", "AI-ECO", "Economía", "23", "6", "Sistema tributario", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-24", "AI-ECO", "Economía", "24", "6", "Economía Informal", "OK", "Temario Excel (BOL7)"],
  ["AI-ECO-25", "AI-ECO", "Economía", "25", "7", "Tema 25 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ECO-26", "AI-ECO", "Economía", "26", "7", "Tema 26 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ECO-27", "AI-ECO", "Economía", "27", "7", "Tema 27 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ECO-28", "AI-ECO", "Economía", "28", "7", "Tema 28 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-ECO-29", "AI-ECO", "Economía", "29", "8", "Agregados e indicadores económicos", "OK", "Boletín 8 impreso"],
  ["AI-ECO-30", "AI-ECO", "Economía", "30", "8", "Ciclos económicos, consumo, distribución e inversión", "OK", "Boletín 8 impreso"],
  ["AI-ECO-31", "AI-ECO", "Economía", "31", "8", "Normas y Constitución Política", "OK", "Boletín 8 impreso"],
  ["AI-ECO-32", "AI-ECO", "Economía", "32", "8", "Derechos", "OK", "Boletín 8 impreso"],
  ["AI-FIL-01", "AI-FIL", "Filosofía", "1", "1", "Conceptos básicos", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-02", "AI-FIL", "Filosofía", "2", "1", "Disciplinas filosóficas I", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-03", "AI-FIL", "Filosofía", "3", "1", "Disciplinas filosóficas II", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-04", "AI-FIL", "Filosofía", "4", "1", "Mito y filosofía", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-05", "AI-FIL", "Filosofía", "5", "2", "Filosofía antigua I: periodo cosmológico", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-06", "AI-FIL", "Filosofía", "6", "2", "Filosofía antigua II: periodo antropológico", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-07", "AI-FIL", "Filosofía", "7", "2", "Filosofía antigua III: periodo ontológico - Platón", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-08", "AI-FIL", "Filosofía", "8", "2", "Filosofía antigua IV: periodo ontológico - Aristóteles", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-09", "AI-FIL", "Filosofía", "9", "3", "Filosofía helenística (cinismo, estoicismo, epicureísmo)", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-FIL-10", "AI-FIL", "Filosofía", "10", "3", "Filosofía medieval: Patrística", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-FIL-11", "AI-FIL", "Filosofía", "11", "3", "Filosofía medieval: Escolástica", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-FIL-12", "AI-FIL", "Filosofía", "12", "3", "Filosofía renacentista: Humanismo", "POR CONFIRMAR", "Deducido del contenido del boletín 3"],
  ["AI-FIL-13", "AI-FIL", "Filosofía", "13", "4", "Filosofía moderna I: Racionalismo", "OK", "Boletín 4 impreso"],
  ["AI-FIL-14", "AI-FIL", "Filosofía", "14", "4", "Filosofía moderna II: Empirismo", "OK", "Boletín 4 impreso"],
  ["AI-FIL-15", "AI-FIL", "Filosofía", "15", "4", "Ilustración", "OK", "Boletín 4 impreso"],
  ["AI-FIL-16", "AI-FIL", "Filosofía", "16", "4", "Criticismo", "OK", "Boletín 4 impreso"],
  ["AI-FIL-17", "AI-FIL", "Filosofía", "17", "5", "El idealismo alemán", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-18", "AI-FIL", "Filosofía", "18", "5", "Marxismo", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-19", "AI-FIL", "Filosofía", "19", "5", "Voluntarismo", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-20", "AI-FIL", "Filosofía", "20", "5", "Existencialismo", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-21", "AI-FIL", "Filosofía", "21", "6", "Filosofía analítica", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-22", "AI-FIL", "Filosofía", "22", "6", "Teorías del reconocimiento", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-23", "AI-FIL", "Filosofía", "23", "6", "Filosofía en el Perú I", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-24", "AI-FIL", "Filosofía", "24", "6", "Filosofía en el Perú II", "OK", "Temario Excel (BOL7)"],
  ["AI-FIL-25", "AI-FIL", "Filosofía", "25", "7", "Tema 25 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-FIL-26", "AI-FIL", "Filosofía", "26", "7", "Tema 26 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-FIL-27", "AI-FIL", "Filosofía", "27", "7", "Tema 27 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-FIL-28", "AI-FIL", "Filosofía", "28", "7", "Tema 28 (por completar)", "POR CONFIRMAR", "Sin fuente"],
  ["AI-FIL-29", "AI-FIL", "Filosofía", "29", "8", "Epistemología II: teorías epistemológicas", "OK", "Boletín 8 impreso"],
  ["AI-FIL-30", "AI-FIL", "Filosofía", "30", "8", "Axiología: el valor", "OK", "Boletín 8 impreso"],
  ["AI-FIL-31", "AI-FIL", "Filosofía", "31", "8", "La moral I", "OK", "Boletín 8 impreso"],
  ["AI-FIL-32", "AI-FIL", "Filosofía", "32", "8", "Ética II: teorías éticas", "OK", "Boletín 8 impreso"]
];

var SEED_CALENDARIO = [
  ["2026-03-02", "2026-03-07", "CLASE", "1", "1", "1", "Inicio de clases 04/03 (clase introductoria)"],
  ["2026-03-09", "2026-03-14", "CLASE", "2", "1", "1", ""],
  ["2026-03-16", "2026-03-21", "CLASE", "3", "1", "1", ""],
  ["2026-03-23", "2026-03-28", "CLASE", "4", "1", "1", ""],
  ["2026-03-30", "2026-04-04", "CLASE", "5", "2", "1", "Jue 02 y vie 03: Semana Santa (feriado)"],
  ["2026-04-06", "2026-04-11", "EXAMEN", "", "", "1", "Exámenes mensuales"],
  ["2026-04-13", "2026-04-18", "CLASE", "6", "2", "1", ""],
  ["2026-04-20", "2026-04-25", "CLASE", "7", "2", "1", ""],
  ["2026-04-27", "2026-05-02", "CLASE", "8", "2", "1", "Vie 01/05: Día del Trabajo (feriado)"],
  ["2026-05-04", "2026-05-09", "CLASE", "9", "3", "1", "Vie 08/05: Simulacro"],
  ["2026-05-11", "2026-05-16", "EXAMEN", "", "", "1", "Exámenes bimestrales (horario reducido)"],
  ["2026-05-18", "2026-05-23", "VACACIONES", "", "", "1", "Vacaciones"],
  ["2026-05-25", "2026-05-30", "CLASE", "10", "3", "2", ""],
  ["2026-06-01", "2026-06-06", "CLASE", "11", "3", "2", ""],
  ["2026-06-08", "2026-06-13", "CLASE", "12", "3", "2", ""],
  ["2026-06-15", "2026-06-20", "EXAMEN", "", "", "2", "Exámenes mensuales"],
  ["2026-06-22", "2026-06-27", "CLASE", "13", "4", "2", ""],
  ["2026-06-29", "2026-07-04", "CLASE", "14", "4", "2", "Lun 29/06: San Pedro y San Pablo (feriado)"],
  ["2026-07-06", "2026-07-11", "CLASE", "15", "4", "2", "Lun 06/07: Día del Maestro · Vie 10/07: Simulacro"],
  ["2026-07-13", "2026-07-18", "CLASE", "16", "4", "2", ""],
  ["2026-07-20", "2026-07-25", "EXAMEN", "", "", "2", "Exámenes bimestrales (sáb. 25/07 recupera jue. 23/07)"],
  ["2026-07-27", "2026-08-01", "VACACIONES", "", "", "2", "Vacaciones (27 jul – 04 ago)"],
  ["2026-08-03", "2026-08-08", "CLASE", "17", "5", "3", "Clases 05–07 ago · Jue 06/08: Batalla de Junín (feriado)"],
  ["2026-08-10", "2026-08-15", "CLASE", "18", "5", "3", ""],
  ["2026-08-17", "2026-08-22", "CLASE", "19", "5", "3", ""],
  ["2026-08-24", "2026-08-29", "CLASE", "20", "5", "3", ""],
  ["2026-08-31", "2026-09-05", "EXAMEN", "", "", "3", "Exámenes mensuales"],
  ["2026-09-07", "2026-09-12", "CLASE", "21", "6", "3", ""],
  ["2026-09-14", "2026-09-19", "CLASE", "22", "6", "3", ""],
  ["2026-09-21", "2026-09-26", "CLASE", "23", "6", "3", "Mié 23/09: Día del Estudiante"],
  ["2026-09-28", "2026-10-03", "CLASE", "24", "6", "3", "Vie 02/10: Simulacro"],
  ["2026-10-05", "2026-10-10", "EXAMEN", "", "", "3", "Exámenes bimestrales (sáb. 10/10 recupera jue. 08/10)"],
  ["2026-10-12", "2026-10-17", "VACACIONES", "", "", "3", "Vacaciones"],
  ["2026-10-19", "2026-10-24", "CLASE", "25", "7", "4", ""],
  ["2026-10-26", "2026-10-31", "CLASE", "26", "7", "4", ""],
  ["2026-11-02", "2026-11-07", "CLASE", "27", "7", "4", ""],
  ["2026-11-09", "2026-11-14", "CLASE", "28", "7", "4", ""],
  ["2026-11-16", "2026-11-21", "EXAMEN", "", "", "4", "Exámenes mensuales"],
  ["2026-11-23", "2026-11-28", "CLASE", "29", "8", "4", "Semana de Aniversario"],
  ["2026-11-30", "2026-12-05", "CLASE", "30", "8", "4", ""],
  ["2026-12-07", "2026-12-12", "CLASE", "31", "8", "4", "Mar 08 y mié 09: feriados · Vie 11/12: Simulacro"],
  ["2026-12-14", "2026-12-19", "CLASE", "32", "8", "4", "Clases 14–16 dic; exámenes bimestrales desde el 17/12"],
  ["2026-12-21", "2026-12-26", "CIERRE", "", "", "4", "Exámenes bimestrales (17–22 dic) y clausura 22/12"]
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
  REPORTE: 'Reporte mensual',
  CURSOS: 'Cursos',
  TEMARIO: 'Temario',
  CALENDARIO: 'Calendario',
  LECCIONARIO: 'Leccionario'
};

// Esquemas: [clave interna, encabezado visible, formato texto?]
var ESQUEMAS = {
  Config: [['clave', 'Clave', true], ['valor', 'Valor', true], ['descripcion', 'Descripción', true]],
  Docentes: [['dni', 'DNI', true], ['docente', 'Docente (igual que en Horario)', true], ['nombreCompleto', 'Nombre completo', true],
    ['especialidad', 'Especialidad', true], ['celular', 'Celular', true], ['correo', 'Correo', true], ['activo', 'Activo (SI/NO)', true],
    ['notas', 'Notas', true]],
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
    ['horas', 'Horas dictadas', false]],
  Cursos: [['id', 'ID curso', true], ['salon', 'Salón', true], ['curso', 'Curso', true], ['area', 'Área', true],
    ['alias', 'Nombre(s) en el horario (separados por |)', true], ['total', 'Total temas', true],
    ['avanceInicial', 'Avance inicial (temas completados antes del sistema)', true], ['activo', 'Activo (SI/NO)', true]],
  Temario: [['id', 'ID tema', true], ['cursoId', 'ID curso', true], ['curso', 'Curso', true], ['n', 'N.º tema', true],
    ['boletin', 'Boletín', true], ['tema', 'Tema', true], ['estadoDato', 'Estado del dato', true], ['fuente', 'Fuente', true]],
  Calendario: [['inicio', 'Semana (lunes)', true], ['fin', 'Hasta (sábado)', true], ['tipo', 'Tipo (CLASE/EXAMEN/VACACIONES/CIERRE)', true],
    ['nSemana', 'N.º semana de clase', true], ['boletin', 'Boletín', true], ['bimestre', 'Bimestre', true], ['descripcion', 'Descripción', true]],
  Leccionario: [['id', 'ID', true], ['fecha', 'Fecha', true], ['mes', 'Mes', true], ['marcacion', 'Marcación', true],
    ['cursoId', 'ID curso', true], ['curso', 'Curso', true], ['salon', 'Salón', true], ['docente', 'Docente', true], ['dni', 'DNI', true],
    ['n', 'N.º tema', true], ['temaId', 'ID tema', true], ['tema', 'Tema', true], ['tipo', 'Tipo de avance', true],
    ['observacion', 'Observación', true], ['bloques', 'Bloques', true], ['registradoPor', 'Registrado por', true],
    ['estado', 'Estado (REGISTRADO/VALIDADO/CORREGIDO)', true], ['revision', 'Revisión de coordinación', true], ['registrado', 'Registrado', true]]
};

var CONFIG_DEFAULT = [
  ['SEDE', 'Monte Azul', 'Nombre de la sede'],
  ['TOLERANCIA_MIN', '5', 'Minutos de tolerancia para considerar puntual'],
  ['PIN_PANEL', '91515', 'PIN para entrar al panel de coordinación'],
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
  if (!doc.activo) return { ok: false, error: 'El docente está inactivo. Comunícate con coordinación.' };
  return infoDocente_(doc);
}

/** Identificador que se guarda en las marcaciones: DNI, o celular, o el nombre si no tiene ninguno. */
function idDocente_(doc) { return doc.dni || doc.celular || ('SIN-ID ' + doc.docente); }

/** Situación del docente hoy: sus bloques, los de otros (para reemplazos) y su marcación abierta. */
function infoDocente_(doc) {
  var dni = idDocente_(doc);
  var fecha = hoy_(), dia = diaDeFecha(fecha);
  var todos = bloquesDelDia(horario_(), dia);
  var propios = todos.filter(function (b) { return norm(b.docente) === norm(doc.docente); });
  var otros = todos.filter(function (b) { return norm(b.docente) !== norm(doc.docente); });
  var marc = marcacionesDe_(fecha);
  var esMia = function (m) { return m.dni === dni || norm(m.docente) === norm(doc.docente); };
  var mias = marc.filter(esMia);
  var abierta = mias.filter(function (m) { return !m.fin; })[0] || null;

  // Bloques ya tomados por otros docentes hoy (para no duplicar reemplazos)
  var tomados = {};
  marc.forEach(function (m) {
    if (esMia(m)) return;
    m.bloques.concat(m.reemplazos).forEach(function (id) { tomados[id] = m.docente; });
  });

  return {
    ok: true, dni: dni, docente: doc.docente, especialidad: doc.especialidad,
    fecha: fecha, dia: dia, hora: ahora_(),
    propios: propios, otros: otros.map(function (b) { b.tomadoPor = tomados[b.id] || ''; return b; }),
    abierta: abierta, cerradasHoy: mias.filter(function (m) { return m.fin; }).length
  };
}

/** Igual que buscarDocente, pero agrega las clases de hoy que quedaron sin tema registrado. */
function buscarDocenteConTemas(texto) {
  var info = buscarDocente(texto);
  if (!info.ok) return info;
  try { info.pendientesTema = pendientesHoyDe_(info); } catch (e) { info.pendientesTema = []; }
  return info;
}

function marcarIngreso(p) {
  var info = buscarDocente(p.dni);
  if (!info.ok) return info;
  return conLock_(function () { return registrarIngreso_(buscarDocente(p.dni), p, ahora_(), p.dispositivo || ''); });
}

function marcarSalida(p) {
  var info = buscarDocente(p.dni);
  if (!info.ok) return info;
  return conLock_(function () { return registrarSalida_(buscarDocente(p.dni), p, ahora_()); });
}

function conLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function registrarIngreso_(info, p, hora, dispositivo) {
  if (info.abierta) return { ok: false, error: info.docente + ' ya tiene un ingreso abierto desde las ' + info.abierta.inicio + '. Corresponde marcar la salida.' };
  var c = config_();
  if (norm(c.PERMITIR_CELULAR) === 'no' && dispositivo === 'Celular') {
    return { ok: false, error: 'La marcación desde celular está deshabilitada. Usa la computadora del colegio.' };
  }
  var ids = (p.bloques || []).concat(p.reemplazos || []);
  if (!ids.length && !p.obs) return { ok: false, error: 'Selecciona al menos un salón o indica una observación.' };
  if (p.obs === 'Otro' && !String(p.obsDetalle || '').trim()) return { ok: false, error: 'Escribe el detalle de la observación.' };

  var todos = info.propios.concat(info.otros);
  var sel = todos.filter(function (b) { return ids.indexOf(b.id) >= 0; });
  var ev = evaluarIngreso(hora, sel, Number(c.TOLERANCIA_MIN));
  var id = 'M' + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') + String(info.dni).replace(/\D/g, '').slice(-3);
  agregar_(HOJAS.MARCACIONES, {
    id: id, fecha: info.fecha, dni: info.dni, docente: info.docente, inicio: hora, fin: '',
    estado: ev.estado, minTarde: ev.minTarde, bloques: p.bloques || [], reemplazos: p.reemplazos || [],
    obs: p.obs || '', obsDetalle: p.obsDetalle || '', dispositivo: dispositivo, registrado: sello_()
  });
  return { ok: true, tipo: 'INGRESO', hora: hora, docente: info.docente, estado: ev.estado, minTarde: ev.minTarde, referencia: ev.referencia, clases: sel };
}

function registrarSalida_(info, p, hora) {
  var m = info.abierta;
  if (!m) return { ok: false, error: info.docente + ' no tiene un ingreso abierto hoy.' };
  if (toMin(hora) <= toMin(m.inicio)) return { ok: false, error: 'La hora de salida debe ser posterior al ingreso (' + m.inicio + ').' };
  if (p.obs === 'Otro' && !String(p.obsDetalle || '').trim()) return { ok: false, error: 'Escribe el detalle de la observación.' };

  var propios = p.bloques || m.bloques;
  var reemp = p.reemplazos || m.reemplazos;
  var todos = info.propios.concat(info.otros);
  var porId = {};
  todos.forEach(function (b) { porId[b.id] = b; });
  var sel = propios.concat(reemp).map(function (id) { return porId[id]; }).filter(Boolean);
  var h = calcularHoras(m.inicio, hora, sel);

  var obs = [m.obs, p.obs].filter(String).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' | ');
  var det = [m.obsDetalle, p.obsDetalle].filter(String).join(' | ');
  var disp = m.dispositivo + (p.porCoordinacion && m.dispositivo.indexOf('Coordinación') < 0 ? ' / salida: Coordinación' : '');
  var sh = hoja_(HOJAS.MARCACIONES);
  var fila = filaDe_(HOJAS.MARCACIONES, {
    id: m.id, fecha: m.fecha, dni: m.dni, docente: m.docente, inicio: m.inicio, fin: hora,
    estado: m.estado, minTarde: m.minTarde, bloques: propios, reemplazos: reemp, obs: obs, obsDetalle: det,
    dispositivo: disp, horasMarcadas: h.marcadas, horasEfectivas: h.efectivas,
    horasProgramadas: h.programadas, registrado: m.registrado + ' / salida ' + sello_()
  });
  sh.getRange(m._fila, 1, 1, fila.length).setValues([fila]);

  var shC = hoja_(HOJAS.CLASES);
  var filas = sel.map(function (b) {
    var d = h.detalle.filter(function (x) { return x.id === b.id; })[0];
    return filaDe_(HOJAS.CLASES, {
      fecha: m.fecha, mes: m.fecha.slice(0, 7), marcacion: m.id, bloque: b.id, salon: b.salon, curso: b.curso,
      titular: b.docente, docente: m.docente, dni: m.dni, tipo: reemp.indexOf(b.id) >= 0 ? 'REEMPLAZO' : 'TITULAR',
      inicio: b.inicio, fin: b.fin, horas: d ? d.horas : 0
    });
  });
  if (filas.length) shC.getRange(shC.getLastRow() + 1, 1, filas.length, filas[0].length).setValues(filas);

  var temas = [];
  try { temas = temasPendientes_(m.id, sel, m.docente); } catch (e) { Logger.log('temasPendientes_: ' + e); }
  return { ok: true, tipo: 'SALIDA', hora: hora, inicio: m.inicio, docente: m.docente, horas: h, clases: sel, marcacion: m.id, temas: temas };
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

/* ============================ API: Marcación por coordinación ============================ */

function docentePorNombre_(nombre) {
  var d = docentes_().filter(function (x) { return norm(x.docente) === norm(nombre); })[0];
  if (!d) throw new Error('No se encontró al docente "' + nombre + '".');
  return d;
}

/** Lista de docentes activos con su situación de hoy, para marcar desde coordinación. */
function coordListaDocentes(pin) {
  validarPin_(pin);
  var fecha = hoy_(), dia = diaDeFecha(fecha);
  var bloques = bloquesDelDia(horario_(), dia);
  var marc = marcacionesDe_(fecha);
  var lista = docentes_().filter(function (d) { return d.activo; }).map(function (d) {
    var propios = bloques.filter(function (b) { return norm(b.docente) === norm(d.docente); });
    var mias = marc.filter(function (m) { return m.dni === idDocente_(d) || norm(m.docente) === norm(d.docente); });
    var abierta = mias.filter(function (m) { return !m.fin; })[0];
    var ultima = mias[mias.length - 1];
    return {
      docente: d.docente, nombreCompleto: d.nombreCompleto, especialidad: d.especialidad,
      clasesHoy: propios.length, desde: propios.length ? propios[0].inicio : '', salones: propios.map(function (b) { return b.salon; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; }),
      estado: abierta ? 'EN EL COLEGIO' : ultima ? 'SALIÓ' : 'SIN MARCAR',
      inicio: abierta ? abierta.inicio : ultima ? ultima.inicio : '', fin: !abierta && ultima ? ultima.fin : ''
    };
  });
  lista.sort(function (a, b) {
    if (!!a.clasesHoy !== !!b.clasesHoy) return a.clasesHoy ? -1 : 1;
    return (toMin(a.desde) || 0) - (toMin(b.desde) || 0) || a.docente.localeCompare(b.docente);
  });
  return { fecha: fecha, dia: dia, hora: ahora_(), docentes: lista };
}

function coordBuscar(pin, nombre) {
  validarPin_(pin);
  return infoDocente_(docentePorNombre_(nombre));
}

/**
 * Coordinación marca ingreso o salida de un docente. p = {docente, hora?, bloques, reemplazos, obs, obsDetalle}
 * La hora puede corregirse (ej. el docente llegó 7:55 y se registra después), pero no puede ser futura.
 */
function coordMarcar(pin, p) {
  validarPin_(pin);
  var doc = docentePorNombre_(p.docente);
  var ahora = ahora_();
  var hora = p.hora ? fmtMin(toMin(p.hora)) : ahora;
  if (!hora || toMin(hora) === null) return { ok: false, error: 'La hora no es válida (usa HH:mm).' };
  if (toMin(hora) > toMin(ahora) + 1) return { ok: false, error: 'No se puede registrar una hora futura (ahora son las ' + ahora + ').' };
  return conLock_(function () {
    var info = infoDocente_(doc);
    if (info.abierta) {
      p.porCoordinacion = true;
      return registrarSalida_(info, p, hora);
    }
    var r = registrarIngreso_(info, p, hora, 'Coordinación');
    return r;
  });
}

/* ============================ API: Horario (ver / editar) ============================ */

function getHorarioAdmin(pin) {
  validarPin_(pin);
  var bloques = horario_().map(function (b) { delete b._fila; return b; });
  var salones = [];
  bloques.forEach(function (b) { if (salones.indexOf(b.salon) < 0) salones.push(b.salon); });
  return {
    bloques: bloques, salones: salones,
    docentes: docentes_().filter(function (d) { return d.activo; }).map(function (d) { return d.docente; }).sort()
  };
}

function guardarBloque(pin, b) {
  validarPin_(pin);
  return conLock_(function () {
    var horario = horario_();
    var limpio = {
      id: b.id || '', salon: String(b.salon || '').trim().toUpperCase(), dia: norm(b.dia).toUpperCase(),
      inicio: fmtMin(toMin(b.inicio)), fin: fmtMin(toMin(b.fin)), curso: String(b.curso || '').trim().toUpperCase(),
      docente: String(b.docente || '').trim(), nota: String(b.nota || '').trim()
    };
    var v = validarBloque(limpio, horario);
    if (v.errores.length) return { ok: false, error: v.errores.join(' ') };
    if (limpio.docente) {
      var existe = docentes_().some(function (d) { return norm(d.docente) === norm(limpio.docente); });
      if (!existe) return { ok: false, error: 'El docente "' + limpio.docente + '" no está en la hoja Docentes.' };
    }
    var sh = hoja_(HOJAS.HORARIO);
    var actual = limpio.id ? horario.filter(function (h) { return h.id === limpio.id; })[0] : null;
    if (actual) {
      // Al editar se conserva el ID (las marcaciones pasadas lo referencian).
      sh.getRange(actual._fila, 1, 1, ESQUEMAS.Horario.length).setValues([filaDe_(HOJAS.HORARIO, limpio)]);
    } else {
      limpio.id = nuevoIdBloque(limpio.salon, limpio.dia, horario);
      agregar_(HOJAS.HORARIO, limpio);
    }
    return { ok: true, bloque: limpio, avisos: v.avisos, nuevo: !actual };
  });
}

function eliminarBloque(pin, id) {
  validarPin_(pin);
  return conLock_(function () {
    var b = horario_().filter(function (h) { return h.id === id; })[0];
    if (!b) return { ok: false, error: 'El bloque ya no existe.' };
    hoja_(HOJAS.HORARIO).deleteRow(b._fila);
    return { ok: true };
  });
}

/* ============================ API: Docentes (agregar / editar / activar) ============================ */

function getDocentesAdmin(pin) {
  validarPin_(pin);
  var horario = horario_();
  var lista = docentes_().map(function (d) {
    var bl = horario.filter(function (b) { return norm(b.docente) === norm(d.docente); });
    var horas = bl.reduce(function (s, b) { return s + (toMin(b.fin) - toMin(b.inicio)) / 60; }, 0);
    var salones = bl.map(function (b) { return b.salon; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    return {
      dni: d.dni, docente: d.docente, nombreCompleto: d.nombreCompleto, especialidad: d.especialidad, celular: d.celular,
      correo: d.correo, activo: d.activo, notas: d.notas, bloques: bl.length, horasSemana: Math.round(horas * 100) / 100, salones: salones
    };
  });
  lista.sort(function (a, b) { return (b.activo - a.activo) || a.docente.localeCompare(b.docente); });
  return { docentes: lista };
}

/**
 * Agrega o edita un docente. Si cambia el nombre corto, también se actualiza en el Horario
 * (las marcaciones pasadas conservan el nombre con que se registraron).
 */
function guardarDocente(pin, d, nombreAnterior) {
  validarPin_(pin);
  return conLock_(function () {
    var lista = docentes_();
    var v = validarDocente(d, lista, nombreAnterior || '');
    if (v.errores.length) return { ok: false, error: v.errores.join(' ') };
    var fila = {
      dni: v.dni, docente: v.docente, nombreCompleto: String(d.nombreCompleto || '').trim(), especialidad: String(d.especialidad || '').trim(),
      celular: v.celular, correo: String(d.correo || '').trim(), activo: d.activo === false || d.activo === 'NO' ? 'NO' : 'SI', notas: String(d.notas || '').trim()
    };
    var sh = hoja_(HOJAS.DOCENTES), renombrados = 0;
    var actual = nombreAnterior ? lista.filter(function (x) { return norm(x.docente) === norm(nombreAnterior); })[0] : null;
    if (nombreAnterior && !actual) return { ok: false, error: 'No se encontró al docente "' + nombreAnterior + '".' };
    if (actual) {
      sh.getRange(actual._fila, 1, 1, ESQUEMAS.Docentes.length).setValues([filaDe_(HOJAS.DOCENTES, fila)]);
      if (norm(nombreAnterior) !== norm(fila.docente)) {
        var shH = hoja_(HOJAS.HORARIO), n = shH.getLastRow() - 1;
        if (n > 0) {
          var rango = shH.getRange(2, 7, n, 1), vals = rango.getDisplayValues();
          vals.forEach(function (r) { if (norm(r[0]) === norm(nombreAnterior)) { r[0] = fila.docente; renombrados++; } });
          if (renombrados) rango.setValues(vals);
        }
      }
    } else {
      agregar_(HOJAS.DOCENTES, fila);
    }
    return { ok: true, docente: fila, nuevo: !actual, renombrados: renombrados };
  });
}

function cambiarActivoDocente(pin, nombre, activo) {
  validarPin_(pin);
  return conLock_(function () {
    var d = docentes_().filter(function (x) { return norm(x.docente) === norm(nombre); })[0];
    if (!d) return { ok: false, error: 'No se encontró al docente.' };
    var col = ESQUEMAS.Docentes.map(function (c) { return c[0]; }).indexOf('activo') + 1;
    hoja_(HOJAS.DOCENTES).getRange(d._fila, col).setValue(activo ? 'SI' : 'NO');
    return { ok: true, activo: !!activo };
  });
}

/* ============================ Control académico ============================ */

function cursos_() {
  return leer_(HOJAS.CURSOS).filter(function (c) { return c.id && norm(c.activo) !== 'no'; })
    .map(function (c) { c.total = Number(c.total) || 32; c.avanceInicial = Number(c.avanceInicial) || 0; return c; });
}
function temario_() {
  return leer_(HOJAS.TEMARIO).filter(function (t) { return t.id; }).map(function (t) { t.n = Number(t.n); return t; });
}
function calendario_() {
  return leer_(HOJAS.CALENDARIO).filter(function (c) { return c.inicio; }).map(function (c) { c.tipo = String(c.tipo).toUpperCase(); return c; });
}
function leccionario_() {
  return leer_(HOJAS.LECCIONARIO).filter(function (r) { return r.id; }).map(function (r) { r.n = Number(r.n); return r; });
}

/** Avance completo de un curso (con semáforo frente al calendario). */
function avanceDe_(curso, temario, lecc, esperado) {
  var regs = lecc.filter(function (r) { return r.cursoId === curso.id; });
  var a = avanceCurso(curso.total, curso.avanceInicial, regs);
  var sem = semaforoAtraso(a.ultimoContinuo, Math.min(esperado.completados, curso.total));
  var temas = temario.filter(function (t) { return t.cursoId === curso.id; });
  var titulo = function (n) { var t = temas.filter(function (x) { return x.n === n; })[0]; return t ? t.tema : ''; };
  var ult = regs.slice().sort(function (x, y) { return String(y.fecha + y.registrado).localeCompare(String(x.fecha + x.registrado)); })[0];
  return {
    id: curso.id, curso: curso.curso, area: curso.area, salon: curso.salon, total: curso.total, avanceInicial: curso.avanceInicial,
    completados: a.completados, parciales: a.parciales, ultimoContinuo: a.ultimoContinuo, siguiente: a.siguiente, sugerido: a.sugerido,
    cobertura: a.cobertura, totalCompletados: a.totalCompletados, atraso: sem.atraso, semaforo: sem.semaforo,
    ultimoTema: a.ultimoContinuo ? { n: a.ultimoContinuo, tema: titulo(a.ultimoContinuo) } : null,
    siguienteTema: a.siguiente ? { n: a.siguiente, tema: titulo(a.siguiente) } : null,
    porConfirmar: temas.filter(function (t) { return t.estadoDato !== 'OK'; }).length,
    ultimoRegistro: ult ? { fecha: ult.fecha, n: ult.n, tipo: ult.tipo, docente: ult.docente } : null
  };
}

/** Para una marcación: cursos con temario dictados en sus clases y que aún no tienen tema registrado. */
function temasPendientes_(marcacionId, clases, docente) {
  var cursos = cursos_();
  if (!cursos.length) return [];
  var lecc = leccionario_(), temario = temario_();
  var esperado = temaEsperado(calendario_(), hoy_());
  var grupos = {};
  (clases || []).forEach(function (b) {
    var c = cursoDeBloque(b, cursos);
    if (!c) return;
    if (!grupos[c.id]) grupos[c.id] = { curso: c, bloques: [] };
    grupos[c.id].bloques.push(b.id);
  });
  return Object.keys(grupos).filter(function (id) {
    return !lecc.some(function (r) { return r.marcacion === marcacionId && r.cursoId === id; });
  }).map(function (id) {
    var c = grupos[id].curso, av = avanceDe_(c, temario, lecc, esperado);
    return {
      cursoId: c.id, curso: c.curso, salon: c.salon, bloques: grupos[id].bloques, marcacion: marcacionId, sugerido: av.sugerido,
      esperado: esperado.enCurso, temas: temario.filter(function (t) { return t.cursoId === c.id; }).sort(function (a, b) { return a.n - b.n; })
        .map(function (t) { return { n: t.n, tema: t.tema, boletin: t.boletin, completado: av.completados.indexOf(t.n) >= 0, parcial: av.parciales.indexOf(t.n) >= 0 }; })
    };
  });
}

/** Clases de marcaciones cerradas hoy que aún no tienen tema registrado (para recordárselo al docente). */
function pendientesHoyDe_(info) {
  var porId = {}; info.propios.concat(info.otros).forEach(function (b) { porId[b.id] = b; });
  var out = [];
  marcacionesDe_(info.fecha).filter(function (m) { return m.fin && (m.dni === info.dni || norm(m.docente) === norm(info.docente)); })
    .forEach(function (m) {
      var clases = m.bloques.concat(m.reemplazos).map(function (id) { return porId[id]; }).filter(Boolean);
      out = out.concat(temasPendientes_(m.id, clases, info.docente));
    });
  return out;
}

function agregarRegistroTema_(base, item, temario) {
  var t = temario.filter(function (x) { return x.cursoId === item.cursoId && x.n === Number(item.n); })[0];
  if (!t) throw new Error('El tema ' + item.n + ' no existe en el temario de ' + item.cursoId + '.');
  if (TIPOS_AVANCE.indexOf(item.tipo) < 0) throw new Error('Tipo de avance no válido.');
  var fila = {
    id: 'L' + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') + Math.floor(Math.random() * 900 + 100),
    fecha: base.fecha, mes: String(base.fecha).slice(0, 7), marcacion: base.marcacion || '', cursoId: item.cursoId, curso: t.curso,
    salon: item.salon || 'ANUAL INTEGRAL', docente: base.docente, dni: base.dni || '', n: t.n, temaId: t.id, tema: t.tema, tipo: item.tipo,
    observacion: String(item.observacion || '').trim(), bloques: item.bloques || [], registradoPor: base.registradoPor,
    estado: base.registradoPor === 'COORDINACIÓN' ? 'VALIDADO' : 'REGISTRADO', revision: '', registrado: sello_()
  };
  agregar_(HOJAS.LECCIONARIO, fila);
  return fila;
}

/** El docente registra el/los tema(s) dictados en una marcación cerrada (paso posterior a "Marcar salida"). */
function registrarTemas(dni, marcacionId, items) {
  var info = buscarDocente(dni);
  if (!info.ok) return info;
  var m = marcacionesDe_(info.fecha).filter(function (x) { return x.id === marcacionId; })[0];
  if (!m || (m.dni !== info.dni && norm(m.docente) !== norm(info.docente))) return { ok: false, error: 'La marcación no corresponde a este docente.' };
  return conLock_(function () {
    var temario = temario_();
    var guardados = (items || []).map(function (it) {
      return agregarRegistroTema_({ fecha: m.fecha, marcacion: m.id, docente: info.docente, dni: info.dni, registradoPor: 'DOCENTE' }, it, temario);
    });
    return { ok: true, guardados: guardados.length };
  });
}

/* ----- Panel de coordinación ----- */

function getAcademico(pin, fecha) {
  validarPin_(pin);
  fecha = fecha || hoy_();
  var cal = calendario_(), esperado = temaEsperado(cal, fecha), cursos = cursos_(), temario = temario_(), lecc = leccionario_();
  var horario = horario_();
  var lista = cursos.map(function (c) {
    var a = avanceDe_(c, temario, lecc, esperado);
    a.docentes = horario.filter(function (b) { return cursoDeBloque(b, [c]); }).map(function (b) { return b.docente; })
      .filter(function (v, i, arr) { return v && arr.indexOf(v) === i; });
    return a;
  });
  // Alertas
  var alertas = [];
  lista.filter(function (a) { return a.semaforo === 'ROJO'; }).forEach(function (a) {
    alertas.push({ tipo: 'ATRASO', nivel: 'ROJO', cursoId: a.id, texto: a.curso + ': ' + a.atraso + ' temas de atraso (va en el ' + a.ultimoContinuo + ', debería ir en el ' + esperado.completados + ').' });
  });
  var desde = Utilities.formatDate(new Date(new Date().getTime() - 14 * 864e5), TZ, 'yyyy-MM-dd');
  var marcadas = {};
  leer_(HOJAS.CLASES).filter(function (c) { return c.fecha >= desde; }).forEach(function (c) {
    var k = cursoDeBloque({ salon: c.salon, curso: c.curso }, cursos);
    if (!k) return;
    var clave = c.marcacion + '|' + k.id;
    if (marcadas[clave]) return;
    marcadas[clave] = true;
    if (!lecc.some(function (r) { return r.marcacion === c.marcacion && r.cursoId === k.id; })) {
      alertas.push({ tipo: 'SIN_TEMA', nivel: 'AMBAR', cursoId: k.id, fecha: c.fecha, marcacion: c.marcacion, docente: c.docente,
        texto: c.fecha + ' · ' + c.docente + ' dictó ' + k.curso + ' sin registrar el tema.' });
    }
  });
  var porValidar = lecc.filter(function (r) { return r.estado === 'REGISTRADO'; }).length;
  var porConfirmar = temario.filter(function (t) { return t.estadoDato !== 'OK'; }).length;
  var cuenta = function (s) { return lista.filter(function (a) { return a.semaforo === s; }).length; };
  return {
    fecha: fecha, esperado: { completados: esperado.completados, enCurso: esperado.enCurso, total: esperado.total },
    semana: esperado.semana, cursos: lista, alertas: alertas,
    kpi: {
      cursos: lista.length, verde: cuenta('VERDE'), ambar: cuenta('AMBAR'), rojo: cuenta('ROJO'),
      cobertura: lista.length ? Math.round(lista.reduce(function (s, a) { return s + a.cobertura; }, 0) / lista.length * 10) / 10 : 0,
      porValidar: porValidar, porConfirmar: porConfirmar, sinTema: alertas.filter(function (x) { return x.tipo === 'SIN_TEMA'; }).length
    }
  };
}

function getCursoDetalle(pin, cursoId) {
  validarPin_(pin);
  var c = cursos_().filter(function (x) { return x.id === cursoId; })[0];
  if (!c) throw new Error('Curso no encontrado.');
  var temario = temario_(), lecc = leccionario_(), esperado = temaEsperado(calendario_(), hoy_());
  var a = avanceDe_(c, temario, lecc, esperado);
  var regs = lecc.filter(function (r) { return r.cursoId === cursoId; });
  a.temas = temario.filter(function (t) { return t.cursoId === cursoId; }).sort(function (x, y) { return x.n - y.n; }).map(function (t) {
    return {
      id: t.id, n: t.n, boletin: t.boletin, tema: t.tema, estadoDato: t.estadoDato, fuente: t.fuente,
      estado: a.completados.indexOf(t.n) >= 0 ? 'COMPLETADO' : a.parciales.indexOf(t.n) >= 0 ? 'PARCIAL' : 'PENDIENTE',
      registros: regs.filter(function (r) { return r.n === t.n; }).map(function (r) { return { id: r.id, fecha: r.fecha, tipo: r.tipo, docente: r.docente, estado: r.estado }; })
    };
  });
  a.esperado = esperado.completados;
  return a;
}

function guardarTituloTema(pin, temaId, titulo) {
  validarPin_(pin);
  titulo = String(titulo || '').trim();
  if (!titulo) return { ok: false, error: 'Escribe el título del tema.' };
  return conLock_(function () {
    var t = temario_().filter(function (x) { return x.id === temaId; })[0];
    if (!t) return { ok: false, error: 'Tema no encontrado.' };
    var esq = ESQUEMAS.Temario.map(function (c) { return c[0]; }), sh = hoja_(HOJAS.TEMARIO);
    sh.getRange(t._fila, esq.indexOf('tema') + 1).setValue(titulo);
    sh.getRange(t._fila, esq.indexOf('estadoDato') + 1).setValue('OK');
    sh.getRange(t._fila, esq.indexOf('fuente') + 1).setValue('Confirmado por coordinación ' + hoy_());
    return { ok: true };
  });
}

function guardarAvanceInicial(pin, cursoId, n) {
  validarPin_(pin);
  n = Number(n);
  if (!(n >= 0 && n <= 32)) return { ok: false, error: 'Indica un número de tema entre 0 y 32.' };
  var c = cursos_().filter(function (x) { return x.id === cursoId; })[0];
  if (!c) return { ok: false, error: 'Curso no encontrado.' };
  hoja_(HOJAS.CURSOS).getRange(c._fila, ESQUEMAS.Cursos.map(function (x) { return x[0]; }).indexOf('avanceInicial') + 1).setValue(String(n));
  return { ok: true };
}

function getLeccionario(pin, filtro) {
  validarPin_(pin);
  filtro = filtro || {};
  var lista = leccionario_().filter(function (r) {
    return (!filtro.cursoId || r.cursoId === filtro.cursoId) && (!filtro.desde || r.fecha >= filtro.desde) && (!filtro.hasta || r.fecha <= filtro.hasta);
  }).map(function (r) { delete r._fila; return r; });
  lista.sort(function (a, b) { return String(b.fecha + b.registrado).localeCompare(String(a.fecha + a.registrado)); });
  return { registros: lista.slice(0, 300), cursos: cursos_().map(function (c) { return { id: c.id, curso: c.curso }; }) };
}

/** Coordinación registra un tema (p. ej. si el docente no lo hizo). p = {fecha, cursoId, n, tipo, observacion, docente} */
function coordRegistrarTema(pin, p) {
  validarPin_(pin);
  if (!p.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(p.fecha)) return { ok: false, error: 'Indica la fecha.' };
  if (p.fecha > hoy_()) return { ok: false, error: 'No se puede registrar una fecha futura.' };
  return conLock_(function () {
    var r = agregarRegistroTema_({ fecha: p.fecha, marcacion: p.marcacion || '', docente: p.docente || 'Coordinación', dni: '', registradoPor: 'COORDINACIÓN' },
      { cursoId: p.cursoId, n: p.n, tipo: p.tipo, observacion: p.observacion }, temario_());
    return { ok: true, registro: r };
  });
}

/** Validar, corregir o eliminar un registro del leccionario. accion: VALIDAR | CORREGIR | ELIMINAR */
function revisarRegistro(pin, id, accion, cambios) {
  validarPin_(pin);
  return conLock_(function () {
    var r = leccionario_().filter(function (x) { return x.id === id; })[0];
    if (!r) return { ok: false, error: 'El registro ya no existe.' };
    var sh = hoja_(HOJAS.LECCIONARIO);
    if (accion === 'ELIMINAR') { sh.deleteRow(r._fila); return { ok: true }; }
    if (accion === 'CORREGIR') {
      cambios = cambios || {};
      var t = temario_().filter(function (x) { return x.cursoId === r.cursoId && x.n === Number(cambios.n || r.n); })[0];
      if (!t) return { ok: false, error: 'Tema no válido.' };
      if (cambios.tipo && TIPOS_AVANCE.indexOf(cambios.tipo) < 0) return { ok: false, error: 'Tipo no válido.' };
      var antes = r.n + '/' + r.tipo;
      r.n = t.n; r.temaId = t.id; r.tema = t.tema; r.tipo = cambios.tipo || r.tipo;
      if (cambios.observacion !== undefined) r.observacion = cambios.observacion;
      r.estado = 'CORREGIDO'; r.revision = 'Corregido ' + sello_() + ' (antes: tema ' + antes + ')';
    } else {
      r.estado = 'VALIDADO'; r.revision = 'Validado ' + sello_();
    }
    sh.getRange(r._fila, 1, 1, ESQUEMAS.Leccionario.length).setValues([filaDe_(HOJAS.LECCIONARIO, r)]);
    return { ok: true };
  });
}

function getCalendario(pin) {
  validarPin_(pin);
  return { semanas: calendario_().map(function (c) { delete c._fila; return c; }), hoy: hoy_() };
}

/* ============================ API: Fotochecks en Drive ============================ */

/**
 * Guarda fotochecks (PNG generados en el navegador) en una carpeta de Drive junto a la hoja,
 * y un ZIP con todos. archivos = [{nombre, base64}]
 */
function guardarFotochecks(pin, archivos, carpetaId) {
  validarPin_(pin);
  var carpeta;
  if (carpetaId) carpeta = DriveApp.getFolderById(carpetaId);
  else {
    var padres = DriveApp.getFileById(ss_().getId()).getParents();
    var base = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
    carpeta = base.createFolder('Fotochecks QR - ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH.mm'));
  }
  var urls = (archivos || []).map(function (a) {
    var blob = Utilities.newBlob(Utilities.base64Decode(a.base64), 'image/png', a.nombre);
    var f = carpeta.createFile(blob);
    return { nombre: a.nombre, url: f.getUrl(), descarga: 'https://drive.google.com/uc?export=download&id=' + f.getId() };
  });
  return { ok: true, carpetaId: carpeta.getId(), carpetaUrl: carpeta.getUrl(), archivos: urls };
}

/** Crea un ZIP con todos los PNG de la carpeta y devuelve su enlace de descarga. */
function comprimirFotochecks(pin, carpetaId) {
  validarPin_(pin);
  var carpeta = DriveApp.getFolderById(carpetaId);
  var it = carpeta.getFilesByType('image/png'), blobs = [];
  while (it.hasNext()) blobs.push(it.next().getBlob());
  var zip = carpeta.createFile(Utilities.zip(blobs, 'Fotochecks_QR_CVI.zip'));
  return { ok: true, carpetaUrl: carpeta.getUrl(), zipUrl: 'https://drive.google.com/uc?export=download&id=' + zip.getId(), total: blobs.length };
}

/* ============================ Instalación ============================ */

/** Ejecutar UNA vez desde el editor: crea hojas, formatos y carga horario/docentes base. */
function setup() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(ESQUEMAS).forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    var esq = ESQUEMAS[nombre];
    // Los encabezados se reescriben siempre: así se agregan columnas nuevas (ej. "Notas") sin tocar los datos.
    sh.getRange(1, 1, 1, esq.length).setValues([esq.map(function (c) { return c[1]; })]);
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
  // Control académico: se cargan solo si las hojas están vacías (no se pisa lo editado por coordinación).
  [[HOJAS.CURSOS, SEED_CURSOS], [HOJAS.TEMARIO, SEED_TEMARIO], [HOJAS.CALENDARIO, SEED_CALENDARIO]].forEach(function (par) {
    var sh = hoja_(par[0]);
    if (sh.getLastRow() < 2 && par[1].length) sh.getRange(2, 1, par[1].length, par[1][0].length).setValues(par[1]);
  });
  var def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  var cambios = actualizarDatos_();
  var msg = 'Listo. ' + (cambios.length ? 'Cambios aplicados: ' + cambios.join('; ') : 'Los datos ya estaban al día.');
  Logger.log(msg);
  return msg;
}

/** Renombres de docentes (nombre anterior → nuevo) que se aplican en Docentes y Horario. */
var RENOMBRES = { 'Yuly': 'Yuli Cucho' };

/**
 * Actualiza la hoja con los datos base SIN borrar nada de lo que ya escribió coordinación:
 *  - aplica RENOMBRES en Docentes y Horario,
 *  - completa celdas vacías de docentes existentes (DNI, celular, correo…) con SEED_DOCENTES,
 *  - agrega docentes nuevos que no estén en la hoja.
 */
function actualizarDatos_() {
  var cambios = [];
  var shD = hoja_(HOJAS.DOCENTES), shH = hoja_(HOJAS.HORARIO);
  var esqD = ESQUEMAS.Docentes, colDoc = 1; // índice de la columna "docente"
  Object.keys(RENOMBRES).forEach(function (viejo) {
    var nuevo = RENOMBRES[viejo], n = 0;
    [[shD, colDoc], [shH, 6]].forEach(function (par) {
      var sh = par[0], col = par[1], filas = sh.getLastRow() - 1;
      if (filas < 1) return;
      var rango = sh.getRange(2, col + 1, filas, 1), vals = rango.getDisplayValues();
      var cambio = false;
      vals.forEach(function (r) { if (norm(r[0]) === norm(viejo)) { r[0] = nuevo; n++; cambio = true; } });
      if (cambio) rango.setValues(vals);
    });
    if (n) cambios.push(viejo + ' → ' + nuevo + ' (' + n + ' celdas)');
  });
  var filas = Math.max(shD.getLastRow() - 1, 0);
  var datos = filas ? shD.getRange(2, 1, filas, esqD.length).getDisplayValues() : [];
  var completadas = 0, agregados = [];
  var colActivo = esqD.map(function (c) { return c[0]; }).indexOf('activo');
  SEED_DOCENTES.forEach(function (seed) {
    var fila = datos.filter(function (r) { return norm(r[colDoc]) === norm(seed[colDoc]); })[0];
    var colCel = 4, cel = String(seed[colCel] || '').replace(/\D/g, '');
    // Si coordinación lo renombró, se reconoce por su celular y no se vuelve a crear.
    if (!fila && cel && datos.some(function (r) { return String(r[colCel]).replace(/\D/g, '') === cel; })) return;
    if (!fila) {
      // Solo se agregan docentes nuevos si no fueron renombrados/eliminados a propósito en la hoja.
      var completo = seed.slice(); while (completo.length < esqD.length) completo.push('');
      datos.push(completo); agregados.push(seed[colDoc]); return;
    }
    seed.forEach(function (v, j) { if (v && !String(fila[j]).trim() && j !== colActivo) { fila[j] = v; completadas++; } });
  });
  if (datos.length) shD.getRange(2, 1, datos.length, esqD.length).setValues(datos);
  if (completadas) cambios.push(completadas + ' dato(s) de docentes completados');
  if (agregados.length) cambios.push('docentes agregados: ' + agregados.join(', '));
  // PIN del panel solicitado por coordinación (solo reemplaza el PIN inicial 2026).
  var shC = hoja_(HOJAS.CONFIG), cfg = shC.getRange(2, 1, Math.max(shC.getLastRow() - 1, 1), 2).getDisplayValues();
  cfg.forEach(function (r, i) {
    if (r[0] === 'PIN_PANEL' && r[1] === '2026') { shC.getRange(i + 2, 2).setValue('91515'); cambios.push('PIN del panel actualizado'); }
  });
  return cambios;
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
    "",
    "  /* ---------- Registro de tema (control académico) ---------- */",
    "  .temas-box { text-align: left; margin: 20px auto 0; max-width: 560px; }",
    "  .temas-box h3 { font-family: 'Cantata One', serif; font-size: 20px; text-align: center; }",
    "  .temas-box .sub { text-align: center; color: var(--texto-2); font-size: 14px; margin: 4px 0 12px; }",
    "  .tema-card { background: var(--fondo); border: 2px solid var(--borde); border-radius: 14px; padding: 14px; margin-top: 12px; }",
    "  .tema-card .cab { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; flex-wrap: wrap; }",
    "  .tema-card .cab b { font-size: 16px; }",
    "  .tema-card select { width: 100%; margin-top: 10px; padding: 12px; border-radius: 12px; border: 2px solid var(--borde); background: var(--blanco); font-size: 15px; font-weight: 600; }",
    "  .tema-card select:focus { border-color: var(--rojo); outline: none; }",
    "  .tipos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }",
    "  .tipo { border: 2px solid var(--borde); background: var(--blanco); border-radius: 12px; padding: 10px 8px; font-weight: 700; font-size: 13.5px; cursor: pointer; text-align: center; }",
    "  .tipo.sel { border-color: var(--negro); background: var(--negro); color: var(--amarillo); }",
    "  .tema-card input.obs { width: 100%; margin-top: 10px; padding: 10px 12px; border-radius: 10px; border: 2px solid var(--borde); }",
    "  .pendiente-banner { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 14px 16px; border-radius: 14px;",
    "    background: var(--amarillo-suave); color: #5d4300; margin-top: 12px; border: 1px solid #ecd9a6; font-weight: 600; }",
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
    "      <div id=\"pendientes-tema\"></div>",
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
    "        <div id=\"listo-temas\"></div>",
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
    "    api('buscarDocenteConTemas', dni).then(function (r) {",
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
    "    var pend = d.pendientesTema || [];",
    "    $('pendientes-tema').innerHTML = pend.length && !ab ? '<div class=\"pendiente-banner\"><span>📚 Tienes ' + pend.length + ' clase(s) de hoy sin tema registrado</span>' +",
    "      '<button class=\"btn btn-negro\" id=\"btn-reg-pend\" type=\"button\" style=\"padding:10px 14px\">Registrar ahora</button></div><div id=\"form-pend\"></div>' : '';",
    "    if (pend.length && !ab) $('btn-reg-pend').addEventListener('click', function () {",
    "      this.parentNode.classList.add('oculto');",
    "      formTemas($('form-pend'), pend, function () { setTimeout(function () { $('pendientes-tema').innerHTML = ''; }, 2500); });",
    "    });",
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
    "    $('listo-temas').innerHTML = '';",
    "    if (r.temas && r.temas.length) {",
    "      clearInterval(estado.timer); $('cuenta').textContent = '';",
    "      formTemas($('listo-temas'), r.temas, function () { cuentaRegresiva(8); });",
    "    } else {",
    "      cuentaRegresiva(10);",
    "    }",
    "  }",
    "  function cuentaRegresiva(s) {",
    "    $('cuenta').textContent = 'Volviendo al inicio en ' + s + ' s';",
    "    clearInterval(estado.timer);",
    "    estado.timer = setInterval(function () { s--; $('cuenta').textContent = 'Volviendo al inicio en ' + s + ' s'; if (s <= 0) reiniciar(); }, 1000);",
    "  }",
    "",
    "  /* ---------- Registro del tema dictado (control académico) ---------- */",
    "  var TIPOS = [['COMPLETADO', '✅ Completé el tema'], ['PARCIAL', '⏳ Avance parcial'], ['REPASO', '🔁 Repaso'], ['EVALUACION', '📝 Práctica / evaluación']];",
    "  function formTemas(cont, items, alTerminar) {",
    "    var dni = estado.docente ? estado.docente.dni : '';",
    "    cont.innerHTML = '<div class=\"temas-box\"><h3>📚 ¿Qué tema dictaste?</h3><div class=\"sub\">Confirma el tema de cada curso. Ya viene propuesto el que corresponde.</div>' +",
    "      items.map(function (it, i) {",
    "        return '<div class=\"tema-card\" data-i=\"' + i + '\"><div class=\"cab\"><b>' + esc(it.curso) + '</b><span class=\"muted\" style=\"font-size:13px\">' + esc(it.salon) +",
    "          (it.esperado ? ' · semana ' + it.esperado + ' del calendario' : '') + '</span></div>' +",
    "          '<select class=\"sel-tema\">' + it.temas.map(function (t) {",
    "            return '<option value=\"' + t.n + '\"' + (t.n === it.sugerido ? ' selected' : '') + '>' + t.n + ' · ' + esc(t.tema) +",
    "              (t.completado ? '  ✓' : t.parcial ? '  (parcial)' : '') + '  (Bol. ' + esc(t.boletin) + ')</option>';",
    "          }).join('') + '</select>' +",
    "          '<div class=\"tipos\">' + TIPOS.map(function (x, k) { return '<button type=\"button\" class=\"tipo' + (k ? '' : ' sel') + '\" data-t=\"' + x[0] + '\">' + x[1] + '</button>'; }).join('') + '</div>' +",
    "          '<input class=\"obs\" maxlength=\"200\" placeholder=\"Observación (opcional): ej. faltó tiempo para la práctica\"></div>';",
    "      }).join('') +",
    "      '<div class=\"alerta oculto\" id=\"err-temas\"></div>' +",
    "      '<div style=\"display:flex;gap:10px;margin-top:14px;flex-wrap:wrap\"><button class=\"btn btn-rojo\" id=\"btn-guardar-temas\" type=\"button\" style=\"flex:1;min-width:180px\">Guardar tema' + (items.length > 1 ? 's' : '') + '</button>' +",
    "      '<button class=\"btn btn-claro\" id=\"btn-omitir-temas\" type=\"button\">Más tarde</button></div></div>';",
    "    cont.querySelectorAll('.tipos').forEach(function (g) {",
    "      g.addEventListener('click', function (e) {",
    "        var b = e.target.closest('[data-t]'); if (!b) return;",
    "        g.querySelectorAll('.tipo').forEach(function (x) { x.classList.toggle('sel', x === b); });",
    "      });",
    "    });",
    "    $('btn-omitir-temas').addEventListener('click', function () { cont.innerHTML = '<div class=\"muted\" style=\"margin-top:14px\">Puedes registrarlo después, al volver a ingresar tu DNI.</div>'; alTerminar(); });",
    "    $('btn-guardar-temas').addEventListener('click', function () {",
    "      var btn = this, porMarc = {};",
    "      cont.querySelectorAll('.tema-card').forEach(function (c) {",
    "        var it = items[+c.getAttribute('data-i')];",
    "        (porMarc[it.marcacion] = porMarc[it.marcacion] || []).push({",
    "          cursoId: it.cursoId, salon: it.salon, bloques: it.bloques, n: +c.querySelector('.sel-tema').value,",
    "          tipo: c.querySelector('.tipo.sel').getAttribute('data-t'), observacion: c.querySelector('.obs').value",
    "        });",
    "      });",
    "      btn.disabled = true; btn.innerHTML = '<span class=\"spinner\"></span> Guardando…';",
    "      Promise.all(Object.keys(porMarc).map(function (m) { return api('registrarTemas', dni, m, porMarc[m]); })).then(function (rs) {",
    "        var mal = rs.filter(function (x) { return !x.ok; })[0];",
    "        if (mal) { error('err-temas', mal.error); btn.disabled = false; btn.textContent = 'Reintentar'; return; }",
    "        cont.innerHTML = '<div class=\"chip ok\" style=\"margin-top:16px;font-size:15px;padding:10px 14px\"><span class=\"punto\"></span>Tema' + (items.length > 1 ? 's' : '') + ' registrado' + (items.length > 1 ? 's' : '') + '. ¡Gracias!</div>';",
    "        alTerminar();",
    "      }).catch(function (e) { error('err-temas', 'No se pudo guardar: ' + e.message); btn.disabled = false; btn.textContent = 'Reintentar'; });",
    "    });",
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
    "<?!= include('QRLib'); ?>",
    "<style>",
    "  html, body { overflow-x: hidden; }",
    "  .contenedor { max-width: 1240px; }",
    "  .login { max-width: 380px; margin: 60px auto; text-align: center; }",
    "  .login h1 { font-family: 'Cantata One', serif; font-size: 26px; margin-bottom: 6px; }",
    "  .login input { width: 100%; text-align: center; font-size: 28px; letter-spacing: .3em; padding: 14px; border-radius: 14px; border: 2px solid var(--borde); margin: 18px 0 12px; outline: none; }",
    "  .login input:focus { border-color: var(--rojo); }",
    "",
    "  /* ---------- Navegación ---------- */",
    "  .nav { display: flex; gap: 6px; background: var(--blanco); padding: 6px; border-radius: 14px; border: 1px solid var(--borde); }",
    "  .tab { border: 0; background: none; padding: 10px 14px; border-radius: 10px; font-weight: 700; cursor: pointer; color: var(--texto-2); white-space: nowrap; display: inline-flex; gap: 8px; align-items: center; }",
    "  .tab .ico { font-size: 17px; }",
    "  .tab.activo { background: var(--negro); color: var(--amarillo); }",
    "  .cabecera { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 18px; }",
    "  .barra { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 16px; }",
    "  .controles { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; min-width: 0; }",
    "  .campo { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--borde); background: var(--blanco); min-width: 0; max-width: 100%; }",
    "  .campo:focus { outline: 2px solid rgba(146,0,0,.25); border-color: var(--rojo); }",
    "  .btn-s { padding: 10px 14px; border-radius: 10px; font-size: 14px; }",
    "  .vivo { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--texto-2); }",
    "  .vivo .punto { width: 10px; height: 10px; border-radius: 50%; background: #2bb15a; flex: none; animation: pulso 2s infinite; }",
    "  .vivo.pausa .punto { background: var(--gris); animation: none; }",
    "  @keyframes pulso { 0% { box-shadow: 0 0 0 0 rgba(43,177,90,.5); } 70% { box-shadow: 0 0 0 10px rgba(43,177,90,0); } 100% { box-shadow: 0 0 0 0 rgba(43,177,90,0); } }",
    "",
    "  .kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }",
    "  .kpis.k4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }",
    "  .kpi { padding: 16px; min-width: 0; }",
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
    "  .leyenda { display: flex; flex-wrap: wrap; gap: 10px 12px; font-size: 12px; color: var(--texto-2); }",
    "  .leyenda i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 5px; vertical-align: -2px; }",
    "",
    "  /* ---------- Línea de tiempo (escritorio) ---------- */",
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
    "  .blq { position: absolute; top: 4px; bottom: 4px; border-radius: 8px; padding: 4px 7px; overflow: hidden; font-size: 11px; line-height: 1.2; border: 1px solid transparent; }",
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
    "  /* ---------- Salones del día (celular) ---------- */",
    "  .tl-movil { display: none; gap: 12px; }",
    "  .salon-card { padding: 14px; }",
    "  .salon-card h3 { font-size: 15px; margin-bottom: 8px; }",
    "  .fila-b { display: grid; grid-template-columns: 92px 1fr auto; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--gris-suave); font-size: 14px; }",
    "  .fila-b:first-of-type { border-top: 0; }",
    "  .fila-b .h { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 13px; }",
    "  .fila-b .c { min-width: 0; }",
    "  .fila-b .c b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    "  .fila-b .c span { font-size: 12px; color: var(--texto-2); }",
    "  .est { font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 999px; white-space: nowrap; }",
    "",
    "  /* ---------- Tablas (en celular se vuelven tarjetas) ---------- */",
    "  .dos-col { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }",
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
    "  /* ---------- Marcar (coordinación) ---------- */",
    "  .filtros { display: flex; gap: 6px; flex-wrap: wrap; }",
    "  .filtro { border: 1px solid var(--borde); background: var(--blanco); padding: 8px 12px; border-radius: 999px; font-weight: 600; font-size: 13px; cursor: pointer; }",
    "  .filtro.sel { background: var(--negro); color: var(--amarillo); border-color: var(--negro); }",
    "  .doc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }",
    "  .doc-card { padding: 14px; display: flex; gap: 12px; align-items: center; }",
    "  .avatar-s { width: 46px; height: 46px; border-radius: 50%; background: var(--rojo); color: #fff; display: grid; place-items: center; font-weight: 800; flex: none; border: 2px solid var(--amarillo); }",
    "  .doc-card .info { flex: 1; min-width: 0; }",
    "  .doc-card .n { font-weight: 800; line-height: 1.25; overflow-wrap: anywhere; }",
    "  .doc-card .d { font-size: 12.5px; color: var(--texto-2); margin: 2px 0 6px; line-height: 1.35; }",
    "  .doc-card .btn { padding: 10px 12px; font-size: 13px; border-radius: 10px; flex: none; }",
    "",
    "  /* ---------- Horario ---------- */",
    "  .seg { display: inline-flex; background: var(--blanco); border: 1px solid var(--borde); border-radius: 10px; padding: 3px; }",
    "  .seg button { border: 0; background: none; padding: 8px 12px; border-radius: 8px; font-weight: 700; cursor: pointer; color: var(--texto-2); }",
    "  .seg button.sel { background: var(--negro); color: var(--amarillo); }",
    "  .semana { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }",
    "  .dia-col { background: var(--blanco); border: 1px solid var(--borde); border-radius: 14px; padding: 10px; min-width: 0; display: flex; flex-direction: column; gap: 8px; }",
    "  .dia-col h3 { font-size: 14px; display: flex; justify-content: space-between; align-items: baseline; gap: 6px; padding: 2px 4px 6px; border-bottom: 2px solid var(--amarillo); }",
    "  .dia-col h3 small { font-weight: 600; color: var(--texto-2); font-size: 12px; }",
    "  .bq { text-align: left; border: 1px solid var(--borde); border-left: 4px solid var(--rojo); background: #fffdfa; border-radius: 10px; padding: 8px 10px; cursor: pointer; width: 100%; }",
    "  .bq:hover { background: var(--amarillo-suave); }",
    "  .bq .h { font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--rojo); }",
    "  .bq .c { font-weight: 700; font-size: 13px; line-height: 1.25; margin-top: 2px; overflow-wrap: anywhere; }",
    "  .bq .d { font-size: 12px; color: var(--texto-2); overflow-wrap: anywhere; }",
    "  .bq .nota { font-size: 11px; color: var(--warn); margin-top: 3px; }",
    "  .bq.sin-doc { border-left-color: var(--gris); }",
    "  .agregar { border: 1.5px dashed #cfc6b8; background: none; border-radius: 10px; padding: 8px; font-weight: 700; color: var(--texto-2); cursor: pointer; }",
    "  .agregar:hover { border-color: var(--rojo); color: var(--rojo); }",
    "  .vacio-d { font-size: 12px; color: var(--gris); text-align: center; padding: 6px 0; }",
    "",
    "  /* ---------- Docentes ---------- */",
    "  .dc { padding: 14px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: start; cursor: pointer; }",
    "  .dc:hover { border-color: var(--amarillo); }",
    "  .dc.inactivo { opacity: .6; }",
    "  .dc.inactivo .avatar-s { background: var(--gris); }",
    "  .dc .n { font-weight: 800; line-height: 1.25; overflow-wrap: anywhere; }",
    "  .dc .nc { font-size: 12.5px; color: var(--texto-2); overflow-wrap: anywhere; }",
    "  .dc .datos { font-size: 12.5px; margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--texto); }",
    "  .dc .datos span { white-space: nowrap; }",
    "  .dc .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }",
    "  .switch { position: relative; width: 50px; height: 28px; flex: none; }",
    "  .switch input { opacity: 0; width: 0; height: 0; position: absolute; }",
    "  .switch .pista { position: absolute; inset: 0; background: #cfc8bd; border-radius: 999px; cursor: pointer; transition: background .2s; }",
    "  .switch .pista::after { content: ''; position: absolute; width: 22px; height: 22px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.25); }",
    "  .switch input:checked + .pista { background: var(--ok); }",
    "  .switch input:checked + .pista::after { transform: translateX(22px); }",
    "  .switch-l { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: var(--texto-2); }",
    "  .form-grid textarea { padding: 11px 12px; border-radius: 10px; border: 1px solid var(--borde); background: var(--blanco); font-size: 15px; width: 100%; min-height: 80px; margin: 0; }",
    "  .form-grid .ayuda { font-weight: 500; font-size: 12px; color: var(--gris); }",
    "  .req { color: var(--rojo); }",
    "",
    "  /* ---------- Académico ---------- */",
    "  .ac-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 12px; }",
    "  .ac-card { padding: 14px 16px; cursor: pointer; border-left: 6px solid var(--gris); }",
    "  .ac-card:hover { border-color: var(--amarillo); }",
    "  .ac-card.VERDE { border-left-color: #2e8b4e; } .ac-card.AMBAR { border-left-color: var(--amarillo); } .ac-card.ROJO { border-left-color: var(--rojo); }",
    "  .ac-card .top { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }",
    "  .ac-card .n { font-weight: 800; font-size: 16px; }",
    "  .ac-card .d { font-size: 12.5px; color: var(--texto-2); }",
    "  .ac-card .linea { font-size: 13px; margin-top: 4px; overflow-wrap: anywhere; }",
    "  .barra32 { display: grid; grid-template-columns: repeat(32, 1fr); gap: 2px; margin: 10px 0 6px; position: relative; }",
    "  .barra32 span { height: 12px; border-radius: 2px; background: #e4ddd2; }",
    "  .barra32 span.c { background: #2e8b4e; } .barra32 span.p { background: var(--amarillo); }",
    "  .barra32 span.esp { box-shadow: 2px 0 0 0 var(--rojo); }",
    "  .barra32 span.bol { margin-left: 3px; }",
    "  .sem { font-size: 12px; font-weight: 800; padding: 4px 9px; border-radius: 999px; white-space: nowrap; }",
    "  .sem.VERDE { background: var(--ok-suave); color: var(--ok); } .sem.AMBAR { background: var(--warn-suave); color: var(--warn); } .sem.ROJO { background: var(--rojo-suave); color: var(--rojo); }",
    "  .alerta-item { display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; border-bottom: 1px solid var(--gris-suave); font-size: 14px; }",
    "  .alerta-item:last-child { border-bottom: 0; }",
    "  .temas-lista .bolh { font-size: 12px; font-weight: 800; color: var(--rojo); text-transform: uppercase; letter-spacing: .05em; margin: 14px 0 6px; }",
    "  .tema-fila { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 10px; background: var(--blanco); border: 1px solid var(--borde); margin-bottom: 6px; }",
    "  .tema-fila .num { font-weight: 800; text-align: center; border-radius: 8px; padding: 4px 0; background: var(--gris-suave); }",
    "  .tema-fila.COMPLETADO .num { background: #2e8b4e; color: #fff; } .tema-fila.PARCIAL .num { background: var(--amarillo); }",
    "  .tema-fila .t { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }",
    "  .tema-fila .t.conf { color: var(--warn); }",
    "  .tema-fila .r { font-size: 11.5px; color: var(--texto-2); }",
    "  .tema-fila input { width: 100%; padding: 6px 8px; border-radius: 8px; border: 2px solid var(--rojo); font-size: 14px; }",
    "  .mini { border: 0; background: none; cursor: pointer; font-size: 16px; padding: 4px 6px; border-radius: 8px; }",
    "  .mini:hover { background: var(--gris-suave); }",
    "  tr.sem-actual td { background: var(--amarillo-suave); font-weight: 700; }",
    "  @media (max-width: 760px) { .ac-grid { grid-template-columns: minmax(0, 1fr); } .barra32 span { height: 10px; } }",
    "",
    "  /* ---------- Fotochecks ---------- */",
    "  .qr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }",
    "  .fotocheck { background: var(--blanco); border-radius: 14px; overflow: hidden; border: 1px solid var(--borde); text-align: center; break-inside: avoid; }",
    "  .fotocheck .cab { background: var(--negro); color: var(--amarillo); padding: 10px; font-family: 'Cantata One', serif; font-size: 14px; border-bottom: 3px solid var(--amarillo); }",
    "  .fotocheck .qr { padding: 14px; display: grid; place-items: center; min-height: 190px; }",
    "  .fotocheck .qr img, .fotocheck .qr canvas { width: 170px !important; height: 170px !important; }",
    "  .fotocheck .nom { font-weight: 800; font-size: 16px; padding: 0 10px; }",
    "  .fotocheck .dni { font-size: 13px; color: var(--texto-2); padding: 2px 10px 10px; }",
    "  .fotocheck .sin { color: var(--rojo); font-weight: 700; font-size: 13px; padding: 30px 10px; }",
    "  .fotocheck .acc { display: flex; gap: 6px; padding: 0 12px 12px; }",
    "  .fotocheck .acc .btn { flex: 1; padding: 9px 8px; font-size: 13px; border-radius: 10px; }",
    "",
    "  /* ---------- Modal y aviso ---------- */",
    "  .modal { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }",
    "  .modal-caja { background: var(--fondo); border-radius: 18px; width: 100%; max-width: 640px; max-height: calc(100vh - 32px); overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,.3); }",
    "  .modal-cab { background: var(--negro); color: var(--blanco); padding: 16px 20px; display: flex; gap: 12px; align-items: center; border-bottom: 3px solid var(--amarillo); position: sticky; top: 0; z-index: 2; }",
    "  .modal-cab h3 { font-family: 'Cantata One', serif; color: var(--amarillo); font-size: 18px; flex: 1; min-width: 0; }",
    "  .modal-cab .cerrar { background: none; border: 0; color: #fff; font-size: 26px; cursor: pointer; line-height: 1; padding: 4px 8px; }",
    "  .modal-cuerpo { padding: 18px 20px 22px; }",
    "  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }",
    "  .form-grid label { display: grid; gap: 6px; font-size: 13px; font-weight: 700; color: var(--texto-2); min-width: 0; }",
    "  .form-grid .full { grid-column: 1 / -1; }",
    "  .form-grid input, .form-grid select { padding: 11px 12px; border-radius: 10px; border: 1px solid var(--borde); background: var(--blanco); font-size: 15px; width: 100%; }",
    "  .aviso { padding: 10px 14px; border-radius: 10px; background: var(--warn-suave); color: var(--warn); font-weight: 600; font-size: 14px; margin-top: 12px; }",
    "  .hora-coord { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; background: var(--blanco); border: 1px solid var(--borde); border-radius: 14px; padding: 12px 14px; }",
    "  .hora-coord input { font-size: 22px; font-weight: 800; padding: 8px 10px; border-radius: 10px; border: 2px solid var(--borde); font-variant-numeric: tabular-nums; }",
    "  .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--negro); color: #fff; padding: 12px 18px; border-radius: 12px; z-index: 60; box-shadow: 0 8px 30px rgba(0,0,0,.3); max-width: calc(100vw - 32px); font-weight: 600; font-size: 14px; }",
    "  .toast a { color: var(--amarillo); }",
    "",
    "  @media (max-width: 1100px) { .semana { grid-template-columns: repeat(3, minmax(0, 1fr)); } }",
    "  @media (max-width: 1000px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } .dos-col { grid-template-columns: minmax(0, 1fr); } }",
    "  @media (max-width: 760px) {",
    "    body { padding-bottom: 76px; }",
    "    .contenedor { padding: 16px 12px 28px; }",
    "    /* Navegación inferior fija estilo app */",
    "    .nav { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; border-radius: 0; border: 0; border-top: 3px solid var(--amarillo); background: var(--negro); padding: 6px 4px calc(6px + env(safe-area-inset-bottom)); display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; }",
    "    .tab { flex-direction: column; gap: 2px; padding: 6px 0; font-size: 9.5px; letter-spacing: -.01em; color: #cfc8bd; border-radius: 10px; }",
    "    .tab .ico { font-size: 20px; }",
    "    .tab.activo { background: #262626; color: var(--amarillo); }",
    "    .tab .txt-largo { display: none; }",
    "    .kpis, .kpis.k4 { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }",
    "    .kpi { padding: 12px; }",
    "    .kpi .v { font-size: 28px; }",
    "    .timeline { display: none; }",
    "    .tl-movil { display: grid; }",
    "    .semana { grid-template-columns: minmax(0, 1fr); }",
    "    .form-grid { grid-template-columns: 1fr; }",
    "    .modal { padding: 0; align-items: flex-end; }",
    "    .modal-caja { max-height: 94vh; border-radius: 18px 18px 0 0; }",
    "    .doc-grid { grid-template-columns: minmax(0, 1fr); }",
    "    .qr-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }",
    "    .fotocheck .qr { min-height: 0; padding: 10px; }",
    "    .fotocheck .qr img, .fotocheck .qr canvas { width: 100% !important; height: auto !important; max-width: 150px; }",
    "    .fotocheck .acc { flex-direction: column; }",
    "    /* Tablas → tarjetas */",
    "    .tabla-resp thead { display: none; }",
    "    .tabla-resp, .tabla-resp tbody, .tabla-resp tr, .tabla-resp td { display: block; width: 100%; }",
    "    .tabla-resp tr { padding: 10px 14px; border-bottom: 1px solid var(--borde); }",
    "    .tabla-resp td { border: 0; padding: 3px 0; text-align: left !important; display: flex; justify-content: space-between; gap: 12px; }",
    "    .tabla-resp td[data-l]::before { content: attr(data-l); font-size: 12px; font-weight: 700; color: var(--texto-2); text-transform: uppercase; letter-spacing: .03em; flex: none; }",
    "    .tabla-resp td.titulo { font-size: 16px; }",
    "    .tabla-resp tr.subtotal td, .tabla-resp tr.total td { justify-content: space-between; }",
    "    .seccion-t h2 { font-size: 18px; }",
    "  }",
    "  @media print {",
    "    .topbar, .nav, .no-print, .cabecera, .barra { display: none !important; }",
    "    body { background: #fff; padding: 0; }",
    "    .qr-grid { grid-template-columns: repeat(3, 1fr); }",
    "    .fotocheck .acc { display: none; }",
    "  }",
    "</style>",
    "</head>",
    "<body>",
    "  <header class=\"topbar\">",
    "    <div class=\"logo\" id=\"logo\"><span class=\"fallback\">CVI</span></div>",
    "    <div class=\"titulo\">",
    "      <div class=\"nombre\">Panel de Asistencia</div>",
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
    "      <div class=\"cabecera\">",
    "        <nav class=\"nav\" role=\"tablist\">",
    "          <button class=\"tab activo\" data-tab=\"hoy\" type=\"button\"><span class=\"ico\">📍</span><span>En vivo</span></button>",
    "          <button class=\"tab\" data-tab=\"marcar\" type=\"button\"><span class=\"ico\">✍️</span><span>Marcar<span class=\"txt-largo\"> asistencia</span></span></button>",
    "          <button class=\"tab\" data-tab=\"horario\" type=\"button\"><span class=\"ico\">🗓️</span><span>Horario</span></button>",
    "          <button class=\"tab\" data-tab=\"docentes\" type=\"button\"><span class=\"ico\">👥</span><span>Docentes</span></button>",
    "          <button class=\"tab\" data-tab=\"academico\" type=\"button\"><span class=\"ico\">📚</span><span>Académico</span></button>",
    "          <button class=\"tab\" data-tab=\"reporte\" type=\"button\"><span class=\"ico\">📊</span><span>Reporte</span></button>",
    "          <button class=\"tab\" data-tab=\"qr\" type=\"button\"><span class=\"ico\">🪪</span><span>QR<span class=\"txt-largo\"> fotochecks</span></span></button>",
    "        </nav>",
    "        <div class=\"controles no-print\">",
    "          <button class=\"btn btn-claro btn-s\" id=\"btn-marcacion\" type=\"button\">Página de marcación ↗</button>",
    "          <button class=\"link\" id=\"btn-salir\" type=\"button\">Salir</button>",
    "        </div>",
    "      </div>",
    "",
    "      <!-- ===================== EN VIVO ===================== -->",
    "      <div id=\"t-hoy\">",
    "        <div class=\"barra\">",
    "          <div class=\"controles\">",
    "            <input type=\"date\" id=\"f-fecha\" class=\"campo\">",
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
    "        <div class=\"tl-movil\" id=\"tl-movil\"></div>",
    "",
    "        <div class=\"dos-col\" style=\"margin-top:16px\">",
    "          <div>",
    "            <div class=\"seccion-t\"><h2>Marcaciones</h2><span class=\"muted\" id=\"n-marc\"></span></div>",
    "            <div class=\"tarjeta tabla-scroll\"><table id=\"tabla-marc\" class=\"tabla-resp\"></table></div>",
    "          </div>",
    "          <div>",
    "            <div class=\"seccion-t\"><h2>Aún no llegan</h2></div>",
    "            <div class=\"tarjeta\" id=\"pendientes\"></div>",
    "          </div>",
    "        </div>",
    "      </div>",
    "",
    "      <!-- ===================== MARCAR (COORDINACIÓN) ===================== -->",
    "      <div id=\"t-marcar\" class=\"oculto\">",
    "        <div class=\"seccion-t\" style=\"margin-top:0\">",
    "          <h2>Marcar asistencia por coordinación</h2>",
    "          <span class=\"muted\" id=\"marcar-fecha\"></span>",
    "        </div>",
    "        <div class=\"barra\">",
    "          <input type=\"search\" id=\"buscar-doc\" class=\"campo\" placeholder=\"🔎 Buscar docente…\" style=\"flex:1;min-width:200px;max-width:420px\">",
    "          <div class=\"filtros\" id=\"filtros\">",
    "            <button class=\"filtro sel\" data-f=\"hoy\" type=\"button\">Con clases hoy</button>",
    "            <button class=\"filtro\" data-f=\"sin\" type=\"button\">Sin marcar</button>",
    "            <button class=\"filtro\" data-f=\"en\" type=\"button\">En el colegio</button>",
    "            <button class=\"filtro\" data-f=\"todos\" type=\"button\">Todos</button>",
    "          </div>",
    "        </div>",
    "        <div class=\"doc-grid\" id=\"doc-grid\"></div>",
    "      </div>",
    "",
    "      <!-- ===================== HORARIO ===================== -->",
    "      <div id=\"t-horario\" class=\"oculto\">",
    "        <div class=\"barra\">",
    "          <div class=\"controles\">",
    "            <div class=\"seg\" id=\"h-modo\"><button type=\"button\" class=\"sel\" data-m=\"salon\">Por salón</button><button type=\"button\" data-m=\"docente\">Por docente</button></div>",
    "            <select id=\"h-sel\" class=\"campo\" style=\"min-width:200px\"></select>",
    "          </div>",
    "          <div class=\"controles\">",
    "            <span class=\"muted\" id=\"h-resumen\"></span>",
    "            <button class=\"btn btn-rojo btn-s\" id=\"h-nuevo\" type=\"button\">＋ Nuevo bloque</button>",
    "          </div>",
    "        </div>",
    "        <div class=\"semana\" id=\"semana\"></div>",
    "        <p class=\"muted\" style=\"font-size:13px;margin-top:14px\">Toca un bloque para editarlo o eliminarlo. Los cambios se guardan en la hoja “Horario” y se aplican de inmediato en la marcación.</p>",
    "      </div>",
    "",
    "      <!-- ===================== DOCENTES ===================== -->",
    "      <div id=\"t-docentes\" class=\"oculto\">",
    "        <div class=\"seccion-t\" style=\"margin-top:0\"><h2>Docentes</h2><span class=\"muted\" id=\"d-resumen\"></span></div>",
    "        <div class=\"barra\">",
    "          <input type=\"search\" id=\"d-buscar\" class=\"campo\" placeholder=\"🔎 Buscar por nombre, DNI, celular o especialidad…\" style=\"flex:1;min-width:200px;max-width:460px\">",
    "          <div class=\"controles\">",
    "            <div class=\"filtros\" id=\"d-filtros\">",
    "              <button class=\"filtro sel\" data-f=\"activos\" type=\"button\">Activos</button>",
    "              <button class=\"filtro\" data-f=\"inactivos\" type=\"button\">Inactivos</button>",
    "              <button class=\"filtro\" data-f=\"todos\" type=\"button\">Todos</button>",
    "            </div>",
    "            <button class=\"btn btn-rojo btn-s\" id=\"d-nuevo\" type=\"button\">＋ Nuevo docente</button>",
    "          </div>",
    "        </div>",
    "        <div class=\"doc-grid\" id=\"d-grid\"></div>",
    "        <p class=\"muted\" style=\"font-size:13px;margin-top:14px\">Los docentes <b>inactivos</b> no pueden marcar asistencia ni aparecen para asignar en el horario. Sus registros pasados se conservan.</p>",
    "      </div>",
    "",
    "      <!-- ===================== ACADÉMICO ===================== -->",
    "      <div id=\"t-academico\" class=\"oculto\">",
    "        <div class=\"seccion-t\" style=\"margin-top:0\">",
    "          <h2>Control académico · Anual Integral</h2>",
    "          <span id=\"ac-semana\"></span>",
    "        </div>",
    "        <div class=\"barra\">",
    "          <div class=\"seg\" id=\"ac-vista\"><button type=\"button\" class=\"sel\" data-v=\"avance\">Avance</button><button type=\"button\" data-v=\"lecc\">Leccionario</button><button type=\"button\" data-v=\"cal\">Calendario</button></div>",
    "          <span class=\"muted\" id=\"ac-msg\"></span>",
    "        </div>",
    "        <div id=\"ac-avance\">",
    "          <div class=\"kpis\" id=\"ac-kpis\"></div>",
    "          <div id=\"ac-alertas\"></div>",
    "          <div class=\"seccion-t\"><h2>Avance por curso</h2>",
    "            <div class=\"leyenda\"><span><i style=\"background:#2e8b4e\"></i>Completado</span><span><i style=\"background:var(--amarillo)\"></i>Parcial</span><span><i style=\"background:#e4ddd2\"></i>Pendiente</span><span><i style=\"background:var(--rojo);width:3px\"></i>Debería ir aquí</span></div>",
    "          </div>",
    "          <div class=\"ac-grid\" id=\"ac-cursos\"></div>",
    "        </div>",
    "        <div id=\"ac-lecc\" class=\"oculto\">",
    "          <div class=\"barra\">",
    "            <div class=\"controles\">",
    "              <select id=\"lc-curso\" class=\"campo\"><option value=\"\">Todos los cursos</option></select>",
    "              <input type=\"date\" id=\"lc-desde\" class=\"campo\"><input type=\"date\" id=\"lc-hasta\" class=\"campo\">",
    "            </div>",
    "            <button class=\"btn btn-rojo btn-s\" id=\"lc-nuevo\" type=\"button\">＋ Registrar tema</button>",
    "          </div>",
    "          <div class=\"tarjeta tabla-scroll\"><table id=\"lc-tabla\" class=\"tabla-resp\"></table></div>",
    "        </div>",
    "        <div id=\"ac-cal\" class=\"oculto\">",
    "          <p class=\"muted\" style=\"font-size:14px;margin-top:0\">1 tema por semana de clase. Las semanas de exámenes y vacaciones no cuentan para el avance esperado. Se edita en la hoja “Calendario”.</p>",
    "          <div class=\"tarjeta tabla-scroll\"><table id=\"cal-tabla\" class=\"tabla-resp\"></table></div>",
    "        </div>",
    "      </div>",
    "",
    "      <!-- ===================== REPORTE ===================== -->",
    "      <div id=\"t-reporte\" class=\"oculto\">",
    "        <div class=\"barra\">",
    "          <div class=\"controles\">",
    "            <input type=\"month\" id=\"f-mes\" class=\"campo\">",
    "            <button class=\"btn btn-negro btn-s\" id=\"btn-exportar\" type=\"button\">Guardar en hoja</button>",
    "            <button class=\"btn btn-claro btn-s\" id=\"btn-csv\" type=\"button\">Descargar CSV</button>",
    "          </div>",
    "          <span class=\"muted\" id=\"rep-msg\"></span>",
    "        </div>",
    "        <div class=\"kpis k4\" id=\"rep-kpis\"></div>",
    "        <div class=\"seccion-t\"><h2>Horas dictadas por docente y salón</h2><span class=\"muted\">Base para la gestión de pagos</span></div>",
    "        <div class=\"tarjeta tabla-scroll\"><table id=\"tabla-rep\" class=\"tabla-resp\"></table></div>",
    "      </div>",
    "",
    "      <!-- ===================== QR ===================== -->",
    "      <div id=\"t-qr\" class=\"oculto\">",
    "        <div class=\"barra\">",
    "          <div class=\"muted\" style=\"max-width:620px;font-size:14px\">Cada QR abre la página de marcación con el DNI (o celular) del docente. Descárgalos como imagen para enviarlos por WhatsApp o imprímelos.</div>",
    "          <div class=\"controles\">",
    "            <button class=\"btn btn-negro btn-s\" id=\"btn-zip\" type=\"button\">⬇ Descargar todos (ZIP)</button>",
    "            <button class=\"btn btn-rojo btn-s\" id=\"btn-imprimir\" type=\"button\">🖨 Imprimir</button>",
    "          </div>",
    "        </div>",
    "        <div id=\"qr-msg\"></div>",
    "        <div class=\"qr-grid\" id=\"qr-grid\"></div>",
    "      </div>",
    "    </section>",
    "  </main>",
    "",
    "  <!-- Modal genérico -->",
    "  <div class=\"modal oculto\" id=\"modal\">",
    "    <div class=\"modal-caja\" role=\"dialog\" aria-modal=\"true\">",
    "      <div class=\"modal-cab\"><h3 id=\"modal-titulo\"></h3><button class=\"cerrar\" id=\"modal-cerrar\" type=\"button\" aria-label=\"Cerrar\">×</button></div>",
    "      <div class=\"modal-cuerpo\" id=\"modal-cuerpo\"></div>",
    "    </div>",
    "  </div>",
    "  <div class=\"toast oculto\" id=\"toast\"></div>",
    "",
    "<script>",
    "(function () {",
    "  var $ = function (id) { return document.getElementById(id); };",
    "  var S = { pin: '', fecha: '', mes: '', timer: null, reporte: null, appUrl: '<?= appUrl ?>', logo: '', horario: null, hModo: 'salon', hSel: '', coord: null, filtro: 'hoy', qr: null };",
    "  var DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];",
    "  var DIAS_L = { LUNES: 'Lunes', MARTES: 'Martes', MIERCOLES: 'Miércoles', JUEVES: 'Jueves', VIERNES: 'Viernes', SABADO: 'Sábado', DOMINGO: 'Domingo' };",
    "  var OBS = ['Tardanza justificada', 'Permiso', 'Salida anticipada', 'Reemplazo de docente', 'Clase de recuperación', 'Salud', 'Problema de transporte', 'Otro'];",
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
    "  function iniciales(n) { return String(n).split(/\\s+/).filter(Boolean).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase(); }",
    "  function guardarPin(p) { try { sessionStorage.setItem('cvi_pin', p); } catch (e) { } }",
    "  function leerPin() { try { return sessionStorage.getItem('cvi_pin') || ''; } catch (e) { return ''; } }",
    "  function horaLima() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' })); }",
    "  function hhmm(d) { return d.toTimeString().slice(0, 5); }",
    "  var toastT;",
    "  function toast(html, ms) { var t = $('toast'); t.innerHTML = html; t.classList.remove('oculto'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.add('oculto'); }, ms || 4500); }",
    "  function abrirModal(titulo, html) { $('modal-titulo').textContent = titulo; $('modal-cuerpo').innerHTML = html; $('modal').classList.remove('oculto'); document.body.style.overflow = 'hidden'; }",
    "  function cerrarModal() { $('modal').classList.add('oculto'); document.body.style.overflow = ''; }",
    "  $('modal-cerrar').addEventListener('click', cerrarModal);",
    "  $('modal').addEventListener('click', function (e) { if (e.target === this) cerrarModal(); });",
    "",
    "  function tic() { var d = horaLima(); $('reloj').textContent = hhmm(d); $('fecha-hoy').textContent = d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }); }",
    "  setInterval(tic, 1000); tic();",
    "  api('getLogo').then(function (u) { if (u) { S.logo = u; $('logo').innerHTML = '<img alt=\"Logo CVI\" src=\"' + u + '\">'; } }).catch(function () { });",
    "",
    "  /* ===================== Login ===================== */",
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
    "  /* ===================== Tabs ===================== */",
    "  document.querySelector('.nav').addEventListener('click', function (e) {",
    "    var b = e.target.closest('[data-tab]'); if (!b) return;",
    "    var t = b.getAttribute('data-tab');",
    "    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('activo', x === b); });",
    "    ['hoy', 'marcar', 'horario', 'docentes', 'academico', 'reporte', 'qr'].forEach(function (x) { $('t-' + x).classList.toggle('oculto', x !== t); });",
    "    window.scrollTo(0, 0);",
    "    if (t === 'hoy') cargarHoy();",
    "    if (t === 'marcar') cargarCoord();",
    "    if (t === 'horario') cargarHorario();",
    "    if (t === 'docentes') cargarDocentes();",
    "    if (t === 'academico') cargarAcademico();",
    "    if (t === 'reporte') cargarReporte();",
    "    if (t === 'qr') cargarQR();",
    "  });",
    "",
    "  function kpi(l, v, extra, cls, pct) {",
    "    return '<div class=\"tarjeta kpi ' + (cls || '') + '\"><div class=\"l\">' + l + '</div><div class=\"v\">' + v + (extra ? ' <small>' + extra + '</small>' : '') + '</div>' +",
    "      (pct != null ? '<div class=\"barra-p\"><span style=\"width:' + Math.min(100, pct) + '%\"></span></div>' : '') + '</div>';",
    "  }",
    "",
    "  /* ===================== EN VIVO ===================== */",
    "  $('f-fecha').addEventListener('change', function () { S.fecha = this.value; cargarHoy(); });",
    "  function cargarHoy() {",
    "    if ($('t-hoy').classList.contains('oculto')) return;",
    "    api('getPanel', S.pin, S.fecha).then(pintarHoy).catch(function (e) {",
    "      $('vivo').classList.add('pausa'); $('vivo-txt').textContent = 'Sin conexión · reintentando (' + e.message + ')';",
    "    });",
    "  }",
    "  function pintarHoy(d) {",
    "    $('vivo').classList.toggle('pausa', !d.esHoy);",
    "    $('vivo-txt').textContent = d.esHoy ? 'En vivo · ' + d.hora + ' · cada 30 s' : DIAS_L[d.dia] + ' ' + d.fecha + ' (histórico)';",
    "    $('aviso-dni').innerHTML = d.docentesSinDni.length",
    "      ? '<span class=\"chip warn\" title=\"' + esc(d.docentesSinDni.join(', ')) + '\">ⓘ ' + d.docentesSinDni.length + ' docente(s) marcan con celular (falta DNI)</span>' : '';",
    "    var k = d.kpi;",
    "    $('kpis').innerHTML =",
    "      kpi('Docentes que llegaron', k.llegaron, 'de ' + k.programados, 'destacado', k.programados ? k.llegaron / k.programados * 100 : 0) +",
    "      kpi('En el colegio ahora', k.presentes) + kpi('Puntuales', k.puntuales) +",
    "      kpi('Tardanzas', k.tardanzas, '', k.tardanzas ? 'alerta-k' : '') +",
    "      kpi('Clases dictadas', k.dictados, 'de ' + k.bloques, '', k.bloques ? k.dictados / k.bloques * 100 : 0) +",
    "      kpi('Sin dictar / sin marcar', k.noDictados + k.sinMarcar, '', (k.noDictados + k.sinMarcar) ? 'alerta-k' : '');",
    "    pintarTimeline(d); pintarMarcaciones(d);",
    "    $('pendientes').innerHTML = d.faltan.length ? d.faltan.map(function (f) {",
    "      return '<div class=\"pend\"><div><div class=\"n\">' + esc(f.docente) + '</div><div class=\"d\">' + esc(f.salon) + ' · desde ' + esc(f.desde) + '</div></div>' +",
    "        '<div>' + (f.atrasado ? '<span class=\"chip rojo\">Atrasado</span>' : '<span class=\"chip\">Por llegar</span>') + '</div></div>';",
    "    }).join('') : '<div class=\"vacio-t\">✅ Todos los docentes programados ya marcaron.</div>';",
    "  }",
    "  function etiquetaEstado(e) { return { 'EN CLASE': 'En clase', 'DICTADO': 'Dictado', 'REEMPLAZO': 'Reemplazo', 'CONFIRMADO': 'Confirmado', 'PROGRAMADO': 'Programado', 'SIN MARCAR': 'Sin marcar', 'NO DICTADO': 'No dictado', 'SIN DOCENTE': 'Sin docente' }[e] || e; }",
    "  function pintarTimeline(d) {",
    "    if (!d.bloques.length) { $('timeline').innerHTML = $('tl-movil').innerHTML = '<div class=\"vacio-t\">No hay clases programadas este día.</div>'; return; }",
    "    var ini = Math.min(INICIO, Math.min.apply(null, d.bloques.map(function (b) { return min(b.inicio); })));",
    "    var fin = Math.max(FIN, Math.max.apply(null, d.bloques.map(function (b) { return min(b.fin); })));",
    "    var pct = function (m) { return ((m - ini) / (fin - ini) * 100).toFixed(3) + '%'; };",
    "    var marcas = '';",
    "    for (var h = Math.ceil(ini / 60) * 60; h <= fin; h += 60) marcas += '<span style=\"left:' + pct(h) + '\">' + (h / 60) + ':00</span>';",
    "    var salones = [];",
    "    d.bloques.forEach(function (b) { if (salones.indexOf(b.salon) < 0) salones.push(b.salon); });",
    "    var ahora = d.esHoy && min(d.hora) >= ini && min(d.hora) <= fin ? '<div class=\"tl-ahora\" style=\"left:' + pct(min(d.hora)) + '\"></div>' : '';",
    "    var quien = function (b) { return b.dicto ? (b.tipo === 'REEMPLAZO' ? '↻ ' + b.dicto : b.dicto) : (b.titular || 'Sin docente'); };",
    "    $('timeline').innerHTML = '<div class=\"tl-escala\"><div></div><div class=\"marcas\">' + marcas + '</div></div>' + salones.map(function (s) {",
    "      return '<div class=\"tl-fila\"><div class=\"tl-salon\">' + esc(s) + '</div><div class=\"tl-pista\">' + ahora + d.bloques.filter(function (b) { return b.salon === s; }).map(function (b) {",
    "        var tip = b.salon + ' · ' + b.curso + '\\n' + b.inicio + '–' + b.fin + '\\nTitular: ' + (b.titular || '—') + (b.dicto ? '\\nDictó: ' + b.dicto : '') + '\\nEstado: ' + etiquetaEstado(b.estado);",
    "        return '<div class=\"blq e-' + b.estado.replace(/ /g, '-') + '\" style=\"left:' + pct(min(b.inicio)) + ';width:calc(' + pct(min(b.fin)) + ' - ' + pct(min(b.inicio)) + ' - 3px)\" title=\"' + esc(tip) + '\">' +",
    "          '<b>' + esc(b.curso) + '</b><span>' + esc(quien(b)) + '</span></div>';",
    "      }).join('') + '</div></div>';",
    "    }).join('');",
    "    $('tl-movil').innerHTML = salones.map(function (s) {",
    "      return '<div class=\"tarjeta salon-card\"><h3>' + esc(s) + '</h3>' + d.bloques.filter(function (b) { return b.salon === s; }).map(function (b) {",
    "        return '<div class=\"fila-b\"><span class=\"h\">' + esc(b.inicio) + '–' + esc(b.fin) + '</span><span class=\"c\"><b>' + esc(b.curso) + '</b><span>' + esc(quien(b)) + '</span></span>' +",
    "          '<span class=\"est e-' + b.estado.replace(/ /g, '-') + '\">' + etiquetaEstado(b.estado) + '</span></div>';",
    "      }).join('') + '</div>';",
    "    }).join('');",
    "  }",
    "  function pintarMarcaciones(d) {",
    "    var porId = {}; d.bloques.forEach(function (b) { porId[b.id] = b; });",
    "    $('n-marc').textContent = d.marcaciones.length + ' registro(s)';",
    "    if (!d.marcaciones.length) { $('tabla-marc').innerHTML = '<tbody><tr><td class=\"vacio-t\">Aún no hay marcaciones este día.</td></tr></tbody>'; return; }",
    "    var filas = d.marcaciones.slice().sort(function (a, b) { return min(a.inicio) - min(b.inicio); }).map(function (m) {",
    "      var salones = m.bloques.map(function (id) { return porId[id] ? porId[id].salon : id; })",
    "        .concat(m.reemplazos.map(function (id) { return '↻ ' + (porId[id] ? porId[id].salon : id); }));",
    "      var uniq = salones.filter(function (v, i, a) { return a.indexOf(v) === i; });",
    "      var est = m.estado === 'TARDANZA' ? '<span class=\"chip warn\">Tarde ' + esc(m.minTarde) + ' min</span>' : m.estado === 'PUNTUAL' ? '<span class=\"chip ok\">Puntual</span>' : '<span class=\"chip\">' + esc(m.estado) + '</span>';",
    "      return '<tr><td class=\"titulo\"><span><b>' + esc(m.docente) + '</b><div class=\"muted\" style=\"font-size:12px\">' + esc(m.dispositivo) + '</div></span></td>' +",
    "        '<td class=\"num\" data-l=\"Ingreso\">' + esc(m.inicio) + '</td><td class=\"num\" data-l=\"Salida\">' + (m.fin ? esc(m.fin) : '<span class=\"chip ok\"><span class=\"punto\"></span>En el colegio</span>') + '</td>' +",
    "        '<td data-l=\"Estado\">' + est + '</td><td data-l=\"Salones\">' + esc(uniq.join(', ') || '—') + '</td><td class=\"num\" data-l=\"Horas\">' + (m.fin ? n2(m.horasEfectivas) : '—') + '</td>' +",
    "        '<td data-l=\"Obs.\">' + esc([m.obs, m.obsDetalle].filter(Boolean).join(': ') || '—') + '</td></tr>';",
    "    });",
    "    $('tabla-marc').innerHTML = '<thead><tr><th>Docente</th><th class=\"num\">Ingreso</th><th class=\"num\">Salida</th><th>Estado</th><th>Salones</th><th class=\"num\">Horas</th><th>Observación</th></tr></thead><tbody>' + filas.join('') + '</tbody>';",
    "  }",
    "",
    "  /* ===================== MARCAR (COORDINACIÓN) ===================== */",
    "  function cargarCoord() {",
    "    $('doc-grid').innerHTML = '<div class=\"muted\">Cargando…</div>';",
    "    api('coordListaDocentes', S.pin).then(function (r) {",
    "      S.coord = r; $('marcar-fecha').textContent = DIAS_L[r.dia] + ' ' + r.fecha + ' · ' + r.hora; pintarCoord();",
    "    }).catch(function (e) { $('doc-grid').innerHTML = '<div class=\"alerta\">' + esc(e.message) + '</div>'; });",
    "  }",
    "  $('buscar-doc').addEventListener('input', pintarCoord);",
    "  $('filtros').addEventListener('click', function (e) {",
    "    var b = e.target.closest('[data-f]'); if (!b) return;",
    "    S.filtro = b.getAttribute('data-f');",
    "    document.querySelectorAll('.filtro').forEach(function (x) { x.classList.toggle('sel', x === b); });",
    "    pintarCoord();",
    "  });",
    "  function pintarCoord() {",
    "    if (!S.coord) return;",
    "    var q = $('buscar-doc').value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');",
    "    var lista = S.coord.docentes.filter(function (d) {",
    "      var t = (d.docente + ' ' + d.nombreCompleto + ' ' + d.especialidad).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');",
    "      if (q && t.indexOf(q) < 0) return false;",
    "      if (q) return true;",
    "      if (S.filtro === 'hoy') return d.clasesHoy > 0 || d.estado !== 'SIN MARCAR';",
    "      if (S.filtro === 'sin') return d.estado === 'SIN MARCAR';",
    "      if (S.filtro === 'en') return d.estado === 'EN EL COLEGIO';",
    "      return true;",
    "    });",
    "    $('doc-grid').innerHTML = lista.length ? lista.map(function (d) {",
    "      var chip = d.estado === 'EN EL COLEGIO' ? '<span class=\"chip ok\"><span class=\"punto\"></span>En el colegio desde ' + esc(d.inicio) + '</span>'",
    "        : d.estado === 'SALIÓ' ? '<span class=\"chip oscuro\">Salió ' + esc(d.fin) + '</span>' : '<span class=\"chip\">Sin marcar</span>';",
    "      var btn = d.estado === 'EN EL COLEGIO' ? '<button class=\"btn btn-negro\" data-d=\"' + esc(d.docente) + '\" type=\"button\">Salida</button>'",
    "        : '<button class=\"btn btn-rojo\" data-d=\"' + esc(d.docente) + '\" type=\"button\">Ingreso</button>';",
    "      return '<div class=\"tarjeta doc-card\"><div class=\"avatar-s\">' + iniciales(d.docente) + '</div><div class=\"info\"><div class=\"n\">' + esc(d.docente) + '</div>' +",
    "        '<div class=\"d\">' + (d.clasesHoy ? d.clasesHoy + ' clase(s) hoy · desde ' + esc(d.desde) + ' · ' + esc(d.salones.join(', ')) : 'Sin clases hoy') + '</div>' + chip + '</div>' + btn + '</div>';",
    "    }).join('') : '<div class=\"vacio-t\">No hay docentes con este filtro.</div>';",
    "  }",
    "  $('doc-grid').addEventListener('click', function (e) { var b = e.target.closest('[data-d]'); if (b) abrirMarcaCoord(b.getAttribute('data-d')); });",
    "",
    "  function tarjetaClase(b, sel, tipo, bloqueada) {",
    "    return '<label class=\"clase' + (sel ? ' sel' : '') + (bloqueada ? ' bloq' : '') + '\" data-id=\"' + esc(b.id) + '\" data-tipo=\"' + tipo + '\">' +",
    "      '<input type=\"checkbox\"' + (sel ? ' checked' : '') + '><span class=\"check\"><svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.5\"><path d=\"M20 6 9 17l-5-5\"/></svg></span>' +",
    "      '<span class=\"info\"><div class=\"salon\">' + esc(b.salon) + '</div><div class=\"curso\">' + esc(b.curso) + (tipo === 'R' ? ' · titular: ' + esc(b.docente || 'sin docente') : '') +",
    "      (bloqueada ? ' · ya lo marcó ' + esc(b.tomadoPor) : '') + '</div></span><span class=\"hora\">' + esc(b.inicio) + ' – ' + esc(b.fin) + '</span></label>';",
    "  }",
    "  function abrirMarcaCoord(nombre) {",
    "    abrirModal(nombre, '<div class=\"muted\">Cargando…</div>');",
    "    api('coordBuscar', S.pin, nombre).then(function (d) {",
    "      var ab = d.abierta, selP = ab ? ab.bloques : d.propios.map(function (b) { return b.id; }), selR = ab ? ab.reemplazos : [];",
    "      var grupos = {}; d.otros.forEach(function (b) { (grupos[b.salon] = grupos[b.salon] || []).push(b); });",
    "      var html =",
    "        '<div class=\"hora-coord\"><div><div style=\"font-weight:800\">' + (ab ? 'Hora de salida' : 'Hora de ingreso') + '</div><div class=\"muted\" style=\"font-size:13px\">' +",
    "        (ab ? 'Ingresó a las ' + esc(ab.inicio) + '. ' : '') + 'Puedes corregirla si llegó/salió antes.</div></div><input type=\"time\" id=\"c-hora\" value=\"' + esc(d.hora) + '\"></div>' +",
    "        '<div class=\"h-seccion\">' + (ab ? 'Salones que dictó' : 'Salones que dictará hoy') + ' · ' + DIAS_L[d.dia] + '</div><div class=\"clases\">' +",
    "        (d.propios.length ? d.propios.map(function (b) { return tarjetaClase(b, selP.indexOf(b.id) >= 0, 'P'); }).join('') : '<div class=\"vacio\">Sin clases programadas hoy.</div>') + '</div>' +",
    "        '<div class=\"h-seccion\">Reemplazos (clases de otros docentes)</div>' +",
    "        (Object.keys(grupos).length ? '<details' + (selR.length || !d.propios.length ? ' open' : '') + '><summary style=\"cursor:pointer;font-weight:700;margin-bottom:8px\">Ver ' + d.otros.length + ' clase(s) de hoy</summary>' +",
    "          Object.keys(grupos).map(function (s) { return '<div class=\"grupo-salon\">' + esc(s) + '</div><div class=\"clases\">' + grupos[s].map(function (b) { return tarjetaClase(b, selR.indexOf(b.id) >= 0, 'R', !!b.tomadoPor && selR.indexOf(b.id) < 0); }).join('') + '</div>'; }).join('') + '</details>'",
    "          : '<div class=\"vacio\">No hay otras clases hoy.</div>') +",
    "        '<div class=\"h-seccion\">Observación</div><div class=\"obs-chips\" id=\"c-obs\">' + ['Ninguna'].concat(OBS).map(function (o, i) { return '<button type=\"button\" class=\"obs-chip' + (i ? '' : ' sel') + '\" data-o=\"' + esc(o) + '\">' + esc(o) + '</button>'; }).join('') + '</div>' +",
    "        '<textarea id=\"c-obs-det\" class=\"oculto\" placeholder=\"Escribe el detalle…\"></textarea>' +",
    "        '<div class=\"alerta oculto\" id=\"c-err\"></div>' +",
    "        '<div style=\"margin-top:16px\"><button class=\"btn btn-grande ' + (ab ? 'btn-negro' : 'btn-rojo') + '\" id=\"c-marcar\" type=\"button\">' + (ab ? '⏹ Registrar SALIDA' : '▶ Registrar INGRESO') + '</button></div>' +",
    "        '<div class=\"muted\" style=\"font-size:12px;text-align:center;margin-top:8px\">Quedará registrado como “Coordinación”.</div>';",
    "      $('modal-cuerpo').innerHTML = html;",
    "      var obs = '';",
    "      $('c-obs').addEventListener('click', function (e) {",
    "        var b = e.target.closest('[data-o]'); if (!b) return;",
    "        obs = b.getAttribute('data-o') === 'Ninguna' ? '' : b.getAttribute('data-o');",
    "        this.querySelectorAll('.obs-chip').forEach(function (x) { x.classList.toggle('sel', x === b); });",
    "        $('c-obs-det').classList.toggle('oculto', obs !== 'Otro');",
    "      });",
    "      $('modal-cuerpo').querySelectorAll('.clase').forEach(function (c) {",
    "        c.addEventListener('click', function (e) {",
    "          e.preventDefault(); if (c.classList.contains('bloq')) return;",
    "          var i = c.querySelector('input'); i.checked = !i.checked; c.classList.toggle('sel', i.checked);",
    "        });",
    "      });",
    "      $('c-marcar').addEventListener('click', function () {",
    "        var p = { docente: d.docente, hora: $('c-hora').value, bloques: [], reemplazos: [], obs: obs, obsDetalle: $('c-obs-det').value.trim() };",
    "        $('modal-cuerpo').querySelectorAll('.clase.sel').forEach(function (c) { (c.getAttribute('data-tipo') === 'R' ? p.reemplazos : p.bloques).push(c.getAttribute('data-id')); });",
    "        var btn = this; btn.disabled = true; btn.innerHTML = '<span class=\"spinner\"></span> Registrando…';",
    "        api('coordMarcar', S.pin, p).then(function (r) {",
    "          if (!r.ok) { $('c-err').textContent = r.error; $('c-err').classList.remove('oculto'); btn.disabled = false; btn.textContent = ab ? '⏹ Registrar SALIDA' : '▶ Registrar INGRESO'; return; }",
    "          cerrarModal();",
    "          toast(r.tipo === 'INGRESO' ? '✅ Ingreso de ' + esc(r.docente) + ' a las ' + r.hora + (r.estado === 'TARDANZA' ? ' · tardanza ' + r.minTarde + ' min' : '')",
    "            : '✅ Salida de ' + esc(r.docente) + ' a las ' + r.hora + ' · ' + n2(r.horas.efectivas) + ' h dictadas');",
    "          cargarCoord();",
    "        }).catch(function (e) { $('c-err').textContent = e.message; $('c-err').classList.remove('oculto'); btn.disabled = false; btn.textContent = 'Reintentar'; });",
    "      });",
    "    }).catch(function (e) { $('modal-cuerpo').innerHTML = '<div class=\"alerta\">' + esc(e.message) + '</div>'; });",
    "  }",
    "",
    "  /* ===================== HORARIO ===================== */",
    "  function cargarHorario(mantener) {",
    "    if (!mantener) $('semana').innerHTML = '<div class=\"muted\">Cargando…</div>';",
    "    return api('getHorarioAdmin', S.pin).then(function (r) { S.horario = r; pintarSelectorHorario(); pintarSemana(); })",
    "      .catch(function (e) { $('semana').innerHTML = '<div class=\"alerta\">' + esc(e.message) + '</div>'; });",
    "  }",
    "  $('h-modo').addEventListener('click', function (e) {",
    "    var b = e.target.closest('[data-m]'); if (!b) return;",
    "    S.hModo = b.getAttribute('data-m'); S.hSel = '';",
    "    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('sel', x === b); });",
    "    pintarSelectorHorario(); pintarSemana();",
    "  });",
    "  $('h-sel').addEventListener('change', function () { S.hSel = this.value; pintarSemana(); });",
    "  function pintarSelectorHorario() {",
    "    var ops = S.hModo === 'salon' ? S.horario.salones : S.horario.docentes;",
    "    if (ops.indexOf(S.hSel) < 0) S.hSel = ops[0] || '';",
    "    $('h-sel').innerHTML = ops.map(function (o) { return '<option' + (o === S.hSel ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');",
    "  }",
    "  function pintarSemana() {",
    "    var bl = S.horario.bloques.filter(function (b) { return S.hModo === 'salon' ? b.salon === S.hSel : b.docente === S.hSel; });",
    "    var total = 0;",
    "    $('semana').innerHTML = DIAS.map(function (dia) {",
    "      var delDia = bl.filter(function (b) { return b.dia === dia; }).sort(function (a, b) { return min(a.inicio) - min(b.inicio); });",
    "      var horas = delDia.reduce(function (s, b) { return s + (min(b.fin) - min(b.inicio)) / 60; }, 0); total += horas;",
    "      return '<div class=\"dia-col\"><h3>' + DIAS_L[dia] + '<small>' + (horas ? horas.toFixed(2).replace(/\\.?0+$/, '') + ' h' : '') + '</small></h3>' +",
    "        (delDia.length ? delDia.map(function (b) {",
    "          return '<button class=\"bq' + (b.docente ? '' : ' sin-doc') + '\" data-id=\"' + esc(b.id) + '\" type=\"button\"><div class=\"h\">' + esc(b.inicio) + ' – ' + esc(b.fin) + '</div>' +",
    "            '<div class=\"c\">' + esc(b.curso) + '</div><div class=\"d\">' + esc(S.hModo === 'salon' ? (b.docente || 'Sin docente') : b.salon) + '</div>' +",
    "            (b.nota ? '<div class=\"nota\">⚠ ' + esc(b.nota) + '</div>' : '') + '</button>';",
    "        }).join('') : '<div class=\"vacio-d\">Sin clases</div>') +",
    "        '<button class=\"agregar\" data-nuevo=\"' + dia + '\" type=\"button\">＋ Agregar</button></div>';",
    "    }).join('');",
    "    $('h-resumen').textContent = bl.length + ' bloque(s) · ' + total.toFixed(2).replace(/\\.?0+$/, '') + ' h/semana';",
    "  }",
    "  $('semana').addEventListener('click', function (e) {",
    "    var b = e.target.closest('.bq'), n = e.target.closest('[data-nuevo]');",
    "    if (b) editarBloque(S.horario.bloques.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0]);",
    "    if (n) editarBloque(null, n.getAttribute('data-nuevo'));",
    "  });",
    "  $('h-nuevo').addEventListener('click', function () { editarBloque(null, 'LUNES'); });",
    "",
    "  function editarBloque(b, dia) {",
    "    var nuevo = !b;",
    "    b = b || { id: '', salon: S.hModo === 'salon' ? S.hSel : '', dia: dia, inicio: '08:00', fin: '10:00', curso: '', docente: S.hModo === 'docente' ? S.hSel : '', nota: '' };",
    "    var cursos = {}; S.horario.bloques.forEach(function (x) { cursos[x.curso] = true; });",
    "    var html = '<div class=\"form-grid\">' +",
    "      '<label>Salón<input id=\"f-salon\" list=\"dl-salones\" value=\"' + esc(b.salon) + '\" placeholder=\"Ej. ANUAL INTEGRAL\"></label>' +",
    "      '<label>Día<select id=\"f-dia\">' + DIAS.map(function (d) { return '<option value=\"' + d + '\"' + (d === b.dia ? ' selected' : '') + '>' + DIAS_L[d] + '</option>'; }).join('') + '</select></label>' +",
    "      '<label>Inicio<input id=\"f-ini\" type=\"time\" step=\"300\" value=\"' + esc(b.inicio) + '\"></label>' +",
    "      '<label>Fin<input id=\"f-fin\" type=\"time\" step=\"300\" value=\"' + esc(b.fin) + '\"></label>' +",
    "      '<label class=\"full\">Curso<input id=\"f-curso\" list=\"dl-cursos\" value=\"' + esc(b.curso) + '\" placeholder=\"Ej. ÁLGEBRA\"></label>' +",
    "      '<label class=\"full\">Docente<select id=\"f-doc\"><option value=\"\">— Sin docente asignado —</option>' + S.horario.docentes.map(function (d) { return '<option' + (d === b.docente ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select></label>' +",
    "      '<label class=\"full\">Nota (opcional)<input id=\"f-nota\" value=\"' + esc(b.nota) + '\" placeholder=\"Ej. clase conjunta con Creadores\"></label></div>' +",
    "      '<datalist id=\"dl-salones\">' + S.horario.salones.map(function (s) { return '<option value=\"' + esc(s) + '\">'; }).join('') + '</datalist>' +",
    "      '<datalist id=\"dl-cursos\">' + Object.keys(cursos).sort().map(function (s) { return '<option value=\"' + esc(s) + '\">'; }).join('') + '</datalist>' +",
    "      '<div class=\"alerta oculto\" id=\"f-err\"></div>' +",
    "      '<div style=\"display:flex;gap:10px;margin-top:18px;flex-wrap:wrap\">' +",
    "      '<button class=\"btn btn-rojo\" id=\"f-guardar\" type=\"button\" style=\"flex:1;min-width:160px\">' + (nuevo ? 'Agregar bloque' : 'Guardar cambios') + '</button>' +",
    "      (nuevo ? '' : '<button class=\"btn btn-claro\" id=\"f-eliminar\" type=\"button\" style=\"color:var(--rojo)\">Eliminar</button>') + '</div>' +",
    "      (nuevo ? '' : '<div class=\"muted\" style=\"font-size:12px;margin-top:10px\">ID del bloque: ' + esc(b.id) + ' (se conserva al editar para no afectar las marcaciones pasadas).</div>');",
    "    abrirModal(nuevo ? 'Nuevo bloque' : 'Editar bloque', html);",
    "    $('f-guardar').addEventListener('click', function () {",
    "      var dato = { id: b.id, salon: $('f-salon').value, dia: $('f-dia').value, inicio: $('f-ini').value, fin: $('f-fin').value, curso: $('f-curso').value, docente: $('f-doc').value, nota: $('f-nota').value };",
    "      var btn = this; btn.disabled = true;",
    "      api('guardarBloque', S.pin, dato).then(function (r) {",
    "        btn.disabled = false;",
    "        if (!r.ok) { $('f-err').textContent = r.error; $('f-err').classList.remove('oculto'); return; }",
    "        cerrarModal();",
    "        if (S.hModo === 'salon') S.hSel = r.bloque.salon;",
    "        toast('✅ ' + (r.nuevo ? 'Bloque agregado' : 'Cambios guardados') + (r.avisos.length ? '<br>ⓘ ' + esc(r.avisos.join(' ')) : ''), r.avisos.length ? 8000 : 3500);",
    "        cargarHorario(true);",
    "      }).catch(function (e) { btn.disabled = false; $('f-err').textContent = e.message; $('f-err').classList.remove('oculto'); });",
    "    });",
    "    if (!nuevo) $('f-eliminar').addEventListener('click', function () {",
    "      if (!confirm('¿Eliminar ' + b.curso + ' (' + DIAS_L[b.dia] + ' ' + b.inicio + '–' + b.fin + ') de ' + b.salon + '?')) return;",
    "      api('eliminarBloque', S.pin, b.id).then(function (r) {",
    "        if (!r.ok) { $('f-err').textContent = r.error; $('f-err').classList.remove('oculto'); return; }",
    "        cerrarModal(); toast('🗑 Bloque eliminado'); cargarHorario(true);",
    "      }).catch(function (e) { $('f-err').textContent = e.message; $('f-err').classList.remove('oculto'); });",
    "    });",
    "  }",
    "",
    "  /* ===================== DOCENTES ===================== */",
    "  S.dFiltro = 'activos'; S.docs = null;",
    "  function cargarDocentes() {",
    "    if (!S.docs) $('d-grid').innerHTML = '<div class=\"muted\">Cargando…</div>';",
    "    return api('getDocentesAdmin', S.pin).then(function (r) { S.docs = r.docentes; pintarDocentes(); })",
    "      .catch(function (e) { $('d-grid').innerHTML = '<div class=\"alerta\">' + esc(e.message) + '</div>'; });",
    "  }",
    "  $('d-buscar').addEventListener('input', pintarDocentes);",
    "  $('d-filtros').addEventListener('click', function (e) {",
    "    var b = e.target.closest('[data-f]'); if (!b) return;",
    "    S.dFiltro = b.getAttribute('data-f');",
    "    this.querySelectorAll('.filtro').forEach(function (x) { x.classList.toggle('sel', x === b); });",
    "    pintarDocentes();",
    "  });",
    "  function sinTildes(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }",
    "  function pintarDocentes() {",
    "    if (!S.docs) return;",
    "    var q = sinTildes($('d-buscar').value);",
    "    var act = S.docs.filter(function (d) { return d.activo; }).length;",
    "    $('d-resumen').textContent = act + ' activo(s) · ' + (S.docs.length - act) + ' inactivo(s)';",
    "    var lista = S.docs.filter(function (d) {",
    "      if (q) return sinTildes([d.docente, d.nombreCompleto, d.dni, d.celular, d.especialidad, d.correo].join(' ')).indexOf(q) >= 0;",
    "      return S.dFiltro === 'todos' || (S.dFiltro === 'activos' ? d.activo : !d.activo);",
    "    });",
    "    $('d-grid').innerHTML = lista.length ? lista.map(function (d) {",
    "      var chips = [];",
    "      if (!d.dni) chips.push('<span class=\"chip warn\">Sin DNI · marca con celular</span>');",
    "      if (!d.dni && !d.celular) chips.push('<span class=\"chip rojo\">No puede marcar</span>');",
    "      if (d.activo && !d.bloques) chips.push('<span class=\"chip\">Sin clases en el horario</span>');",
    "      if (d.bloques) chips.push('<span class=\"chip oscuro\">' + d.bloques + ' bloque(s) · ' + String(d.horasSemana).replace('.', ',') + ' h/sem</span>');",
    "      return '<div class=\"tarjeta dc' + (d.activo ? '' : ' inactivo') + '\" data-doc=\"' + esc(d.docente) + '\"><div class=\"avatar-s\">' + iniciales(d.docente) + '</div>' +",
    "        '<div><div class=\"n\">' + esc(d.docente) + '</div>' + (d.nombreCompleto && d.nombreCompleto !== d.docente ? '<div class=\"nc\">' + esc(d.nombreCompleto) + '</div>' : '') +",
    "        '<div class=\"datos\">' + (d.especialidad ? '<span>📚 ' + esc(d.especialidad) + '</span>' : '') + (d.dni ? '<span>🪪 ' + esc(d.dni) + '</span>' : '') +",
    "        (d.celular ? '<span>📱 ' + esc(d.celular) + '</span>' : '') + '</div>' +",
    "        (d.salones.length ? '<div class=\"nc\" style=\"margin-top:4px\">' + esc(d.salones.join(' · ')) + '</div>' : '') +",
    "        (d.notas ? '<div class=\"nc\" style=\"margin-top:4px\">📝 ' + esc(d.notas) + '</div>' : '') +",
    "        '<div class=\"chips\">' + chips.join('') + '</div></div>' +",
    "        '<label class=\"switch-l\" data-sw=\"1\"><span class=\"switch\"><input type=\"checkbox\"' + (d.activo ? ' checked' : '') + '><span class=\"pista\"></span></span>' + (d.activo ? 'Activo' : 'Inactivo') + '</label></div>';",
    "    }).join('') : '<div class=\"vacio-t\">No hay docentes con este filtro.</div>';",
    "  }",
    "  $('d-grid').addEventListener('click', function (e) {",
    "    var card = e.target.closest('[data-doc]'); if (!card) return;",
    "    var d = S.docs.filter(function (x) { return x.docente === card.getAttribute('data-doc'); })[0];",
    "    var sw = e.target.closest('[data-sw]');",
    "    if (sw) {",
    "      e.preventDefault();",
    "      var nuevo = !d.activo;",
    "      if (!nuevo && d.bloques && !confirm(d.docente + ' tiene ' + d.bloques + ' bloque(s) en el horario. Si lo desactivas no podrá marcar asistencia. ¿Continuar?')) return;",
    "      api('cambiarActivoDocente', S.pin, d.docente, nuevo).then(function (r) {",
    "        if (!r.ok) return toast('Error: ' + esc(r.error));",
    "        d.activo = nuevo; pintarDocentes(); S.horario = null; S.coord = null;",
    "        toast((nuevo ? '✅ ' : '⏸ ') + esc(d.docente) + (nuevo ? ' activado' : ' desactivado'));",
    "      }).catch(function (er) { toast('Error: ' + esc(er.message)); });",
    "      return;",
    "    }",
    "    editarDocente(d);",
    "  });",
    "  $('d-nuevo').addEventListener('click', function () { editarDocente(null); });",
    "",
    "  function editarDocente(d) {",
    "    var nuevo = !d;",
    "    d = d || { docente: '', nombreCompleto: '', dni: '', celular: '', especialidad: '', correo: '', activo: true, notas: '', bloques: 0 };",
    "    var html = '<div class=\"form-grid\">' +",
    "      '<label><span>Nombre corto <span class=\"req\">*</span></span><input id=\"g-docente\" value=\"' + esc(d.docente) + '\" placeholder=\"Ej. Ana Pérez\"><span class=\"ayuda\">Así aparece en el horario y en los reportes.</span></label>' +",
    "      '<label>Nombre completo<input id=\"g-nombre\" value=\"' + esc(d.nombreCompleto) + '\" placeholder=\"Nombres y apellidos\"></label>' +",
    "      '<label>DNI<input id=\"g-dni\" inputmode=\"numeric\" maxlength=\"8\" value=\"' + esc(d.dni) + '\" placeholder=\"8 dígitos\"></label>' +",
    "      '<label>Celular<input id=\"g-cel\" inputmode=\"tel\" value=\"' + esc(d.celular) + '\" placeholder=\"9 dígitos\"></label>' +",
    "      '<label class=\"full\"><span class=\"ayuda\" style=\"margin-top:-6px\">Con el DNI <b>o</b> el celular el docente marca su asistencia (al menos uno es obligatorio).</span></label>' +",
    "      '<label>Especialidad / cursos<input id=\"g-esp\" value=\"' + esc(d.especialidad) + '\" placeholder=\"Ej. Matemática\"></label>' +",
    "      '<label>Correo<input id=\"g-correo\" type=\"email\" value=\"' + esc(d.correo) + '\" placeholder=\"correo@gmail.com\"></label>' +",
    "      '<label class=\"full\">Notas<textarea id=\"g-notas\" placeholder=\"Ej. fecha de ingreso, disponibilidad, contacto de emergencia…\">' + esc(d.notas) + '</textarea></label>' +",
    "      '<label class=\"full\" style=\"flex-direction:row;display:flex;align-items:center;gap:12px\"><span class=\"switch\"><input type=\"checkbox\" id=\"g-activo\"' + (d.activo ? ' checked' : '') + '><span class=\"pista\"></span></span><span>Docente activo (puede marcar asistencia)</span></label>' +",
    "      '</div>' +",
    "      (nuevo ? '' : '<div class=\"aviso oculto\" id=\"g-aviso-nombre\">Al cambiar el nombre corto también se actualizará en sus ' + d.bloques + ' bloque(s) del horario.</div>') +",
    "      '<div class=\"alerta oculto\" id=\"g-err\"></div>' +",
    "      '<div style=\"margin-top:18px\"><button class=\"btn btn-rojo btn-grande\" id=\"g-guardar\" type=\"button\">' + (nuevo ? 'Agregar docente' : 'Guardar cambios') + '</button></div>';",
    "    abrirModal(nuevo ? 'Nuevo docente' : d.docente, html);",
    "    if (!nuevo) $('g-docente').addEventListener('input', function () { $('g-aviso-nombre').classList.toggle('oculto', this.value.trim() === d.docente || !d.bloques); });",
    "    $('g-guardar').addEventListener('click', function () {",
    "      var dato = { docente: $('g-docente').value, nombreCompleto: $('g-nombre').value, dni: $('g-dni').value, celular: $('g-cel').value,",
    "        especialidad: $('g-esp').value, correo: $('g-correo').value, notas: $('g-notas').value, activo: $('g-activo').checked };",
    "      var btn = this; btn.disabled = true;",
    "      api('guardarDocente', S.pin, dato, nuevo ? '' : d.docente).then(function (r) {",
    "        btn.disabled = false;",
    "        if (!r.ok) { $('g-err').textContent = r.error; $('g-err').classList.remove('oculto'); return; }",
    "        cerrarModal(); S.horario = null; S.coord = null;",
    "        toast('✅ ' + (r.nuevo ? 'Docente agregado: ' : 'Datos guardados: ') + esc(r.docente.docente) + (r.renombrados ? ' · ' + r.renombrados + ' bloque(s) del horario actualizados' : ''));",
    "        cargarDocentes();",
    "      }).catch(function (e) { btn.disabled = false; $('g-err').textContent = e.message; $('g-err').classList.remove('oculto'); });",
    "    });",
    "  }",
    "",
    "  /* ===================== ACADÉMICO ===================== */",
    "  var TIPOS_AV = { COMPLETADO: '✅ Completado', PARCIAL: '⏳ Parcial', REPASO: '🔁 Repaso', EVALUACION: '📝 Práctica/Evaluación' };",
    "  var SEM_TXT = { VERDE: 'Al día', AMBAR: '1 tema de atraso', ROJO: 'Atrasado' };",
    "  S.acVista = 'avance'; S.ac = null;",
    "  $('ac-vista').addEventListener('click', function (e) {",
    "    var b = e.target.closest('[data-v]'); if (!b) return;",
    "    S.acVista = b.getAttribute('data-v');",
    "    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('sel', x === b); });",
    "    ['avance', 'lecc', 'cal'].forEach(function (v) { $('ac-' + v).classList.toggle('oculto', v !== S.acVista); });",
    "    if (S.acVista === 'lecc') cargarLeccionario();",
    "    if (S.acVista === 'cal') cargarCalendario();",
    "  });",
    "  function cargarAcademico() {",
    "    if (!S.ac) $('ac-cursos').innerHTML = '<div class=\"muted\">Cargando…</div>';",
    "    api('getAcademico', S.pin).then(function (r) { S.ac = r; pintarAcademico(r); })",
    "      .catch(function (e) { $('ac-cursos').innerHTML = '<div class=\"alerta\">' + esc(e.message) + '</div>'; });",
    "    if (S.acVista === 'lecc') cargarLeccionario();",
    "  }",
    "  function barra32(c, esperado) {",
    "    var h = '';",
    "    for (var n = 1; n <= c.total; n++) {",
    "      var cl = c.completados.indexOf(n) >= 0 ? 'c' : c.parciales.indexOf(n) >= 0 ? 'p' : '';",
    "      if (n === esperado) cl += ' esp';",
    "      h += '<span class=\"' + cl + '\" title=\"Tema ' + n + '\"></span>';",
    "    }",
    "    return '<div class=\"barra32\">' + h + '</div>';",
    "  }",
    "  function pintarAcademico(r) {",
    "    var sm = r.semana;",
    "    $('ac-semana').innerHTML = sm ? (sm.tipo === 'CLASE'",
    "      ? '<span class=\"chip oscuro\">Semana ' + esc(sm.nSemana) + ' de 32 · Boletín ' + esc(sm.boletin) + ' · Bimestre ' + esc(sm.bimestre) + '</span>'",
    "      : '<span class=\"chip warn\">' + esc(sm.descripcion || sm.tipo) + ' · no avanza tema</span>') : '';",
    "    var k = r.kpi;",
    "    $('ac-kpis').innerHTML = kpi('Cobertura promedio', k.cobertura + '%', '', 'destacado', k.cobertura) +",
    "      kpi('Cursos al día', k.verde, 'de ' + k.cursos) + kpi('1 tema de atraso', k.ambar, '', k.ambar ? 'alerta-k' : '') +",
    "      kpi('Atrasados (2+)', k.rojo, '', k.rojo ? 'alerta-k' : '') + kpi('Clases sin tema', k.sinTema, '', k.sinTema ? 'alerta-k' : '') +",
    "      kpi('Temas por confirmar', k.porConfirmar, '', '');",
    "    var al = r.alertas.slice(0, 12);",
    "    $('ac-alertas').innerHTML = al.length ? '<div class=\"seccion-t\"><h2>⚠️ Alertas</h2><span class=\"muted\">' + r.alertas.length + ' en total</span></div><div class=\"tarjeta\">' + al.map(function (a) {",
    "      return '<div class=\"alerta-item\"><span>' + (a.nivel === 'ROJO' ? '🔴' : '🟡') + '</span><span style=\"flex:1\">' + esc(a.texto) + '</span>' +",
    "        (a.tipo === 'SIN_TEMA' ? '<button class=\"btn btn-claro btn-s\" data-sin=\"' + esc(a.cursoId) + '|' + esc(a.fecha) + '|' + esc(a.marcacion) + '|' + esc(a.docente) + '\" type=\"button\" style=\"padding:6px 10px\">Registrar</button>' : '') + '</div>';",
    "    }).join('') + '</div>' : '';",
    "    $('ac-cursos').innerHTML = r.cursos.map(function (c) {",
    "      return '<div class=\"tarjeta ac-card ' + c.semaforo + '\" data-curso=\"' + esc(c.id) + '\"><div class=\"top\"><div><div class=\"n\">' + esc(c.curso) + '</div>' +",
    "        '<div class=\"d\">' + esc(c.docentes.join(', ') || 'Sin docente en el horario') + '</div></div><span class=\"sem ' + c.semaforo + '\">' + SEM_TXT[c.semaforo] + '</span></div>' +",
    "        barra32(c, r.esperado.completados) +",
    "        '<div class=\"linea\">✅ <b>Va en el tema ' + c.ultimoContinuo + '</b>' + (c.ultimoTema ? ' · ' + esc(c.ultimoTema.tema) : '') + '</div>' +",
    "        (c.siguienteTema ? '<div class=\"linea muted\">➡ Sigue: ' + c.siguienteTema.n + ' · ' + esc(c.siguienteTema.tema) + '</div>' : '<div class=\"linea\">🎉 Currícula completa</div>') +",
    "        '<div class=\"d\" style=\"margin-top:6px\">Cobertura ' + c.cobertura + '% · debería ir en el ' + r.esperado.completados + (c.porConfirmar ? ' · ⚠ ' + c.porConfirmar + ' tema(s) por confirmar' : '') + '</div></div>';",
    "    }).join('');",
    "  }",
    "  $('ac-cursos').addEventListener('click', function (e) { var c = e.target.closest('[data-curso]'); if (c) abrirCurso(c.getAttribute('data-curso')); });",
    "  $('ac-alertas').addEventListener('click', function (e) {",
    "    var b = e.target.closest('[data-sin]'); if (!b) return;",
    "    var p = b.getAttribute('data-sin').split('|');",
    "    formRegistroCoord({ cursoId: p[0], fecha: p[1], marcacion: p[2], docente: p[3] });",
    "  });",
    "",
    "  function abrirCurso(id) {",
    "    abrirModal('Cargando…', '<div class=\"muted\">Cargando…</div>');",
    "    api('getCursoDetalle', S.pin, id).then(function (c) {",
    "      $('modal-titulo').textContent = c.curso + ' · ' + c.salon;",
    "      var porBol = {};",
    "      c.temas.forEach(function (t) { (porBol[t.boletin] = porBol[t.boletin] || []).push(t); });",
    "      $('modal-cuerpo').innerHTML =",
    "        '<div style=\"display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between\"><span class=\"sem ' + c.semaforo + '\">' + SEM_TXT[c.semaforo] +",
    "        (c.atraso ? ' · ' + c.atraso + ' tema(s)' : '') + '</span><span class=\"muted\" style=\"font-size:13px\">Cobertura ' + c.cobertura + '% · debería ir en el tema ' + c.esperado + '</span></div>' +",
    "        barra32(c, c.esperado) +",
    "        '<div class=\"hora-coord\" style=\"margin-top:12px\"><div style=\"flex:1;min-width:200px\"><div style=\"font-weight:800\">Avance inicial</div><div class=\"muted\" style=\"font-size:13px\">Temas que ya estaban completos antes de usar el sistema (línea base). Ajústalo si el curso iba atrasado.</div></div>' +",
    "        '<input type=\"number\" min=\"0\" max=\"32\" id=\"cd-base\" value=\"' + c.avanceInicial + '\" style=\"width:90px\"><button class=\"btn btn-negro btn-s\" id=\"cd-base-ok\" type=\"button\">Guardar</button></div>' +",
    "        '<div class=\"temas-lista\">' + Object.keys(porBol).sort(function (a, b) { return a - b; }).map(function (b) {",
    "          return '<div class=\"bolh\">Boletín ' + b + '</div>' + porBol[b].map(function (t) {",
    "            var reg = t.registros.length ? t.registros.map(function (r) { return r.fecha + ' ' + (TIPOS_AV[r.tipo] || r.tipo) + ' (' + r.docente + ')'; }).join(' · ') : (t.estado === 'COMPLETADO' ? 'Completado antes del sistema' : '');",
    "            return '<div class=\"tema-fila ' + t.estado + '\" data-tema=\"' + esc(t.id) + '\"><span class=\"num\">' + t.n + '</span><div><div class=\"t' + (t.estadoDato !== 'OK' ? ' conf' : '') + '\">' + esc(t.tema) +",
    "              (t.estadoDato !== 'OK' ? ' <span class=\"chip warn\" style=\"font-size:11px;padding:2px 7px\">por confirmar</span>' : '') + '</div><div class=\"r\">' + esc(reg) + '</div></div>' +",
    "              '<div style=\"white-space:nowrap\"><button class=\"mini\" data-edit=\"' + esc(t.id) + '\" title=\"Editar título\" type=\"button\">✏️</button><button class=\"mini\" data-reg=\"' + t.n + '\" title=\"Registrar como dictado\" type=\"button\">➕</button></div></div>';",
    "          }).join('');",
    "        }).join('') + '</div>';",
    "      $('cd-base-ok').addEventListener('click', function () {",
    "        api('guardarAvanceInicial', S.pin, c.id, $('cd-base').value).then(function (r) {",
    "          if (!r.ok) return toast('Error: ' + esc(r.error));",
    "          toast('✅ Avance inicial guardado'); cargarAcademico(); abrirCurso(c.id);",
    "        });",
    "      });",
    "      $('modal-cuerpo').querySelector('.temas-lista').addEventListener('click', function (e) {",
    "        var be = e.target.closest('[data-edit]'), br = e.target.closest('[data-reg]');",
    "        if (br) return formRegistroCoord({ cursoId: c.id, n: +br.getAttribute('data-reg') });",
    "        if (!be) return;",
    "        var fila = be.closest('.tema-fila'), tdiv = fila.querySelector('.t'), actual = c.temas.filter(function (x) { return x.id === be.getAttribute('data-edit'); })[0];",
    "        tdiv.innerHTML = '<input value=\"' + esc(actual.tema.indexOf('(por completar)') >= 0 ? '' : actual.tema) + '\" placeholder=\"Título del tema ' + actual.n + '\">';",
    "        var inp = tdiv.querySelector('input'); inp.focus();",
    "        var guardar = function () {",
    "          if (!inp.value.trim() || inp.value.trim() === actual.tema) { abrirCurso(c.id); return; }",
    "          api('guardarTituloTema', S.pin, actual.id, inp.value).then(function (r) {",
    "            if (!r.ok) return toast('Error: ' + esc(r.error));",
    "            toast('✅ Tema ' + actual.n + ' actualizado'); abrirCurso(c.id); cargarAcademico();",
    "          });",
    "        };",
    "        inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') guardar(); if (ev.key === 'Escape') abrirCurso(c.id); });",
    "        inp.addEventListener('blur', guardar);",
    "      });",
    "    }).catch(function (e) { $('modal-cuerpo').innerHTML = '<div class=\"alerta\">' + esc(e.message) + '</div>'; });",
    "  }",
    "",
    "  function formRegistroCoord(pre) {",
    "    var cursos = (S.ac && S.ac.cursos) || S.cursosAc || [];",
    "    if (!cursos.length) { api('getLeccionario', S.pin, {}).then(function (r) { S.cursosAc = r.cursos; formRegistroCoord(pre); }).catch(function (e) { toast('Error: ' + esc(e.message)); }); return; }",
    "    var hoy = horaLima(); var f = pre.fecha || (hoy.getFullYear() + '-' + ('0' + (hoy.getMonth() + 1)).slice(-2) + '-' + ('0' + hoy.getDate()).slice(-2));",
    "    abrirModal('Registrar tema dictado', '<div class=\"form-grid\">' +",
    "      '<label class=\"full\">Curso<select id=\"rc-curso\">' + cursos.map(function (c) { return '<option value=\"' + esc(c.id) + '\"' + (c.id === pre.cursoId ? ' selected' : '') + '>' + esc(c.curso) + '</option>'; }).join('') + '</select></label>' +",
    "      '<label class=\"full\">Tema<select id=\"rc-tema\"></select></label>' +",
    "      '<label>Fecha<input type=\"date\" id=\"rc-fecha\" value=\"' + esc(f) + '\"></label>' +",
    "      '<label>Tipo de avance<select id=\"rc-tipo\">' + Object.keys(TIPOS_AV).map(function (t) { return '<option value=\"' + t + '\">' + TIPOS_AV[t] + '</option>'; }).join('') + '</select></label>' +",
    "      '<label class=\"full\">Docente<input id=\"rc-doc\" value=\"' + esc(pre.docente || '') + '\" placeholder=\"Quién dictó la clase\"></label>' +",
    "      '<label class=\"full\">Observación<input id=\"rc-obs\" placeholder=\"Opcional\"></label></div>' +",
    "      '<div class=\"alerta oculto\" id=\"rc-err\"></div><div style=\"margin-top:16px\"><button class=\"btn btn-rojo btn-grande\" id=\"rc-ok\" type=\"button\">Registrar</button></div>' +",
    "      '<div class=\"muted\" style=\"font-size:12px;text-align:center;margin-top:8px\">Queda registrado por “Coordinación” y validado.</div>');",
    "    var cargarTemas = function () {",
    "      $('rc-tema').innerHTML = '<option>Cargando…</option>';",
    "      api('getCursoDetalle', S.pin, $('rc-curso').value).then(function (c) {",
    "        var sel = pre.n && $('rc-curso').value === pre.cursoId ? pre.n : c.sugerido;",
    "        $('rc-tema').innerHTML = c.temas.map(function (t) { return '<option value=\"' + t.n + '\"' + (t.n === sel ? ' selected' : '') + '>' + t.n + ' · ' + esc(t.tema) + (t.estado === 'COMPLETADO' ? ' ✓' : '') + '</option>'; }).join('');",
    "      }).catch(function (e) { $('rc-err').textContent = e.message; $('rc-err').classList.remove('oculto'); });",
    "    };",
    "    $('rc-curso').addEventListener('change', cargarTemas); cargarTemas();",
    "    $('rc-ok').addEventListener('click', function () {",
    "      var b = this; b.disabled = true;",
    "      api('coordRegistrarTema', S.pin, { cursoId: $('rc-curso').value, n: +$('rc-tema').value, fecha: $('rc-fecha').value, tipo: $('rc-tipo').value,",
    "        observacion: $('rc-obs').value, docente: $('rc-doc').value, marcacion: pre.marcacion || '' }).then(function (r) {",
    "        b.disabled = false;",
    "        if (!r.ok) { $('rc-err').textContent = r.error; $('rc-err').classList.remove('oculto'); return; }",
    "        cerrarModal(); toast('✅ Tema registrado'); cargarAcademico();",
    "      }).catch(function (e) { b.disabled = false; $('rc-err').textContent = e.message; $('rc-err').classList.remove('oculto'); });",
    "    });",
    "  }",
    "  $('lc-nuevo').addEventListener('click', function () { formRegistroCoord({}); });",
    "",
    "  ['lc-curso', 'lc-desde', 'lc-hasta'].forEach(function (id) { $(id).addEventListener('change', cargarLeccionario); });",
    "  function cargarLeccionario() {",
    "    $('lc-tabla').innerHTML = '<tbody><tr><td class=\"vacio-t\">Cargando…</td></tr></tbody>';",
    "    api('getLeccionario', S.pin, { cursoId: $('lc-curso').value, desde: $('lc-desde').value, hasta: $('lc-hasta').value }).then(function (r) {",
    "      if ($('lc-curso').options.length <= 1) $('lc-curso').innerHTML = '<option value=\"\">Todos los cursos</option>' + r.cursos.map(function (c) { return '<option value=\"' + esc(c.id) + '\">' + esc(c.curso) + '</option>'; }).join('');",
    "      S.lecc = r.registros; S.cursosAc = r.cursos;",
    "      if (!r.registros.length) { $('lc-tabla').innerHTML = '<tbody><tr><td class=\"vacio-t\">Aún no hay temas registrados con estos filtros.</td></tr></tbody>'; return; }",
    "      var est = { REGISTRADO: '<span class=\"chip\">Por validar</span>', VALIDADO: '<span class=\"chip ok\">Validado</span>', CORREGIDO: '<span class=\"chip warn\">Corregido</span>' };",
    "      $('lc-tabla').innerHTML = '<thead><tr><th>Fecha</th><th>Curso</th><th>Tema</th><th>Avance</th><th>Docente</th><th>Estado</th><th></th></tr></thead><tbody>' + r.registros.map(function (x) {",
    "        return '<tr><td class=\"titulo\"><b>' + esc(x.fecha) + '</b></td><td data-l=\"Curso\">' + esc(x.curso) + '</td><td data-l=\"Tema\">' + x.n + ' · ' + esc(x.tema) +",
    "          (x.observacion ? '<div class=\"muted\" style=\"font-size:12px\">' + esc(x.observacion) + '</div>' : '') + '</td><td data-l=\"Avance\">' + (TIPOS_AV[x.tipo] || esc(x.tipo)) + '</td>' +",
    "          '<td data-l=\"Docente\">' + esc(x.docente) + '<div class=\"muted\" style=\"font-size:11px\">' + esc(x.registradoPor) + '</div></td><td data-l=\"Estado\">' + (est[x.estado] || esc(x.estado)) + '</td>' +",
    "          '<td style=\"white-space:nowrap\">' + (x.estado === 'REGISTRADO' ? '<button class=\"mini\" data-val=\"' + esc(x.id) + '\" title=\"Validar\" type=\"button\">✔️</button>' : '') +",
    "          '<button class=\"mini\" data-cor=\"' + esc(x.id) + '\" title=\"Corregir\" type=\"button\">✏️</button><button class=\"mini\" data-del=\"' + esc(x.id) + '\" title=\"Eliminar\" type=\"button\">🗑️</button></td></tr>';",
    "      }).join('') + '</tbody>';",
    "    }).catch(function (e) { $('lc-tabla').innerHTML = '<tbody><tr><td class=\"vacio-t\">' + esc(e.message) + '</td></tr></tbody>'; });",
    "  }",
    "  $('lc-tabla').addEventListener('click', function (e) {",
    "    var v = e.target.closest('[data-val]'), c = e.target.closest('[data-cor]'), d = e.target.closest('[data-del]');",
    "    var fin = function (r, msg) { if (!r.ok) return toast('Error: ' + esc(r.error)); toast(msg); cargarLeccionario(); cargarAcademico(); };",
    "    if (v) api('revisarRegistro', S.pin, v.getAttribute('data-val'), 'VALIDAR').then(function (r) { fin(r, '✔️ Registro validado'); });",
    "    if (d && confirm('¿Eliminar este registro del leccionario?')) api('revisarRegistro', S.pin, d.getAttribute('data-del'), 'ELIMINAR').then(function (r) { fin(r, '🗑️ Registro eliminado'); });",
    "    if (c) {",
    "      var x = S.lecc.filter(function (y) { return y.id === c.getAttribute('data-cor'); })[0];",
    "      abrirModal('Corregir registro', '<div class=\"form-grid\"><label class=\"full\">Tema<select id=\"cr-tema\"><option>Cargando…</option></select></label>' +",
    "        '<label class=\"full\">Tipo de avance<select id=\"cr-tipo\">' + Object.keys(TIPOS_AV).map(function (t) { return '<option value=\"' + t + '\"' + (t === x.tipo ? ' selected' : '') + '>' + TIPOS_AV[t] + '</option>'; }).join('') + '</select></label>' +",
    "        '<label class=\"full\">Observación<input id=\"cr-obs\" value=\"' + esc(x.observacion) + '\"></label></div><div style=\"margin-top:16px\"><button class=\"btn btn-rojo btn-grande\" id=\"cr-ok\" type=\"button\">Guardar corrección</button></div>');",
    "      api('getCursoDetalle', S.pin, x.cursoId).catch(function (e) { toast('Error: ' + esc(e.message)); return { temas: [] }; }).then(function (k) {",
    "        $('cr-tema').innerHTML = k.temas.map(function (t) { return '<option value=\"' + t.n + '\"' + (t.n === x.n ? ' selected' : '') + '>' + t.n + ' · ' + esc(t.tema) + '</option>'; }).join('');",
    "      });",
    "      $('cr-ok').addEventListener('click', function () {",
    "        api('revisarRegistro', S.pin, x.id, 'CORREGIR', { n: +$('cr-tema').value, tipo: $('cr-tipo').value, observacion: $('cr-obs').value }).then(function (r) { cerrarModal(); fin(r, '✏️ Registro corregido'); });",
    "      });",
    "    }",
    "  });",
    "",
    "  function cargarCalendario() {",
    "    api('getCalendario', S.pin).then(function (r) {",
    "      var chip = { CLASE: 'ok', EXAMEN: 'warn', VACACIONES: 'rojo', CIERRE: 'oscuro' };",
    "      $('cal-tabla').innerHTML = '<thead><tr><th>Semana</th><th>Tipo</th><th>Semana de clase</th><th>Boletín</th><th>Bimestre</th><th>Notas</th></tr></thead><tbody>' + r.semanas.map(function (s) {",
    "        var actual = s.inicio <= r.hoy && r.hoy <= s.fin;",
    "        return '<tr' + (actual ? ' class=\"sem-actual\"' : '') + '><td class=\"titulo\"><b>' + esc(s.inicio.slice(8) + '/' + s.inicio.slice(5, 7)) + ' – ' + esc(s.fin.slice(8) + '/' + s.fin.slice(5, 7)) + '</b>' + (actual ? ' ⬅ hoy' : '') + '</td>' +",
    "          '<td data-l=\"Tipo\"><span class=\"chip ' + (chip[s.tipo] || '') + '\">' + esc(s.tipo) + '</span></td><td data-l=\"Semana\" class=\"num\">' + esc(s.nSemana || '—') + '</td>' +",
    "          '<td data-l=\"Boletín\" class=\"num\">' + esc(s.boletin || '—') + '</td><td data-l=\"Bimestre\" class=\"num\">' + esc(s.bimestre) + '</td><td data-l=\"Notas\">' + esc(s.descripcion || '') + '</td></tr>';",
    "      }).join('') + '</tbody>';",
    "    });",
    "  }",
    "",
    "  /* ===================== REPORTE ===================== */",
    "  $('f-mes').addEventListener('change', function () { S.mes = this.value; cargarReporte(); });",
    "  function cargarReporte() {",
    "    $('rep-msg').textContent = 'Cargando…';",
    "    api('getReporte', S.pin, S.mes).then(function (r) { S.reporte = r; pintarReporte(r); $('rep-msg').textContent = ''; })",
    "      .catch(function (e) { $('rep-msg').textContent = 'Error: ' + e.message; });",
    "  }",
    "  function pintarReporte(r) {",
    "    var tot = r.filas.reduce(function (s, f) { return s + f.horas; }, 0);",
    "    var docs = {}; r.filas.forEach(function (f) { docs[f.docente] = true; });",
    "    $('rep-kpis').innerHTML = kpi('Horas dictadas (mes)', n2(tot), '', 'destacado') + kpi('Docentes', Object.keys(docs).length) +",
    "      kpi('Clases registradas', r.filas.reduce(function (s, f) { return s + f.clases; }, 0)) + kpi('Reemplazos', r.filas.reduce(function (s, f) { return s + f.reemplazos; }, 0));",
    "    if (!r.filas.length) { $('tabla-rep').innerHTML = '<tbody><tr><td class=\"vacio-t\">No hay clases dictadas registradas en ' + esc(r.mes) + '.</td></tr></tbody>'; return; }",
    "    var html = '<thead><tr><th>Docente</th><th>Mes</th><th>Salón</th><th class=\"num\">N.º horas dictadas</th><th class=\"num\">Clases</th><th class=\"num\">Días</th><th class=\"num\">Reemplazos</th><th class=\"num\">Tardanzas</th></tr></thead><tbody>';",
    "    var actual = null, sub = 0;",
    "    var subtotal = function () { return '<tr class=\"subtotal\"><td colspan=\"3\" data-l=\"Total\">' + esc(actual) + '</td><td class=\"num\">' + n2(sub) + ' h</td><td colspan=\"4\" class=\"oculto-m\"></td></tr>'; };",
    "    r.filas.forEach(function (f) {",
    "      if (actual !== null && actual !== f.docente) { html += subtotal(); sub = 0; }",
    "      actual = f.docente; sub += f.horas;",
    "      html += '<tr><td class=\"titulo\"><b>' + esc(f.docente) + '</b></td><td data-l=\"Mes\">' + esc(f.mes) + '</td><td data-l=\"Salón\">' + esc(f.salon) + '</td><td class=\"num\" data-l=\"Horas\"><b>' + n2(f.horas) + '</b></td>' +",
    "        '<td class=\"num\" data-l=\"Clases\">' + f.clases + '</td><td class=\"num\" data-l=\"Días\">' + f.dias + '</td><td class=\"num\" data-l=\"Reemplazos\">' + f.reemplazos + '</td>' +",
    "        '<td class=\"num\" data-l=\"Tardanzas\">' + (f.tardanzas ? f.tardanzas + ' (' + f.minTarde + ' min)' : '0') + '</td></tr>';",
    "    });",
    "    html += subtotal();",
    "    html += '<tr class=\"total\"><td colspan=\"3\">TOTAL GENERAL</td><td class=\"num\">' + n2(tot) + ' h</td><td colspan=\"4\"></td></tr></tbody>';",
    "    $('tabla-rep').innerHTML = html;",
    "  }",
    "  $('btn-exportar').addEventListener('click', function () {",
    "    var b = this; b.disabled = true; $('rep-msg').textContent = 'Guardando…';",
    "    api('exportarReporte', S.pin, S.mes).then(function (r) { $('rep-msg').innerHTML = '✅ ' + r.filas + ' fila(s) guardadas. <a href=\"' + r.url + '\" target=\"_blank\">Abrir hoja</a>'; })",
    "      .catch(function (e) { $('rep-msg').textContent = 'Error: ' + e.message; }).then(function () { b.disabled = false; });",
    "  });",
    "  function descargarBlob(blob, nombre) {",
    "    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;",
    "    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);",
    "  }",
    "  $('btn-csv').addEventListener('click', function () {",
    "    if (!S.reporte) return;",
    "    var q = function (v) { return '\"' + String(v).replace(/\"/g, '\"\"') + '\"'; };",
    "    var lineas = [['Docente', 'Mes', 'Salón', 'N.º horas dictadas', 'Clases', 'Días', 'Reemplazos', 'Tardanzas', 'Min. tardanza'].map(q).join(',')].concat(",
    "      S.reporte.filas.map(function (f) { return [f.docente, f.mes, f.salon, n2(f.horas), f.clases, f.dias, f.reemplazos, f.tardanzas, f.minTarde].map(q).join(','); }));",
    "    descargarBlob(new Blob(['﻿' + lineas.join('\\n')], { type: 'text/csv;charset=utf-8' }), 'horas_docentes_' + S.mes + '.csv');",
    "  });",
    "",
    "  /* ===================== QR / FOTOCHECKS ===================== */",
    "  function codigo(d) { return d.dni || d.celular || ''; }",
    "  /** Dibuja un QR (nivel M, margen de 4 módulos) en un canvas cuadrado de `tam` px. */",
    "  function qrCanvas(texto, tam) {",
    "    var q = qrcode(0, 'M'); q.addData(texto); q.make();",
    "    var n = q.getModuleCount(), m = 4, c = document.createElement('canvas'); c.width = c.height = tam;",
    "    var g = c.getContext('2d'), s = tam / (n + 2 * m);",
    "    g.fillStyle = '#ffffff'; g.fillRect(0, 0, tam, tam); g.fillStyle = '#000000';",
    "    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(Math.floor((k + m) * s), Math.floor((r + m) * s), Math.ceil(s), Math.ceil(s));",
    "    return c;",
    "  }",
    "  function urlQR(d) { return (S.qr.appUrl || S.appUrl) + '?dni=' + codigo(d); }",
    "  function cargarQR() {",
    "    $('qr-grid').innerHTML = '<div class=\"muted\">Cargando…</div>';",
    "    api('getDocentesQR', S.pin).then(function (r) {",
    "      S.qr = r;",
    "      $('qr-grid').innerHTML = r.docentes.map(function (d, i) {",
    "        return '<div class=\"fotocheck\"><div class=\"cab\">CVI · Monte Azul</div>' +",
    "          (codigo(d) ? '<div class=\"qr\" id=\"qr-' + i + '\"></div>' : '<div class=\"qr\"><div class=\"sin\">Falta DNI o celular<br>en la hoja “Docentes”</div></div>') +",
    "          '<div class=\"nom\">' + esc(d.docente) + '</div><div class=\"dni\">' + (d.dni ? 'DNI ' + esc(d.dni) : d.celular ? 'Cel. ' + esc(d.celular) : '&nbsp;') + '</div>' +",
    "          (codigo(d) ? '<div class=\"acc\"><button class=\"btn btn-negro\" data-png=\"' + i + '\" type=\"button\">⬇ Descargar</button><button class=\"btn btn-claro\" data-drive=\"' + i + '\" type=\"button\">☁ Drive</button></div>' : '') + '</div>';",
    "      }).join('');",
    "      r.docentes.forEach(function (d, i) {",
    "        if (codigo(d)) $('qr-' + i).appendChild(qrCanvas(urlQR(d), 340));",
    "      });",
    "    }).catch(function (e) { $('qr-grid').innerHTML = '<div class=\"alerta\">' + esc(e.message) + '</div>'; });",
    "  }",
    "  function cargarImg(src) { return new Promise(function (ok) { if (!src) return ok(null); var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { ok(null); }; im.src = src; }); }",
    "  function nombreArchivo(d) { return 'Fotocheck_QR_' + d.docente.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_') + '.png'; }",
    "  /** Dibuja el fotocheck completo (600×900) en un canvas: cabecera con logo, QR, nombre y código. */",
    "  function crearFotocheck(d) {",
    "    var qr = qrCanvas(urlQR(d), 440);",
    "    return Promise.all([cargarImg(S.logo), document.fonts && document.fonts.load ? document.fonts.load('30px \"Cantata One\"').catch(function () { }) : null]).then(function (res) {",
    "      var logo = res[0], W = 600, H = 900, c = document.createElement('canvas'); c.width = W; c.height = H;",
    "      var g = c.getContext('2d');",
    "      g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);",
    "      g.fillStyle = '#000000'; g.fillRect(0, 0, W, 170);",
    "      g.fillStyle = '#eebe4f'; g.fillRect(0, 170, W, 8);",
    "      var x = 40;",
    "      if (logo) {",
    "        g.fillStyle = '#ffffff'; g.beginPath(); if (g.roundRect) g.roundRect(32, 35, 100, 100, 16); else g.rect(32, 35, 100, 100); g.fill();",
    "        var r = Math.min(88 / logo.width, 88 / logo.height); g.drawImage(logo, 82 - logo.width * r / 2, 85 - logo.height * r / 2, logo.width * r, logo.height * r);",
    "        x = 152;",
    "      }",
    "      g.fillStyle = '#eebe4f'; g.font = '30px \"Cantata One\", Georgia, serif'; g.textBaseline = 'alphabetic';",
    "      g.fillText('César Vallejo', x, 82); g.fillText('Ingenieros', x, 120);",
    "      g.fillStyle = '#d9d4cc'; g.font = '600 18px Inter, Arial, sans-serif'; g.fillText('Sede Monte Azul · Docente', x, 150);",
    "      g.drawImage(qr, 80, 215, 440, 440);",
    "      g.fillStyle = '#000000'; g.textAlign = 'center';",
    "      var nombre = d.nombreCompleto || d.docente, tam = 34;",
    "      g.font = '800 ' + tam + 'px Inter, Arial, sans-serif';",
    "      while (g.measureText(nombre).width > 540 && tam > 20) { tam -= 2; g.font = '800 ' + tam + 'px Inter, Arial, sans-serif'; }",
    "      g.fillText(nombre, W / 2, 712);",
    "      g.fillStyle = '#5c5752'; g.font = '600 22px Inter, Arial, sans-serif';",
    "      g.fillText((d.dni ? 'DNI ' + d.dni : 'Cel. ' + d.celular) + (d.especialidad ? ' · ' + d.especialidad : ''), W / 2, 750);",
    "      g.fillStyle = '#920000'; g.fillRect(0, 800, W, 100);",
    "      g.fillStyle = '#ffffff'; g.font = '800 26px Inter, Arial, sans-serif'; g.fillText('Escanéame para marcar asistencia', W / 2, 860);",
    "      return c;",
    "    });",
    "  }",
    "  function aBlob(c) { return new Promise(function (ok) { c.toBlob(ok, 'image/png'); }); }",
    "  function aBase64(c) { return c.toDataURL('image/png').split(',')[1]; }",
    "  $('qr-grid').addEventListener('click', function (e) {",
    "    var bp = e.target.closest('[data-png]'), bd = e.target.closest('[data-drive]');",
    "    if (bp) {",
    "      var d = S.qr.docentes[+bp.getAttribute('data-png')];",
    "      crearFotocheck(d).then(aBlob).then(function (b) { descargarBlob(b, nombreArchivo(d)); toast('⬇ Descargando ' + esc(nombreArchivo(d)) + '<br><span style=\"font-weight:500\">Si no se descarga, usa el botón “☁ Drive”.</span>', 6000); });",
    "    }",
    "    if (bd) {",
    "      var d2 = S.qr.docentes[+bd.getAttribute('data-drive')]; bd.disabled = true; bd.textContent = 'Guardando…';",
    "      crearFotocheck(d2).then(function (c) { return api('guardarFotochecks', S.pin, [{ nombre: nombreArchivo(d2), base64: aBase64(c) }]); }).then(function (r) {",
    "        var a = r.archivos[0]; toast('☁ Guardado en Drive: <a href=\"' + a.descarga + '\" target=\"_blank\">Descargar</a> · <a href=\"' + r.carpetaUrl + '\" target=\"_blank\">Abrir carpeta</a>', 12000);",
    "        window.open(a.descarga, '_blank');",
    "      }).catch(function (er) { toast('Error: ' + esc(er.message)); }).then(function () { bd.disabled = false; bd.textContent = '☁ Drive'; });",
    "    }",
    "  });",
    "  $('btn-zip').addEventListener('click', function () {",
    "    var b = this, lista = S.qr ? S.qr.docentes.filter(codigo) : [];",
    "    if (!lista.length) return;",
    "    b.disabled = true; var carpeta = null, hechos = 0;",
    "    var msg = function (t) { $('qr-msg').innerHTML = '<div class=\"alerta info\" style=\"margin:0 0 14px\">' + t + '</div>'; };",
    "    msg('Generando fotochecks… 0 de ' + lista.length);",
    "    var lote = function (i) {",
    "      if (i >= lista.length) return api('comprimirFotochecks', S.pin, carpeta);",
    "      var grupo = lista.slice(i, i + 5);",
    "      return Promise.all(grupo.map(function (d) { return crearFotocheck(d).then(function (c) { return { nombre: nombreArchivo(d), base64: aBase64(c) }; }); }))",
    "        .then(function (arch) { return api('guardarFotochecks', S.pin, arch, carpeta); })",
    "        .then(function (r) { carpeta = r.carpetaId; hechos += grupo.length; msg('Guardando en Drive… ' + hechos + ' de ' + lista.length); return lote(i + 5); });",
    "    };",
    "    lote(0).then(function (r) {",
    "      msg('✅ ' + r.total + ' fotochecks listos. <a href=\"' + r.zipUrl + '\" target=\"_blank\"><b>⬇ Descargar ZIP</b></a> · <a href=\"' + r.carpetaUrl + '\" target=\"_blank\">Abrir carpeta en Drive</a>');",
    "      window.open(r.zipUrl, '_blank');",
    "    }).catch(function (e) { msg('Error: ' + esc(e.message)); }).then(function () { b.disabled = false; });",
    "  });",
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
    "  /* ---------- Selección de salones / observaciones (marcación) ---------- */",
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
  ].join('\n'),
  QRLib: [
    "<!-- qrcode-generator 1.4.4 · (c) Kazuhiko Arase · Licencia MIT · https://github.com/kazuhikoarase/qrcode-generator",
    "     Incluida localmente para no depender de internet/CDN al generar los QR. -->",
    "<script>",
    "//---------------------------------------------------------------------",
    "//",
    "// QR Code Generator for JavaScript",
    "//",
    "// Copyright (c) 2009 Kazuhiko Arase",
    "//",
    "// URL: http://www.d-project.com/",
    "//",
    "// Licensed under the MIT license:",
    "//  http://www.opensource.org/licenses/mit-license.php",
    "//",
    "// The word 'QR Code' is registered trademark of",
    "// DENSO WAVE INCORPORATED",
    "//  http://www.denso-wave.com/qrcode/faqpatent-e.html",
    "//",
    "//---------------------------------------------------------------------",
    "",
    "var qrcode = function() {",
    "",
    "  //---------------------------------------------------------------------",
    "  // qrcode",
    "  //---------------------------------------------------------------------",
    "",
    "  /**",
    "   * qrcode",
    "   * @param typeNumber 1 to 40",
    "   * @param errorCorrectionLevel 'L','M','Q','H'",
    "   */",
    "  var qrcode = function(typeNumber, errorCorrectionLevel) {",
    "",
    "    var PAD0 = 0xEC;",
    "    var PAD1 = 0x11;",
    "",
    "    var _typeNumber = typeNumber;",
    "    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];",
    "    var _modules = null;",
    "    var _moduleCount = 0;",
    "    var _dataCache = null;",
    "    var _dataList = [];",
    "",
    "    var _this = {};",
    "",
    "    var makeImpl = function(test, maskPattern) {",
    "",
    "      _moduleCount = _typeNumber * 4 + 17;",
    "      _modules = function(moduleCount) {",
    "        var modules = new Array(moduleCount);",
    "        for (var row = 0; row < moduleCount; row += 1) {",
    "          modules[row] = new Array(moduleCount);",
    "          for (var col = 0; col < moduleCount; col += 1) {",
    "            modules[row][col] = null;",
    "          }",
    "        }",
    "        return modules;",
    "      }(_moduleCount);",
    "",
    "      setupPositionProbePattern(0, 0);",
    "      setupPositionProbePattern(_moduleCount - 7, 0);",
    "      setupPositionProbePattern(0, _moduleCount - 7);",
    "      setupPositionAdjustPattern();",
    "      setupTimingPattern();",
    "      setupTypeInfo(test, maskPattern);",
    "",
    "      if (_typeNumber >= 7) {",
    "        setupTypeNumber(test);",
    "      }",
    "",
    "      if (_dataCache == null) {",
    "        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);",
    "      }",
    "",
    "      mapData(_dataCache, maskPattern);",
    "    };",
    "",
    "    var setupPositionProbePattern = function(row, col) {",
    "",
    "      for (var r = -1; r <= 7; r += 1) {",
    "",
    "        if (row + r <= -1 || _moduleCount <= row + r) continue;",
    "",
    "        for (var c = -1; c <= 7; c += 1) {",
    "",
    "          if (col + c <= -1 || _moduleCount <= col + c) continue;",
    "",
    "          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )",
    "              || (0 <= c && c <= 6 && (r == 0 || r == 6) )",
    "              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {",
    "            _modules[row + r][col + c] = true;",
    "          } else {",
    "            _modules[row + r][col + c] = false;",
    "          }",
    "        }",
    "      }",
    "    };",
    "",
    "    var getBestMaskPattern = function() {",
    "",
    "      var minLostPoint = 0;",
    "      var pattern = 0;",
    "",
    "      for (var i = 0; i < 8; i += 1) {",
    "",
    "        makeImpl(true, i);",
    "",
    "        var lostPoint = QRUtil.getLostPoint(_this);",
    "",
    "        if (i == 0 || minLostPoint > lostPoint) {",
    "          minLostPoint = lostPoint;",
    "          pattern = i;",
    "        }",
    "      }",
    "",
    "      return pattern;",
    "    };",
    "",
    "    var setupTimingPattern = function() {",
    "",
    "      for (var r = 8; r < _moduleCount - 8; r += 1) {",
    "        if (_modules[r][6] != null) {",
    "          continue;",
    "        }",
    "        _modules[r][6] = (r % 2 == 0);",
    "      }",
    "",
    "      for (var c = 8; c < _moduleCount - 8; c += 1) {",
    "        if (_modules[6][c] != null) {",
    "          continue;",
    "        }",
    "        _modules[6][c] = (c % 2 == 0);",
    "      }",
    "    };",
    "",
    "    var setupPositionAdjustPattern = function() {",
    "",
    "      var pos = QRUtil.getPatternPosition(_typeNumber);",
    "",
    "      for (var i = 0; i < pos.length; i += 1) {",
    "",
    "        for (var j = 0; j < pos.length; j += 1) {",
    "",
    "          var row = pos[i];",
    "          var col = pos[j];",
    "",
    "          if (_modules[row][col] != null) {",
    "            continue;",
    "          }",
    "",
    "          for (var r = -2; r <= 2; r += 1) {",
    "",
    "            for (var c = -2; c <= 2; c += 1) {",
    "",
    "              if (r == -2 || r == 2 || c == -2 || c == 2",
    "                  || (r == 0 && c == 0) ) {",
    "                _modules[row + r][col + c] = true;",
    "              } else {",
    "                _modules[row + r][col + c] = false;",
    "              }",
    "            }",
    "          }",
    "        }",
    "      }",
    "    };",
    "",
    "    var setupTypeNumber = function(test) {",
    "",
    "      var bits = QRUtil.getBCHTypeNumber(_typeNumber);",
    "",
    "      for (var i = 0; i < 18; i += 1) {",
    "        var mod = (!test && ( (bits >> i) & 1) == 1);",
    "        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;",
    "      }",
    "",
    "      for (var i = 0; i < 18; i += 1) {",
    "        var mod = (!test && ( (bits >> i) & 1) == 1);",
    "        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;",
    "      }",
    "    };",
    "",
    "    var setupTypeInfo = function(test, maskPattern) {",
    "",
    "      var data = (_errorCorrectionLevel << 3) | maskPattern;",
    "      var bits = QRUtil.getBCHTypeInfo(data);",
    "",
    "      // vertical",
    "      for (var i = 0; i < 15; i += 1) {",
    "",
    "        var mod = (!test && ( (bits >> i) & 1) == 1);",
    "",
    "        if (i < 6) {",
    "          _modules[i][8] = mod;",
    "        } else if (i < 8) {",
    "          _modules[i + 1][8] = mod;",
    "        } else {",
    "          _modules[_moduleCount - 15 + i][8] = mod;",
    "        }",
    "      }",
    "",
    "      // horizontal",
    "      for (var i = 0; i < 15; i += 1) {",
    "",
    "        var mod = (!test && ( (bits >> i) & 1) == 1);",
    "",
    "        if (i < 8) {",
    "          _modules[8][_moduleCount - i - 1] = mod;",
    "        } else if (i < 9) {",
    "          _modules[8][15 - i - 1 + 1] = mod;",
    "        } else {",
    "          _modules[8][15 - i - 1] = mod;",
    "        }",
    "      }",
    "",
    "      // fixed module",
    "      _modules[_moduleCount - 8][8] = (!test);",
    "    };",
    "",
    "    var mapData = function(data, maskPattern) {",
    "",
    "      var inc = -1;",
    "      var row = _moduleCount - 1;",
    "      var bitIndex = 7;",
    "      var byteIndex = 0;",
    "      var maskFunc = QRUtil.getMaskFunction(maskPattern);",
    "",
    "      for (var col = _moduleCount - 1; col > 0; col -= 2) {",
    "",
    "        if (col == 6) col -= 1;",
    "",
    "        while (true) {",
    "",
    "          for (var c = 0; c < 2; c += 1) {",
    "",
    "            if (_modules[row][col - c] == null) {",
    "",
    "              var dark = false;",
    "",
    "              if (byteIndex < data.length) {",
    "                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);",
    "              }",
    "",
    "              var mask = maskFunc(row, col - c);",
    "",
    "              if (mask) {",
    "                dark = !dark;",
    "              }",
    "",
    "              _modules[row][col - c] = dark;",
    "              bitIndex -= 1;",
    "",
    "              if (bitIndex == -1) {",
    "                byteIndex += 1;",
    "                bitIndex = 7;",
    "              }",
    "            }",
    "          }",
    "",
    "          row += inc;",
    "",
    "          if (row < 0 || _moduleCount <= row) {",
    "            row -= inc;",
    "            inc = -inc;",
    "            break;",
    "          }",
    "        }",
    "      }",
    "    };",
    "",
    "    var createBytes = function(buffer, rsBlocks) {",
    "",
    "      var offset = 0;",
    "",
    "      var maxDcCount = 0;",
    "      var maxEcCount = 0;",
    "",
    "      var dcdata = new Array(rsBlocks.length);",
    "      var ecdata = new Array(rsBlocks.length);",
    "",
    "      for (var r = 0; r < rsBlocks.length; r += 1) {",
    "",
    "        var dcCount = rsBlocks[r].dataCount;",
    "        var ecCount = rsBlocks[r].totalCount - dcCount;",
    "",
    "        maxDcCount = Math.max(maxDcCount, dcCount);",
    "        maxEcCount = Math.max(maxEcCount, ecCount);",
    "",
    "        dcdata[r] = new Array(dcCount);",
    "",
    "        for (var i = 0; i < dcdata[r].length; i += 1) {",
    "          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];",
    "        }",
    "        offset += dcCount;",
    "",
    "        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);",
    "        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);",
    "",
    "        var modPoly = rawPoly.mod(rsPoly);",
    "        ecdata[r] = new Array(rsPoly.getLength() - 1);",
    "        for (var i = 0; i < ecdata[r].length; i += 1) {",
    "          var modIndex = i + modPoly.getLength() - ecdata[r].length;",
    "          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;",
    "        }",
    "      }",
    "",
    "      var totalCodeCount = 0;",
    "      for (var i = 0; i < rsBlocks.length; i += 1) {",
    "        totalCodeCount += rsBlocks[i].totalCount;",
    "      }",
    "",
    "      var data = new Array(totalCodeCount);",
    "      var index = 0;",
    "",
    "      for (var i = 0; i < maxDcCount; i += 1) {",
    "        for (var r = 0; r < rsBlocks.length; r += 1) {",
    "          if (i < dcdata[r].length) {",
    "            data[index] = dcdata[r][i];",
    "            index += 1;",
    "          }",
    "        }",
    "      }",
    "",
    "      for (var i = 0; i < maxEcCount; i += 1) {",
    "        for (var r = 0; r < rsBlocks.length; r += 1) {",
    "          if (i < ecdata[r].length) {",
    "            data[index] = ecdata[r][i];",
    "            index += 1;",
    "          }",
    "        }",
    "      }",
    "",
    "      return data;",
    "    };",
    "",
    "    var createData = function(typeNumber, errorCorrectionLevel, dataList) {",
    "",
    "      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);",
    "",
    "      var buffer = qrBitBuffer();",
    "",
    "      for (var i = 0; i < dataList.length; i += 1) {",
    "        var data = dataList[i];",
    "        buffer.put(data.getMode(), 4);",
    "        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );",
    "        data.write(buffer);",
    "      }",
    "",
    "      // calc num max data.",
    "      var totalDataCount = 0;",
    "      for (var i = 0; i < rsBlocks.length; i += 1) {",
    "        totalDataCount += rsBlocks[i].dataCount;",
    "      }",
    "",
    "      if (buffer.getLengthInBits() > totalDataCount * 8) {",
    "        throw 'code length overflow. ('",
    "          + buffer.getLengthInBits()",
    "          + '>'",
    "          + totalDataCount * 8",
    "          + ')';",
    "      }",
    "",
    "      // end code",
    "      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {",
    "        buffer.put(0, 4);",
    "      }",
    "",
    "      // padding",
    "      while (buffer.getLengthInBits() % 8 != 0) {",
    "        buffer.putBit(false);",
    "      }",
    "",
    "      // padding",
    "      while (true) {",
    "",
    "        if (buffer.getLengthInBits() >= totalDataCount * 8) {",
    "          break;",
    "        }",
    "        buffer.put(PAD0, 8);",
    "",
    "        if (buffer.getLengthInBits() >= totalDataCount * 8) {",
    "          break;",
    "        }",
    "        buffer.put(PAD1, 8);",
    "      }",
    "",
    "      return createBytes(buffer, rsBlocks);",
    "    };",
    "",
    "    _this.addData = function(data, mode) {",
    "",
    "      mode = mode || 'Byte';",
    "",
    "      var newData = null;",
    "",
    "      switch(mode) {",
    "      case 'Numeric' :",
    "        newData = qrNumber(data);",
    "        break;",
    "      case 'Alphanumeric' :",
    "        newData = qrAlphaNum(data);",
    "        break;",
    "      case 'Byte' :",
    "        newData = qr8BitByte(data);",
    "        break;",
    "      case 'Kanji' :",
    "        newData = qrKanji(data);",
    "        break;",
    "      default :",
    "        throw 'mode:' + mode;",
    "      }",
    "",
    "      _dataList.push(newData);",
    "      _dataCache = null;",
    "    };",
    "",
    "    _this.isDark = function(row, col) {",
    "      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {",
    "        throw row + ',' + col;",
    "      }",
    "      return _modules[row][col];",
    "    };",
    "",
    "    _this.getModuleCount = function() {",
    "      return _moduleCount;",
    "    };",
    "",
    "    _this.make = function() {",
    "      if (_typeNumber < 1) {",
    "        var typeNumber = 1;",
    "",
    "        for (; typeNumber < 40; typeNumber++) {",
    "          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);",
    "          var buffer = qrBitBuffer();",
    "",
    "          for (var i = 0; i < _dataList.length; i++) {",
    "            var data = _dataList[i];",
    "            buffer.put(data.getMode(), 4);",
    "            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );",
    "            data.write(buffer);",
    "          }",
    "",
    "          var totalDataCount = 0;",
    "          for (var i = 0; i < rsBlocks.length; i++) {",
    "            totalDataCount += rsBlocks[i].dataCount;",
    "          }",
    "",
    "          if (buffer.getLengthInBits() <= totalDataCount * 8) {",
    "            break;",
    "          }",
    "        }",
    "",
    "        _typeNumber = typeNumber;",
    "      }",
    "",
    "      makeImpl(false, getBestMaskPattern() );",
    "    };",
    "",
    "    _this.createTableTag = function(cellSize, margin) {",
    "",
    "      cellSize = cellSize || 2;",
    "      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;",
    "",
    "      var qrHtml = '';",
    "",
    "      qrHtml += '<table style=\"';",
    "      qrHtml += ' border-width: 0px; border-style: none;';",
    "      qrHtml += ' border-collapse: collapse;';",
    "      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';",
    "      qrHtml += '\">';",
    "      qrHtml += '<tbody>';",
    "",
    "      for (var r = 0; r < _this.getModuleCount(); r += 1) {",
    "",
    "        qrHtml += '<tr>';",
    "",
    "        for (var c = 0; c < _this.getModuleCount(); c += 1) {",
    "          qrHtml += '<td style=\"';",
    "          qrHtml += ' border-width: 0px; border-style: none;';",
    "          qrHtml += ' border-collapse: collapse;';",
    "          qrHtml += ' padding: 0px; margin: 0px;';",
    "          qrHtml += ' width: ' + cellSize + 'px;';",
    "          qrHtml += ' height: ' + cellSize + 'px;';",
    "          qrHtml += ' background-color: ';",
    "          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';",
    "          qrHtml += ';';",
    "          qrHtml += '\"/>';",
    "        }",
    "",
    "        qrHtml += '</tr>';",
    "      }",
    "",
    "      qrHtml += '</tbody>';",
    "      qrHtml += '</table>';",
    "",
    "      return qrHtml;",
    "    };",
    "",
    "    _this.createSvgTag = function(cellSize, margin, alt, title) {",
    "",
    "      var opts = {};",
    "      if (typeof arguments[0] == 'object') {",
    "        // Called by options.",
    "        opts = arguments[0];",
    "        // overwrite cellSize and margin.",
    "        cellSize = opts.cellSize;",
    "        margin = opts.margin;",
    "        alt = opts.alt;",
    "        title = opts.title;",
    "      }",
    "",
    "      cellSize = cellSize || 2;",
    "      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;",
    "",
    "      // Compose alt property surrogate",
    "      alt = (typeof alt === 'string') ? {text: alt} : alt || {};",
    "      alt.text = alt.text || null;",
    "      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;",
    "",
    "      // Compose title property surrogate",
    "      title = (typeof title === 'string') ? {text: title} : title || {};",
    "      title.text = title.text || null;",
    "      title.id = (title.text) ? title.id || 'qrcode-title' : null;",
    "",
    "      var size = _this.getModuleCount() * cellSize + margin * 2;",
    "      var c, mc, r, mr, qrSvg='', rect;",
    "",
    "      rect = 'l' + cellSize + ',0 0,' + cellSize +",
    "        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';",
    "",
    "      qrSvg += '<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\"';",
    "      qrSvg += !opts.scalable ? ' width=\"' + size + 'px\" height=\"' + size + 'px\"' : '';",
    "      qrSvg += ' viewBox=\"0 0 ' + size + ' ' + size + '\" ';",
    "      qrSvg += ' preserveAspectRatio=\"xMinYMin meet\"';",
    "      qrSvg += (title.text || alt.text) ? ' role=\"img\" aria-labelledby=\"' +",
    "          escapeXml([title.id, alt.id].join(' ').trim() ) + '\"' : '';",
    "      qrSvg += '>';",
    "      qrSvg += (title.text) ? '<title id=\"' + escapeXml(title.id) + '\">' +",
    "          escapeXml(title.text) + '</title>' : '';",
    "      qrSvg += (alt.text) ? '<description id=\"' + escapeXml(alt.id) + '\">' +",
    "          escapeXml(alt.text) + '</description>' : '';",
    "      qrSvg += '<rect width=\"100%\" height=\"100%\" fill=\"white\" cx=\"0\" cy=\"0\"/>';",
    "      qrSvg += '<path d=\"';",
    "",
    "      for (r = 0; r < _this.getModuleCount(); r += 1) {",
    "        mr = r * cellSize + margin;",
    "        for (c = 0; c < _this.getModuleCount(); c += 1) {",
    "          if (_this.isDark(r, c) ) {",
    "            mc = c*cellSize+margin;",
    "            qrSvg += 'M' + mc + ',' + mr + rect;",
    "          }",
    "        }",
    "      }",
    "",
    "      qrSvg += '\" stroke=\"transparent\" fill=\"black\"/>';",
    "      qrSvg += '</svg>';",
    "",
    "      return qrSvg;",
    "    };",
    "",
    "    _this.createDataURL = function(cellSize, margin) {",
    "",
    "      cellSize = cellSize || 2;",
    "      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;",
    "",
    "      var size = _this.getModuleCount() * cellSize + margin * 2;",
    "      var min = margin;",
    "      var max = size - margin;",
    "",
    "      return createDataURL(size, size, function(x, y) {",
    "        if (min <= x && x < max && min <= y && y < max) {",
    "          var c = Math.floor( (x - min) / cellSize);",
    "          var r = Math.floor( (y - min) / cellSize);",
    "          return _this.isDark(r, c)? 0 : 1;",
    "        } else {",
    "          return 1;",
    "        }",
    "      } );",
    "    };",
    "",
    "    _this.createImgTag = function(cellSize, margin, alt) {",
    "",
    "      cellSize = cellSize || 2;",
    "      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;",
    "",
    "      var size = _this.getModuleCount() * cellSize + margin * 2;",
    "",
    "      var img = '';",
    "      img += '<img';",
    "      img += '\\u0020src=\"';",
    "      img += _this.createDataURL(cellSize, margin);",
    "      img += '\"';",
    "      img += '\\u0020width=\"';",
    "      img += size;",
    "      img += '\"';",
    "      img += '\\u0020height=\"';",
    "      img += size;",
    "      img += '\"';",
    "      if (alt) {",
    "        img += '\\u0020alt=\"';",
    "        img += escapeXml(alt);",
    "        img += '\"';",
    "      }",
    "      img += '/>';",
    "",
    "      return img;",
    "    };",
    "",
    "    var escapeXml = function(s) {",
    "      var escaped = '';",
    "      for (var i = 0; i < s.length; i += 1) {",
    "        var c = s.charAt(i);",
    "        switch(c) {",
    "        case '<': escaped += '&lt;'; break;",
    "        case '>': escaped += '&gt;'; break;",
    "        case '&': escaped += '&amp;'; break;",
    "        case '\"': escaped += '&quot;'; break;",
    "        default : escaped += c; break;",
    "        }",
    "      }",
    "      return escaped;",
    "    };",
    "",
    "    var _createHalfASCII = function(margin) {",
    "      var cellSize = 1;",
    "      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;",
    "",
    "      var size = _this.getModuleCount() * cellSize + margin * 2;",
    "      var min = margin;",
    "      var max = size - margin;",
    "",
    "      var y, x, r1, r2, p;",
    "",
    "      var blocks = {",
    "        '██': '█',",
    "        '█ ': '▀',",
    "        ' █': '▄',",
    "        '  ': ' '",
    "      };",
    "",
    "      var blocksLastLineNoMargin = {",
    "        '██': '▀',",
    "        '█ ': '▀',",
    "        ' █': ' ',",
    "        '  ': ' '",
    "      };",
    "",
    "      var ascii = '';",
    "      for (y = 0; y < size; y += 2) {",
    "        r1 = Math.floor((y - min) / cellSize);",
    "        r2 = Math.floor((y + 1 - min) / cellSize);",
    "        for (x = 0; x < size; x += 1) {",
    "          p = '█';",
    "",
    "          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {",
    "            p = ' ';",
    "          }",
    "",
    "          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {",
    "            p += ' ';",
    "          }",
    "          else {",
    "            p += '█';",
    "          }",
    "",
    "          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.",
    "          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];",
    "        }",
    "",
    "        ascii += '\\n';",
    "      }",
    "",
    "      if (size % 2 && margin > 0) {",
    "        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');",
    "      }",
    "",
    "      return ascii.substring(0, ascii.length-1);",
    "    };",
    "",
    "    _this.createASCII = function(cellSize, margin) {",
    "      cellSize = cellSize || 1;",
    "",
    "      if (cellSize < 2) {",
    "        return _createHalfASCII(margin);",
    "      }",
    "",
    "      cellSize -= 1;",
    "      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;",
    "",
    "      var size = _this.getModuleCount() * cellSize + margin * 2;",
    "      var min = margin;",
    "      var max = size - margin;",
    "",
    "      var y, x, r, p;",
    "",
    "      var white = Array(cellSize+1).join('██');",
    "      var black = Array(cellSize+1).join('  ');",
    "",
    "      var ascii = '';",
    "      var line = '';",
    "      for (y = 0; y < size; y += 1) {",
    "        r = Math.floor( (y - min) / cellSize);",
    "        line = '';",
    "        for (x = 0; x < size; x += 1) {",
    "          p = 1;",
    "",
    "          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {",
    "            p = 0;",
    "          }",
    "",
    "          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.",
    "          line += p ? white : black;",
    "        }",
    "",
    "        for (r = 0; r < cellSize; r += 1) {",
    "          ascii += line + '\\n';",
    "        }",
    "      }",
    "",
    "      return ascii.substring(0, ascii.length-1);",
    "    };",
    "",
    "    _this.renderTo2dContext = function(context, cellSize) {",
    "      cellSize = cellSize || 2;",
    "      var length = _this.getModuleCount();",
    "      for (var row = 0; row < length; row++) {",
    "        for (var col = 0; col < length; col++) {",
    "          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';",
    "          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);",
    "        }",
    "      }",
    "    }",
    "",
    "    return _this;",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // qrcode.stringToBytes",
    "  //---------------------------------------------------------------------",
    "",
    "  qrcode.stringToBytesFuncs = {",
    "    'default' : function(s) {",
    "      var bytes = [];",
    "      for (var i = 0; i < s.length; i += 1) {",
    "        var c = s.charCodeAt(i);",
    "        bytes.push(c & 0xff);",
    "      }",
    "      return bytes;",
    "    }",
    "  };",
    "",
    "  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];",
    "",
    "  //---------------------------------------------------------------------",
    "  // qrcode.createStringToBytes",
    "  //---------------------------------------------------------------------",
    "",
    "  /**",
    "   * @param unicodeData base64 string of byte array.",
    "   * [16bit Unicode],[16bit Bytes], ...",
    "   * @param numChars",
    "   */",
    "  qrcode.createStringToBytes = function(unicodeData, numChars) {",
    "",
    "    // create conversion map.",
    "",
    "    var unicodeMap = function() {",
    "",
    "      var bin = base64DecodeInputStream(unicodeData);",
    "      var read = function() {",
    "        var b = bin.read();",
    "        if (b == -1) throw 'eof';",
    "        return b;",
    "      };",
    "",
    "      var count = 0;",
    "      var unicodeMap = {};",
    "      while (true) {",
    "        var b0 = bin.read();",
    "        if (b0 == -1) break;",
    "        var b1 = read();",
    "        var b2 = read();",
    "        var b3 = read();",
    "        var k = String.fromCharCode( (b0 << 8) | b1);",
    "        var v = (b2 << 8) | b3;",
    "        unicodeMap[k] = v;",
    "        count += 1;",
    "      }",
    "      if (count != numChars) {",
    "        throw count + ' != ' + numChars;",
    "      }",
    "",
    "      return unicodeMap;",
    "    }();",
    "",
    "    var unknownChar = '?'.charCodeAt(0);",
    "",
    "    return function(s) {",
    "      var bytes = [];",
    "      for (var i = 0; i < s.length; i += 1) {",
    "        var c = s.charCodeAt(i);",
    "        if (c < 128) {",
    "          bytes.push(c);",
    "        } else {",
    "          var b = unicodeMap[s.charAt(i)];",
    "          if (typeof b == 'number') {",
    "            if ( (b & 0xff) == b) {",
    "              // 1byte",
    "              bytes.push(b);",
    "            } else {",
    "              // 2bytes",
    "              bytes.push(b >>> 8);",
    "              bytes.push(b & 0xff);",
    "            }",
    "          } else {",
    "            bytes.push(unknownChar);",
    "          }",
    "        }",
    "      }",
    "      return bytes;",
    "    };",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // QRMode",
    "  //---------------------------------------------------------------------",
    "",
    "  var QRMode = {",
    "    MODE_NUMBER :    1 << 0,",
    "    MODE_ALPHA_NUM : 1 << 1,",
    "    MODE_8BIT_BYTE : 1 << 2,",
    "    MODE_KANJI :     1 << 3",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // QRErrorCorrectionLevel",
    "  //---------------------------------------------------------------------",
    "",
    "  var QRErrorCorrectionLevel = {",
    "    L : 1,",
    "    M : 0,",
    "    Q : 3,",
    "    H : 2",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // QRMaskPattern",
    "  //---------------------------------------------------------------------",
    "",
    "  var QRMaskPattern = {",
    "    PATTERN000 : 0,",
    "    PATTERN001 : 1,",
    "    PATTERN010 : 2,",
    "    PATTERN011 : 3,",
    "    PATTERN100 : 4,",
    "    PATTERN101 : 5,",
    "    PATTERN110 : 6,",
    "    PATTERN111 : 7",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // QRUtil",
    "  //---------------------------------------------------------------------",
    "",
    "  var QRUtil = function() {",
    "",
    "    var PATTERN_POSITION_TABLE = [",
    "      [],",
    "      [6, 18],",
    "      [6, 22],",
    "      [6, 26],",
    "      [6, 30],",
    "      [6, 34],",
    "      [6, 22, 38],",
    "      [6, 24, 42],",
    "      [6, 26, 46],",
    "      [6, 28, 50],",
    "      [6, 30, 54],",
    "      [6, 32, 58],",
    "      [6, 34, 62],",
    "      [6, 26, 46, 66],",
    "      [6, 26, 48, 70],",
    "      [6, 26, 50, 74],",
    "      [6, 30, 54, 78],",
    "      [6, 30, 56, 82],",
    "      [6, 30, 58, 86],",
    "      [6, 34, 62, 90],",
    "      [6, 28, 50, 72, 94],",
    "      [6, 26, 50, 74, 98],",
    "      [6, 30, 54, 78, 102],",
    "      [6, 28, 54, 80, 106],",
    "      [6, 32, 58, 84, 110],",
    "      [6, 30, 58, 86, 114],",
    "      [6, 34, 62, 90, 118],",
    "      [6, 26, 50, 74, 98, 122],",
    "      [6, 30, 54, 78, 102, 126],",
    "      [6, 26, 52, 78, 104, 130],",
    "      [6, 30, 56, 82, 108, 134],",
    "      [6, 34, 60, 86, 112, 138],",
    "      [6, 30, 58, 86, 114, 142],",
    "      [6, 34, 62, 90, 118, 146],",
    "      [6, 30, 54, 78, 102, 126, 150],",
    "      [6, 24, 50, 76, 102, 128, 154],",
    "      [6, 28, 54, 80, 106, 132, 158],",
    "      [6, 32, 58, 84, 110, 136, 162],",
    "      [6, 26, 54, 82, 110, 138, 166],",
    "      [6, 30, 58, 86, 114, 142, 170]",
    "    ];",
    "    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);",
    "    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);",
    "    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);",
    "",
    "    var _this = {};",
    "",
    "    var getBCHDigit = function(data) {",
    "      var digit = 0;",
    "      while (data != 0) {",
    "        digit += 1;",
    "        data >>>= 1;",
    "      }",
    "      return digit;",
    "    };",
    "",
    "    _this.getBCHTypeInfo = function(data) {",
    "      var d = data << 10;",
    "      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {",
    "        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );",
    "      }",
    "      return ( (data << 10) | d) ^ G15_MASK;",
    "    };",
    "",
    "    _this.getBCHTypeNumber = function(data) {",
    "      var d = data << 12;",
    "      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {",
    "        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );",
    "      }",
    "      return (data << 12) | d;",
    "    };",
    "",
    "    _this.getPatternPosition = function(typeNumber) {",
    "      return PATTERN_POSITION_TABLE[typeNumber - 1];",
    "    };",
    "",
    "    _this.getMaskFunction = function(maskPattern) {",
    "",
    "      switch (maskPattern) {",
    "",
    "      case QRMaskPattern.PATTERN000 :",
    "        return function(i, j) { return (i + j) % 2 == 0; };",
    "      case QRMaskPattern.PATTERN001 :",
    "        return function(i, j) { return i % 2 == 0; };",
    "      case QRMaskPattern.PATTERN010 :",
    "        return function(i, j) { return j % 3 == 0; };",
    "      case QRMaskPattern.PATTERN011 :",
    "        return function(i, j) { return (i + j) % 3 == 0; };",
    "      case QRMaskPattern.PATTERN100 :",
    "        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };",
    "      case QRMaskPattern.PATTERN101 :",
    "        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };",
    "      case QRMaskPattern.PATTERN110 :",
    "        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };",
    "      case QRMaskPattern.PATTERN111 :",
    "        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };",
    "",
    "      default :",
    "        throw 'bad maskPattern:' + maskPattern;",
    "      }",
    "    };",
    "",
    "    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {",
    "      var a = qrPolynomial([1], 0);",
    "      for (var i = 0; i < errorCorrectLength; i += 1) {",
    "        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );",
    "      }",
    "      return a;",
    "    };",
    "",
    "    _this.getLengthInBits = function(mode, type) {",
    "",
    "      if (1 <= type && type < 10) {",
    "",
    "        // 1 - 9",
    "",
    "        switch(mode) {",
    "        case QRMode.MODE_NUMBER    : return 10;",
    "        case QRMode.MODE_ALPHA_NUM : return 9;",
    "        case QRMode.MODE_8BIT_BYTE : return 8;",
    "        case QRMode.MODE_KANJI     : return 8;",
    "        default :",
    "          throw 'mode:' + mode;",
    "        }",
    "",
    "      } else if (type < 27) {",
    "",
    "        // 10 - 26",
    "",
    "        switch(mode) {",
    "        case QRMode.MODE_NUMBER    : return 12;",
    "        case QRMode.MODE_ALPHA_NUM : return 11;",
    "        case QRMode.MODE_8BIT_BYTE : return 16;",
    "        case QRMode.MODE_KANJI     : return 10;",
    "        default :",
    "          throw 'mode:' + mode;",
    "        }",
    "",
    "      } else if (type < 41) {",
    "",
    "        // 27 - 40",
    "",
    "        switch(mode) {",
    "        case QRMode.MODE_NUMBER    : return 14;",
    "        case QRMode.MODE_ALPHA_NUM : return 13;",
    "        case QRMode.MODE_8BIT_BYTE : return 16;",
    "        case QRMode.MODE_KANJI     : return 12;",
    "        default :",
    "          throw 'mode:' + mode;",
    "        }",
    "",
    "      } else {",
    "        throw 'type:' + type;",
    "      }",
    "    };",
    "",
    "    _this.getLostPoint = function(qrcode) {",
    "",
    "      var moduleCount = qrcode.getModuleCount();",
    "",
    "      var lostPoint = 0;",
    "",
    "      // LEVEL1",
    "",
    "      for (var row = 0; row < moduleCount; row += 1) {",
    "        for (var col = 0; col < moduleCount; col += 1) {",
    "",
    "          var sameCount = 0;",
    "          var dark = qrcode.isDark(row, col);",
    "",
    "          for (var r = -1; r <= 1; r += 1) {",
    "",
    "            if (row + r < 0 || moduleCount <= row + r) {",
    "              continue;",
    "            }",
    "",
    "            for (var c = -1; c <= 1; c += 1) {",
    "",
    "              if (col + c < 0 || moduleCount <= col + c) {",
    "                continue;",
    "              }",
    "",
    "              if (r == 0 && c == 0) {",
    "                continue;",
    "              }",
    "",
    "              if (dark == qrcode.isDark(row + r, col + c) ) {",
    "                sameCount += 1;",
    "              }",
    "            }",
    "          }",
    "",
    "          if (sameCount > 5) {",
    "            lostPoint += (3 + sameCount - 5);",
    "          }",
    "        }",
    "      };",
    "",
    "      // LEVEL2",
    "",
    "      for (var row = 0; row < moduleCount - 1; row += 1) {",
    "        for (var col = 0; col < moduleCount - 1; col += 1) {",
    "          var count = 0;",
    "          if (qrcode.isDark(row, col) ) count += 1;",
    "          if (qrcode.isDark(row + 1, col) ) count += 1;",
    "          if (qrcode.isDark(row, col + 1) ) count += 1;",
    "          if (qrcode.isDark(row + 1, col + 1) ) count += 1;",
    "          if (count == 0 || count == 4) {",
    "            lostPoint += 3;",
    "          }",
    "        }",
    "      }",
    "",
    "      // LEVEL3",
    "",
    "      for (var row = 0; row < moduleCount; row += 1) {",
    "        for (var col = 0; col < moduleCount - 6; col += 1) {",
    "          if (qrcode.isDark(row, col)",
    "              && !qrcode.isDark(row, col + 1)",
    "              &&  qrcode.isDark(row, col + 2)",
    "              &&  qrcode.isDark(row, col + 3)",
    "              &&  qrcode.isDark(row, col + 4)",
    "              && !qrcode.isDark(row, col + 5)",
    "              &&  qrcode.isDark(row, col + 6) ) {",
    "            lostPoint += 40;",
    "          }",
    "        }",
    "      }",
    "",
    "      for (var col = 0; col < moduleCount; col += 1) {",
    "        for (var row = 0; row < moduleCount - 6; row += 1) {",
    "          if (qrcode.isDark(row, col)",
    "              && !qrcode.isDark(row + 1, col)",
    "              &&  qrcode.isDark(row + 2, col)",
    "              &&  qrcode.isDark(row + 3, col)",
    "              &&  qrcode.isDark(row + 4, col)",
    "              && !qrcode.isDark(row + 5, col)",
    "              &&  qrcode.isDark(row + 6, col) ) {",
    "            lostPoint += 40;",
    "          }",
    "        }",
    "      }",
    "",
    "      // LEVEL4",
    "",
    "      var darkCount = 0;",
    "",
    "      for (var col = 0; col < moduleCount; col += 1) {",
    "        for (var row = 0; row < moduleCount; row += 1) {",
    "          if (qrcode.isDark(row, col) ) {",
    "            darkCount += 1;",
    "          }",
    "        }",
    "      }",
    "",
    "      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;",
    "      lostPoint += ratio * 10;",
    "",
    "      return lostPoint;",
    "    };",
    "",
    "    return _this;",
    "  }();",
    "",
    "  //---------------------------------------------------------------------",
    "  // QRMath",
    "  //---------------------------------------------------------------------",
    "",
    "  var QRMath = function() {",
    "",
    "    var EXP_TABLE = new Array(256);",
    "    var LOG_TABLE = new Array(256);",
    "",
    "    // initialize tables",
    "    for (var i = 0; i < 8; i += 1) {",
    "      EXP_TABLE[i] = 1 << i;",
    "    }",
    "    for (var i = 8; i < 256; i += 1) {",
    "      EXP_TABLE[i] = EXP_TABLE[i - 4]",
    "        ^ EXP_TABLE[i - 5]",
    "        ^ EXP_TABLE[i - 6]",
    "        ^ EXP_TABLE[i - 8];",
    "    }",
    "    for (var i = 0; i < 255; i += 1) {",
    "      LOG_TABLE[EXP_TABLE[i] ] = i;",
    "    }",
    "",
    "    var _this = {};",
    "",
    "    _this.glog = function(n) {",
    "",
    "      if (n < 1) {",
    "        throw 'glog(' + n + ')';",
    "      }",
    "",
    "      return LOG_TABLE[n];",
    "    };",
    "",
    "    _this.gexp = function(n) {",
    "",
    "      while (n < 0) {",
    "        n += 255;",
    "      }",
    "",
    "      while (n >= 256) {",
    "        n -= 255;",
    "      }",
    "",
    "      return EXP_TABLE[n];",
    "    };",
    "",
    "    return _this;",
    "  }();",
    "",
    "  //---------------------------------------------------------------------",
    "  // qrPolynomial",
    "  //---------------------------------------------------------------------",
    "",
    "  function qrPolynomial(num, shift) {",
    "",
    "    if (typeof num.length == 'undefined') {",
    "      throw num.length + '/' + shift;",
    "    }",
    "",
    "    var _num = function() {",
    "      var offset = 0;",
    "      while (offset < num.length && num[offset] == 0) {",
    "        offset += 1;",
    "      }",
    "      var _num = new Array(num.length - offset + shift);",
    "      for (var i = 0; i < num.length - offset; i += 1) {",
    "        _num[i] = num[i + offset];",
    "      }",
    "      return _num;",
    "    }();",
    "",
    "    var _this = {};",
    "",
    "    _this.getAt = function(index) {",
    "      return _num[index];",
    "    };",
    "",
    "    _this.getLength = function() {",
    "      return _num.length;",
    "    };",
    "",
    "    _this.multiply = function(e) {",
    "",
    "      var num = new Array(_this.getLength() + e.getLength() - 1);",
    "",
    "      for (var i = 0; i < _this.getLength(); i += 1) {",
    "        for (var j = 0; j < e.getLength(); j += 1) {",
    "          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );",
    "        }",
    "      }",
    "",
    "      return qrPolynomial(num, 0);",
    "    };",
    "",
    "    _this.mod = function(e) {",
    "",
    "      if (_this.getLength() - e.getLength() < 0) {",
    "        return _this;",
    "      }",
    "",
    "      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );",
    "",
    "      var num = new Array(_this.getLength() );",
    "      for (var i = 0; i < _this.getLength(); i += 1) {",
    "        num[i] = _this.getAt(i);",
    "      }",
    "",
    "      for (var i = 0; i < e.getLength(); i += 1) {",
    "        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);",
    "      }",
    "",
    "      // recursive call",
    "      return qrPolynomial(num, 0).mod(e);",
    "    };",
    "",
    "    return _this;",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // QRRSBlock",
    "  //---------------------------------------------------------------------",
    "",
    "  var QRRSBlock = function() {",
    "",
    "    var RS_BLOCK_TABLE = [",
    "",
    "      // L",
    "      // M",
    "      // Q",
    "      // H",
    "",
    "      // 1",
    "      [1, 26, 19],",
    "      [1, 26, 16],",
    "      [1, 26, 13],",
    "      [1, 26, 9],",
    "",
    "      // 2",
    "      [1, 44, 34],",
    "      [1, 44, 28],",
    "      [1, 44, 22],",
    "      [1, 44, 16],",
    "",
    "      // 3",
    "      [1, 70, 55],",
    "      [1, 70, 44],",
    "      [2, 35, 17],",
    "      [2, 35, 13],",
    "",
    "      // 4",
    "      [1, 100, 80],",
    "      [2, 50, 32],",
    "      [2, 50, 24],",
    "      [4, 25, 9],",
    "",
    "      // 5",
    "      [1, 134, 108],",
    "      [2, 67, 43],",
    "      [2, 33, 15, 2, 34, 16],",
    "      [2, 33, 11, 2, 34, 12],",
    "",
    "      // 6",
    "      [2, 86, 68],",
    "      [4, 43, 27],",
    "      [4, 43, 19],",
    "      [4, 43, 15],",
    "",
    "      // 7",
    "      [2, 98, 78],",
    "      [4, 49, 31],",
    "      [2, 32, 14, 4, 33, 15],",
    "      [4, 39, 13, 1, 40, 14],",
    "",
    "      // 8",
    "      [2, 121, 97],",
    "      [2, 60, 38, 2, 61, 39],",
    "      [4, 40, 18, 2, 41, 19],",
    "      [4, 40, 14, 2, 41, 15],",
    "",
    "      // 9",
    "      [2, 146, 116],",
    "      [3, 58, 36, 2, 59, 37],",
    "      [4, 36, 16, 4, 37, 17],",
    "      [4, 36, 12, 4, 37, 13],",
    "",
    "      // 10",
    "      [2, 86, 68, 2, 87, 69],",
    "      [4, 69, 43, 1, 70, 44],",
    "      [6, 43, 19, 2, 44, 20],",
    "      [6, 43, 15, 2, 44, 16],",
    "",
    "      // 11",
    "      [4, 101, 81],",
    "      [1, 80, 50, 4, 81, 51],",
    "      [4, 50, 22, 4, 51, 23],",
    "      [3, 36, 12, 8, 37, 13],",
    "",
    "      // 12",
    "      [2, 116, 92, 2, 117, 93],",
    "      [6, 58, 36, 2, 59, 37],",
    "      [4, 46, 20, 6, 47, 21],",
    "      [7, 42, 14, 4, 43, 15],",
    "",
    "      // 13",
    "      [4, 133, 107],",
    "      [8, 59, 37, 1, 60, 38],",
    "      [8, 44, 20, 4, 45, 21],",
    "      [12, 33, 11, 4, 34, 12],",
    "",
    "      // 14",
    "      [3, 145, 115, 1, 146, 116],",
    "      [4, 64, 40, 5, 65, 41],",
    "      [11, 36, 16, 5, 37, 17],",
    "      [11, 36, 12, 5, 37, 13],",
    "",
    "      // 15",
    "      [5, 109, 87, 1, 110, 88],",
    "      [5, 65, 41, 5, 66, 42],",
    "      [5, 54, 24, 7, 55, 25],",
    "      [11, 36, 12, 7, 37, 13],",
    "",
    "      // 16",
    "      [5, 122, 98, 1, 123, 99],",
    "      [7, 73, 45, 3, 74, 46],",
    "      [15, 43, 19, 2, 44, 20],",
    "      [3, 45, 15, 13, 46, 16],",
    "",
    "      // 17",
    "      [1, 135, 107, 5, 136, 108],",
    "      [10, 74, 46, 1, 75, 47],",
    "      [1, 50, 22, 15, 51, 23],",
    "      [2, 42, 14, 17, 43, 15],",
    "",
    "      // 18",
    "      [5, 150, 120, 1, 151, 121],",
    "      [9, 69, 43, 4, 70, 44],",
    "      [17, 50, 22, 1, 51, 23],",
    "      [2, 42, 14, 19, 43, 15],",
    "",
    "      // 19",
    "      [3, 141, 113, 4, 142, 114],",
    "      [3, 70, 44, 11, 71, 45],",
    "      [17, 47, 21, 4, 48, 22],",
    "      [9, 39, 13, 16, 40, 14],",
    "",
    "      // 20",
    "      [3, 135, 107, 5, 136, 108],",
    "      [3, 67, 41, 13, 68, 42],",
    "      [15, 54, 24, 5, 55, 25],",
    "      [15, 43, 15, 10, 44, 16],",
    "",
    "      // 21",
    "      [4, 144, 116, 4, 145, 117],",
    "      [17, 68, 42],",
    "      [17, 50, 22, 6, 51, 23],",
    "      [19, 46, 16, 6, 47, 17],",
    "",
    "      // 22",
    "      [2, 139, 111, 7, 140, 112],",
    "      [17, 74, 46],",
    "      [7, 54, 24, 16, 55, 25],",
    "      [34, 37, 13],",
    "",
    "      // 23",
    "      [4, 151, 121, 5, 152, 122],",
    "      [4, 75, 47, 14, 76, 48],",
    "      [11, 54, 24, 14, 55, 25],",
    "      [16, 45, 15, 14, 46, 16],",
    "",
    "      // 24",
    "      [6, 147, 117, 4, 148, 118],",
    "      [6, 73, 45, 14, 74, 46],",
    "      [11, 54, 24, 16, 55, 25],",
    "      [30, 46, 16, 2, 47, 17],",
    "",
    "      // 25",
    "      [8, 132, 106, 4, 133, 107],",
    "      [8, 75, 47, 13, 76, 48],",
    "      [7, 54, 24, 22, 55, 25],",
    "      [22, 45, 15, 13, 46, 16],",
    "",
    "      // 26",
    "      [10, 142, 114, 2, 143, 115],",
    "      [19, 74, 46, 4, 75, 47],",
    "      [28, 50, 22, 6, 51, 23],",
    "      [33, 46, 16, 4, 47, 17],",
    "",
    "      // 27",
    "      [8, 152, 122, 4, 153, 123],",
    "      [22, 73, 45, 3, 74, 46],",
    "      [8, 53, 23, 26, 54, 24],",
    "      [12, 45, 15, 28, 46, 16],",
    "",
    "      // 28",
    "      [3, 147, 117, 10, 148, 118],",
    "      [3, 73, 45, 23, 74, 46],",
    "      [4, 54, 24, 31, 55, 25],",
    "      [11, 45, 15, 31, 46, 16],",
    "",
    "      // 29",
    "      [7, 146, 116, 7, 147, 117],",
    "      [21, 73, 45, 7, 74, 46],",
    "      [1, 53, 23, 37, 54, 24],",
    "      [19, 45, 15, 26, 46, 16],",
    "",
    "      // 30",
    "      [5, 145, 115, 10, 146, 116],",
    "      [19, 75, 47, 10, 76, 48],",
    "      [15, 54, 24, 25, 55, 25],",
    "      [23, 45, 15, 25, 46, 16],",
    "",
    "      // 31",
    "      [13, 145, 115, 3, 146, 116],",
    "      [2, 74, 46, 29, 75, 47],",
    "      [42, 54, 24, 1, 55, 25],",
    "      [23, 45, 15, 28, 46, 16],",
    "",
    "      // 32",
    "      [17, 145, 115],",
    "      [10, 74, 46, 23, 75, 47],",
    "      [10, 54, 24, 35, 55, 25],",
    "      [19, 45, 15, 35, 46, 16],",
    "",
    "      // 33",
    "      [17, 145, 115, 1, 146, 116],",
    "      [14, 74, 46, 21, 75, 47],",
    "      [29, 54, 24, 19, 55, 25],",
    "      [11, 45, 15, 46, 46, 16],",
    "",
    "      // 34",
    "      [13, 145, 115, 6, 146, 116],",
    "      [14, 74, 46, 23, 75, 47],",
    "      [44, 54, 24, 7, 55, 25],",
    "      [59, 46, 16, 1, 47, 17],",
    "",
    "      // 35",
    "      [12, 151, 121, 7, 152, 122],",
    "      [12, 75, 47, 26, 76, 48],",
    "      [39, 54, 24, 14, 55, 25],",
    "      [22, 45, 15, 41, 46, 16],",
    "",
    "      // 36",
    "      [6, 151, 121, 14, 152, 122],",
    "      [6, 75, 47, 34, 76, 48],",
    "      [46, 54, 24, 10, 55, 25],",
    "      [2, 45, 15, 64, 46, 16],",
    "",
    "      // 37",
    "      [17, 152, 122, 4, 153, 123],",
    "      [29, 74, 46, 14, 75, 47],",
    "      [49, 54, 24, 10, 55, 25],",
    "      [24, 45, 15, 46, 46, 16],",
    "",
    "      // 38",
    "      [4, 152, 122, 18, 153, 123],",
    "      [13, 74, 46, 32, 75, 47],",
    "      [48, 54, 24, 14, 55, 25],",
    "      [42, 45, 15, 32, 46, 16],",
    "",
    "      // 39",
    "      [20, 147, 117, 4, 148, 118],",
    "      [40, 75, 47, 7, 76, 48],",
    "      [43, 54, 24, 22, 55, 25],",
    "      [10, 45, 15, 67, 46, 16],",
    "",
    "      // 40",
    "      [19, 148, 118, 6, 149, 119],",
    "      [18, 75, 47, 31, 76, 48],",
    "      [34, 54, 24, 34, 55, 25],",
    "      [20, 45, 15, 61, 46, 16]",
    "    ];",
    "",
    "    var qrRSBlock = function(totalCount, dataCount) {",
    "      var _this = {};",
    "      _this.totalCount = totalCount;",
    "      _this.dataCount = dataCount;",
    "      return _this;",
    "    };",
    "",
    "    var _this = {};",
    "",
    "    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {",
    "",
    "      switch(errorCorrectionLevel) {",
    "      case QRErrorCorrectionLevel.L :",
    "        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];",
    "      case QRErrorCorrectionLevel.M :",
    "        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];",
    "      case QRErrorCorrectionLevel.Q :",
    "        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];",
    "      case QRErrorCorrectionLevel.H :",
    "        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];",
    "      default :",
    "        return undefined;",
    "      }",
    "    };",
    "",
    "    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {",
    "",
    "      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);",
    "",
    "      if (typeof rsBlock == 'undefined') {",
    "        throw 'bad rs block @ typeNumber:' + typeNumber +",
    "            '/errorCorrectionLevel:' + errorCorrectionLevel;",
    "      }",
    "",
    "      var length = rsBlock.length / 3;",
    "",
    "      var list = [];",
    "",
    "      for (var i = 0; i < length; i += 1) {",
    "",
    "        var count = rsBlock[i * 3 + 0];",
    "        var totalCount = rsBlock[i * 3 + 1];",
    "        var dataCount = rsBlock[i * 3 + 2];",
    "",
    "        for (var j = 0; j < count; j += 1) {",
    "          list.push(qrRSBlock(totalCount, dataCount) );",
    "        }",
    "      }",
    "",
    "      return list;",
    "    };",
    "",
    "    return _this;",
    "  }();",
    "",
    "  //---------------------------------------------------------------------",
    "  // qrBitBuffer",
    "  //---------------------------------------------------------------------",
    "",
    "  var qrBitBuffer = function() {",
    "",
    "    var _buffer = [];",
    "    var _length = 0;",
    "",
    "    var _this = {};",
    "",
    "    _this.getBuffer = function() {",
    "      return _buffer;",
    "    };",
    "",
    "    _this.getAt = function(index) {",
    "      var bufIndex = Math.floor(index / 8);",
    "      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;",
    "    };",
    "",
    "    _this.put = function(num, length) {",
    "      for (var i = 0; i < length; i += 1) {",
    "        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);",
    "      }",
    "    };",
    "",
    "    _this.getLengthInBits = function() {",
    "      return _length;",
    "    };",
    "",
    "    _this.putBit = function(bit) {",
    "",
    "      var bufIndex = Math.floor(_length / 8);",
    "      if (_buffer.length <= bufIndex) {",
    "        _buffer.push(0);",
    "      }",
    "",
    "      if (bit) {",
    "        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );",
    "      }",
    "",
    "      _length += 1;",
    "    };",
    "",
    "    return _this;",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // qrNumber",
    "  //---------------------------------------------------------------------",
    "",
    "  var qrNumber = function(data) {",
    "",
    "    var _mode = QRMode.MODE_NUMBER;",
    "    var _data = data;",
    "",
    "    var _this = {};",
    "",
    "    _this.getMode = function() {",
    "      return _mode;",
    "    };",
    "",
    "    _this.getLength = function(buffer) {",
    "      return _data.length;",
    "    };",
    "",
    "    _this.write = function(buffer) {",
    "",
    "      var data = _data;",
    "",
    "      var i = 0;",
    "",
    "      while (i + 2 < data.length) {",
    "        buffer.put(strToNum(data.substring(i, i + 3) ), 10);",
    "        i += 3;",
    "      }",
    "",
    "      if (i < data.length) {",
    "        if (data.length - i == 1) {",
    "          buffer.put(strToNum(data.substring(i, i + 1) ), 4);",
    "        } else if (data.length - i == 2) {",
    "          buffer.put(strToNum(data.substring(i, i + 2) ), 7);",
    "        }",
    "      }",
    "    };",
    "",
    "    var strToNum = function(s) {",
    "      var num = 0;",
    "      for (var i = 0; i < s.length; i += 1) {",
    "        num = num * 10 + chatToNum(s.charAt(i) );",
    "      }",
    "      return num;",
    "    };",
    "",
    "    var chatToNum = function(c) {",
    "      if ('0' <= c && c <= '9') {",
    "        return c.charCodeAt(0) - '0'.charCodeAt(0);",
    "      }",
    "      throw 'illegal char :' + c;",
    "    };",
    "",
    "    return _this;",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // qrAlphaNum",
    "  //---------------------------------------------------------------------",
    "",
    "  var qrAlphaNum = function(data) {",
    "",
    "    var _mode = QRMode.MODE_ALPHA_NUM;",
    "    var _data = data;",
    "",
    "    var _this = {};",
    "",
    "    _this.getMode = function() {",
    "      return _mode;",
    "    };",
    "",
    "    _this.getLength = function(buffer) {",
    "      return _data.length;",
    "    };",
    "",
    "    _this.write = function(buffer) {",
    "",
    "      var s = _data;",
    "",
    "      var i = 0;",
    "",
    "      while (i + 1 < s.length) {",
    "        buffer.put(",
    "          getCode(s.charAt(i) ) * 45 +",
    "          getCode(s.charAt(i + 1) ), 11);",
    "        i += 2;",
    "      }",
    "",
    "      if (i < s.length) {",
    "        buffer.put(getCode(s.charAt(i) ), 6);",
    "      }",
    "    };",
    "",
    "    var getCode = function(c) {",
    "",
    "      if ('0' <= c && c <= '9') {",
    "        return c.charCodeAt(0) - '0'.charCodeAt(0);",
    "      } else if ('A' <= c && c <= 'Z') {",
    "        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;",
    "      } else {",
    "        switch (c) {",
    "        case ' ' : return 36;",
    "        case '$' : return 37;",
    "        case '%' : return 38;",
    "        case '*' : return 39;",
    "        case '+' : return 40;",
    "        case '-' : return 41;",
    "        case '.' : return 42;",
    "        case '/' : return 43;",
    "        case ':' : return 44;",
    "        default :",
    "          throw 'illegal char :' + c;",
    "        }",
    "      }",
    "    };",
    "",
    "    return _this;",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // qr8BitByte",
    "  //---------------------------------------------------------------------",
    "",
    "  var qr8BitByte = function(data) {",
    "",
    "    var _mode = QRMode.MODE_8BIT_BYTE;",
    "    var _data = data;",
    "    var _bytes = qrcode.stringToBytes(data);",
    "",
    "    var _this = {};",
    "",
    "    _this.getMode = function() {",
    "      return _mode;",
    "    };",
    "",
    "    _this.getLength = function(buffer) {",
    "      return _bytes.length;",
    "    };",
    "",
    "    _this.write = function(buffer) {",
    "      for (var i = 0; i < _bytes.length; i += 1) {",
    "        buffer.put(_bytes[i], 8);",
    "      }",
    "    };",
    "",
    "    return _this;",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // qrKanji",
    "  //---------------------------------------------------------------------",
    "",
    "  var qrKanji = function(data) {",
    "",
    "    var _mode = QRMode.MODE_KANJI;",
    "    var _data = data;",
    "",
    "    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];",
    "    if (!stringToBytes) {",
    "      throw 'sjis not supported.';",
    "    }",
    "    !function(c, code) {",
    "      // self test for sjis support.",
    "      var test = stringToBytes(c);",
    "      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {",
    "        throw 'sjis not supported.';",
    "      }",
    "    }('\\u53cb', 0x9746);",
    "",
    "    var _bytes = stringToBytes(data);",
    "",
    "    var _this = {};",
    "",
    "    _this.getMode = function() {",
    "      return _mode;",
    "    };",
    "",
    "    _this.getLength = function(buffer) {",
    "      return ~~(_bytes.length / 2);",
    "    };",
    "",
    "    _this.write = function(buffer) {",
    "",
    "      var data = _bytes;",
    "",
    "      var i = 0;",
    "",
    "      while (i + 1 < data.length) {",
    "",
    "        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);",
    "",
    "        if (0x8140 <= c && c <= 0x9FFC) {",
    "          c -= 0x8140;",
    "        } else if (0xE040 <= c && c <= 0xEBBF) {",
    "          c -= 0xC140;",
    "        } else {",
    "          throw 'illegal char at ' + (i + 1) + '/' + c;",
    "        }",
    "",
    "        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);",
    "",
    "        buffer.put(c, 13);",
    "",
    "        i += 2;",
    "      }",
    "",
    "      if (i < data.length) {",
    "        throw 'illegal char at ' + (i + 1);",
    "      }",
    "    };",
    "",
    "    return _this;",
    "  };",
    "",
    "  //=====================================================================",
    "  // GIF Support etc.",
    "  //",
    "",
    "  //---------------------------------------------------------------------",
    "  // byteArrayOutputStream",
    "  //---------------------------------------------------------------------",
    "",
    "  var byteArrayOutputStream = function() {",
    "",
    "    var _bytes = [];",
    "",
    "    var _this = {};",
    "",
    "    _this.writeByte = function(b) {",
    "      _bytes.push(b & 0xff);",
    "    };",
    "",
    "    _this.writeShort = function(i) {",
    "      _this.writeByte(i);",
    "      _this.writeByte(i >>> 8);",
    "    };",
    "",
    "    _this.writeBytes = function(b, off, len) {",
    "      off = off || 0;",
    "      len = len || b.length;",
    "      for (var i = 0; i < len; i += 1) {",
    "        _this.writeByte(b[i + off]);",
    "      }",
    "    };",
    "",
    "    _this.writeString = function(s) {",
    "      for (var i = 0; i < s.length; i += 1) {",
    "        _this.writeByte(s.charCodeAt(i) );",
    "      }",
    "    };",
    "",
    "    _this.toByteArray = function() {",
    "      return _bytes;",
    "    };",
    "",
    "    _this.toString = function() {",
    "      var s = '';",
    "      s += '[';",
    "      for (var i = 0; i < _bytes.length; i += 1) {",
    "        if (i > 0) {",
    "          s += ',';",
    "        }",
    "        s += _bytes[i];",
    "      }",
    "      s += ']';",
    "      return s;",
    "    };",
    "",
    "    return _this;",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // base64EncodeOutputStream",
    "  //---------------------------------------------------------------------",
    "",
    "  var base64EncodeOutputStream = function() {",
    "",
    "    var _buffer = 0;",
    "    var _buflen = 0;",
    "    var _length = 0;",
    "    var _base64 = '';",
    "",
    "    var _this = {};",
    "",
    "    var writeEncoded = function(b) {",
    "      _base64 += String.fromCharCode(encode(b & 0x3f) );",
    "    };",
    "",
    "    var encode = function(n) {",
    "      if (n < 0) {",
    "        // error.",
    "      } else if (n < 26) {",
    "        return 0x41 + n;",
    "      } else if (n < 52) {",
    "        return 0x61 + (n - 26);",
    "      } else if (n < 62) {",
    "        return 0x30 + (n - 52);",
    "      } else if (n == 62) {",
    "        return 0x2b;",
    "      } else if (n == 63) {",
    "        return 0x2f;",
    "      }",
    "      throw 'n:' + n;",
    "    };",
    "",
    "    _this.writeByte = function(n) {",
    "",
    "      _buffer = (_buffer << 8) | (n & 0xff);",
    "      _buflen += 8;",
    "      _length += 1;",
    "",
    "      while (_buflen >= 6) {",
    "        writeEncoded(_buffer >>> (_buflen - 6) );",
    "        _buflen -= 6;",
    "      }",
    "    };",
    "",
    "    _this.flush = function() {",
    "",
    "      if (_buflen > 0) {",
    "        writeEncoded(_buffer << (6 - _buflen) );",
    "        _buffer = 0;",
    "        _buflen = 0;",
    "      }",
    "",
    "      if (_length % 3 != 0) {",
    "        // padding",
    "        var padlen = 3 - _length % 3;",
    "        for (var i = 0; i < padlen; i += 1) {",
    "          _base64 += '=';",
    "        }",
    "      }",
    "    };",
    "",
    "    _this.toString = function() {",
    "      return _base64;",
    "    };",
    "",
    "    return _this;",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // base64DecodeInputStream",
    "  //---------------------------------------------------------------------",
    "",
    "  var base64DecodeInputStream = function(str) {",
    "",
    "    var _str = str;",
    "    var _pos = 0;",
    "    var _buffer = 0;",
    "    var _buflen = 0;",
    "",
    "    var _this = {};",
    "",
    "    _this.read = function() {",
    "",
    "      while (_buflen < 8) {",
    "",
    "        if (_pos >= _str.length) {",
    "          if (_buflen == 0) {",
    "            return -1;",
    "          }",
    "          throw 'unexpected end of file./' + _buflen;",
    "        }",
    "",
    "        var c = _str.charAt(_pos);",
    "        _pos += 1;",
    "",
    "        if (c == '=') {",
    "          _buflen = 0;",
    "          return -1;",
    "        } else if (c.match(/^\\s$/) ) {",
    "          // ignore if whitespace.",
    "          continue;",
    "        }",
    "",
    "        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );",
    "        _buflen += 6;",
    "      }",
    "",
    "      var n = (_buffer >>> (_buflen - 8) ) & 0xff;",
    "      _buflen -= 8;",
    "      return n;",
    "    };",
    "",
    "    var decode = function(c) {",
    "      if (0x41 <= c && c <= 0x5a) {",
    "        return c - 0x41;",
    "      } else if (0x61 <= c && c <= 0x7a) {",
    "        return c - 0x61 + 26;",
    "      } else if (0x30 <= c && c <= 0x39) {",
    "        return c - 0x30 + 52;",
    "      } else if (c == 0x2b) {",
    "        return 62;",
    "      } else if (c == 0x2f) {",
    "        return 63;",
    "      } else {",
    "        throw 'c:' + c;",
    "      }",
    "    };",
    "",
    "    return _this;",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // gifImage (B/W)",
    "  //---------------------------------------------------------------------",
    "",
    "  var gifImage = function(width, height) {",
    "",
    "    var _width = width;",
    "    var _height = height;",
    "    var _data = new Array(width * height);",
    "",
    "    var _this = {};",
    "",
    "    _this.setPixel = function(x, y, pixel) {",
    "      _data[y * _width + x] = pixel;",
    "    };",
    "",
    "    _this.write = function(out) {",
    "",
    "      //---------------------------------",
    "      // GIF Signature",
    "",
    "      out.writeString('GIF87a');",
    "",
    "      //---------------------------------",
    "      // Screen Descriptor",
    "",
    "      out.writeShort(_width);",
    "      out.writeShort(_height);",
    "",
    "      out.writeByte(0x80); // 2bit",
    "      out.writeByte(0);",
    "      out.writeByte(0);",
    "",
    "      //---------------------------------",
    "      // Global Color Map",
    "",
    "      // black",
    "      out.writeByte(0x00);",
    "      out.writeByte(0x00);",
    "      out.writeByte(0x00);",
    "",
    "      // white",
    "      out.writeByte(0xff);",
    "      out.writeByte(0xff);",
    "      out.writeByte(0xff);",
    "",
    "      //---------------------------------",
    "      // Image Descriptor",
    "",
    "      out.writeString(',');",
    "      out.writeShort(0);",
    "      out.writeShort(0);",
    "      out.writeShort(_width);",
    "      out.writeShort(_height);",
    "      out.writeByte(0);",
    "",
    "      //---------------------------------",
    "      // Local Color Map",
    "",
    "      //---------------------------------",
    "      // Raster Data",
    "",
    "      var lzwMinCodeSize = 2;",
    "      var raster = getLZWRaster(lzwMinCodeSize);",
    "",
    "      out.writeByte(lzwMinCodeSize);",
    "",
    "      var offset = 0;",
    "",
    "      while (raster.length - offset > 255) {",
    "        out.writeByte(255);",
    "        out.writeBytes(raster, offset, 255);",
    "        offset += 255;",
    "      }",
    "",
    "      out.writeByte(raster.length - offset);",
    "      out.writeBytes(raster, offset, raster.length - offset);",
    "      out.writeByte(0x00);",
    "",
    "      //---------------------------------",
    "      // GIF Terminator",
    "      out.writeString(';');",
    "    };",
    "",
    "    var bitOutputStream = function(out) {",
    "",
    "      var _out = out;",
    "      var _bitLength = 0;",
    "      var _bitBuffer = 0;",
    "",
    "      var _this = {};",
    "",
    "      _this.write = function(data, length) {",
    "",
    "        if ( (data >>> length) != 0) {",
    "          throw 'length over';",
    "        }",
    "",
    "        while (_bitLength + length >= 8) {",
    "          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );",
    "          length -= (8 - _bitLength);",
    "          data >>>= (8 - _bitLength);",
    "          _bitBuffer = 0;",
    "          _bitLength = 0;",
    "        }",
    "",
    "        _bitBuffer = (data << _bitLength) | _bitBuffer;",
    "        _bitLength = _bitLength + length;",
    "      };",
    "",
    "      _this.flush = function() {",
    "        if (_bitLength > 0) {",
    "          _out.writeByte(_bitBuffer);",
    "        }",
    "      };",
    "",
    "      return _this;",
    "    };",
    "",
    "    var getLZWRaster = function(lzwMinCodeSize) {",
    "",
    "      var clearCode = 1 << lzwMinCodeSize;",
    "      var endCode = (1 << lzwMinCodeSize) + 1;",
    "      var bitLength = lzwMinCodeSize + 1;",
    "",
    "      // Setup LZWTable",
    "      var table = lzwTable();",
    "",
    "      for (var i = 0; i < clearCode; i += 1) {",
    "        table.add(String.fromCharCode(i) );",
    "      }",
    "      table.add(String.fromCharCode(clearCode) );",
    "      table.add(String.fromCharCode(endCode) );",
    "",
    "      var byteOut = byteArrayOutputStream();",
    "      var bitOut = bitOutputStream(byteOut);",
    "",
    "      // clear code",
    "      bitOut.write(clearCode, bitLength);",
    "",
    "      var dataIndex = 0;",
    "",
    "      var s = String.fromCharCode(_data[dataIndex]);",
    "      dataIndex += 1;",
    "",
    "      while (dataIndex < _data.length) {",
    "",
    "        var c = String.fromCharCode(_data[dataIndex]);",
    "        dataIndex += 1;",
    "",
    "        if (table.contains(s + c) ) {",
    "",
    "          s = s + c;",
    "",
    "        } else {",
    "",
    "          bitOut.write(table.indexOf(s), bitLength);",
    "",
    "          if (table.size() < 0xfff) {",
    "",
    "            if (table.size() == (1 << bitLength) ) {",
    "              bitLength += 1;",
    "            }",
    "",
    "            table.add(s + c);",
    "          }",
    "",
    "          s = c;",
    "        }",
    "      }",
    "",
    "      bitOut.write(table.indexOf(s), bitLength);",
    "",
    "      // end code",
    "      bitOut.write(endCode, bitLength);",
    "",
    "      bitOut.flush();",
    "",
    "      return byteOut.toByteArray();",
    "    };",
    "",
    "    var lzwTable = function() {",
    "",
    "      var _map = {};",
    "      var _size = 0;",
    "",
    "      var _this = {};",
    "",
    "      _this.add = function(key) {",
    "        if (_this.contains(key) ) {",
    "          throw 'dup key:' + key;",
    "        }",
    "        _map[key] = _size;",
    "        _size += 1;",
    "      };",
    "",
    "      _this.size = function() {",
    "        return _size;",
    "      };",
    "",
    "      _this.indexOf = function(key) {",
    "        return _map[key];",
    "      };",
    "",
    "      _this.contains = function(key) {",
    "        return typeof _map[key] != 'undefined';",
    "      };",
    "",
    "      return _this;",
    "    };",
    "",
    "    return _this;",
    "  };",
    "",
    "  var createDataURL = function(width, height, getPixel) {",
    "    var gif = gifImage(width, height);",
    "    for (var y = 0; y < height; y += 1) {",
    "      for (var x = 0; x < width; x += 1) {",
    "        gif.setPixel(x, y, getPixel(x, y) );",
    "      }",
    "    }",
    "",
    "    var b = byteArrayOutputStream();",
    "    gif.write(b);",
    "",
    "    var base64 = base64EncodeOutputStream();",
    "    var bytes = b.toByteArray();",
    "    for (var i = 0; i < bytes.length; i += 1) {",
    "      base64.writeByte(bytes[i]);",
    "    }",
    "    base64.flush();",
    "",
    "    return 'data:image/gif;base64,' + base64;",
    "  };",
    "",
    "  //---------------------------------------------------------------------",
    "  // returns qrcode function.",
    "",
    "  return qrcode;",
    "}();",
    "",
    "// multibyte support",
    "!function() {",
    "",
    "  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {",
    "    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array",
    "    function toUTF8Array(str) {",
    "      var utf8 = [];",
    "      for (var i=0; i < str.length; i++) {",
    "        var charcode = str.charCodeAt(i);",
    "        if (charcode < 0x80) utf8.push(charcode);",
    "        else if (charcode < 0x800) {",
    "          utf8.push(0xc0 | (charcode >> 6),",
    "              0x80 | (charcode & 0x3f));",
    "        }",
    "        else if (charcode < 0xd800 || charcode >= 0xe000) {",
    "          utf8.push(0xe0 | (charcode >> 12),",
    "              0x80 | ((charcode>>6) & 0x3f),",
    "              0x80 | (charcode & 0x3f));",
    "        }",
    "        // surrogate pair",
    "        else {",
    "          i++;",
    "          // UTF-16 encodes 0x10000-0x10FFFF by",
    "          // subtracting 0x10000 and splitting the",
    "          // 20 bits of 0x0-0xFFFFF into two halves",
    "          charcode = 0x10000 + (((charcode & 0x3ff)<<10)",
    "            | (str.charCodeAt(i) & 0x3ff));",
    "          utf8.push(0xf0 | (charcode >>18),",
    "              0x80 | ((charcode>>12) & 0x3f),",
    "              0x80 | ((charcode>>6) & 0x3f),",
    "              0x80 | (charcode & 0x3f));",
    "        }",
    "      }",
    "      return utf8;",
    "    }",
    "    return toUTF8Array(s);",
    "  };",
    "",
    "}();",
    "",
    "(function (factory) {",
    "  if (typeof define === 'function' && define.amd) {",
    "      define([], factory);",
    "  } else if (typeof exports === 'object') {",
    "      module.exports = factory();",
    "  }",
    "}(function () {",
    "    return qrcode;",
    "}));",
    "",
    "</script>",
    ""
  ].join('\n')
};
/* ==================== FIN DEL ARCHIVO (no debe haber nada debajo de esta línea) ==================== */
