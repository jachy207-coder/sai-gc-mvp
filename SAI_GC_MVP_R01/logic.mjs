/** 
 * SAI-GC R02 — Módulo de Lógica Pura
 * Sistema de Asistencia Inteligente y Gestión de Capacidad
 * MVP Académico Demostrativo · Datos Sintéticos
 * Versión R02 Verificable
 */

export const VERSION = '0.5-r02-verificable';
export const CAPACITY = 10;

export const KNOWLEDGE = {
  A: {
    id: 'KB-DEMO-001',
    title: 'Envío de constancia · plantilla demostrativa',
    body: 'Para solicitar una constancia, verificar identidad y cobertura con el procedimiento corporativo vigente. No afirmar el envío ni la vigencia sin comprobación.',
    checklist: [
      'Confirmar validación previa en IVR o verificar DNI/placa del titular.',
      'Consultar estado de vigencia en el sistema core antes de emitir constancia.',
      'Adjuntar PDF oficial sin prometer coberturas adicionales.'
    ],
    reply: 'Con gusto le ayudo con su constancia. Antes de continuar, revisaré la validación y la información disponible en el procedimiento autorizado. Le confirmaré los siguientes pasos.'
  },
  B: {
    id: 'KB-DEMO-002',
    title: 'Estado de cuenta y deuda · plantilla demostrativa',
    body: 'La información de deuda y cuotas requiere consulta a fuentes corporativas. La plantilla no contiene saldos ni datos personales.',
    checklist: [
      'Validar identidad del asegurado (obligatorio si el IVR no completó autenticación).',
      'Consultar cronograma de pagos y estado de cuotas en módulo de cobranzas.',
      'Informar canales oficiales de pago sin digitar importes no verificados.'
    ],
    reply: 'Con gusto reviso su consulta sobre el estado de cuenta. Necesito validar los datos correspondientes y consultar el sistema autorizado antes de confirmarle importes o fechas.'
  },
  C: {
    id: 'KB-DEMO-003',
    title: 'Siniestros y excepciones · control reforzado',
    body: 'Los siniestros, indemnizaciones, anulaciones contractuales y casos sensibles requieren revisión o escalamiento. No prometer cobertura, pagos ni plazos.',
    checklist: [
      'Contención empática inicial; prohibido confirmar cobertura o indemnización.',
      'Recopilar número de póliza, fecha del evento y documentación de sustento.',
      'Escalar a célula especializada o supervisor según matriz de riesgo.'
    ],
    reply: 'Comprendo su solicitud. Por tratarse de una gestión que requiere una revisión especializada, verificaré la documentación y la ruta de atención correspondiente antes de brindarle una respuesta definitiva.'
  }
};

export const CASES = [
  {
    id: 'DEMO-001',
    name: 'Constancia (Clase A)',
    text: 'Necesito el reenvío de mi constancia de seguro vehicular.',
    topic: 'Envío de constancia',
    branch: 'Vehicular',
    validated: true,
    scenario: 'standard'
  },
  {
    id: 'DEMO-002',
    name: 'Estado de cuenta (Clase B)',
    text: 'Quiero consultar una deuda y el estado de cuenta de mi póliza de vida.',
    topic: 'Estado de cuenta y deuda',
    branch: 'Vida',
    validated: false,
    scenario: 'standard'
  },
  {
    id: 'DEMO-003',
    name: 'Siniestro (Clase C)',
    text: 'Tuve un siniestro vehicular y necesito orientación sobre la indemnización.',
    topic: 'Siniestros e indemnización',
    branch: 'Vehicular',
    validated: true,
    scenario: 'standard'
  },
  {
    id: 'DEMO-004',
    name: 'Anulación por excepción (Clase C)',
    text: 'Deseo anular mi póliza de seguro de salud por un caso excepcional.',
    topic: 'Anulación de póliza',
    branch: 'Salud',
    validated: false,
    scenario: 'standard'
  },
  {
    id: 'DEMO-005',
    name: 'Texto no reconocido (C precautoria)',
    text: 'Tengo una inquietud especial con un código de promoción o sorteo no registrado en el sistema.',
    topic: 'Consulta fuera de catálogo',
    branch: 'Vida',
    validated: false,
    scenario: 'standard'
  },
  {
    id: 'DEMO-006',
    name: 'Saturación en cola (Sin capacidad)',
    text: 'Consulta vehicular prioritaria ingresando en momento de saturación de asesores.',
    topic: 'Capacidad agotada en cola',
    branch: 'Vehicular',
    validated: true,
    scenario: 'all_busy'
  },
  {
    id: 'DEMO-007',
    name: 'Especialista en pausa/refrigerio',
    text: 'Consulta del ramo Salud donde el asesor de turno se encuentra en refrigerio.',
    topic: 'Exclusión por estado no disponible',
    branch: 'Salud',
    validated: true,
    scenario: 'agent_paused'
  },
  {
    id: 'DEMO-008',
    name: 'Comparativa Actual vs Experimental',
    text: 'Solicitud con complejidad clase C para contrastar peso 5 (actual) vs 7 (experimental).',
    topic: 'Contraste metodológico',
    branch: 'Vehicular',
    validated: true,
    scenario: 'policy_compare'
  }
];

export const AGENTS = [
  { id: 'AG-01', display: 'Asesor Demo 01', status: 'Disponible', load: 0, skills: ['Vida', 'Salud', 'Vehicular'] },
  { id: 'AG-02', display: 'Asesor Demo 02', status: 'Disponible', load: 5, skills: ['Vida', 'Vehicular'] },
  { id: 'AG-03', display: 'Asesor Demo 03', status: 'Ocupado', load: 10, skills: ['Vida', 'Salud', 'Vehicular'] },
  { id: 'AG-04', display: 'Asesor Demo 04', status: 'Refrigerio', load: 0, skills: ['Vida', 'Salud'] }
];

const CLASS_RULES = [
  {
    id: 'RULE-C-CRIT',
    value: 'C',
    rx: /siniestro|indemniza\w*|anulaci[oó]n|anular|rescate|carta de garant[ií]a|fraude|queja grave|reclamo sensible|excepci[oó]n|excepcional|modificaci[oó]n de p[oó]liza|complejidad clase c/gi,
    why: 'Regla de seguridad demostrativa: consulta sensible / contractual / excepción'
  },
  {
    id: 'RULE-B-PROC',
    value: 'B',
    rx: /deuda|estado de cuenta|cuota|cobranza|renovaci[oó]n|deducible|beneficio|proveedor|factura|boleta/gi,
    why: 'Procedimiento con verificaciones o consultas a sistemas internos'
  },
  {
    id: 'RULE-A-INFO',
    value: 'A',
    rx: /constancia|copia|duplicado|p[oó]liza digital|vigencia informativa|horario/gi,
    why: 'Consulta de orientación preliminar de baja complejidad'
  }
];

export function classify(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return {
      level: 'C',
      risk: 'Alto',
      ruleId: 'RULE-C-EMPTY',
      matchedKeywords: [],
      reason: 'Entrada vacía o inválida: escalamiento precautorio',
      confidence: 'No estimada (reglas demostrativas)'
    };
  }
  for (const rule of CLASS_RULES) {
    const matches = text.match(rule.rx);
    if (matches && matches.length > 0) {
      const uniqueMatches = [...new Set(matches.map(m => m.toLowerCase()))];
      return {
        level: rule.value,
        risk: rule.value === 'C' ? 'Alto' : rule.value === 'B' ? 'Medio' : 'Bajo',
        ruleId: rule.id,
        matchedKeywords: uniqueMatches,
        reason: rule.why,
        confidence: 'No estimada (reglas demostrativas)'
      };
    }
  }
  return {
    level: 'C',
    risk: 'Alto',
    ruleId: 'RULE-C-FALLBACK',
    matchedKeywords: [],
    reason: 'Baja cobertura del conocimiento: escalamiento precautorio a humano',
    confidence: 'No estimada (reglas demostrativas)'
  };
}

export function weightFor(level, policy = 'actual') {
  if (policy === 'experimental') {
    return ({ A: 4, B: 5, C: 7 })[level] ?? 7;
  }
  return 5; // Regla actual confirmada: WhatsApp consume 5 unidades
}

export function route(agents, level, branch, policy = 'actual') {
  const weight = weightFor(level, policy);
  const valid = (agents || []).filter(a =>
    a.status === 'Disponible' &&
    Array.isArray(a.skills) &&
    a.skills.includes(branch) &&
    (a.load + weight) <= CAPACITY
  );
  // Ordenar por menor carga actual; desempate por identificador
  valid.sort((a, b) => (a.load - b.load) || a.id.localeCompare(b.id));
  const choice = valid[0];
  return {
    weight,
    agent: choice || null,
    projected: choice ? choice.load + weight : null,
    reason: choice
      ? 'Menor carga ponderada y skill compatible'
      : 'Sin capacidad o skill disponible; mantener en cola'
  };
}

export function comparePolicies(agents, level, branch) {
  const actual = route(agents, level, branch, 'actual');
  const experimental = route(agents, level, branch, 'experimental');
  return {
    actual,
    experimental,
    weightDelta: experimental.weight - actual.weight,
    maxConcurrencyActual: Math.floor(CAPACITY / actual.weight),
    maxConcurrencyExperimental: Math.floor(CAPACITY / experimental.weight)
  };
}

export function respond(level, validated) {
  const source = KNOWLEDGE[level] || KNOWLEDGE.C;
  const validation = validated
    ? 'El bot realizó validación previa; no repetir automáticamente el requerimiento.'
    : 'Validación pendiente; el asesor debe ejecutar verificación conforme al procedimiento autorizado.';
  return {
    ...source,
    text: source.reply + ' ' + validation
  };
}

/**
 * Genera una huella digital determinista única para una versión de caso.
 * Cualquier cambio en texto, ramo, IVR, política o nivel invalida la revisión.
 */
export function computeCaseRevision(caseData, policy = 'actual', classification = null) {
  const id = caseData?.id || 'NO-ID';
  const text = (caseData?.text || '').trim();
  const branch = caseData?.branch || 'Vehicular';
  const validated = Boolean(caseData?.validated);
  const level = classification?.level || classify(text).level;
  const pol = policy || 'actual';
  
  const raw = `${id}|${branch}|ivr:${validated}|pol:${pol}|lvl:${level}|len:${text.length}|txt:${text}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hashHex = h.toString(16).padStart(8, '0');
  return `rev-${hashHex}`;
}

export function processCase(testCase, agents, policy = 'actual') {
  const classification = classify(testCase.text);
  const hasCoverage = !classification.reason.startsWith('Baja cobertura') &&
                      !classification.reason.startsWith('Entrada vacía');
  const guidance = hasCoverage
    ? respond(classification.level, !!testCase.validated)
    : {
        id: 'KB-NO-COBERTURA',
        title: 'Sin fuente aplicable: escalamiento obligatorio',
        body: 'La base demo no cubre este caso sintético.',
        checklist: [
          'Caso fuera de dominio del repositorio demostrativo.',
          'No emitir respuesta informativa al cliente sin validación.',
          'Derivar inmediatamente a supervisor o nivel 2.'
        ],
        text: 'No se dispone de información suficiente en el repositorio de prueba. El asesor debe revisar y escalar; no generar una respuesta de contenido.'
      };
  const branch = testCase.branch || 'Vehicular';
  const recommendation = route(agents, classification.level, branch, policy);
  const policyComparison = comparePolicies(agents, classification.level, branch);
  const revision = computeCaseRevision(testCase, policy, classification);
  
  const initialCaseStatus = classification.level === 'C' 
    ? 'ESCALAMIENTO_REQUERIDO' 
    : 'PENDIENTE_REVISION';

  return {
    classification,
    guidance,
    recommendation,
    policyComparison,
    revision,
    caseStatus: initialCaseStatus,
    caseId: testCase.id,
    policy,
    version: VERSION
  };
}

/**
 * Función central de autorización y control de seguridad R02 (canConfirmAssignment).
 * Valida de forma pura las 9 barreras de negocio exigidas antes de autorizar cualquier asignación.
 */
export function canConfirmAssignment({
  caseData,
  output,
  decision,
  approvedRevision,
  isEditing = false,
  editApproved = false,
  agents = [],
  policy = 'actual',
  activeAssignments = []
}) {
  if (!caseData || !output || !output.classification) {
    return {
      allowed: false,
      code: 'ERR_NO_OUTPUT',
      reason: 'El caso no ha sido procesado aún por el motor de triaje.'
    };
  }

  const level = output.classification.level;
  const branch = caseData.branch || 'Vehicular';
  const currentRevision = output.revision || computeCaseRevision(caseData, policy, output.classification);

  // Barrera 1: Clase C o Sin Cobertura exige escalamiento obligatorio (T06, T07)
  if (level === 'C' || output.guidance?.id === 'KB-NO-COBERTURA') {
    return {
      allowed: false,
      code: 'ERR_CLASS_C_ESCALATION',
      reason: 'Clase C o consulta sensible/desconocida exige escalamiento obligatorio a supervisor. Asignación ordinaria bloqueada por seguridad operacional.'
    };
  }

  // Barrera 2: Modo edición activo sin aprobación de texto final (T04)
  if (isEditing && !editApproved) {
    return {
      allowed: false,
      code: 'ERR_EDIT_NOT_APPROVED',
      reason: 'El borrador se encuentra en modo edición. Debe guardar y aprobar el texto final antes de confirmar la asignación.'
    };
  }

  // Barrera 3: Rechazo explícito (T05)
  if (decision === 'Rechazar') {
    return {
      allowed: false,
      code: 'ERR_REJECTED',
      reason: 'La recomendación fue rechazada por el asesor. Asignación ordinaria bloqueada hasta nueva revisión.'
    };
  }

  // Barrera 4: Escalamiento explícito
  if (decision === 'Escalar') {
    return {
      allowed: false,
      code: 'ERR_ESCALATED',
      reason: 'El caso fue marcado para escalamiento. Asignación ordinaria bloqueada.'
    };
  }

  // Barrera 5: Aprobación humana explícita (T01, T02)
  const hasValidApproval = (decision === 'Aceptar') || (decision === 'Editar' && editApproved);
  if (!hasValidApproval) {
    return {
      allowed: false,
      code: 'ERR_NO_APPROVAL',
      reason: 'Se requiere aprobación humana explícita (Aceptar o Guardar y aprobar edición) antes de confirmar la asignación.'
    };
  }

  // Barrera 6: Coincidencia estricta de la revisión aprobada (T08, T09)
  if (!approvedRevision || approvedRevision !== currentRevision) {
    return {
      allowed: false,
      code: 'ERR_STALE_REVISION',
      reason: 'La aprobación registrada es obsoleta o no coincide con los parámetros/contenido actuales del caso.'
    };
  }

  // Barrera 7: Validación de identidad IVR (R02-06)
  if (!caseData.validated && !caseData.ivrManualVerified) {
    return {
      allowed: false,
      code: 'ERR_IVR_UNVERIFIED',
      reason: 'Validación IVR pendiente: el asesor debe confirmar la verificación manual de identidad del titular antes de la asignación.'
    };
  }

  // Barrera 8: Idempotencia / duplicados (T13)
  const isDuplicate = (activeAssignments || []).some(
    item => item.id === caseData.id && (item.status === 'En curso' || item.status === 'Asignado')
  );
  if (isDuplicate) {
    return {
      allowed: false,
      code: 'ERR_DUPLICATE_ASSIGNMENT',
      reason: `El caso ${caseData.id} ya cuenta con una asignación activa en trabajo en curso.`
    };
  }

  // Barrera 9: Revalidación en tiempo real de capacidad, estado y skill del asesor (T10, T11, T12)
  const weight = weightFor(level, policy);
  const validAgents = (agents || []).filter(a =>
    a.status === 'Disponible' &&
    Array.isArray(a.skills) &&
    a.skills.includes(branch) &&
    (a.load + weight) <= CAPACITY
  );
  validAgents.sort((a, b) => (a.load - b.load) || a.id.localeCompare(b.id));
  const choice = validAgents[0] || null;

  if (!choice) {
    return {
      allowed: false,
      code: 'ERR_NO_CAPACITY_OR_SKILL',
      reason: 'No hay capacidad disponible o no existe asesor disponible con skill compatible en este momento; mantener en cola.',
      weight
    };
  }

  return {
    allowed: true,
    code: 'OK_APPROVED',
    reason: 'Aprobación humana vigente y capacidad verificada en tiempo real.',
    targetAgent: choice,
    weight,
    projected: choice.load + weight
  };
}

/**
 * Registra y estructura un escalamiento operacional formal.
 */
export function registerEscalation({ caseData, output, reason, actorRole = 'Asesor WhatsApp' }) {
  const caseId = caseData?.id || 'DEMO-???';
  const level = output?.classification?.level || 'C';
  const targetQueue = level === 'C' ? 'Cola de Supervisión / Siniestros y Excepciones' : 'Cola de Nivel 2';
  return {
    caseId,
    level,
    targetQueue,
    reason: reason || output?.classification?.reason || 'Escalamiento mandatorio de seguridad operacional',
    actorRole,
    timestampIso: new Date().toISOString(),
    status: 'DERIVADO_SUPERVISOR'
  };
}

export function calculateCapacityRecovery(monthlyVolume = 8000, deltaTmoMinutes = 2.0) {
  const vol = Math.max(0, Number(monthlyVolume) || 0);
  const delta = Math.max(0, Number(deltaTmoMinutes) || 0);
  const hoursRecovered = Number(((vol * delta) / 60).toFixed(1));
  return {
    monthlyVolume: vol,
    deltaTmoMinutes: delta,
    hoursRecovered,
    equivalentShifts8h: Number((hoursRecovered / 8).toFixed(1)),
    disclaimer: 'Cálculo hipotético de sensibilidad (Cap. V). No equivale a reducción automática de FTE.'
  };
}

export function log_event(logs, entry) {
  const timestampIso = entry.timestampIso || new Date().toISOString();
  const time = entry.time || new Date().toLocaleString('es-PE');
  const record = {
    timestampIso,
    time,
    case: entry.caseId || entry.case || '—',
    revision: entry.revision || '—',
    caseStatus: entry.caseStatus || '—',
    event: entry.event || 'Evento',
    level: entry.level || '—',
    source: entry.source || '—',
    action: entry.action || '—',
    result: entry.result || 'PERMITIDO', // 'PERMITIDO' | 'BLOQUEADO' | 'ESCALADO' | 'INVALIDADO'
    blockReason: entry.blockReason || '—',
    actorRole: entry.actorRole || 'Asesor WhatsApp',
    agent: entry.agent || '—',
    policy: entry.policy || 'actual',
    version: entry.version || VERSION
  };
  return [record, ...(logs || [])];
}

export function export_evidence(logs, format = 'json') {
  const records = logs || [];
  if (format === 'csv') {
    const headers = [
      'Timestamp_ISO',
      'Fecha_Hora',
      'Caso',
      'Revision',
      'Estado_Caso',
      'Evento',
      'Clase',
      'Fuente',
      'Decision_Humana',
      'Resultado',
      'Motivo_Bloqueo',
      'Rol_Actor',
      'Asesor_Routing',
      'Politica',
      'Version'
    ];
    const rows = records.map(r => [
      r.timestampIso || '',
      r.time,
      r.case,
      r.revision || '—',
      r.caseStatus || '—',
      r.event,
      r.level,
      r.source,
      r.action,
      r.result || 'PERMITIDO',
      r.blockReason || '—',
      r.actorRole || 'Asesor WhatsApp',
      r.agent,
      r.policy,
      r.version
    ].map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(','));
    return [headers.join(','), ...rows].join('\r\n');
  }
  return JSON.stringify({
    app: 'SAI-GC',
    version: VERSION,
    generatedAt: new Date().toISOString(),
    disclaimer: 'Datos sintéticos para demostración académica; no contiene registros operativos reales',
    records
  }, null, 2);
}
