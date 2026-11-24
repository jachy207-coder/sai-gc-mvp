/**
 * SAI-GC R02 | Auditoría ampliada PRE-V5
 * Origen de metadatos: J
 * Esta capa NO utiliza el Gold Standard ni cambia la lógica del motor.
 */
import {
  CAPACITY, VERSION, DATASET_VERSION, WEIGHT_SCHEME_VERSION,
  classify, weightFor, processCase, buildAgentsFromCaseState,
  evaluateDatasetV08
} from './logic.mjs';

export const AUDIT_SCHEMA = 'SAIGC-PRE-V5-1.0';
export const BASE_COMMIT = '7af8f2d0ed9517d75ee311d40186145b43978c98';

export const AUDIT_FIELDS = [
  'ID_Ejecucion', 'ID_Evento', 'Fecha_Hora_ISO', 'ID_Caso',
  'Version_MVP', 'Commit_Base', 'Version_Dataset', 'Version_Pesos',
  'Clase_Observada', 'Peso_Asignado', 'Politica_Activa', 'Capacidad_Nominal',
  'Sesiones_Activas_Por_Agente', 'Clases_Activas_Por_Agente', 'Antiguedad_Ultima_Asignacion',
  'Carga_Actual_Fija_Por_Agente', 'Carga_Proyectada_Fija_Por_Agente',
  'Agentes_Elegibles_Fijo_5', 'Agente_Recomendado_Fijo_5', 'Caso_En_Cola_Fijo_5',
  'Carga_Actual_358_Por_Agente', 'Carga_Proyectada_358_Por_Agente',
  'Agentes_Elegibles_358', 'Agente_Recomendado_358', 'Caso_En_Cola_358',
  'Respuesta_Sugerida', 'Respuesta_Final_Interfaz', 'Decision_Humana',
  'Respuesta_Automatica_Bloqueada', 'Revision_Humana_Requerida',
  'Escalamiento_Requerido', 'Escalamiento_Realizado',
  'Latencia_Total_Milisegundos', 'Metodo_Latencia',
  'Estado_Ejecucion', 'Mensaje_Error', 'Evento', 'Resultado_Evento',
  'Revision_Caso', 'Actor', 'Motivo_Bloqueo'
];

const FORBIDDEN_FIELDS = [
  'expected_class', 'scenario_type', 'typology', 'risk_condition',
  'available_information', 'missing_information', 'expected_routing',
  'expected_response', 'escalation_expected', 'critical_error'
];
const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? performance.now() : Date.now();

export function createAuditRunId(prefix = 'PREV5') {
  const t = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const entropy = Math.random().toString(36).slice(2, 9).toUpperCase();
  return `${prefix}-${t}-${entropy}`;
}

export function validateV08Input(dataset) {
  if (!dataset || typeof dataset !== 'object' || !Array.isArray(dataset.cases)) {
    throw new Error('El JSON debe tener un arreglo cases.');
  }
  if (dataset.cases.length !== 30) throw new Error('Se requieren exactamente 30 casos para el lote controlado.');
  const ids = new Set();
  for (const c of dataset.cases) {
    if (!c || typeof c !== 'object' || !/^CASO-\d{3}$/.test(c.case_id || '')) {
      throw new Error('ID no válido: use CASO-001...CASO-030.');
    }
    if (ids.has(c.case_id)) throw new Error(`ID duplicado: ${c.case_id}`);
    ids.add(c.case_id);
    if (typeof c.query_text !== 'string' || !c.query_text.trim()) {
      throw new Error(`Consulta vacía: ${c.case_id}`);
    }
    for (const fld of FORBIDDEN_FIELDS) {
      if (Object.hasOwn(c, fld)) throw new Error(`Campo de referencia prohibido en entrada: ${fld} (${c.case_id})`);
    }
    const agents = c.agent_state, sessions = c.active_sessions_by_agent,
      classes = c.active_case_classes_by_agent, ages = c.last_assignment_age;
    if (![agents,sessions,classes,ages].every(x=>x && typeof x === 'object' && !Array.isArray(x))) {
      throw new Error(`Estado operativo incompleto: ${c.case_id}`);
    }
    for (const id of Object.keys(agents)) {
      if (!Number.isInteger(sessions[id]) || sessions[id] < 0 || !Array.isArray(classes[id]) ||
          classes[id].length !== sessions[id] ||
          !classes[id].every(cl => ['A','B','C'].includes(cl)) ||
          !Number.isFinite(ages[id])) {
        throw new Error(`Datos de sesiones/carga inconsistentes en ${c.case_id}/${id}`);
      }
    }
  }
  const sorted = [...ids].sort();
  for (let i=1;i<=30;i++) if (sorted[i-1] !== `CASO-${String(i).padStart(3,'0')}`) {
    throw new Error('Se requieren los identificadores CASO-001 a CASO-030 sin omisiones.');
  }
  const weights = dataset.capacity_policy?.experimental_weights;
  if (dataset.capacity_policy?.nominal_capacity_units !== CAPACITY ||
    dataset.capacity_policy?.current_policy_fixed_weight_units !== 5 ||
    !weights || weights.A !== 3 || weights.B !== 5 || weights.C !== 8) {
    throw new Error('Política no compatible: capacidad 10, fijo 5, experimental A3/B5/C8.');
  }
  return true;
}

function indexById(agents) { return Object.fromEntries(agents.map(a=>[a.id,a.load])); }
function projected(agents, w) { return Object.fromEntries(agents.map(a=>[a.id,a.load+w])); }
function eligible(agents, w) {
  return agents.filter(a=>a.status==='Disponible' && a.available!==false && a.connected!==false && a.load+w<=CAPACITY).map(a=>a.id).sort();
}
function sortedAgentKeys(a) { return Object.fromEntries(Object.entries(a || {}).sort(([x],[y])=>x.localeCompare(y))); }

export function buildAuditRecord({
  runId, eventId = '', recordedAt, testCase = null, output = null, activePolicy = 'experimental',
  decision = 'SIN_EJECUTAR', escalationPerformed = false, latencyMs = null,
  finalResponse = null, status = 'CALCULO_TECNICO_NO_V5',
  error = null, event = 'Cálculo técnico', eventResult = 'CALCULADO',
  actor = 'Motor determinista', blockReason = ''
} = {}) {
  const raw = testCase?.v08Raw || testCase;
  const hasOperational = Boolean(raw?.agent_state);
  const level = output?.classification?.level || null;
  const agentsFixed = hasOperational ? buildAgentsFromCaseState(raw,'actual') : [];
  const agentsExp = hasOperational ? buildAgentsFromCaseState(raw,'experimental') : [];
  const wFixed = level ? weightFor(level,'actual') : null;
  const wExp = level ? weightFor(level,'experimental') : null;
  const a = output?.policyComparison?.actual || null;
  const b = output?.policyComparison?.experimental || null;
  const escalated = level === 'C';
  const isEvent = status !== 'CALCULO_TECNICO_NO_V5';
  return {
    ID_Ejecucion: runId || null,
    ID_Evento: eventId || null,
    Fecha_Hora_ISO: recordedAt || new Date().toISOString(),
    ID_Caso: testCase?.case_id || testCase?.id || null,
    Version_MVP: VERSION,
    Commit_Base: BASE_COMMIT,
    Version_Dataset: hasOperational ? (testCase?.dataset_version || DATASET_VERSION) : null,
    Version_Pesos: WEIGHT_SCHEME_VERSION,
    Clase_Observada: level,
    Peso_Asignado: level ? weightFor(level,activePolicy) : null,
    Politica_Activa: activePolicy,
    Capacidad_Nominal: CAPACITY,
    Sesiones_Activas_Por_Agente: hasOperational ? sortedAgentKeys(raw.active_sessions_by_agent) : null,
    Clases_Activas_Por_Agente: hasOperational ? sortedAgentKeys(raw.active_case_classes_by_agent) : null,
    Antiguedad_Ultima_Asignacion: hasOperational ? sortedAgentKeys(raw.last_assignment_age) : null,
    Carga_Actual_Fija_Por_Agente: hasOperational ? indexById(agentsFixed) : null,
    Carga_Proyectada_Fija_Por_Agente: hasOperational && wFixed!==null ? projected(agentsFixed,wFixed) : null,
    Agentes_Elegibles_Fijo_5: hasOperational && wFixed!==null ? eligible(agentsFixed,wFixed) : null,
    Agente_Recomendado_Fijo_5: a ? (a.agent?.id || 'EN_COLA') : null,
    Caso_En_Cola_Fijo_5: a ? !Boolean(a.agent) : null,
    Carga_Actual_358_Por_Agente: hasOperational ? indexById(agentsExp) : null,
    Carga_Proyectada_358_Por_Agente: hasOperational && wExp!==null ? projected(agentsExp,wExp) : null,
    Agentes_Elegibles_358: hasOperational && wExp!==null ? eligible(agentsExp,wExp) : null,
    Agente_Recomendado_358: b ? (b.agent?.id || 'EN_COLA') : null,
    Caso_En_Cola_358: b ? !Boolean(b.agent) : null,
    Respuesta_Sugerida: output?.guidance?.text || null,
    Respuesta_Final_Interfaz: finalResponse || null,
    Decision_Humana: decision,
    Respuesta_Automatica_Bloqueada: true, // ningún caso habilita respuesta automática en R02
    Revision_Humana_Requerida: true,
    Escalamiento_Requerido: escalated,
    Escalamiento_Realizado: isEvent && escalationPerformed ? 'SIMULADO_EN_MVP' : 'NO_REGISTRADO',
    Latencia_Total_Milisegundos: Number.isFinite(latencyMs) ? Number(latencyMs.toFixed(3)) : null,
    Metodo_Latencia: Number.isFinite(latencyMs) ? 'Duración processCase() con performance.now(); NO es TMO' : 'NO_MEDIDO',
    Estado_Ejecucion: status,
    Mensaje_Error: error ? String(error) : null,
    Evento: event,
    Resultado_Evento: eventResult,
    Revision_Caso: output?.revision || null,
    Actor: actor,
    Motivo_Bloqueo: blockReason || null
  };
}

// En la exportación de lote no se fabrican aprobaciones ni escalamiento humano.
export function buildBatchEvidence(dataset, {runId = createAuditRunId('PREV5-LOTE'), activePolicy='experimental'} = {}) {
  validateV08Input(dataset);
  const calculated = evaluateDatasetV08(dataset); // referencia matemática determinista
  const records = dataset.cases.map((c,i) => {
    try {
      const cas = { ...c, id:c.case_id, text:c.query_text, branch:'Vehicular', validated:false };
      const t0 = nowMs();
      const out = processCase(cas, buildAgentsFromCaseState(c,activePolicy), activePolicy);
      const elapsed = nowMs() - t0;
      return buildAuditRecord({runId, eventId:`BATCH-${String(i+1).padStart(3,'0')}`,testCase:{...c,dataset_version:dataset.dataset_version},
        output:out,latencyMs:elapsed,activePolicy,event:'Predicción lote (sin decisión humana)'});
    } catch (err) {
      return buildAuditRecord({runId,eventId:`BATCH-${String(i+1).padStart(3,'0')}`,testCase:{...c,dataset_version:dataset.dataset_version},
        status:'ERROR_TECNICO_NO_V5',eventResult:'ERROR',error:String(err)});
    }
  });
  return {
    app:'SAI-GC', schema:AUDIT_SCHEMA, status:'PREVALIDACION_NO_V5',
    sourceCommit:BASE_COMMIT, generatedAt:new Date().toISOString(),
    methodology:'Cada caso es independiente. Latencia mide processCase() por caso, no atención humana ni TMO.',
    notice:'El Gold Standard no se carga al motor. Candidatos de routing NO son asignaciones humanas ejecutadas.',
    summary:calculated.summary, records
  };
}

function csvEscape(value) {
  let text = value === null || value === undefined ? '' :
    (typeof value === 'object' ? JSON.stringify(value) : String(value));
  // Prevención de fórmulas CSV al abrir el documento en Excel.
  if (/^[\t\r\n ]*[=+@]/.test(text)) text = `'${text}`;
  return '"' + text.replace(/"/g,'""') + '"';
}
export function exportAuditCSV(rows) {
  return '\uFEFF' + AUDIT_FIELDS.join(',') + '\r\n' + (rows||[])
    .map(r=>AUDIT_FIELDS.map(key=>csvEscape(r[key])).join(','))
    .join('\r\n');
}
export function exportAuditJSON(payload) {
  return JSON.stringify(payload,null,2);
}
export function buildEventEvidence(logs, runId) {
  return {
    app:'SAI-GC',schema:AUDIT_SCHEMA,status:'BITACORA_INTERACTIVA_PREV5_NO_V5',
    generatedAt:new Date().toISOString(),sourceCommit:BASE_COMMIT,
    runId, notice:'Acciones registradas en interfaz demostrativa, no ejecución en Salesforce.',
    records:(logs||[]).map((r,i)=>r.extendedPreV5 || {
      ...buildAuditRecord({runId,eventId:`EVT-${i+1}`,status:'EVENTO_LEGADO_SIN_CONTEXT0',event:r.event,
        eventResult:r.result,actor:r.actorRole,error:'Evento sin snapshot enriquecido'}), ID_Caso:r.case
    })
  };
}
