/** 
 * SAI-GC R01 — Módulo de Lógica Pura
 * Sistema de Asistencia Inteligente y Gestión de Capacidad
 * MVP Académico Demostrativo · Datos Sintéticos
 */

export const VERSION = '0.3-r01-demo';
export const CAPACITY = 10;

export const KNOWLEDGE = {
  A: {
    id: 'KB-DEMO-001',
    title: 'Envío de constancia · plantilla demostrativa',
    body: 'Para solicitar una constancia, verificar identidad y cobertura con el procedimiento corporativo vigente. No afirmar el envío ni la vigencia sin comprobación.',
    reply: 'Con gusto le ayudo con su constancia. Antes de continuar, revisaré la validación y la información disponible en el procedimiento autorizado. Le confirmaré los siguientes pasos.'
  },
  B: {
    id: 'KB-DEMO-002',
    title: 'Estado de cuenta y deuda · plantilla demostrativa',
    body: 'La información de deuda y cuotas requiere consulta a fuentes corporativas. La plantilla no contiene saldos ni datos personales.',
    reply: 'Con gusto reviso su consulta sobre el estado de cuenta. Necesito validar los datos correspondientes y consultar el sistema autorizado antes de confirmarle importes o fechas.'
  },
  C: {
    id: 'KB-DEMO-003',
    title: 'Siniestros y excepciones · control reforzado',
    body: 'Los siniestros, indemnizaciones, anulaciones contractuales y casos sensibles requieren revisión o escalamiento. No prometer cobertura, pagos ni plazos.',
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
    value: 'C',
    rx: /siniestro|indemniza|anulaci[oó]n|rescate|carta de garant[ií]a|fraude|queja grave|reclamo sensible|excepci[oó]n|modificaci[oó]n de p[oó]liza/i,
    why: 'Regla de seguridad demostrativa: consulta sensible / contractual / excepción'
  },
  {
    value: 'B',
    rx: /deuda|estado de cuenta|cuota|cobranza|renovaci[oó]n|deducible|beneficio|proveedor|factura|boleta/i,
    why: 'Procedimiento con verificaciones o consultas a sistemas internos'
  },
  {
    value: 'A',
    rx: /constancia|copia|duplicado|p[oó]liza digital|vigencia informativa|horario/i,
    why: 'Consulta de orientación preliminar de baja complejidad'
  }
];

export function classify(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return {
      level: 'C',
      risk: 'Alto',
      reason: 'Entrada vacía o inválida: escalamiento precautorio',
      confidence: 'No estimada (reglas demostrativas)'
    };
  }
  const rule = CLASS_RULES.find(r => r.rx.test(text));
  if (!rule) {
    return {
      level: 'C',
      risk: 'Alto',
      reason: 'Baja cobertura del conocimiento: escalamiento precautorio a humano',
      confidence: 'No estimada (reglas demostrativas)'
    };
  }
  return {
    level: rule.value,
    risk: rule.value === 'C' ? 'Alto' : rule.value === 'B' ? 'Medio' : 'Bajo',
    reason: rule.why,
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
        text: 'No se dispone de información suficiente en el repositorio de prueba. El asesor debe revisar y escalar; no generar una respuesta de contenido.'
      };
  const recommendation = route(agents, classification.level, testCase.branch || 'Vehicular', policy);
  return {
    classification,
    guidance,
    recommendation,
    caseId: testCase.id,
    policy,
    version: VERSION
  };
}

export function log_event(logs, entry) {
  const time = entry.time || new Date().toLocaleString('es-PE');
  const record = {
    time,
    case: entry.caseId || entry.case || '—',
    event: entry.event || 'Evento',
    level: entry.level || '—',
    source: entry.source || '—',
    action: entry.action || '—',
    agent: entry.agent || '—',
    policy: entry.policy || 'actual',
    version: entry.version || VERSION
  };
  return [record, ...(logs || [])];
}

export function export_evidence(logs, format = 'json') {
  const records = logs || [];
  if (format === 'csv') {
    const headers = ['Fecha_Hora', 'Caso', 'Evento', 'Clase', 'Fuente', 'Decision_Humana', 'Asesor_Routing', 'Politica', 'Version'];
    const rows = records.map(r => [
      r.time,
      r.case,
      r.event,
      r.level,
      r.source,
      r.action,
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
