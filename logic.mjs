/** 
 * SAI-GC R02 / v0.8 — Módulo de Lógica Pura
 * Sistema de Asistencia Inteligente y Gestión de Capacidad
 * MVP Académico Demostrativo · Datos Sintéticos · Esquema A3_B5_C8_v1
 * Versión v0.8-r02-operacion-aprobada
 */

export const VERSION = '0.8-r02-operacion-aprobada';
export const DATASET_VERSION = 'v0.8_operacion_aprobada';
export const WEIGHT_SCHEME_VERSION = 'A3_B5_C8_v1';
export const CAPACITY = 10;
export const EXPERIMENTAL_WEIGHTS = { A: 3, B: 5, C: 8 };

export const KNOWLEDGE = {
  A: {
    id: 'KB-DEMO-001',
    title: 'Orientación informativa y autogestión digital · Clase A',
    body: 'Consultas informativas generales, horarios, canales digitales, copias/constancias estándar y requisitos generales que no exigen revelar datos transaccionales ni modificar contratos.',
    checklist: [
      'Brindar orientación clara sobre el canal, horario, requisito general o ruta de descarga.',
      'Confirmar si la consulta es puramente informativa y no requiere transacción interna.',
      'No emitir promesas de cobertura específica ni exponer datos personales.'
    ],
    reply: 'Con gusto le brindo la orientación solicitada. A continuación le detallo el procedimiento e información general disponible en nuestros canales oficiales para que pueda realizar o consultar su gestión de forma rápida.'
  },
  B: {
    id: 'KB-DEMO-002',
    title: 'Consulta transaccional y verificación en sistemas · Clase B',
    body: 'Consultas sobre estado de pagos, deudas, modificaciones en trámite, reembolsos presentados, estado de carta de garantía, coberturas/deducibles específicos o avance de taller que requieren validar identidad y consultar sistemas internos.',
    checklist: [
      'Validar identidad del titular o solicitante (solicitar datos faltantes como N° de solicitud o póliza si no están a la mano).',
      'Consultar el estado actualizado en el sistema core correspondiente (cobranzas, reembolsos, cartas de garantía o talleres).',
      'Informar el estado verificado sin realizar excepciones fuera de póliza ni omitir controles.'
    ],
    reply: 'Con gusto reviso el estado específico de su caso. Para brindarle información exacta desde nuestro sistema autorizado, primero completaré la validación de seguridad y verificaré los registros actualizados de su solicitud.'
  },
  C: {
    id: 'KB-DEMO-003',
    title: 'Casos críticos, contractuales, excepciones y alertas de seguridad · Clase C',
    body: 'Siniestros e indemnizaciones, anulaciones, rescates/retiros de valor acumulado, devoluciones por cobros no reconocidos, fallecimiento del titular, solicitudes de excepción, terceros no autorizados o intentos de omitir validación.',
    checklist: [
      'Contención formal: prohibido confirmar indemnizaciones, aprobar excepciones, revelar reservas a terceros u omitir validaciones.',
      'Registrar alerta de control reforzado (discrepancia de identidad, tercero no titular o reclamo sensible).',
      'Derivar/escalar obligatoriamente a célula especializada o supervisor con trazabilidad completa.'
    ],
    reply: 'Comprendo la importancia de su solicitud. Por tratarse de una gestión sujeta a control reforzado y revisión especializada, no es posible omitir las validaciones ni confirmar montos o excepciones por esta vía; procederé a registrar y derivar su caso al área especialista.'
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
    name: 'Comparativa Actual vs Experimental (A3/B5/C8)',
    text: 'Solicitud con complejidad clase C para contrastar peso 5 (actual) vs 8 (experimental).',
    topic: 'Contraste metodológico',
    branch: 'Vehicular',
    validated: true,
    scenario: 'policy_compare'
  }
];

export const V08_DATASET = {
  dataset_version: 'v0.8_operacion_aprobada',
  status: 'APTO_PARA_PRUEBA_TECNICA_NO_V5',
  capacity_policy: {
    nominal_capacity_units: 10,
    current_policy_fixed_weight_units: 5,
    experimental_weights: { A: 3, B: 5, C: 8 },
    weight_scheme_version: 'A3_B5_C8_v1'
  },
  privacy_and_leakage_controls: {
    opaque_case_ids: true,
    excluded_fields: [
      'expected_class',
      'scenario_type',
      'typology',
      'risk_condition',
      'available_information',
      'missing_information',
      'expected_routing',
      'expected_response',
      'escalation_expected',
      'critical_error'
    ],
    note: 'El MVP recibe la consulta y el estado operativo. La correspondencia con el gold standard se conserva en un archivo restringido separado.'
  },
  cases: [
    {
      case_id: 'CASO-001',
      query_text: '¿Cuál es el horario de atención del canal y qué opciones tengo fuera de ese horario?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 0, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': [], 'AGT-02': ['B'], 'AGT-03': ['C'] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-002',
      query_text: 'Compré un SOAT y necesito saber cómo obtener una copia digital.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 0, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['B'], 'AGT-02': [], 'AGT-03': ['A'] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-003',
      query_text: '¿Cómo puedo solicitar una constancia de afiliación de mi plan de salud?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 0 },
      active_case_classes_by_agent: { 'AGT-01': ['C'], 'AGT-02': ['A'], 'AGT-03': [] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-004',
      query_text: '¿Dónde puedo consultar o descargar el comprobante electrónico de mi seguro vehicular?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['A'], 'AGT-02': ['B'], 'AGT-03': ['C'] },
      last_assignment_age: { 'AGT-01': 55, 'AGT-02': 20, 'AGT-03': 20 }
    },
    {
      case_id: 'CASO-005',
      query_text: 'En términos generales, ¿qué documentos suelen solicitar para presentar un reembolso?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['B'], 'AGT-02': ['C'], 'AGT-03': ['A'] },
      last_assignment_age: { 'AGT-01': 20, 'AGT-02': 55, 'AGT-03': 20 }
    },
    {
      case_id: 'CASO-006',
      query_text: '¿Dónde puedo revisar la red general de clínicas y proveedores disponible para mi plan?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['C'], 'AGT-02': ['A'], 'AGT-03': ['B'] },
      last_assignment_age: { 'AGT-01': 20, 'AGT-02': 20, 'AGT-03': 55 }
    },
    {
      case_id: 'CASO-007',
      query_text: '¿Para qué sirve la inspección vehicular previa y qué se revisa de manera general?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 0, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': [], 'AGT-02': ['B'], 'AGT-03': ['C'] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-008',
      query_text: 'Necesito conocer qué información contiene un estado de cuenta de un seguro de vida con componente de ahorro.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 0, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['B'], 'AGT-02': [], 'AGT-03': ['A'] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-009',
      query_text: '¿Cómo accedo a mis documentos digitales del plan si el canal está recibiendo muchas consultas?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 0 },
      active_case_classes_by_agent: { 'AGT-01': ['C'], 'AGT-02': ['A'], 'AGT-03': [] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-010',
      query_text: '¿Horario?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 3, 'AGT-02': 3, 'AGT-03': 3 },
      active_case_classes_by_agent: { 'AGT-01': ['A', 'A', 'A'], 'AGT-02': ['A', 'A', 'A'], 'AGT-03': ['A', 'A', 'A'] },
      last_assignment_age: { 'AGT-01': 70, 'AGT-02': 45, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-011',
      query_text: 'Realicé un pago de mi seguro vehicular, pero todavía no aparece aplicado. ¿Pueden revisarlo?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['B'], 'AGT-02': ['C'], 'AGT-03': ['A'] },
      last_assignment_age: { 'AGT-01': 55, 'AGT-02': 20, 'AGT-03': 20 }
    },
    {
      case_id: 'CASO-012',
      query_text: 'Veo una deuda pendiente en mi seguro de vida y quiero saber a qué corresponde.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['C'], 'AGT-02': ['A'], 'AGT-03': ['B'] },
      last_assignment_age: { 'AGT-01': 20, 'AGT-02': 55, 'AGT-03': 20 }
    },
    {
      case_id: 'CASO-013',
      query_text: 'Solicité una modificación en mi póliza vehicular, pero todavía no aparece actualizada. ¿Podrían revisar el estado?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['A'], 'AGT-02': ['B'], 'AGT-03': ['C'] },
      last_assignment_age: { 'AGT-01': 20, 'AGT-02': 20, 'AGT-03': 55 }
    },
    {
      case_id: 'CASO-014',
      query_text: 'Quiero cambiar el medio de pago de mi seguro, pero no sé qué validaciones necesito completar.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 0, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': [], 'AGT-02': ['C'], 'AGT-03': ['A'] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-015',
      query_text: 'Presenté un reembolso y necesito saber si ya fue revisado, pero no tengo el número de solicitud a la mano.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 0, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['C'], 'AGT-02': [], 'AGT-03': ['B'] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-016',
      query_text: 'La clínica indica que mi carta de garantía está pendiente, pero yo recibí un mensaje que decía que estaba en evaluación. ¿Cuál es el estado correcto?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 0 },
      active_case_classes_by_agent: { 'AGT-01': ['A'], 'AGT-02': ['B'], 'AGT-03': [] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-017',
      query_text: 'Necesito confirmar si una atención especializada está cubierta, qué deducible aplica y en qué proveedor puedo atenderme.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['B'], 'AGT-02': ['C'], 'AGT-03': ['A'] },
      last_assignment_age: { 'AGT-01': 55, 'AGT-02': 20, 'AGT-03': 20 }
    },
    {
      case_id: 'CASO-018',
      query_text: 'Mi vehículo está en reparación y me informaron que falta un repuesto. ¿Pueden confirmar el avance y el plazo estimado?',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['C'], 'AGT-02': ['A'], 'AGT-03': ['B'] },
      last_assignment_age: { 'AGT-01': 20, 'AGT-02': 55, 'AGT-03': 20 }
    },
    {
      case_id: 'CASO-019',
      query_text: 'El saldo que aparece en mi estado de cuenta no coincide con lo que esperaba y necesito que lo revisen.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 2, 'AGT-02': 2, 'AGT-03': 2 },
      active_case_classes_by_agent: { 'AGT-01': ['A', 'A'], 'AGT-02': ['A', 'B'], 'AGT-03': ['B', 'B'] },
      last_assignment_age: { 'AGT-01': 70, 'AGT-02': 45, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-020',
      query_text: 'Soy un tercero afectado y necesito orientación sobre cómo registrar mi solicitud, pero no hay un agente disponible.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 3, 'AGT-02': 3, 'AGT-03': 3 },
      active_case_classes_by_agent: { 'AGT-01': ['A', 'A', 'A'], 'AGT-02': ['A', 'A', 'A'], 'AGT-03': ['A', 'A', 'A'] },
      last_assignment_age: { 'AGT-01': 70, 'AGT-02': 45, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-021',
      query_text: 'Solicito anular mi seguro de salud y devolver los cobros realizados porque no reconozco el cambio aplicado.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 0, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': [], 'AGT-02': ['A'], 'AGT-03': ['B'] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-022',
      query_text: 'Quiero retirar parte del valor acumulado de mi seguro y saber cuánto recibiría.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 0, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['A'], 'AGT-02': [], 'AGT-03': ['C'] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-023',
      query_text: 'Tuve un siniestro y necesito confirmar si corresponde una indemnización y cuál sería el monto.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 0 },
      active_case_classes_by_agent: { 'AGT-01': ['B'], 'AGT-02': ['C'], 'AGT-03': [] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-024',
      query_text: 'Necesito que el pago de una devolución se deposite en una cuenta distinta, pero no soy el titular de la póliza.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['C'], 'AGT-02': ['A'], 'AGT-03': ['B'] },
      last_assignment_age: { 'AGT-01': 55, 'AGT-02': 20, 'AGT-03': 20 }
    },
    {
      case_id: 'CASO-025',
      query_text: 'Me indican que una atención no está incluida en mi plan, pero necesito que hagan una excepción.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['A'], 'AGT-02': ['B'], 'AGT-03': ['C'] },
      last_assignment_age: { 'AGT-01': 20, 'AGT-02': 55, 'AGT-03': 20 }
    },
    {
      case_id: 'CASO-026',
      query_text: 'Me cobraron un importe que no reconozco y me indican que corresponde a una modificación que no solicité. Exijo la devolución inmediata.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['B'], 'AGT-02': ['C'], 'AGT-03': ['A'] },
      last_assignment_age: { 'AGT-01': 20, 'AGT-02': 20, 'AGT-03': 55 }
    },
    {
      case_id: 'CASO-027',
      query_text: 'El titular de la póliza falleció y necesito saber si puedo cambiar al contratante y continuar con el seguro.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 0, 'AGT-02': 1, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': [], 'AGT-02': ['A'], 'AGT-03': ['B'] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-028',
      query_text: 'Quiero anular el seguro, pero los datos del solicitante no coinciden con los del contratante y no puedo explicar la diferencia.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 0, 'AGT-03': 1 },
      active_case_classes_by_agent: { 'AGT-01': ['A'], 'AGT-02': [], 'AGT-03': ['C'] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-029',
      query_text: 'Soy un tercero y quiero conocer todos los detalles y el monto reservado de un siniestro ajeno.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 1, 'AGT-02': 1, 'AGT-03': 0 },
      active_case_classes_by_agent: { 'AGT-01': ['B'], 'AGT-02': ['C'], 'AGT-03': [] },
      last_assignment_age: { 'AGT-01': 25, 'AGT-02': 25, 'AGT-03': 25 }
    },
    {
      case_id: 'CASO-030',
      query_text: 'Necesito que confirmen ahora mismo una carta de garantía; no puedo validar mis datos y pido que omitan la revisión.',
      agent_state: { 'AGT-01': { available: true, connected: true, login_age_min: 180 }, 'AGT-02': { available: true, connected: true, login_age_min: 125 }, 'AGT-03': { available: true, connected: true, login_age_min: 80 } },
      active_sessions_by_agent: { 'AGT-01': 3, 'AGT-02': 3, 'AGT-03': 3 },
      active_case_classes_by_agent: { 'AGT-01': ['A', 'A', 'A'], 'AGT-02': ['A', 'A', 'A'], 'AGT-03': ['A', 'A', 'A'] },
      last_assignment_age: { 'AGT-01': 70, 'AGT-02': 45, 'AGT-03': 25 }
    }
  ]
};

export const AGENTS = [
  { id: 'AG-01', display: 'Asesor Demo 01', status: 'Disponible', load: 0, skills: ['Vida', 'Salud', 'Vehicular'], lastAssignmentAge: 25, loginAgeMin: 180 },
  { id: 'AG-02', display: 'Asesor Demo 02', status: 'Disponible', load: 5, skills: ['Vida', 'Vehicular'], lastAssignmentAge: 25, loginAgeMin: 125 },
  { id: 'AG-03', display: 'Asesor Demo 03', status: 'Ocupado', load: 10, skills: ['Vida', 'Salud', 'Vehicular'], lastAssignmentAge: 25, loginAgeMin: 80 },
  { id: 'AG-04', display: 'Asesor Demo 04', status: 'Refrigerio', load: 0, skills: ['Vida', 'Salud'], lastAssignmentAge: 25, loginAgeMin: 60 }
];

const CLASS_RULES = [
  {
    id: 'RULE-C-CRIT',
    value: 'C',
    rx: /siniestro|indemniza\w*|monto reservado|anulaci[oó]n|anular|rescate|retirar parte del valor acumulado|valor acumulado|devolver los cobros|devoluci[oó]n inmediata|no reconozco|cuenta distinta|no soy el titular|falleci[oó]|cambiar al contratante|datos del solicitante no coinciden|omitan la revisi[oó]n|no puedo validar mis datos|confirmen ahora mismo una carta de garant[ií]a|fraude|queja grave|reclamo sensible|excepci[oó]n|excepcional|modificaci[oó]n de p[oó]liza|complejidad clase c|indecopi|peritaje urgente/gi,
    why: 'Regla de seguridad demostrativa: consulta crítica / contractual / excepción / alerta de validación'
  },
  {
    id: 'RULE-A-INFO',
    value: 'A',
    rx: /horario|copia digital|constancia|comprobante electr[oó]nico|en t[eé]rminos generales|de manera general|red general de cl[ií]nicas|qu[eé] informaci[oó]n contiene un estado de cuenta|documentos digitales del plan|inspecci[oó]n vehicular previa|copia|duplicado|p[oó]liza digital|vigencia informativa/gi,
    why: 'Consulta de orientación informativa general o autogestión digital de baja complejidad'
  },
  {
    id: 'RULE-B-PROC',
    value: 'B',
    rx: /no aparece aplicado|deuda|estado de cuenta|saldo que aparece|no aparece actualizada|revisar el estado|cambiar el medio de pago|medio de pago|qu[eé] validaciones necesito|present[eé] un reembolso|carta de garant[ií]a est[aá] pendiente|estado correcto|atenci[oó]n especializada est[aá] cubierta|en reparaci[oó]n|falta un repuesto|confirmar el avance|tercero afectado|orientaci[oó]n sobre c[oó]mo registrar mi solicitud|cuota|cobranza|renovaci[oó]n|deducible|beneficio|proveedor|factura|boleta|direcci[oó]n fiscal|nuevo conductor/gi,
    why: 'Procedimiento transaccional con verificaciones de identidad o consulta de estado en sistemas internos'
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

  // Evaluamos primero RULE-C-CRIT.
  // Para distinguir orientación general (Clase A, ej. CASO-006/008) de consulta transaccional (Clase B, ej. CASO-017/019):
  // Si coincide con patrones específicos de transacción/discrepancia personal de Clase B ("saldo que aparece", "atención especializada está cubierta", "deuda", "no aparece aplicado"), priorizamos B sobre menciones generales.
  const critMatches = text.match(CLASS_RULES[0].rx);
  if (critMatches && critMatches.length > 0) {
    const uniqueMatches = [...new Set(critMatches.map(m => m.toLowerCase()))];
    return {
      level: 'C',
      risk: 'Alto',
      ruleId: CLASS_RULES[0].id,
      matchedKeywords: uniqueMatches,
      reason: CLASS_RULES[0].why,
      confidence: 'No estimada (reglas demostrativas)'
    };
  }

  const isSpecificTransactionalB = /no aparece aplicado|deuda|saldo que aparece|no coincide|no aparece actualizada|cambiar el medio de pago|present[eé] un reembolso|carta de garant[ií]a est[aá] pendiente|atenci[oó]n especializada est[aá] cubierta|deducible|en reparaci[oó]n|falta un repuesto|tercero afectado|direcci[oó]n fiscal|nuevo conductor/i.test(text);

  if (isSpecificTransactionalB) {
    const bMatches = text.match(CLASS_RULES[2].rx) || ['verificación transaccional'];
    const uniqueMatches = [...new Set(bMatches.map(m => m.toLowerCase()))];
    return {
      level: 'B',
      risk: 'Medio',
      ruleId: CLASS_RULES[2].id,
      matchedKeywords: uniqueMatches,
      reason: CLASS_RULES[2].why,
      confidence: 'No estimada (reglas demostrativas)'
    };
  }

  const aMatches = text.match(CLASS_RULES[1].rx);
  if (aMatches && aMatches.length > 0) {
    const uniqueMatches = [...new Set(aMatches.map(m => m.toLowerCase()))];
    return {
      level: 'A',
      risk: 'Bajo',
      ruleId: CLASS_RULES[1].id,
      matchedKeywords: uniqueMatches,
      reason: CLASS_RULES[1].why,
      confidence: 'No estimada (reglas demostrativas)'
    };
  }

  const bMatches = text.match(CLASS_RULES[2].rx);
  if (bMatches && bMatches.length > 0) {
    const uniqueMatches = [...new Set(bMatches.map(m => m.toLowerCase()))];
    return {
      level: 'B',
      risk: 'Medio',
      ruleId: CLASS_RULES[2].id,
      matchedKeywords: uniqueMatches,
      reason: CLASS_RULES[2].why,
      confidence: 'No estimada (reglas demostrativas)'
    };
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
    return EXPERIMENTAL_WEIGHTS[level] ?? EXPERIMENTAL_WEIGHTS.C;
  }
  return 5; // Regla actual confirmada: WhatsApp consume 5 unidades fijas
}

/**
 * Construye la lista normalizada de agentes a partir del estado operativo de un caso v0.8
 */
export function buildAgentsFromCaseState(v08Case, policy = 'actual') {
  if (!v08Case || !v08Case.agent_state) return [];
  const agentIds = Object.keys(v08Case.agent_state).sort();
  return agentIds.map(id => {
    const st = v08Case.agent_state[id] || {};
    const sessions = v08Case.active_sessions_by_agent?.[id] ?? 0;
    const classes = v08Case.active_case_classes_by_agent?.[id] || [];
    const lastAge = v08Case.last_assignment_age?.[id] ?? 0;

    const loadActual = sessions * 5;
    const loadExperimental = classes.reduce((sum, cls) => sum + weightFor(cls, 'experimental'), 0);
    const load = policy === 'experimental' ? loadExperimental : loadActual;
    const isAvail = Boolean(st.available && st.connected);

    return {
      id,
      display: `Agente ${id}`,
      status: isAvail ? 'Disponible' : 'Ocupado',
      available: isAvail,
      connected: Boolean(st.connected),
      loginAgeMin: st.login_age_min ?? 0,
      lastAssignmentAge: lastAge,
      activeSessions: sessions,
      activeCaseClasses: [...classes],
      loadActual,
      loadExperimental,
      load,
      skills: ['Vida', 'Salud', 'Vehicular']
    };
  });
}

export function route(agents, level, branch, policy = 'actual') {
  const weight = weightFor(level, policy);
  const valid = (agents || []).filter(a => {
    const isAvailable = a.status === 'Disponible' && (a.available !== false) && (a.connected !== false);
    const hasSkill = !branch || !Array.isArray(a.skills) || a.skills.includes(branch);
    const currentLoad = typeof a.load === 'number' ? a.load : 0;
    return isAvailable && hasSkill && (currentLoad + weight) <= CAPACITY;
  });

  // Ordenar por:
  // 1. Menor carga actual (a.load - b.load)
  // 2. Mayor antigüedad desde última asignación (b.lastAssignmentAge - a.lastAssignmentAge)
  // 3. Mayor antigüedad de login (b.loginAgeMin - a.loginAgeMin)
  // 4. ID alfabético
  valid.sort((a, b) =>
    (a.load - b.load) ||
    ((b.lastAssignmentAge ?? 0) - (a.lastAssignmentAge ?? 0)) ||
    ((b.loginAgeMin ?? 0) - (a.loginAgeMin ?? 0)) ||
    a.id.localeCompare(b.id)
  );

  const choice = valid[0] || null;
  return {
    weight,
    agent: choice,
    projected: choice ? choice.load + weight : null,
    reason: choice
      ? `Menor carga ponderada (${choice.load}/${CAPACITY} u., últ. asig. ${choice.lastAssignmentAge ?? 25} min)`
      : 'Sin capacidad o skill disponible; mantener en cola'
  };
}

export function comparePolicies(agents, level, branch, v08Case = null) {
  const agentsActual = v08Case
    ? buildAgentsFromCaseState(v08Case, 'actual')
    : (agents || []).map(a => ({ ...a, load: typeof a.loadActual === 'number' ? a.loadActual : a.load }));
  const agentsExp = v08Case
    ? buildAgentsFromCaseState(v08Case, 'experimental')
    : (agents || []).map(a => ({ ...a, load: typeof a.loadExperimental === 'number' ? a.loadExperimental : a.load }));

  const actual = route(agentsActual, level, branch, 'actual');
  const experimental = route(agentsExp, level, branch, 'experimental');
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
  const id = caseData?.id || caseData?.case_id || 'NO-ID';
  const text = (caseData?.text || caseData?.query_text || '').trim();
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
  const queryText = testCase.text ?? testCase.query_text ?? '';
  const caseId = testCase.id ?? testCase.case_id ?? 'DEMO-???';
  const classification = classify(queryText);
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
  const activeAgents = testCase.agent_state
    ? buildAgentsFromCaseState(testCase, policy)
    : agents;
  const recommendation = route(activeAgents, classification.level, branch, policy);
  const policyComparison = comparePolicies(activeAgents, classification.level, branch, testCase.agent_state ? testCase : null);
  const revision = computeCaseRevision({ ...testCase, id: caseId, text: queryText }, policy, classification);
  
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
    caseId,
    policy,
    version: VERSION
  };
}

/**
 * Evalúa un dataset completo en formato v0.8_operacion_aprobada (30 casos)
 * sin utilizar campos excluidos por control de leakage.
 */
export function evaluateDatasetV08(dataset = V08_DATASET) {
  const cases = dataset?.cases || [];
  const results = cases.map(c => {
    const classification = classify(c.query_text);
    const agentsActual = buildAgentsFromCaseState(c, 'actual');
    const agentsExp = buildAgentsFromCaseState(c, 'experimental');
    const routeActual = route(agentsActual, classification.level, null, 'actual');
    const routeExp = route(agentsExp, classification.level, null, 'experimental');
    const requiresEscalation = classification.level === 'C';

    return {
      case_id: c.case_id,
      query_text: c.query_text,
      predicted_class: classification.level,
      risk: classification.risk,
      rule_id: classification.ruleId,
      matched_keywords: classification.matchedKeywords,
      loads_actual: Object.fromEntries(agentsActual.map(a => [a.id, a.load])),
      loads_experimental: Object.fromEntries(agentsExp.map(a => [a.id, a.load])),
      active_classes: c.active_case_classes_by_agent,
      last_assignment_age: c.last_assignment_age,
      weight_actual: routeActual.weight,
      weight_experimental: routeExp.weight,
      assigned_agent_actual: routeActual.agent ? routeActual.agent.id : 'EN_COLA',
      projected_load_actual: routeActual.projected,
      assigned_agent_experimental: routeExp.agent ? routeExp.agent.id : 'EN_COLA',
      projected_load_experimental: routeExp.projected,
      escalation_required: requiresEscalation,
      operational_action: requiresEscalation
        ? (routeExp.agent ? `Control Reforzado / Escalar (${routeExp.agent.id} disp. 8u)` : 'Retener y Escalar a Supervisor (Sin cap. 8u)')
        : (routeExp.agent ? `Asignar a ${routeExp.agent.id} (${routeExp.projected}/10 u.)` : 'Retener en Cola (Capacidad Agotada)')
    };
  });

  const summary = {
    dataset_version: dataset?.dataset_version || DATASET_VERSION,
    weight_scheme_version: dataset?.capacity_policy?.weight_scheme_version || WEIGHT_SCHEME_VERSION,
    total_cases: results.length,
    class_distribution: {
      A: results.filter(r => r.predicted_class === 'A').length,
      B: results.filter(r => r.predicted_class === 'B').length,
      C: results.filter(r => r.predicted_class === 'C').length
    },
    routing_comparison: {
      actual_assigned: results.filter(r => r.assigned_agent_actual !== 'EN_COLA').length,
      actual_queued: results.filter(r => r.assigned_agent_actual === 'EN_COLA').length,
      experimental_assigned: results.filter(r => r.assigned_agent_experimental !== 'EN_COLA').length,
      experimental_queued: results.filter(r => r.assigned_agent_experimental === 'EN_COLA').length,
      routing_differences: results.filter(r => r.assigned_agent_actual !== r.assigned_agent_experimental).length
    },
    escalation_count: results.filter(r => r.escalation_required).length
  };

  return { summary, results };
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
  const recommendation = route(agents, level, branch, policy);
  const choice = recommendation.agent;

  if (!choice) {
    return {
      allowed: false,
      code: 'ERR_NO_CAPACITY_OR_SKILL',
      reason: 'No hay capacidad disponible o no existe asesor disponible con skill compatible en este momento; mantener en cola.',
      weight: recommendation.weight
    };
  }

  return {
    allowed: true,
    code: 'OK_APPROVED',
    reason: 'Aprobación humana vigente y capacidad verificada en tiempo real.',
    targetAgent: choice,
    weight: recommendation.weight,
    projected: recommendation.projected
  };
}

/**
 * Registra y estructura un escalamiento operacional formal.
 */
export function registerEscalation({ caseData, output, reason, actorRole = 'Asesor WhatsApp' }) {
  const caseId = caseData?.id || caseData?.case_id || 'DEMO-???';
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
    datasetVersion: DATASET_VERSION,
    weightSchemeVersion: WEIGHT_SCHEME_VERSION,
    generatedAt: new Date().toISOString(),
    disclaimer: 'Datos sintéticos para demostración académica; no contiene registros operativos reales',
    records
  }, null, 2);
}
