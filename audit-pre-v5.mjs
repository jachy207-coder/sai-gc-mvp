/**
 * SAI-GC R02 Validación v1.0 | Capa de auditoría ampliada y control de lotes
 * Esta capa NO utiliza el Gold Standard ni modifica las reglas, pesos ni algoritmo de routing de logic.mjs.
 * Preparación técnica para ejecución de validación V5 (no declara concluida la validación formal V5).
 */
import {
  CAPACITY, VERSION, DATASET_VERSION, WEIGHT_SCHEME_VERSION,
  weightFor, processCase, buildAgentsFromCaseState,
  evaluateDatasetV08
} from './logic.mjs';

export const VALIDATION_VERSION = 'SAI-GC R02 Validación v1.0';
export const AUDIT_SCHEMA = 'SAIGC-R02-VAL-1.0';
export const BASE_COMMIT = 'fcde8d1acefdf6b61ea9111936b3766dae03e3ed';

export const VERSION_HISTORY = [
  {
    version: 'R01',
    label: 'MVP R01 Base Demostrativo',
    commit: '4b91493',
    status: 'HISTORICA',
    notes: 'Triaje A/B/C inicial, asistencia KB, routing por capacidad y pruebas unitarias base.'
  },
  {
    version: 'v0.5-r02-verificable',
    label: 'SAI-GC R02 Controles Humanos',
    commit: '63f2df1',
    status: 'HISTORICA',
    notes: 'Controles HITL, bloqueo de envío automático en Clase C, verificación IVR manual y 31 pruebas.'
  },
  {
    version: 'v0.8-r02-operacion-aprobada',
    label: 'SAI-GC R02 Lote v0.8 (A3_B5_C8_v1)',
    commit: '7af8f2d',
    status: 'HISTORICA',
    notes: 'Dataset controlado de 30 casos sin data leakage, política experimental A=3/B=5/C=8 y 35 pruebas.'
  },
  {
    version: 'R02 - PRE-V5',
    label: 'Prevalidación Técnica PRE-V5',
    commit: 'fcde8d1',
    status: 'HISTORICA',
    notes: 'Selector sin clasificación anticipada, bitácora ampliada, medición de latencia y 46 pruebas.'
  },
  {
    version: VALIDATION_VERSION,
    label: 'Preparación Ejecución Validación V5',
    commit: 'actual',
    status: 'PREPARACION_V5_NO_CONCLUIDA',
    notes: 'Trazabilidad jerárquica ID_Lote/ID_Ejecucion/ID_Evento, estados estrictos de Escalamiento_Realizado, historial de versiones y lotes independientes.'
  }
];

export const ESCALATION_STATES = Object.freeze({
  NO_APLICA: 'NO_APLICA',
  PENDIENTE: 'PENDIENTE',
  REALIZADO: 'REALIZADO',
  NO_EVALUADO: 'NO_EVALUADO',
  INCIDENCIA_ESCALAMIENTO_INESPERADO: 'INCIDENCIA_ESCALAMIENTO_INESPERADO'
});

export const AUDIT_FIELDS = [
  'ID_Lote', 'ID_Ejecucion', 'ID_Evento', 'Fecha_Hora_ISO', 'ID_Caso',
  'Version_MVP', 'Version_Motor', 'Commit_Base', 'Version_Dataset', 'Version_Pesos',
  'Clase_Observada', 'Peso_Asignado', 'Politica_Activa', 'Capacidad_Nominal',
  'Sesiones_Activas_Por_Agente', 'Clases_Activas_Por_Agente', 'Antiguedad_Ultima_Asignacion',
  'Carga_Actual_Fija_Por_Agente', 'Carga_Proyectada_Fija_Por_Agente',
  'Agentes_Elegibles_Fijo_5', 'Agente_Recomendado_Fijo_5', 'Caso_En_Cola_Fijo_5',
  'Carga_Actual_358_Por_Agente', 'Carga_Proyectada_358_Por_Agente',
  'Agentes_Elegibles_358', 'Agente_Recomendado_358', 'Caso_En_Cola_358',
  'Respuesta_Sugerida', 'Respuesta_Final_Interfaz', 'Decision_Humana',
  'Respuesta_Automatica_Bloqueada', 'Revision_Humana_Requerida',
  'Escalamiento_Requerido', 'Escalamiento_Realizado', 'Incidencia_Escalamiento',
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

let idSequence = 0;
function nextUniqueToken(prefix) {
  idSequence += 1;
  const t = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const seq = String(idSequence).padStart(4, '0');
  const entropy = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${t}-${seq}-${entropy}`;
}

export function createBatchId(prefix = 'LOTE') {
  return nextUniqueToken(prefix);
}

export function createAuditRunId(prefix = 'EJEC') {
  return nextUniqueToken(prefix);
}

export function createEventId(sequenceNumber, prefix = 'EVT') {
  return `${prefix}-${String(sequenceNumber).padStart(3, '0')}`;
}

export function resolveEscalationState({ level = null, escalationRequired = null, escalationPerformed = false } = {}) {
  const performed = Boolean(escalationPerformed);
  const hasEvaluation = level === 'A' || level === 'B' || level === 'C';

  if (!hasEvaluation && typeof escalationRequired !== 'boolean') {
    if (performed) {
      return {
        required: 'NO_EVALUADO',
        status: ESCALATION_STATES.INCIDENCIA_ESCALAMIENTO_INESPERADO,
        incidence: 'Escalamiento inesperado registrado sin clasificación previa del caso.'
      };
    }
    return {
      required: 'NO_EVALUADO',
      status: ESCALATION_STATES.NO_EVALUADO,
      incidence: null
    };
  }

  const required = typeof escalationRequired === 'boolean' ? escalationRequired : level === 'C';

  if (!required && !performed) {
    return { required: false, status: ESCALATION_STATES.NO_APLICA, incidence: null };
  }
  if (required && !performed) {
    return { required: true, status: ESCALATION_STATES.PENDIENTE, incidence: null };
  }
  if (required && performed) {
    return { required: true, status: ESCALATION_STATES.REALIZADO, incidence: null };
  }
  return {
    required: false,
    status: ESCALATION_STATES.INCIDENCIA_ESCALAMIENTO_INESPERADO,
    incidence: `Escalamiento inesperado registrado en caso Clase ${level || 'DESCONOCIDA'} donde el escalamiento no era requerido.`
  };
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
    if (![agents, sessions, classes, ages].every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      throw new Error(`Estado operativo incompleto: ${c.case_id}`);
    }
    for (const id of Object.keys(agents)) {
      if (!Number.isInteger(sessions[id]) || sessions[id] < 0 || !Array.isArray(classes[id]) ||
          classes[id].length !== sessions[id] ||
          !classes[id].every(cl => ['A', 'B', 'C'].includes(cl)) ||
          !Number.isFinite(ages[id])) {
        throw new Error(`Datos de sesiones/carga inconsistentes en ${c.case_id}/${id}`);
      }
    }
  }
  const sorted = [...ids].sort();
  for (let i = 1; i <= 30; i++) if (sorted[i - 1] !== `CASO-${String(i).padStart(3, '0')}`) {
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

function indexById(agents) { return Object.fromEntries(agents.map(a => [a.id, a.load])); }
function projected(agents, w) { return Object.fromEntries(agents.map(a => [a.id, a.load + w])); }
function eligible(agents, w) {
  return agents.filter(a => a.status === 'Disponible' && a.available !== false && a.connected !== false && a.load + w <= CAPACITY).map(a => a.id).sort();
}
function sortedAgentKeys(a) { return Object.fromEntries(Object.entries(a || {}).sort(([x], [y]) => x.localeCompare(y))); }

export function buildAuditRecord({
  batchId = null, runId = null, eventId = '', recordedAt, testCase = null, output = null, activePolicy = 'experimental',
  decision = 'SIN_EJECUTAR', escalationPerformed = false, latencyMs = null,
  finalResponse = null, status = 'CALCULO_TECNICO_NO_V5',
  error = null, event = 'Cálculo técnico', eventResult = 'CALCULADO',
  actor = 'Motor determinista', blockReason = ''
} = {}) {
  const raw = testCase?.v08Raw || testCase;
  const hasOperational = Boolean(raw?.agent_state);
  const level = output?.classification?.level || null;
  const agentsFixed = hasOperational ? buildAgentsFromCaseState(raw, 'actual') : [];
  const agentsExp = hasOperational ? buildAgentsFromCaseState(raw, 'experimental') : [];
  const wFixed = level ? weightFor(level, 'actual') : null;
  const wExp = level ? weightFor(level, 'experimental') : null;
  const a = output?.policyComparison?.actual || null;
  const b = output?.policyComparison?.experimental || null;

  const escState = resolveEscalationState({
    level,
    escalationRequired: level ? level === 'C' : null,
    escalationPerformed
  });

  const combinedError = [error ? String(error) : null, escState.incidence].filter(Boolean).join(' | ') || null;

  return {
    ID_Lote: batchId || null,
    ID_Ejecucion: runId || null,
    ID_Evento: eventId || null,
    Fecha_Hora_ISO: recordedAt || new Date().toISOString(),
    ID_Caso: testCase?.case_id || testCase?.id || null,
    Version_MVP: VALIDATION_VERSION,
    Version_Motor: VERSION,
    Commit_Base: BASE_COMMIT,
    Version_Dataset: hasOperational ? (testCase?.dataset_version || DATASET_VERSION) : null,
    Version_Pesos: WEIGHT_SCHEME_VERSION,
    Clase_Observada: level,
    Peso_Asignado: level ? weightFor(level, activePolicy) : null,
    Politica_Activa: activePolicy,
    Capacidad_Nominal: CAPACITY,
    Sesiones_Activas_Por_Agente: hasOperational ? sortedAgentKeys(raw.active_sessions_by_agent) : null,
    Clases_Activas_Por_Agente: hasOperational ? sortedAgentKeys(raw.active_case_classes_by_agent) : null,
    Antiguedad_Ultima_Asignacion: hasOperational ? sortedAgentKeys(raw.last_assignment_age) : null,
    Carga_Actual_Fija_Por_Agente: hasOperational ? indexById(agentsFixed) : null,
    Carga_Proyectada_Fija_Por_Agente: hasOperational && wFixed !== null ? projected(agentsFixed, wFixed) : null,
    Agentes_Elegibles_Fijo_5: hasOperational && wFixed !== null ? eligible(agentsFixed, wFixed) : null,
    Agente_Recomendado_Fijo_5: a ? (a.agent?.id || 'EN_COLA') : null,
    Caso_En_Cola_Fijo_5: a ? !Boolean(a.agent) : null,
    Carga_Actual_358_Por_Agente: hasOperational ? indexById(agentsExp) : null,
    Carga_Proyectada_358_Por_Agente: hasOperational && wExp !== null ? projected(agentsExp, wExp) : null,
    Agentes_Elegibles_358: hasOperational && wExp !== null ? eligible(agentsExp, wExp) : null,
    Agente_Recomendado_358: b ? (b.agent?.id || 'EN_COLA') : null,
    Caso_En_Cola_358: b ? !Boolean(b.agent) : null,
    Respuesta_Sugerida: output?.guidance?.text || null,
    Respuesta_Final_Interfaz: finalResponse || null,
    Decision_Humana: decision,
    Respuesta_Automatica_Bloqueada: true, // ningún caso habilita respuesta automática en R02
    Revision_Humana_Requerida: true,
    Escalamiento_Requerido: escState.required,
    Escalamiento_Realizado: escState.status,
    Incidencia_Escalamiento: escState.incidence,
    Latencia_Total_Milisegundos: Number.isFinite(latencyMs) ? Number(latencyMs.toFixed(3)) : null,
    Metodo_Latencia: Number.isFinite(latencyMs) ? 'Duración processCase() con performance.now(); NO es TMO' : 'NO_MEDIDO',
    Estado_Ejecucion: escState.incidence ? 'INCIDENCIA_ESCALAMIENTO' : status,
    Mensaje_Error: combinedError,
    Evento: event,
    Resultado_Evento: escState.incidence ? 'INCIDENCIA' : eventResult,
    Revision_Caso: output?.revision || null,
    Actor: actor,
    Motivo_Bloqueo: blockReason || null
  };
}

// En la exportación de lote no se fabrican aprobaciones ni escalamiento humano.
// Cada caso del lote recibe un ID_Ejecucion único y un ID_Evento individual, vinculados al mismo ID_Lote.
export function buildBatchEvidence(dataset, { batchId = null, runId = null, activePolicy = 'experimental' } = {}) {
  validateV08Input(dataset);
  const resolvedBatchId = batchId || runId || createBatchId('LOTE-V08');
  const calculated = evaluateDatasetV08(dataset); // referencia matemática determinista
  const records = dataset.cases.map((c, i) => {
    const caseRunId = createAuditRunId('EJEC');
    const eventId = createEventId(i + 1, 'BATCH');
    try {
      const cas = { ...c, id: c.case_id, text: c.query_text, branch: 'Vehicular', validated: false };
      const t0 = nowMs();
      const out = processCase(cas, buildAgentsFromCaseState(c, activePolicy), activePolicy);
      const elapsed = nowMs() - t0;
      return buildAuditRecord({
        batchId: resolvedBatchId,
        runId: caseRunId,
        eventId,
        testCase: { ...c, dataset_version: dataset.dataset_version },
        output: out,
        latencyMs: elapsed,
        activePolicy,
        event: 'Predicción lote (sin decisión humana)'
      });
    } catch (err) {
      return buildAuditRecord({
        batchId: resolvedBatchId,
        runId: caseRunId,
        eventId,
        testCase: { ...c, dataset_version: dataset.dataset_version },
        status: 'ERROR_TECNICO_NO_V5',
        eventResult: 'ERROR',
        error: String(err)
      });
    }
  });
  return {
    app: 'SAI-GC',
    version: VALIDATION_VERSION,
    engineVersion: VERSION,
    schema: AUDIT_SCHEMA,
    status: 'PREPARACION_V5_NO_CONCLUIDA',
    batchId: resolvedBatchId,
    ID_Lote: resolvedBatchId,
    sourceCommit: BASE_COMMIT,
    versionHistory: VERSION_HISTORY,
    generatedAt: new Date().toISOString(),
    methodology: 'Cada caso es independiente y posee un ID_Ejecucion único dentro del ID_Lote. Latencia mide processCase() por caso, no atención humana ni TMO.',
    notice: 'El Gold Standard no se carga al motor. Candidatos de routing NO son asignaciones humanas ejecutadas. Validación formal V5 no concluida.',
    summary: calculated.summary,
    records
  };
}

function csvEscape(value) {
  let text = value === null || value === undefined ? '' :
    (typeof value === 'object' ? JSON.stringify(value) : String(value));
  // Prevención de fórmulas CSV al abrir el documento en Excel.
  if (/^[\t\r\n ]*[=+@]/.test(text)) text = `'${text}`;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function exportAuditCSV(rows) {
  return '\uFEFF' + AUDIT_FIELDS.join(',') + '\r\n' + (rows || [])
    .map(r => AUDIT_FIELDS.map(key => csvEscape(r[key])).join(','))
    .join('\r\n');
}

export function exportAuditJSON(payload) {
  return JSON.stringify(payload, null, 2);
}

export function buildEventEvidence(logs, batchOrMeta) {
  const batchId = typeof batchOrMeta === 'string'
    ? batchOrMeta
    : (batchOrMeta?.batchId || batchOrMeta?.runId || null);

  return {
    app: 'SAI-GC',
    version: VALIDATION_VERSION,
    engineVersion: VERSION,
    schema: AUDIT_SCHEMA,
    status: 'BITACORA_INTERACTIVA_VALIDACION_NO_V5',
    batchId,
    ID_Lote: batchId,
    generatedAt: new Date().toISOString(),
    sourceCommit: BASE_COMMIT,
    versionHistory: VERSION_HISTORY,
    notice: 'Acciones registradas en interfaz de preparación V5, no ejecución en Salesforce ni validación formal V5 concluida.',
    records: (logs || []).map((r, i) => {
      if (r.extendedPreV5) {
        return {
          ...r.extendedPreV5,
          ID_Lote: r.extendedPreV5.ID_Lote || batchId
        };
      }
      return {
        ...buildAuditRecord({
          batchId,
          runId: r.runId || null,
          eventId: createEventId(i + 1, 'EVT'),
          status: 'EVENTO_LEGADO_SIN_CONTEXTO',
          event: r.event,
          eventResult: r.result,
          actor: r.actorRole,
          error: 'Evento sin snapshot enriquecido'
        }),
        ID_Caso: r.case
      };
    })
  };
}

export function createValidationSession(prefix = 'LOTE') {
  return {
    batchId: createBatchId(prefix),
    startedAt: new Date().toISOString(),
    eventSeq: 0,
    logs: [],
    archivedBatches: []
  };
}

export function startNewValidationBatch(session, { prefix = 'LOTE', preserveArchive = true } = {}) {
  const archived = Array.isArray(session?.archivedBatches) ? [...session.archivedBatches] : [];
  let archivedSnapshot = null;

  if (preserveArchive && session?.batchId) {
    const evidence = buildEventEvidence(session.logs || [], session.batchId);
    archivedSnapshot = {
      batchId: session.batchId,
      startedAt: session.startedAt || null,
      closedAt: new Date().toISOString(),
      eventCount: (session.logs || []).length,
      evidence,
      csv: exportAuditCSV(evidence.records),
      json: exportAuditJSON(evidence)
    };
    archived.unshift(archivedSnapshot);
  }

  return {
    batchId: createBatchId(prefix),
    startedAt: new Date().toISOString(),
    eventSeq: 0,
    logs: [],
    archivedBatches: archived,
    previousBatch: archivedSnapshot
  };
}
