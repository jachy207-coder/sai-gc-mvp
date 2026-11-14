/**
 * CVI Monte Azul — Control de Asistencia Docente (piloto 16/11/2026)
 * Backend en Google Apps Script. Los datos viven en la hoja de cálculo vinculada.
 *
 * Páginas:
 *   <URL de la app>              → Marcación (DNI / QR)
 *   <URL de la app>?page=panel   → Panel en tiempo real + reportes (con PIN)
 */

var TZ = 'America/Lima';

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
  Docentes: [['dni', 'DNI', true], ['docente', 'Docente (igual que en Horario)', true], ['especialidad', 'Especialidad', true],
    ['celular', 'Celular', true], ['activo', 'Activo (SI/NO)', true]],
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
  var t = HtmlService.createTemplateFromFile(page);
  t.dniInicial = extraerDni(p.dni || '') || '';
  t.appUrl = ScriptApp.getService().getUrl();
  return t.evaluate()
    .setTitle(page === 'Dashboard' ? 'Panel de Asistencia · CVI' : 'Asistencia Docente · CVI')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/* ============================ Utilidades de hoja ============================ */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

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

function normDni_(v) {
  var s = String(v || '').replace(/\D/g, '');
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
  var dni = extraerDni(texto) || normDni_(texto);
  if (!dni || dni.length !== 8) return { ok: false, error: 'Ingresa un DNI válido de 8 dígitos.' };
  var doc = docentes_().filter(function (d) { return d.dni === dni; })[0];
  if (!doc) return { ok: false, error: 'El DNI ' + dni + ' no está registrado. Comunícate con coordinación.' };
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
    docentesSinDni: docs.filter(function (d) { return !d.dni; }).map(function (d) { return d.docente; })
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
