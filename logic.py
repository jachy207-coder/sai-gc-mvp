"""
SAI-GC R02 / v0.8 — Módulo de Lógica Pura en Python
Sistema de Asistencia Inteligente y Gestión de Capacidad
MVP Académico Demostrativo · Datos Sintéticos · Esquema A3_B5_C8_v1
Versión v0.8-r02-operacion-aprobada
"""

import re
import json
import csv
import io
from pathlib import Path
from datetime import datetime

VERSION = '0.8-r02-operacion-aprobada'
DATASET_VERSION = 'v0.8_operacion_aprobada'
WEIGHT_SCHEME_VERSION = 'A3_B5_C8_v1'
CAPACITY = 10
EXPERIMENTAL_WEIGHTS = {'A': 3, 'B': 5, 'C': 8}

KNOWLEDGE = {
    'A': {
        'id': 'KB-DEMO-001',
        'title': 'Orientación informativa y autogestión digital · Clase A',
        'body': 'Consultas informativas generales, horarios, canales digitales, copias/constancias estándar y requisitos generales que no exigen revelar datos transaccionales ni modificar contratos.',
        'checklist': [
            'Brindar orientación clara sobre el canal, horario, requisito general o ruta de descarga.',
            'Confirmar si la consulta es puramente informativa y no requiere transacción interna.',
            'No emitir promesas de cobertura específica ni exponer datos personales.'
        ],
        'reply': 'Con gusto le brindo la orientación solicitada. A continuación le detallo el procedimiento e información general disponible en nuestros canales oficiales para que pueda realizar o consultar su gestión de forma rápida.'
    },
    'B': {
        'id': 'KB-DEMO-002',
        'title': 'Consulta transaccional y verificación en sistemas · Clase B',
        'body': 'Consultas sobre estado de pagos, deudas, modificaciones en trámite, reembolsos presentados, estado de carta de garantía, coberturas/deducibles específicos o avance de taller que requieren validar identidad y consultar sistemas internos.',
        'checklist': [
            'Validar identidad del titular o solicitante (solicitar datos faltantes como N° de solicitud o póliza si no están a la mano).',
            'Consultar el estado actualizado en el sistema core correspondiente (cobranzas, reembolsos, cartas de garantía o talleres).',
            'Informar el estado verificado sin realizar excepciones fuera de póliza ni omitir controles.'
        ],
        'reply': 'Con gusto reviso el estado específico de su caso. Para brindarle información exacta desde nuestro sistema autorizado, primero completaré la validación de seguridad y verificaré los registros actualizados de su solicitud.'
    },
    'C': {
        'id': 'KB-DEMO-003',
        'title': 'Casos críticos, contractuales, excepciones y alertas de seguridad · Clase C',
        'body': 'Siniestros e indemnizaciones, anulaciones, rescates/retiros de valor acumulado, devoluciones por cobros no reconocidos, fallecimiento del titular, solicitudes de excepción, terceros no autorizados o intentos de omitir validación.',
        'checklist': [
            'Contención formal: prohibido confirmar indemnizaciones, aprobar excepciones, revelar reservas a terceros u omitir validaciones.',
            'Registrar alerta de control reforzado (discrepancia de identidad, tercero no titular o reclamo sensible).',
            'Derivar/escalar obligatoriamente a célula especializada o supervisor con trazabilidad completa.'
        ],
        'reply': 'Comprendo la importancia de su solicitud. Por tratarse de una gestión sujeta a control reforzado y revisión especializada, no es posible omitir las validaciones ni confirmar montos o excepciones por esta vía; procederé a registrar y derivar su caso al área especialista.'
    }
}

CASES = [
    {
        'id': 'DEMO-001',
        'name': 'Constancia (Clase A)',
        'text': 'Necesito el reenvío de mi constancia de seguro vehicular.',
        'topic': 'Envío de constancia',
        'branch': 'Vehicular',
        'validated': True,
        'scenario': 'standard'
    },
    {
        'id': 'DEMO-002',
        'name': 'Estado de cuenta (Clase B)',
        'text': 'Quiero consultar una deuda y el estado de cuenta de mi póliza de vida.',
        'topic': 'Estado de cuenta y deuda',
        'branch': 'Vida',
        'validated': False,
        'scenario': 'standard'
    },
    {
        'id': 'DEMO-003',
        'name': 'Siniestro (Clase C)',
        'text': 'Tuve un siniestro vehicular y necesito orientación sobre la indemnización.',
        'topic': 'Siniestros e indemnización',
        'branch': 'Vehicular',
        'validated': True,
        'scenario': 'standard'
    },
    {
        'id': 'DEMO-004',
        'name': 'Anulación por excepción (Clase C)',
        'text': 'Deseo anular mi póliza de seguro de salud por un caso excepcional.',
        'topic': 'Anulación de póliza',
        'branch': 'Salud',
        'validated': False,
        'scenario': 'standard'
    },
    {
        'id': 'DEMO-005',
        'name': 'Texto no reconocido (C precautoria)',
        'text': 'Tengo una inquietud especial con un código de promoción o sorteo no registrado en el sistema.',
        'topic': 'Consulta fuera de catálogo',
        'branch': 'Vida',
        'validated': False,
        'scenario': 'standard'
    },
    {
        'id': 'DEMO-006',
        'name': 'Saturación en cola (Sin capacidad)',
        'text': 'Consulta vehicular prioritaria ingresando en momento de saturación de asesores.',
        'topic': 'Capacidad agotada en cola',
        'branch': 'Vehicular',
        'validated': True,
        'scenario': 'all_busy'
    },
    {
        'id': 'DEMO-007',
        'name': 'Especialista en pausa/refrigerio',
        'text': 'Consulta del ramo Salud donde el asesor de turno se encuentra en refrigerio.',
        'topic': 'Exclusión por estado no disponible',
        'branch': 'Salud',
        'validated': True,
        'scenario': 'agent_paused'
    },
    {
        'id': 'DEMO-008',
        'name': 'Comparativa Actual vs Experimental (A3/B5/C8)',
        'text': 'Solicitud con complejidad clase C para contrastar peso 5 (actual) vs 8 (experimental).',
        'topic': 'Contraste metodológico',
        'branch': 'Vehicular',
        'validated': True,
        'scenario': 'policy_compare'
    }
]

AGENTS = [
    {'id': 'AG-01', 'display': 'Asesor Demo 01', 'status': 'Disponible', 'load': 0, 'skills': ['Vida', 'Salud', 'Vehicular'], 'lastAssignmentAge': 25, 'loginAgeMin': 180},
    {'id': 'AG-02', 'display': 'Asesor Demo 02', 'status': 'Disponible', 'load': 5, 'skills': ['Vida', 'Vehicular'], 'lastAssignmentAge': 25, 'loginAgeMin': 125},
    {'id': 'AG-03', 'display': 'Asesor Demo 03', 'status': 'Ocupado', 'load': 10, 'skills': ['Vida', 'Salud', 'Vehicular'], 'lastAssignmentAge': 25, 'loginAgeMin': 80},
    {'id': 'AG-04', 'display': 'Asesor Demo 04', 'status': 'Refrigerio', 'load': 0, 'skills': ['Vida', 'Salud'], 'lastAssignmentAge': 25, 'loginAgeMin': 60}
]

CLASS_RULES = [
    {
        'id': 'RULE-C-CRIT',
        'value': 'C',
        'pattern': re.compile(r'siniestro|indemniza\w*|monto reservado|anulaci[oó]n|anular|rescate|retirar parte del valor acumulado|valor acumulado|devolver los cobros|devoluci[oó]n inmediata|no reconozco|cuenta distinta|no soy el titular|falleci[oó]|cambiar al contratante|datos del solicitante no coinciden|omitan la revisi[oó]n|no puedo validar mis datos|confirmen ahora mismo una carta de garant[ií]a|fraude|queja grave|reclamo sensible|excepci[oó]n|excepcional|modificaci[oó]n de p[oó]liza|complejidad clase c|indecopi|peritaje urgente', re.IGNORECASE),
        'why': 'Regla de seguridad demostrativa: consulta crítica / contractual / excepción / alerta de validación'
    },
    {
        'id': 'RULE-A-INFO',
        'value': 'A',
        'pattern': re.compile(r'horario|copia digital|constancia|comprobante electr[oó]nico|en t[eé]rminos generales|de manera general|red general de cl[ií]nicas|qu[eé] informaci[oó]n contiene un estado de cuenta|documentos digitales del plan|inspecci[oó]n vehicular previa|copia|duplicado|p[oó]liza digital|vigencia informativa', re.IGNORECASE),
        'why': 'Consulta de orientación informativa general o autogestión digital de baja complejidad'
    },
    {
        'id': 'RULE-B-PROC',
        'value': 'B',
        'pattern': re.compile(r'no aparece aplicado|deuda|estado de cuenta|saldo que aparece|no aparece actualizada|revisar el estado|cambiar el medio de pago|medio de pago|qu[eé] validaciones necesito|present[eé] un reembolso|carta de garant[ií]a est[aá] pendiente|estado correcto|atenci[oó]n especializada est[aá] cubierta|en reparaci[oó]n|falta un repuesto|confirmar el avance|tercero afectado|orientaci[oó]n sobre c[oó]mo registrar mi solicitud|cuota|cobranza|renovaci[oó]n|deducible|beneficio|proveedor|factura|boleta|direcci[oó]n fiscal|nuevo conductor', re.IGNORECASE),
        'why': 'Procedimiento transaccional con verificaciones de identidad o consulta de estado en sistemas internos'
    }
]

SPECIFIC_B_PATTERN = re.compile(
    r'no aparece aplicado|deuda|saldo que aparece|no coincide|no aparece actualizada|cambiar el medio de pago|present[eé] un reembolso|carta de garant[ií]a est[aá] pendiente|atenci[oó]n especializada est[aá] cubierta|deducible|en reparaci[oó]n|falta un repuesto|tercero afectado|direcci[oó]n fiscal|nuevo conductor',
    re.IGNORECASE
)

def classify(text: str) -> dict:
    if not isinstance(text, str) or not text.strip():
        return {
            'level': 'C',
            'risk': 'Alto',
            'ruleId': 'RULE-C-EMPTY',
            'matchedKeywords': [],
            'reason': 'Entrada vacía o inválida: escalamiento precautorio',
            'confidence': 'No estimada (reglas demostrativas)'
        }

    crit_matches = CLASS_RULES[0]['pattern'].findall(text)
    if crit_matches:
        unique_matches = list(dict.fromkeys(m.lower() for m in crit_matches))
        return {
            'level': 'C',
            'risk': 'Alto',
            'ruleId': CLASS_RULES[0]['id'],
            'matchedKeywords': unique_matches,
            'reason': CLASS_RULES[0]['why'],
            'confidence': 'No estimada (reglas demostrativas)'
        }

    if SPECIFIC_B_PATTERN.search(text):
        b_matches = CLASS_RULES[2]['pattern'].findall(text) or ['verificación transaccional']
        unique_matches = list(dict.fromkeys(m.lower() for m in b_matches))
        return {
            'level': 'B',
            'risk': 'Medio',
            'ruleId': CLASS_RULES[2]['id'],
            'matchedKeywords': unique_matches,
            'reason': CLASS_RULES[2]['why'],
            'confidence': 'No estimada (reglas demostrativas)'
        }

    a_matches = CLASS_RULES[1]['pattern'].findall(text)
    if a_matches:
        unique_matches = list(dict.fromkeys(m.lower() for m in a_matches))
        return {
            'level': 'A',
            'risk': 'Bajo',
            'ruleId': CLASS_RULES[1]['id'],
            'matchedKeywords': unique_matches,
            'reason': CLASS_RULES[1]['why'],
            'confidence': 'No estimada (reglas demostrativas)'
        }

    b_matches = CLASS_RULES[2]['pattern'].findall(text)
    if b_matches:
        unique_matches = list(dict.fromkeys(m.lower() for m in b_matches))
        return {
            'level': 'B',
            'risk': 'Medio',
            'ruleId': CLASS_RULES[2]['id'],
            'matchedKeywords': unique_matches,
            'reason': CLASS_RULES[2]['why'],
            'confidence': 'No estimada (reglas demostrativas)'
        }

    return {
        'level': 'C',
        'risk': 'Alto',
        'ruleId': 'RULE-C-FALLBACK',
        'matchedKeywords': [],
        'reason': 'Baja cobertura del conocimiento: escalamiento precautorio a humano',
        'confidence': 'No estimada (reglas demostrativas)'
    }

def weight_for(level: str, policy: str = 'actual') -> int:
    if policy == 'experimental':
        return EXPERIMENTAL_WEIGHTS.get(level, EXPERIMENTAL_WEIGHTS['C'])
    return 5

def build_agents_from_case_state(v08_case: dict, policy: str = 'actual') -> list:
    if not v08_case or not v08_case.get('agent_state'):
        return []
    agent_ids = sorted(v08_case['agent_state'].keys())
    result = []
    for ag_id in agent_ids:
        st = v08_case['agent_state'].get(ag_id, {})
        sessions = v08_case.get('active_sessions_by_agent', {}).get(ag_id, 0)
        classes = v08_case.get('active_case_classes_by_agent', {}).get(ag_id, [])
        last_age = v08_case.get('last_assignment_age', {}).get(ag_id, 0)

        load_actual = sessions * 5
        load_experimental = sum(weight_for(c, 'experimental') for c in classes)
        load = load_experimental if policy == 'experimental' else load_actual
        is_avail = bool(st.get('available') and st.get('connected'))

        result.append({
            'id': ag_id,
            'display': f"Agente {ag_id}",
            'status': 'Disponible' if is_avail else 'Ocupado',
            'available': is_avail,
            'connected': bool(st.get('connected')),
            'loginAgeMin': st.get('login_age_min', 0),
            'lastAssignmentAge': last_age,
            'activeSessions': sessions,
            'activeCaseClasses': list(classes),
            'loadActual': load_actual,
            'loadExperimental': load_experimental,
            'load': load,
            'skills': ['Vida', 'Salud', 'Vehicular']
        })
    return result

def route(agents: list, level: str, branch: str = None, policy: str = 'actual') -> dict:
    weight = weight_for(level, policy)
    valid = [
        a for a in (agents or [])
        if a.get('status') == 'Disponible' and
        a.get('available', True) is not False and
        a.get('connected', True) is not False and
        (not branch or not a.get('skills') or branch in a.get('skills', [])) and
        (a.get('load', 0) + weight) <= CAPACITY
    ]
    valid.sort(key=lambda a: (
        a.get('load', 0),
        -(a.get('lastAssignmentAge', 0) or 0),
        -(a.get('loginAgeMin', 0) or 0),
        a.get('id', '')
    ))
    choice = valid[0] if valid else None
    return {
        'weight': weight,
        'agent': choice,
        'projected': (choice['load'] + weight) if choice else None,
        'reason': (
            f"Menor carga ponderada ({choice['load']}/{CAPACITY} u., últ. asig. {choice.get('lastAssignmentAge', 25)} min)"
            if choice else
            'Sin capacidad o skill disponible; mantener en cola'
        )
    }

def compare_policies(agents: list, level: str, branch: str, v08_case: dict = None) -> dict:
    agents_actual = (
        build_agents_from_case_state(v08_case, 'actual')
        if v08_case else
        [{**a, 'load': a.get('loadActual', a.get('load', 0))} for a in (agents or [])]
    )
    agents_exp = (
        build_agents_from_case_state(v08_case, 'experimental')
        if v08_case else
        [{**a, 'load': a.get('loadExperimental', a.get('load', 0))} for a in (agents or [])]
    )
    actual = route(agents_actual, level, branch, 'actual')
    experimental = route(agents_exp, level, branch, 'experimental')
    return {
        'actual': actual,
        'experimental': experimental,
        'weightDelta': experimental['weight'] - actual['weight'],
        'maxConcurrencyActual': CAPACITY // actual['weight'],
        'maxConcurrencyExperimental': CAPACITY // experimental['weight']
    }

def respond(level: str, validated: bool) -> dict:
    source = KNOWLEDGE.get(level, KNOWLEDGE['C'])
    validation = (
        'El bot realizó validación previa; no repetir automáticamente el requerimiento.'
        if validated else
        'Validación pendiente; el asesor debe ejecutar verificación conforme al procedimiento autorizado.'
    )
    return {
        **source,
        'text': f"{source['reply']} {validation}"
    }

def compute_case_revision(case_data: dict, policy: str = 'actual', classification: dict = None) -> str:
    cid = case_data.get('id') or case_data.get('case_id', 'NO-ID')
    text = (case_data.get('text') or case_data.get('query_text', '') or '').strip()
    branch = case_data.get('branch', 'Vehicular')
    validated = bool(case_data.get('validated', False))
    level = classification.get('level') if classification else classify(text).get('level', 'C')
    pol = policy or 'actual'

    raw = f"{cid}|{branch}|ivr:{validated}|pol:{pol}|lvl:{level}|len:{len(text)}|txt:{text}"
    h = 2166136261
    for char in raw:
        h ^= ord(char)
        h = (h * 16777619) & 0xFFFFFFFF
    return f"rev-{h:08x}"

def process_case(test_case: dict, agents: list, policy: str = 'actual') -> dict:
    query_text = test_case.get('text') or test_case.get('query_text', '')
    case_id = test_case.get('id') or test_case.get('case_id', 'DEMO-???')
    classification = classify(query_text)
    has_coverage = (
        not classification['reason'].startswith('Baja cobertura') and
        not classification['reason'].startswith('Entrada vacía')
    )
    if has_coverage:
        guidance = respond(classification['level'], bool(test_case.get('validated', False)))
    else:
        guidance = {
            'id': 'KB-NO-COBERTURA',
            'title': 'Sin fuente aplicable: escalamiento obligatorio',
            'body': 'La base demo no cubre este caso sintético.',
            'checklist': [
                'Caso fuera de dominio del repositorio demostrativo.',
                'No emitir respuesta informativa al cliente sin validación.',
                'Derivar inmediatamente a supervisor o nivel 2.'
            ],
            'text': 'No se dispone de información suficiente en el repositorio de prueba. El asesor debe revisar y escalar; no generar una respuesta de contenido.'
        }
    branch = test_case.get('branch', 'Vehicular')
    active_agents = build_agents_from_case_state(test_case, policy) if test_case.get('agent_state') else agents
    recommendation = route(active_agents, classification['level'], branch, policy)
    policy_comparison = compare_policies(active_agents, classification['level'], branch, test_case if test_case.get('agent_state') else None)
    revision = compute_case_revision({**test_case, 'id': case_id, 'text': query_text}, policy, classification)
    initial_case_status = 'ESCALAMIENTO_REQUERIDO' if classification['level'] == 'C' else 'PENDIENTE_REVISION'

    return {
        'classification': classification,
        'guidance': guidance,
        'recommendation': recommendation,
        'policyComparison': policy_comparison,
        'revision': revision,
        'caseStatus': initial_case_status,
        'caseId': case_id,
        'policy': policy,
        'version': VERSION
    }

def load_v08_dataset() -> dict:
    path = Path(__file__).resolve().parent / 'data' / 'SAIGC_MVP_input_v0_8_operacion_aprobada.json'
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    return {'dataset_version': DATASET_VERSION, 'cases': []}

def evaluate_dataset_v08(dataset: dict = None) -> dict:
    ds = dataset or load_v08_dataset()
    cases = ds.get('cases', [])
    results = []
    for c in cases:
        cl = classify(c.get('query_text', ''))
        agents_act = build_agents_from_case_state(c, 'actual')
        agents_exp = build_agents_from_case_state(c, 'experimental')
        r_act = route(agents_act, cl['level'], None, 'actual')
        r_exp = route(agents_exp, cl['level'], None, 'experimental')
        req_esc = cl['level'] == 'C'
        results.append({
            'case_id': c.get('case_id'),
            'query_text': c.get('query_text'),
            'predicted_class': cl['level'],
            'risk': cl['risk'],
            'rule_id': cl['ruleId'],
            'loads_actual': {a['id']: a['load'] for a in agents_act},
            'loads_experimental': {a['id']: a['load'] for a in agents_exp},
            'weight_actual': r_act['weight'],
            'weight_experimental': r_exp['weight'],
            'assigned_agent_actual': r_act['agent']['id'] if r_act['agent'] else 'EN_COLA',
            'projected_load_actual': r_act['projected'],
            'assigned_agent_experimental': r_exp['agent']['id'] if r_exp['agent'] else 'EN_COLA',
            'projected_load_experimental': r_exp['projected'],
            'escalation_required': req_esc
        })
    summary = {
        'dataset_version': ds.get('dataset_version', DATASET_VERSION),
        'weight_scheme_version': ds.get('capacity_policy', {}).get('weight_scheme_version', WEIGHT_SCHEME_VERSION),
        'total_cases': len(results),
        'class_distribution': {
            'A': sum(1 for r in results if r['predicted_class'] == 'A'),
            'B': sum(1 for r in results if r['predicted_class'] == 'B'),
            'C': sum(1 for r in results if r['predicted_class'] == 'C')
        }
    }
    return {'summary': summary, 'results': results}

def can_confirm_assignment(context: dict) -> dict:
    case_data = context.get('caseData') or context.get('case_data')
    output = context.get('output')
    decision = context.get('decision')
    approved_revision = context.get('approvedRevision') or context.get('approved_revision')
    is_editing = bool(context.get('isEditing') or context.get('is_editing', False))
    edit_approved = bool(context.get('editApproved') or context.get('edit_approved', False))
    agents = context.get('agents', [])
    policy = context.get('policy', 'actual')
    active_assignments = context.get('activeAssignments') or context.get('active_assignments', [])

    if not case_data or not output or not output.get('classification'):
        return {
            'allowed': False,
            'code': 'ERR_NO_OUTPUT',
            'reason': 'El caso no ha sido procesado aún por el motor de triaje.'
        }

    level = output['classification']['level']
    branch = case_data.get('branch', 'Vehicular')
    current_revision = output.get('revision') or compute_case_revision(case_data, policy, output['classification'])

    if level == 'C' or output.get('guidance', {}).get('id') == 'KB-NO-COBERTURA':
        return {
            'allowed': False,
            'code': 'ERR_CLASS_C_ESCALATION',
            'reason': 'Clase C o consulta sensible/desconocida exige escalamiento obligatorio a supervisor. Asignación ordinaria bloqueada por seguridad operacional.'
        }

    if is_editing and not edit_approved:
        return {
            'allowed': False,
            'code': 'ERR_EDIT_NOT_APPROVED',
            'reason': 'El borrador se encuentra en modo edición. Debe guardar y aprobar el texto final antes de confirmar la asignación.'
        }

    if decision == 'Rechazar':
        return {
            'allowed': False,
            'code': 'ERR_REJECTED',
            'reason': 'La recomendación fue rechazada por el asesor. Asignación ordinaria bloqueada hasta nueva revisión.'
        }

    if decision == 'Escalar':
        return {
            'allowed': False,
            'code': 'ERR_ESCALATED',
            'reason': 'El caso fue marcado para escalamiento. Asignación ordinaria bloqueada.'
        }

    has_valid_approval = (decision == 'Aceptar') or (decision == 'Editar' and edit_approved)
    if not has_valid_approval:
        return {
            'allowed': False,
            'code': 'ERR_NO_APPROVAL',
            'reason': 'Se requiere aprobación humana explícita (Aceptar o Guardar y aprobar edición) antes de confirmar la asignación.'
        }

    if not approved_revision or approved_revision != current_revision:
        return {
            'allowed': False,
            'code': 'ERR_STALE_REVISION',
            'reason': 'La aprobación registrada es obsoleta o no coincide con los parámetros/contenido actuales del caso.'
        }

    ivr_manual = bool(case_data.get('ivrManualVerified') or case_data.get('ivr_manual_verified', False))
    if not case_data.get('validated') and not ivr_manual:
        return {
            'allowed': False,
            'code': 'ERR_IVR_UNVERIFIED',
            'reason': 'Validación IVR pendiente: el asesor debe confirmar la verificación manual de identidad del titular antes de la asignación.'
        }

    is_duplicate = any(
        item.get('id') == case_data.get('id') and item.get('status') in ('En curso', 'Asignado')
        for item in (active_assignments or [])
    )
    if is_duplicate:
        return {
            'allowed': False,
            'code': 'ERR_DUPLICATE_ASSIGNMENT',
            'reason': f"El caso {case_data.get('id')} ya cuenta con una asignación activa en trabajo en curso."
        }

    rec = route(agents, level, branch, policy)
    choice = rec['agent']

    if not choice:
        return {
            'allowed': False,
            'code': 'ERR_NO_CAPACITY_OR_SKILL',
            'reason': 'No hay capacidad disponible o no existe asesor disponible con skill compatible en este momento; mantener en cola.',
            'weight': rec['weight']
        }

    return {
        'allowed': True,
        'code': 'OK_APPROVED',
        'reason': 'Aprobación humana vigente y capacidad verificada en tiempo real.',
        'targetAgent': choice,
        'weight': rec['weight'],
        'projected': rec['projected']
    }

def register_escalation(context: dict) -> dict:
    case_data = context.get('caseData') or context.get('case_data', {})
    output = context.get('output', {})
    reason = context.get('reason')
    actor_role = context.get('actorRole') or context.get('actor_role', 'Asesor WhatsApp')

    case_id = case_data.get('id') or case_data.get('case_id', 'DEMO-???')
    level = output.get('classification', {}).get('level', 'C')
    target_queue = 'Cola de Supervisión / Siniestros y Excepciones' if level == 'C' else 'Cola de Nivel 2'
    return {
        'caseId': case_id,
        'level': level,
        'targetQueue': target_queue,
        'reason': reason or output.get('classification', {}).get('reason', 'Escalamiento mandatorio de seguridad operacional'),
        'actorRole': actor_role,
        'timestampIso': datetime.now().isoformat(),
        'status': 'DERIVADO_SUPERVISOR'
    }

def calculate_capacity_recovery(monthly_volume: float = 8000, delta_tmo_minutes: float = 2.0) -> dict:
    vol = max(0.0, float(monthly_volume or 0))
    delta = max(0.0, float(delta_tmo_minutes or 0))
    hours_recovered = round((vol * delta) / 60.0, 1)
    return {
        'monthlyVolume': int(vol),
        'deltaTmoMinutes': delta,
        'hoursRecovered': hours_recovered,
        'equivalentShifts8h': round(hours_recovered / 8.0, 1),
        'disclaimer': 'Cálculo hipotético de sensibilidad (Cap. V). No equivale a reducción automática de FTE.'
    }

def log_event(logs: list, entry: dict) -> list:
    timestamp_iso = entry.get('timestampIso') or datetime.now().isoformat()
    time_str = entry.get('time') or datetime.now().strftime('%d/%m/%Y, %H:%M:%S')
    record = {
        'timestampIso': timestamp_iso,
        'time': time_str,
        'case': entry.get('caseId') or entry.get('case', '—'),
        'revision': entry.get('revision', '—'),
        'caseStatus': entry.get('caseStatus') or entry.get('case_status', '—'),
        'event': entry.get('event', 'Evento'),
        'level': entry.get('level', '—'),
        'source': entry.get('source', '—'),
        'action': entry.get('action', '—'),
        'result': entry.get('result', 'PERMITIDO'),
        'blockReason': entry.get('blockReason') or entry.get('block_reason', '—'),
        'actorRole': entry.get('actorRole') or entry.get('actor_role', 'Asesor WhatsApp'),
        'agent': entry.get('agent', '—'),
        'policy': entry.get('policy', 'actual'),
        'version': entry.get('version', VERSION)
    }
    return [record] + list(logs or [])

def export_evidence(logs: list, fmt: str = 'json') -> str:
    records = logs or []
    if fmt == 'csv':
        output = io.StringIO()
        fieldnames = [
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
        ]
        writer = csv.writer(output, quoting=csv.QUOTE_ALL)
        writer.writerow(fieldnames)
        for r in records:
            writer.writerow([
                r.get('timestampIso', ''),
                r.get('time', ''),
                r.get('case', ''),
                r.get('revision', '—'),
                r.get('caseStatus', '—'),
                r.get('event', ''),
                r.get('level', ''),
                r.get('source', ''),
                r.get('action', ''),
                r.get('result', 'PERMITIDO'),
                r.get('blockReason', '—'),
                r.get('actorRole', 'Asesor WhatsApp'),
                r.get('agent', ''),
                r.get('policy', ''),
                r.get('version', '')
            ])
        return output.getvalue()

    return json.dumps({
        'app': 'SAI-GC',
        'version': VERSION,
        'datasetVersion': DATASET_VERSION,
        'weightSchemeVersion': WEIGHT_SCHEME_VERSION,
        'generatedAt': datetime.now().isoformat(),
        'disclaimer': 'Datos sintéticos para demostración académica; no contiene registros operativos reales',
        'records': records
    }, indent=2, ensure_ascii=False)
