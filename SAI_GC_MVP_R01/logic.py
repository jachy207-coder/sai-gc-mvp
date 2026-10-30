"""
SAI-GC R02 — Módulo de Lógica Pura en Python
Sistema de Asistencia Inteligente y Gestión de Capacidad
MVP Académico Demostrativo · Datos Sintéticos
Versión R02 Verificable
"""

import re
import json
import csv
import io
from datetime import datetime

VERSION = '0.5-r02-verificable'
CAPACITY = 10

KNOWLEDGE = {
    'A': {
        'id': 'KB-DEMO-001',
        'title': 'Envío de constancia · plantilla demostrativa',
        'body': 'Para solicitar una constancia, verificar identidad y cobertura con el procedimiento corporativo vigente. No afirmar el envío ni la vigencia sin comprobación.',
        'checklist': [
            'Confirmar validación previa en IVR o verificar DNI/placa del titular.',
            'Consultar estado de vigencia en el sistema core antes de emitir constancia.',
            'Adjuntar PDF oficial sin prometer coberturas adicionales.'
        ],
        'reply': 'Con gusto le ayudo con su constancia. Antes de continuar, revisaré la validación y la información disponible en el procedimiento autorizado. Le confirmaré los siguientes pasos.'
    },
    'B': {
        'id': 'KB-DEMO-002',
        'title': 'Estado de cuenta y deuda · plantilla demostrativa',
        'body': 'La información de deuda y cuotas requiere consulta a fuentes corporativas. La plantilla no contiene saldos ni datos personales.',
        'checklist': [
            'Validar identidad del asegurado (obligatorio si el IVR no completó autenticación).',
            'Consultar cronograma de pagos y estado de cuotas en módulo de cobranzas.',
            'Informar canales oficiales de pago sin digitar importes no verificados.'
        ],
        'reply': 'Con gusto reviso su consulta sobre el estado de cuenta. Necesito validar los datos correspondientes y consultar el sistema autorizado antes de confirmarle importes o fechas.'
    },
    'C': {
        'id': 'KB-DEMO-003',
        'title': 'Siniestros y excepciones · control reforzado',
        'body': 'Los siniestros, indemnizaciones, anulaciones contractuales y casos sensibles requieren revisión o escalamiento. No prometer cobertura, pagos ni plazos.',
        'checklist': [
            'Contención empática inicial; prohibido confirmar cobertura o indemnización.',
            'Recopilar número de póliza, fecha del evento y documentación de sustento.',
            'Escalar a célula especializada o supervisor según matriz de riesgo.'
        ],
        'reply': 'Comprendo su solicitud. Por tratarse de una gestión que requiere una revisión especializada, verificaré la documentación y la ruta de atención correspondiente antes de brindarle una respuesta definitiva.'
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
        'name': 'Comparativa Actual vs Experimental',
        'text': 'Solicitud con complejidad clase C para contrastar peso 5 (actual) vs 7 (experimental).',
        'topic': 'Contraste metodológico',
        'branch': 'Vehicular',
        'validated': True,
        'scenario': 'policy_compare'
    }
]

AGENTS = [
    {'id': 'AG-01', 'display': 'Asesor Demo 01', 'status': 'Disponible', 'load': 0, 'skills': ['Vida', 'Salud', 'Vehicular']},
    {'id': 'AG-02', 'display': 'Asesor Demo 02', 'status': 'Disponible', 'load': 5, 'skills': ['Vida', 'Vehicular']},
    {'id': 'AG-03', 'display': 'Asesor Demo 03', 'status': 'Ocupado', 'load': 10, 'skills': ['Vida', 'Salud', 'Vehicular']},
    {'id': 'AG-04', 'display': 'Asesor Demo 04', 'status': 'Refrigerio', 'load': 0, 'skills': ['Vida', 'Salud']}
]

CLASS_RULES = [
    {
        'id': 'RULE-C-CRIT',
        'value': 'C',
        'pattern': re.compile(r'siniestro|indemniza\w*|anulaci[oó]n|anular|rescate|carta de garant[ií]a|fraude|queja grave|reclamo sensible|excepci[oó]n|excepcional|modificaci[oó]n de p[oó]liza|complejidad clase c', re.IGNORECASE),
        'why': 'Regla de seguridad demostrativa: consulta sensible / contractual / excepción'
    },
    {
        'id': 'RULE-B-PROC',
        'value': 'B',
        'pattern': re.compile(r'deuda|estado de cuenta|cuota|cobranza|renovaci[oó]n|deducible|beneficio|proveedor|factura|boleta', re.IGNORECASE),
        'why': 'Procedimiento con verificaciones o consultas a sistemas internos'
    },
    {
        'id': 'RULE-A-INFO',
        'value': 'A',
        'pattern': re.compile(r'constancia|copia|duplicado|p[oó]liza digital|vigencia informativa|horario', re.IGNORECASE),
        'why': 'Consulta de orientación preliminar de baja complejidad'
    }
]

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
    for rule in CLASS_RULES:
        matches = rule['pattern'].findall(text)
        if matches:
            unique_matches = list(dict.fromkeys(m.lower() for m in matches))
            level = rule['value']
            risk = 'Alto' if level == 'C' else ('Medio' if level == 'B' else 'Bajo')
            return {
                'level': level,
                'risk': risk,
                'ruleId': rule['id'],
                'matchedKeywords': unique_matches,
                'reason': rule['why'],
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
        return {'A': 4, 'B': 5, 'C': 7}.get(level, 7)
    return 5

def route(agents: list, level: str, branch: str, policy: str = 'actual') -> dict:
    weight = weight_for(level, policy)
    valid = [
        a for a in (agents or [])
        if a.get('status') == 'Disponible' and
        branch in a.get('skills', []) and
        (a.get('load', 0) + weight) <= CAPACITY
    ]
    # Menor carga, desempate por id
    valid.sort(key=lambda a: (a.get('load', 0), a.get('id', '')))
    choice = valid[0] if valid else None
    return {
        'weight': weight,
        'agent': choice,
        'projected': (choice['load'] + weight) if choice else None,
        'reason': 'Menor carga ponderada y skill compatible' if choice else 'Sin capacidad o skill disponible; mantener en cola'
    }

def compare_policies(agents: list, level: str, branch: str) -> dict:
    actual = route(agents, level, branch, 'actual')
    experimental = route(agents, level, branch, 'experimental')
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
    cid = case_data.get('id', 'NO-ID')
    text = (case_data.get('text', '') or '').strip()
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
    classification = classify(test_case.get('text', ''))
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
    recommendation = route(agents, classification['level'], branch, policy)
    policy_comparison = compare_policies(agents, classification['level'], branch)
    revision = compute_case_revision(test_case, policy, classification)
    initial_case_status = 'ESCALAMIENTO_REQUERIDO' if classification['level'] == 'C' else 'PENDIENTE_REVISION'

    return {
        'classification': classification,
        'guidance': guidance,
        'recommendation': recommendation,
        'policyComparison': policy_comparison,
        'revision': revision,
        'caseStatus': initial_case_status,
        'caseId': test_case.get('id', 'DEMO-???'),
        'policy': policy,
        'version': VERSION
    }

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

    # Barrera 1: Clase C o Sin Cobertura exige escalamiento obligatorio
    if level == 'C' or output.get('guidance', {}).get('id') == 'KB-NO-COBERTURA':
        return {
            'allowed': False,
            'code': 'ERR_CLASS_C_ESCALATION',
            'reason': 'Clase C o consulta sensible/desconocida exige escalamiento obligatorio a supervisor. Asignación ordinaria bloqueada por seguridad operacional.'
        }

    # Barrera 2: Modo edición sin aprobación de texto final
    if is_editing and not edit_approved:
        return {
            'allowed': False,
            'code': 'ERR_EDIT_NOT_APPROVED',
            'reason': 'El borrador se encuentra en modo edición. Debe guardar y aprobar el texto final antes de confirmar la asignación.'
        }

    # Barrera 3: Rechazo explícito
    if decision == 'Rechazar':
        return {
            'allowed': False,
            'code': 'ERR_REJECTED',
            'reason': 'La recomendación fue rechazada por el asesor. Asignación ordinaria bloqueada hasta nueva revisión.'
        }

    # Barrera 4: Escalamiento explícito
    if decision == 'Escalar':
        return {
            'allowed': False,
            'code': 'ERR_ESCALATED',
            'reason': 'El caso fue marcado para escalamiento. Asignación ordinaria bloqueada.'
        }

    # Barrera 5: Aprobación humana explícita
    has_valid_approval = (decision == 'Aceptar') or (decision == 'Editar' and edit_approved)
    if not has_valid_approval:
        return {
            'allowed': False,
            'code': 'ERR_NO_APPROVAL',
            'reason': 'Se requiere aprobación humana explícita (Aceptar o Guardar y aprobar edición) antes de confirmar la asignación.'
        }

    # Barrera 6: Coincidencia estricta de la revisión aprobada
    if not approved_revision or approved_revision != current_revision:
        return {
            'allowed': False,
            'code': 'ERR_STALE_REVISION',
            'reason': 'La aprobación registrada es obsoleta o no coincide con los parámetros/contenido actuales del caso.'
        }

    # Barrera 7: Validación de identidad IVR
    ivr_manual = bool(case_data.get('ivrManualVerified') or case_data.get('ivr_manual_verified', False))
    if not case_data.get('validated') and not ivr_manual:
        return {
            'allowed': False,
            'code': 'ERR_IVR_UNVERIFIED',
            'reason': 'Validación IVR pendiente: el asesor debe confirmar la verificación manual de identidad del titular antes de la asignación.'
        }

    # Barrera 8: Idempotencia / duplicados
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

    # Barrera 9: Revalidación en tiempo real de capacidad, estado y skill del asesor
    weight = weight_for(level, policy)
    valid_agents = [
        a for a in (agents or [])
        if a.get('status') == 'Disponible' and
        branch in a.get('skills', []) and
        (a.get('load', 0) + weight) <= CAPACITY
    ]
    valid_agents.sort(key=lambda a: (a.get('load', 0), a.get('id', '')))
    choice = valid_agents[0] if valid_agents else None

    if not choice:
        return {
            'allowed': False,
            'code': 'ERR_NO_CAPACITY_OR_SKILL',
            'reason': 'No hay capacidad disponible o no existe asesor disponible con skill compatible en este momento; mantener en cola.',
            'weight': weight
        }

    return {
        'allowed': True,
        'code': 'OK_APPROVED',
        'reason': 'Aprobación humana vigente y capacidad verificada en tiempo real.',
        'targetAgent': choice,
        'weight': weight,
        'projected': choice.get('load', 0) + weight
    }

def register_escalation(context: dict) -> dict:
    case_data = context.get('caseData') or context.get('case_data', {})
    output = context.get('output', {})
    reason = context.get('reason')
    actor_role = context.get('actorRole') or context.get('actor_role', 'Asesor WhatsApp')

    case_id = case_data.get('id', 'DEMO-???')
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
        'generatedAt': datetime.now().isoformat(),
        'disclaimer': 'Datos sintéticos para demostración académica; no contiene registros operativos reales',
        'records': records
    }, indent=2, ensure_ascii=False)
