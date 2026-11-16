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
  aplicarMigraciones_(cambios);
  return cambios;
}

/**
 * Cambios puntuales de datos, cada uno se aplica UNA sola vez (queda anotado en Config → MIGRACIONES).
 * horario: [ID bloque, docente anterior, docente nuevo] → solo cambia si el bloque aún tiene al docente anterior.
 * docentes: filas nuevas (si no existen) · inactivar: docentes que dejan de dictar (Activo = NO).
 */
var MIGRACIONES = [{
  id: '2026-11-16-asignacion-IVB',
  descripcion: 'Asignación de docentes IV bimestre (examen mensual 16–21 nov 2026)',
  docentes: [['', 'Dharma', '', 'Inicial Pequeñines 3', '904405961', '', 'SI', 'Ingresa en noviembre 2026']],
  horario: [
    ['PE-LU-1', 'Cherceni Floridas', 'Dharma'], ['PE-MA-1', 'Cherceni Floridas', 'Dharma'], ['PE-MI-1', 'Cherceni Floridas', 'Dharma'],
    ['PE-JU-1', 'Cherceni Floridas', 'Dharma'], ['PE-VI-1', 'Cherceni Floridas', 'Dharma'],
    ['EX-LU-1', 'Ariana Cancino', 'Cherceni Floridas'], ['EX-MA-1', 'Ariana Cancino', 'Cherceni Floridas'], ['EX-MI-1', 'Ariana Cancino', 'Cherceni Floridas'],
    ['EX-JU-1', 'Ariana Cancino', 'Cherceni Floridas'], ['EX-VI-1', 'Ariana Cancino', 'Cherceni Floridas'],
    ['CR-MI-1', 'Justin Guillén', 'Nicol Vallejos'],
    ['LI-MI-2', 'Susan Adama', 'Yuli Cucho'], ['LI-MI-4', 'Susan Adama', 'Yuli Cucho']
  ],
  inactivar: ['Ariana Cancino', 'Justin Guillén']
}];

function aplicarMigraciones_(cambios) {
  var shC = hoja_(HOJAS.CONFIG);
  var cfg = shC.getRange(2, 1, Math.max(shC.getLastRow() - 1, 1), 2).getDisplayValues();
  var filaMig = -1, hechas = [];
  cfg.forEach(function (r, i) { if (r[0] === 'MIGRACIONES') { filaMig = i + 2; hechas = String(r[1]).split(',').filter(String); } });
  MIGRACIONES.forEach(function (mig) {
    if (hechas.indexOf(mig.id) >= 0) return;
    var esqD = ESQUEMAS.Docentes.map(function (c) { return c[0]; });
    var colDoc = esqD.indexOf('docente'), colAct = esqD.indexOf('activo');
    var shD = hoja_(HOJAS.DOCENTES), n = Math.max(shD.getLastRow() - 1, 0);
    var datos = n ? shD.getRange(2, 1, n, esqD.length).getDisplayValues() : [];
    var nuevos = 0, inact = 0, bloques = 0;
    (mig.docentes || []).forEach(function (d) {
      if (datos.some(function (r) { return norm(r[colDoc]) === norm(d[colDoc]); })) return;
      var fila = d.slice(); while (fila.length < esqD.length) fila.push('');
      datos.push(fila); nuevos++;
    });
    (mig.inactivar || []).forEach(function (nom) {
      datos.forEach(function (r) { if (norm(r[colDoc]) === norm(nom) && norm(r[colAct]) !== 'no') { r[colAct] = 'NO'; inact++; } });
    });
    if (datos.length) shD.getRange(2, 1, datos.length, esqD.length).setValues(datos);
    var shH = hoja_(HOJAS.HORARIO), nh = shH.getLastRow() - 1;
    if (nh > 0) {
      var hv = shH.getRange(2, 1, nh, 7).getDisplayValues();
      var cambio = false;
      (mig.horario || []).forEach(function (h) {
        hv.forEach(function (r) { if (r[0] === h[0] && norm(r[6]) === norm(h[1])) { r[6] = h[2]; bloques++; cambio = true; } });
      });
      if (cambio) shH.getRange(2, 7, nh, 1).setValues(hv.map(function (r) { return [r[6]]; }));
    }
    hechas.push(mig.id);
    cambios.push(mig.descripcion + ': ' + bloques + ' bloque(s) reasignados, ' + nuevos + ' docente(s) nuevo(s), ' + inact + ' inactivado(s)');
  });
  var valor = hechas.join(',');
  if (filaMig > 0) shC.getRange(filaMig, 2).setValue(valor);
  else shC.getRange(shC.getLastRow() + 1, 1, 1, 3).setValues([['MIGRACIONES', valor, 'Actualizaciones de datos ya aplicadas (no editar)']]);
}
