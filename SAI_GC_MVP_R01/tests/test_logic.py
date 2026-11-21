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
    process_case, evaluate_dataset_v08, calculate_capacity_recovery, log_event, export_evidence,
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

    def test_07_weight_experimental_policy_a3_b5_c8(self):
        self.assertEqual(weight_for('A', 'experimental'), 3)
        self.assertEqual(weight_for('B', 'experimental'), 5)
        self.assertEqual(weight_for('C', 'experimental'), 8)
        self.assertEqual(weight_for('OTHER', 'experimental'), 8)

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
        self.assertEqual(cmp_res['experimental']['weight'], 8)
        self.assertEqual(cmp_res['weightDelta'], 3)
        self.assertEqual(cmp_res['maxConcurrencyActual'], 2)
        self.assertEqual(cmp_res['maxConcurrencyExperimental'], 1)

    def test_17_calculate_capacity_recovery(self):
        r1 = calculate_capacity_recovery(8000, 2.0)
        self.assertEqual(r1['hoursRecovered'], 266.7)
        r2 = calculate_capacity_recovery(8000, 3.5)
        self.assertEqual(r2['hoursRecovered'], 466.7)

    def test_18_evaluate_dataset_v08(self):
        rep = evaluate_dataset_v08()
        self.assertEqual(rep['summary']['total_cases'], 30)
        self.assertEqual(rep['summary']['class_distribution'], {'A': 10, 'B': 10, 'C': 10})

if __name__ == '__main__':
    unittest.main()
