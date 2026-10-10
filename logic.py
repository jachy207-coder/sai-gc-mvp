"""
SAI-GC R01 — Módulo de Lógica Pura en Python
Sistema de Asistencia Inteligente y Gestión de Capacidad
MVP Académico Demostrativo · Datos Sintéticos
"""

import re
import json
import csv
import io
from datetime import datetime

VERSION = '0.3-r01-demo'
CAPACITY = 10

KNOWLEDGE = {
    'A': {
        'id': 'KB-DEMO-001',
        'title': 'Envío de constancia · plantilla demostrativa',
        'body': 'Para solicitar una constancia, verificar identidad y cobertura con el procedimiento corporativo vigente. No afirmar el envío ni la vigencia sin comprobación.',
        'reply': 'Con gusto le ayudo con su constancia. Antes de continuar, revisaré la validación y la información disponible en el procedimiento autorizado. Le confirmaré los siguientes pasos.'
    },
    'B': {
        'id': 'KB-DEMO-002',
        'title': 'Estado de cuenta y deuda · plantilla demostrativa',
        'body': 'La información de deuda y cuotas requiere consulta a fuentes corporativas. La plantilla no contiene saldos ni datos personales.',
        'reply': 'Con gusto reviso su consulta sobre el estado de cuenta. Necesito validar los datos correspondientes y consultar el sistema autorizado antes de confirmarle importes o fechas.'
    },
    'C': {
        'id': 'KB-DEMO-003',
        'title': 'Siniestros y excepciones · control reforzado',
        'body': 'Los siniestros, indemnizaciones, anulaciones contractuales y casos sensibles requieren revisión o escalamiento. No prometer cobertura, pagos ni plazos.',
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
        'value': 'C',
        'pattern': re.compile(r'siniestro|indemniza|anulaci[oó]n|rescate|carta de garant[ií]a|fraude|queja grave|reclamo sensible|excepci[oó]n|modificaci[oó]n de p[oó]liza', re.IGNORECASE),
        'why': 'Regla de seguridad demostrativa: consulta sensible / contractual / excepción'
    },
    {
        'value': 'B',
        'pattern': re.compile(r'deuda|estado de cuenta|cuota|cobranza|renovaci[oó]n|deducible|beneficio|proveedor|factura|boleta', re.IGNORECASE),
        'why': 'Procedimiento con verificaciones o consultas a sistemas internos'
    },
    {
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
            'reason': 'Entrada vacía o inválida: escalamiento precautorio',
            'confidence': 'No estimada (reglas demostrativas)'
        }
    for rule in CLASS_RULES:
        if rule['pattern'].search(text):
            level = rule['value']
            risk = 'Alto' if level == 'C' else ('Medio' if level == 'B' else 'Bajo')
            return {
                'level': level,
                'risk': risk,
                'reason': rule['why'],
                'confidence': 'No estimada (reglas demostrativas)'
            }
    return {
        'level': 'C',
        'risk': 'Alto',
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
            'text': 'No se dispone de información suficiente en el repositorio de prueba. El asesor debe revisar y escalar; no generar una respuesta de contenido.'
        }
    recommendation = route(agents, classification['level'], test_case.get('branch', 'Vehicular'), policy)
    return {
        'classification': classification,
        'guidance': guidance,
        'recommendation': recommendation,
        'caseId': test_case.get('id', 'DEMO-???'),
        'policy': policy,
        'version': VERSION
    }

def log_event(logs: list, entry: dict) -> list:
    time_str = entry.get('time') or datetime.now().strftime('%d/%m/%Y, %H:%M:%S')
    record = {
        'time': time_str,
        'case': entry.get('caseId') or entry.get('case', '—'),
        'event': entry.get('event', 'Evento'),
        'level': entry.get('level', '—'),
        'source': entry.get('source', '—'),
        'action': entry.get('action', '—'),
        'agent': entry.get('agent', '—'),
        'policy': entry.get('policy', 'actual'),
        'version': entry.get('version', VERSION)
    }
    return [record] + list(logs or [])

def export_evidence(logs: list, fmt: str = 'json') -> str:
    records = logs or []
    if fmt == 'csv':
        output = io.StringIO()
        fieldnames = ['Fecha_Hora', 'Caso', 'Evento', 'Clase', 'Fuente', 'Decision_Humana', 'Asesor_Routing', 'Politica', 'Version']
        writer = csv.writer(output, quoting=csv.QUOTE_ALL)
        writer.writerow(fieldnames)
        for r in records:
            writer.writerow([
                r.get('time', ''),
                r.get('case', ''),
                r.get('event', ''),
                r.get('level', ''),
                r.get('source', ''),
                r.get('action', ''),
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
