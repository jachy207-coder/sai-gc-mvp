"""
Pruebas Unitarias en Python para SAI-GC (unittest estándar)
Ejecución: python -m unittest tests/test_logic.py
"""

import unittest
import json
import os
import sys

# Agregar directorio raíz al path para importar módulos locales
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from logic import (
    VERSION, CAPACITY, CASES, AGENTS,
    classify, weight_for, route, compare_policies, respond,
    process_case, calculate_capacity_recovery, log_event, export_evidence,
    compute_case_revision, can_confirm_assignment, register_escalation
)
from database import init_db, insert_log, fetch_logs, clear_logs, export_db_evidence

class TestSaiGcLogic(unittest.TestCase):

    def test_01_classify_case_a(self):
        res = classify(CASES[0]['text'])
        self.assertEqual(res['level'], 'A')
        self.assertEqual(res['risk'], 'Bajo')
        self.assertEqual(res['ruleId'], 'RULE-A-INFO')
        self.assertIn('constancia', res['matchedKeywords'])

    def test_02_classify_case_b(self):
        res = classify(CASES[1]['text'])
        self.assertEqual(res['level'], 'B')
        self.assertEqual(res['risk'], 'Medio')
        self.assertEqual(res['ruleId'], 'RULE-B-PROC')
        self.assertTrue(len(res['matchedKeywords']) >= 1)

    def test_03_classify_case_c(self):
        res = classify(CASES[2]['text'])
        self.assertEqual(res['level'], 'C')
        self.assertEqual(res['risk'], 'Alto')
        self.assertEqual(res['ruleId'], 'RULE-C-CRIT')

    def test_04_classify_unknown_text_escalates_to_c(self):
        res = classify(CASES[4]['text'])
        self.assertEqual(res['level'], 'C')
        self.assertEqual(res['risk'], 'Alto')
        self.assertEqual(res['ruleId'], 'RULE-C-FALLBACK')
        self.assertEqual(len(res['matchedKeywords']), 0)
        self.assertIn('Baja cobertura', res['reason'])

    def test_05_classify_empty_text_escalates_to_c(self):
        res1 = classify('')
        res2 = classify('   ')
        res3 = classify(None)
        self.assertEqual(res1['level'], 'C')
        self.assertEqual(res2['level'], 'C')
        self.assertEqual(res3['level'], 'C')
        self.assertEqual(res1['ruleId'], 'RULE-C-EMPTY')

    def test_06_weight_actual_policy(self):
        self.assertEqual(weight_for('A', 'actual'), 5)
        self.assertEqual(weight_for('B', 'actual'), 5)
        self.assertEqual(weight_for('C', 'actual'), 5)

    def test_07_weight_experimental_policy(self):
        self.assertEqual(weight_for('A', 'experimental'), 4)
        self.assertEqual(weight_for('B', 'experimental'), 5)
        self.assertEqual(weight_for('C', 'experimental'), 7)
        self.assertEqual(weight_for('OTHER', 'experimental'), 7)

    def test_08_route_selects_lowest_load_with_skill(self):
        r = route(AGENTS, 'C', 'Vehicular', 'actual')
        self.assertIsNotNone(r['agent'])
        self.assertEqual(r['agent']['id'], 'AG-01')
        self.assertEqual(r['projected'], 5)

    def test_09_route_excludes_busy_and_paused_agents(self):
        r = route(AGENTS, 'A', 'Salud', 'actual')
        self.assertIsNotNone(r['agent'])
        self.assertEqual(r['agent']['id'], 'AG-01')
        self.assertNotEqual(r['agent']['id'], 'AG-03')
        self.assertNotEqual(r['agent']['id'], 'AG-04')

    def test_10_route_respects_capacity_limit_ten(self):
        single_agent = [{'id': 'AG-02', 'display': 'Asesor 02', 'status': 'Disponible', 'load': 5, 'skills': ['Vehicular']}]
        r = route(single_agent, 'C', 'Vehicular', 'experimental')
        self.assertIsNone(r['agent'])
        self.assertIn('Sin capacidad', r['reason'])

    def test_11_route_all_busy_retains_in_queue(self):
        busy = [{'id': f'AG-0{i}', 'display': f'Asesor {i}', 'status': 'Ocupado', 'load': 10, 'skills': ['Vehicular']} for i in range(1, 5)]
        r = route(busy, 'A', 'Vehicular', 'actual')
        self.assertIsNone(r['agent'])
        self.assertIn('mantener en cola', r['reason'])

    def test_12_respond_differentiates_validation_and_has_checklist(self):
        r_val = respond('A', True)
        r_pend = respond('B', False)
        self.assertIn('El bot realizó validación previa', r_val['text'])
        self.assertIn('Validación pendiente', r_pend['text'])
        self.assertEqual(len(r_val['checklist']), 3)

    def test_13_process_case_without_coverage_requires_escalation(self):
        res = process_case(CASES[4], AGENTS, 'actual')
        self.assertEqual(res['classification']['level'], 'C')
        self.assertEqual(res['guidance']['id'], 'KB-NO-COBERTURA')
        self.assertIn('escalar', res['guidance']['text'])

    def test_14_sqlite_database_operations(self):
        init_db()
        clear_logs()
        insert_log({
            'time': '09/10/2026, 18:00:00',
            'case': 'DEMO-001',
            'event': 'Triaje y recomendación',
            'level': 'A',
            'source': 'KB-DEMO-001',
            'action': 'Aceptar',
            'agent': 'Asesor Demo 01',
            'policy': 'actual',
            'version': VERSION
        })
        logs = fetch_logs(limit=10)
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]['caso'], 'DEMO-001')
        
        json_export = export_db_evidence('json')
        self.assertIn('SAI-GC', json_export)
        
        csv_export = export_db_evidence('csv')
        self.assertIn('DEMO-001', csv_export)

    def test_15_export_evidence_formatting(self):
        mock_logs = [{'time': '09/10/2026', 'case': 'DEMO-003', 'event': 'Decisión humana', 'level': 'C', 'source': 'KB-DEMO-003', 'action': 'Escalar', 'agent': 'AG-01', 'policy': 'actual', 'version': VERSION}]
        json_res = export_evidence(mock_logs, 'json')
        parsed = json.loads(json_res)
        self.assertEqual(parsed['records'][0]['level'], 'C')

        csv_res = export_evidence(mock_logs, 'csv')
        self.assertIn('"DEMO-003"', csv_res)
        self.assertIn('"Escalar"', csv_res)

    def test_16_compare_policies(self):
        cmp_res = compare_policies(AGENTS, 'C', 'Vehicular')
        self.assertEqual(cmp_res['actual']['weight'], 5)
        self.assertEqual(cmp_res['experimental']['weight'], 7)
        self.assertEqual(cmp_res['weightDelta'], 2)
        self.assertEqual(cmp_res['maxConcurrencyActual'], 2)
        self.assertEqual(cmp_res['maxConcurrencyExperimental'], 1)

    def test_17_calculate_capacity_recovery(self):
        r1 = calculate_capacity_recovery(8000, 2.0)
        self.assertEqual(r1['hoursRecovered'], 266.7)
        r2 = calculate_capacity_recovery(8000, 3.5)
        self.assertEqual(r2['hoursRecovered'], 466.7)

    # --- PROTOCOLO DE 15 PRUEBAS R02 (T01 a T15) ---

    def test_T01_no_approval_case_a_blocked(self):
        c = CASES[0]
        out = process_case(c, AGENTS, 'actual')
        auth = can_confirm_assignment({
            'caseData': c,
            'output': out,
            'decision': None,
            'approvedRevision': None,
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_NO_APPROVAL')

    def test_T02_no_approval_case_b_blocked(self):
        c = CASES[1]
        out = process_case(c, AGENTS, 'actual')
        auth = can_confirm_assignment({
            'caseData': c,
            'output': out,
            'decision': None,
            'approvedRevision': None,
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_NO_APPROVAL')

    def test_T03_valid_approval_allowed(self):
        c = CASES[0]
        out = process_case(c, AGENTS, 'actual')
        auth = can_confirm_assignment({
            'caseData': c,
            'output': out,
            'decision': 'Aceptar',
            'approvedRevision': out['revision'],
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertTrue(auth['allowed'])
        self.assertEqual(auth['code'], 'OK_APPROVED')
        self.assertEqual(auth['targetAgent']['id'], 'AG-01')
        self.assertEqual(auth['projected'], 5)

    def test_T04_edit_without_save_approval_blocked(self):
        c = CASES[0]
        out = process_case(c, AGENTS, 'actual')
        auth = can_confirm_assignment({
            'caseData': c,
            'output': out,
            'decision': 'Editar',
            'approvedRevision': out['revision'],
            'isEditing': True,
            'editApproved': False,
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_EDIT_NOT_APPROVED')

    def test_T05_rejected_recommendation_blocked(self):
        c = CASES[0]
        out = process_case(c, AGENTS, 'actual')
        auth = can_confirm_assignment({
            'caseData': c,
            'output': out,
            'decision': 'Rechazar',
            'approvedRevision': out['revision'],
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_REJECTED')

    def test_T06_class_c_escalation_mandatory(self):
        c = CASES[2]
        out = process_case(c, AGENTS, 'actual')
        auth = can_confirm_assignment({
            'caseData': c,
            'output': out,
            'decision': 'Aceptar',
            'approvedRevision': out['revision'],
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_CLASS_C_ESCALATION')

        esc = register_escalation({'caseData': c, 'output': out, 'reason': out['classification']['reason']})
        self.assertEqual(esc['status'], 'DERIVADO_SUPERVISOR')
        self.assertEqual(esc['level'], 'C')
        self.assertIn('Supervisión', esc['targetQueue'])

    def test_T07_unknown_text_escalates_mandatory(self):
        c = CASES[4]
        out = process_case(c, AGENTS, 'actual')
        self.assertEqual(out['classification']['level'], 'C')
        self.assertEqual(out['guidance']['id'], 'KB-NO-COBERTURA')

        auth = can_confirm_assignment({
            'caseData': c,
            'output': out,
            'decision': 'Aceptar',
            'approvedRevision': out['revision'],
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_CLASS_C_ESCALATION')

    def test_T08_stale_revision_on_data_mutation(self):
        c_initial = dict(CASES[0])
        out_initial = process_case(c_initial, AGENTS, 'actual')
        approved_rev = out_initial['revision']

        c_modified = dict(c_initial)
        c_modified['text'] = 'Requiero una copia y duplicado de constancia vehicular'
        c_modified['branch'] = 'Vida'

        out_modified = process_case(c_modified, AGENTS, 'actual')
        self.assertEqual(out_modified['classification']['level'], 'A')
        self.assertNotEqual(approved_rev, out_modified['revision'])

        auth = can_confirm_assignment({
            'caseData': c_modified,
            'output': out_modified,
            'decision': 'Aceptar',
            'approvedRevision': approved_rev,
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_STALE_REVISION')

    def test_T09_stale_revision_on_policy_change(self):
        c = CASES[0]
        out_actual = process_case(c, AGENTS, 'actual')
        approved_rev = out_actual['revision']

        out_exp = process_case(c, AGENTS, 'experimental')
        self.assertNotEqual(approved_rev, out_exp['revision'])

        auth = can_confirm_assignment({
            'caseData': c,
            'output': out_exp,
            'decision': 'Aceptar',
            'approvedRevision': approved_rev,
            'agents': AGENTS,
            'policy': 'experimental',
            'activeAssignments': []
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_STALE_REVISION')

    def test_T10_agent_pause_or_busy_blocked(self):
        c = dict(CASES[0])
        c['branch'] = 'Salud'
        out = process_case(c, AGENTS, 'actual')

        dynamic_agents = []
        for a in AGENTS:
            item = dict(a)
            if item['id'] == 'AG-01':
                item['status'] = 'Ocupado'
                item['load'] = 10
            elif item['id'] == 'AG-04':
                item['status'] = 'Refrigerio'
            dynamic_agents.append(item)

        auth = can_confirm_assignment({
            'caseData': c,
            'output': out,
            'decision': 'Aceptar',
            'approvedRevision': out['revision'],
            'agents': dynamic_agents,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_NO_CAPACITY_OR_SKILL')

    def test_T11_saturated_agent_load_limit(self):
        c = CASES[0]
        out = process_case(c, AGENTS, 'actual')

        saturated_agents = [
            dict(a, load=8 if a['id'] == 'AG-01' else 10)
            for a in AGENTS
        ]

        auth = can_confirm_assignment({
            'caseData': c,
            'output': out,
            'decision': 'Aceptar',
            'approvedRevision': out['revision'],
            'agents': saturated_agents,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_NO_CAPACITY_OR_SKILL')

    def test_T12_incompatible_branch_skill_blocked(self):
        c = dict(CASES[0])
        c['branch'] = 'EspecialidadInexistente'
        out = process_case(c, AGENTS, 'actual')

        auth = can_confirm_assignment({
            'caseData': c,
            'output': out,
            'decision': 'Aceptar',
            'approvedRevision': out['revision'],
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_NO_CAPACITY_OR_SKILL')

    def test_T13_duplicate_assignment_blocked(self):
        c = CASES[0]
        out = process_case(c, AGENTS, 'actual')

        active_wip = [
            {'id': c['id'], 'status': 'En curso', 'agent': 'Asesor Demo 01'}
        ]

        auth = can_confirm_assignment({
            'caseData': c,
            'output': out,
            'decision': 'Aceptar',
            'approvedRevision': out['revision'],
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': active_wip
        })
        self.assertFalse(auth['allowed'])
        self.assertEqual(auth['code'], 'ERR_DUPLICATE_ASSIGNMENT')

    def test_T14_ivr_manual_verification_enforced(self):
        c_pend = CASES[1]
        out = process_case(c_pend, AGENTS, 'actual')

        c_blocked = dict(c_pend, ivrManualVerified=False)
        auth_blocked = can_confirm_assignment({
            'caseData': c_blocked,
            'output': out,
            'decision': 'Aceptar',
            'approvedRevision': out['revision'],
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertFalse(auth_blocked['allowed'])
        self.assertEqual(auth_blocked['code'], 'ERR_IVR_UNVERIFIED')

        c_ok = dict(c_pend, ivrManualVerified=True)
        auth_ok = can_confirm_assignment({
            'caseData': c_ok,
            'output': out,
            'decision': 'Aceptar',
            'approvedRevision': out['revision'],
            'agents': AGENTS,
            'policy': 'actual',
            'activeAssignments': []
        })
        self.assertTrue(auth_ok['allowed'])
        self.assertEqual(auth_ok['code'], 'OK_APPROVED')

    def test_T15_evidence_export_traceability(self):
        logs = []
        logs = log_event(logs, {
            'caseId': 'DEMO-001',
            'revision': 'rev-001',
            'caseStatus': 'APROBADO',
            'event': 'Decisión humana',
            'level': 'A',
            'source': 'KB-DEMO-001',
            'action': 'Aceptar',
            'result': 'PERMITIDO',
            'agent': 'AG-01',
            'policy': 'actual'
        })
        logs = log_event(logs, {
            'caseId': 'DEMO-003',
            'revision': 'rev-003',
            'caseStatus': 'ESCALAMIENTO_REQUERIDO',
            'event': 'Intento de asignación bloqueado',
            'level': 'C',
            'source': 'KB-DEMO-003',
            'action': 'Aceptar',
            'result': 'BLOQUEADO',
            'blockReason': 'Clase C exige escalamiento obligatorio',
            'agent': '—',
            'policy': 'actual'
        })

        self.assertEqual(len(logs), 2)
        self.assertEqual(logs[0]['version'], VERSION)

        json_str = export_evidence(logs, 'json')
        parsed = json.loads(json_str)
        self.assertEqual(parsed['app'], 'SAI-GC')
        self.assertEqual(len(parsed['records']), 2)

        csv_str = export_evidence(logs, 'csv')
        self.assertTrue(csv_str.startswith('Timestamp_ISO,Fecha_Hora,Caso,Revision'))
        self.assertIn('"BLOQUEADO"', csv_str)
        self.assertIn('"PERMITIDO"', csv_str)
        self.assertIn('"Clase C exige escalamiento obligatorio"', csv_str)

if __name__ == '__main__':
    unittest.main()
