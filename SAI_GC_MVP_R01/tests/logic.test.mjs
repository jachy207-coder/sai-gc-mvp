import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERSION,
  DATASET_VERSION,
  WEIGHT_SCHEME_VERSION,
  CAPACITY,
  EXPERIMENTAL_WEIGHTS,
  CASES,
  V08_DATASET,
  AGENTS,
  classify,
  weightFor,
  buildAgentsFromCaseState,
  route,
  comparePolicies,
  respond,
  processCase,
  evaluateDatasetV08,
  computeCaseRevision,
  canConfirmAssignment,
  registerEscalation,
  calculateCapacityRecovery,
  log_event,
  export_evidence
} from '../logic.mjs';

// --- SUITE BASE: CLASIFICACIÓN Y ROUTING ---

test('1. DEMO-001 clasifica como Clase A (constancia informativa) y detecta keyword', () => {
  const res = classify(CASES[0].text);
  assert.equal(res.level, 'A');
  assert.equal(res.risk, 'Bajo');
  assert.equal(res.ruleId, 'RULE-A-INFO');
  assert.ok(res.matchedKeywords.includes('constancia'));
});

test('2. DEMO-002 clasifica como Clase B (deuda / estado de cuenta)', () => {
  const res = classify(CASES[1].text);
  assert.equal(res.level, 'B');
  assert.equal(res.risk, 'Medio');
  assert.equal(res.ruleId, 'RULE-B-PROC');
  assert.ok(res.matchedKeywords.length >= 1);
});

test('3. DEMO-003 clasifica como Clase C (siniestro e indemnización)', () => {
  const res = classify(CASES[2].text);
  assert.equal(res.level, 'C');
  assert.equal(res.risk, 'Alto');
  assert.equal(res.ruleId, 'RULE-C-CRIT');
});

test('4. DEMO-004 clasifica como Clase C (anulación por excepción)', () => {
  const res = classify(CASES[3].text);
  assert.equal(res.level, 'C');
  assert.equal(res.risk, 'Alto');
  assert.equal(res.ruleId, 'RULE-C-CRIT');
});

test('5. DEMO-005 texto desconocido aplica escalamiento precautorio a Clase C', () => {
  const res = classify(CASES[4].text);
  assert.equal(res.level, 'C');
  assert.equal(res.risk, 'Alto');
  assert.equal(res.ruleId, 'RULE-C-FALLBACK');
  assert.equal(res.matchedKeywords.length, 0);
  assert.match(res.reason, /Baja cobertura/);
});

test('6. Texto vacío o inválido aplica escalamiento precautorio a Clase C', () => {
  const res1 = classify('');
  const res2 = classify('   ');
  const res3 = classify(null);
  assert.equal(res1.level, 'C');
  assert.equal(res2.level, 'C');
  assert.equal(res3.level, 'C');
  assert.equal(res1.ruleId, 'RULE-C-EMPTY');
});

test('7. Regla actual confirmada: peso WhatsApp = 5 independientemente de la clase', () => {
  assert.equal(weightFor('A', 'actual'), 5);
  assert.equal(weightFor('B', 'actual'), 5);
  assert.equal(weightFor('C', 'actual'), 5);
});

test('8. Política experimental v0.8 (A3_B5_C8_v1): pesos A=3, B=5, C=8', () => {
  assert.equal(WEIGHT_SCHEME_VERSION, 'A3_B5_C8_v1');
  assert.deepEqual(EXPERIMENTAL_WEIGHTS, { A: 3, B: 5, C: 8 });
  assert.equal(weightFor('A', 'experimental'), 3);
  assert.equal(weightFor('B', 'experimental'), 5);
  assert.equal(weightFor('C', 'experimental'), 8);
  assert.equal(weightFor('DESCONOCIDO', 'experimental'), 8);
});

test('9. Routing asigna al asesor disponible con menor carga y skill compatible', () => {
  const r = route(AGENTS, 'A', 'Vehicular', 'actual');
  assert.equal(r.agent.id, 'AG-01');
  assert.equal(r.projected, 5);
});

test('10. Routing excluye asesores en estado Ocupado o Refrigerio', () => {
  const r = route(AGENTS, 'A', 'Salud', 'actual');
  assert.notEqual(r.agent?.id, 'AG-03');
  assert.notEqual(r.agent?.id, 'AG-04');
  assert.equal(r.agent?.id, 'AG-01');
});

test('11. Routing no supera capacidad máxima de 10 unidades', () => {
  const single = [{ id: 'AG-02', display: 'Asesor 02', status: 'Disponible', load: 5, skills: ['Vehicular'] }];
  const r = route(single, 'C', 'Vehicular', 'experimental');
  assert.equal(r.agent, null);
  assert.match(r.reason, /Sin capacidad/);
});

test('12. DEMO-006: Saturación en cola retiene caso sin forzar asignación', () => {
  const busyAgents = AGENTS.map(a => ({ ...a, status: 'Ocupado', load: 10 }));
  const r = route(busyAgents, 'A', 'Vehicular', 'actual');
  assert.equal(r.agent, null);
  assert.match(r.reason, /Sin capacidad o skill disponible; mantener en cola/);
});

test('13. DEMO-007: Exclusión de agente en pausa preserva cola si no hay otro con skill', () => {
  const onlyPaused = [{ id: 'AG-04', display: 'Asesor 04', status: 'Refrigerio', load: 0, skills: ['Salud'] }];
  const r = route(onlyPaused, 'B', 'Salud', 'actual');
  assert.equal(r.agent, null);
});

test('14. Asistencia incluye checklist KB y diferencia validación IVR', () => {
  const respVal = respond('A', true);
  const respPend = respond('B', false);
  assert.match(respVal.text, /El bot realizó validación previa/);
  assert.match(respPend.text, /Validación pendiente/);
  assert.ok(Array.isArray(respVal.checklist));
  assert.equal(respVal.checklist.length, 3);
});

test('15. comparePolicies contrasta pesos A3/B5/C8 y concurrencias máximas', () => {
  const cmpC = comparePolicies(AGENTS, 'C', 'Vehicular');
  assert.equal(cmpC.actual.weight, 5);
  assert.equal(cmpC.experimental.weight, 8);
  assert.equal(cmpC.weightDelta, 3);
  assert.equal(cmpC.maxConcurrencyActual, 2);
  assert.equal(cmpC.maxConcurrencyExperimental, 1);

  const cmpA = comparePolicies(AGENTS, 'A', 'Vehicular');
  assert.equal(cmpA.actual.weight, 5);
  assert.equal(cmpA.experimental.weight, 3);
  assert.equal(cmpA.maxConcurrencyActual, 2);
  assert.equal(cmpA.maxConcurrencyExperimental, 3);
});

test('16. calculateCapacityRecovery aplica ecuación industrial ((V * deltaTMO) / 60)', () => {
  const r1 = calculateCapacityRecovery(8000, 2.0);
  assert.equal(r1.hoursRecovered, 266.7);
  const r2 = calculateCapacityRecovery(8000, 3.5);
  assert.equal(r2.hoursRecovered, 466.7);
});

// --- PROTOCOLO DE 15 PRUEBAS R02 (T01 a T15) ---

test('T01: Caso A con asesor libre; pulsar confirmar sin revisión humana -> Bloqueado (ERR_NO_APPROVAL)', () => {
  const c = CASES[0];
  const out = processCase(c, AGENTS, 'actual');
  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: undefined,
    approvedRevision: undefined,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_NO_APPROVAL');
});

test('T02: Caso B con asesor libre; pulsar confirmar sin revisión humana -> Bloqueado (ERR_NO_APPROVAL)', () => {
  const c = CASES[1];
  const out = processCase(c, AGENTS, 'actual');
  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: null,
    approvedRevision: null,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_NO_APPROVAL');
});

test('T03: Caso A/B; aprobar versión vigente y confirmar -> Permitido (OK_APPROVED) con asignación única', () => {
  const c = CASES[0];
  const out = processCase(c, AGENTS, 'actual');
  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: 'Aceptar',
    approvedRevision: out.revision,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, true);
  assert.equal(auth.code, 'OK_APPROVED');
  assert.equal(auth.targetAgent.id, 'AG-01');
  assert.equal(auth.projected, 5);
});

test('T04: Elegir Editar sin guardar y aprobar el texto final -> Bloqueado (ERR_EDIT_NOT_APPROVED)', () => {
  const c = CASES[0];
  const out = processCase(c, AGENTS, 'actual');
  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: 'Editar',
    approvedRevision: out.revision,
    isEditing: true,
    editApproved: false,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_EDIT_NOT_APPROVED');
});

test('T05: Elegir Rechazar y luego intentar confirmar -> Bloqueado (ERR_REJECTED)', () => {
  const c = CASES[0];
  const out = processCase(c, AGENTS, 'actual');
  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: 'Rechazar',
    approvedRevision: out.revision,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_REJECTED');
});

test('T06: Caso C (DEMO-003/004), incluso con clic forzado en Aceptar -> Bloqueado (ERR_CLASS_C_ESCALATION)', () => {
  const c = CASES[2];
  const out = processCase(c, AGENTS, 'actual');
  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: 'Aceptar',
    approvedRevision: out.revision,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_CLASS_C_ESCALATION');

  const esc = registerEscalation({ caseData: c, output: out, reason: out.classification.reason });
  assert.equal(esc.status, 'DERIVADO_SUPERVISOR');
  assert.equal(esc.level, 'C');
  assert.match(esc.targetQueue, /Supervisión/);
});

test('T07: Texto desconocido o vacío (DEMO-005) -> C precautoria y escalamiento obligatorio', () => {
  const c = CASES[4];
  const out = processCase(c, AGENTS, 'actual');
  assert.equal(out.classification.level, 'C');
  assert.equal(out.guidance.id, 'KB-NO-COBERTURA');

  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: 'Aceptar',
    approvedRevision: out.revision,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_CLASS_C_ESCALATION');
});

test('T08: Aprobar A; cambiar texto, ramo o verificación -> Aprobación anterior invalidada (ERR_STALE_REVISION)', () => {
  const cInitial = { ...CASES[0] };
  const outInitial = processCase(cInitial, AGENTS, 'actual');
  const approvedRev = outInitial.revision;

  const cModified = {
    ...cInitial,
    text: 'Requiero una copia y duplicado de constancia vehicular',
    branch: 'Vida'
  };
  const outModified = processCase(cModified, AGENTS, 'actual');
  assert.equal(outModified.classification.level, 'A');
  assert.notEqual(approvedRev, outModified.revision);

  const auth = canConfirmAssignment({
    caseData: cModified,
    output: outModified,
    decision: 'Aceptar',
    approvedRevision: approvedRev,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_STALE_REVISION');
});

test('T09: Aprobar A; cambiar política o reprocesar -> Aprobación anterior invalidada (ERR_STALE_REVISION)', () => {
  const c = CASES[0];
  const outActual = processCase(c, AGENTS, 'actual');
  const approvedRev = outActual.revision;

  const outExp = processCase(c, AGENTS, 'experimental');
  assert.notEqual(approvedRev, outExp.revision);

  const auth = canConfirmAssignment({
    caseData: c,
    output: outExp,
    decision: 'Aceptar',
    approvedRevision: approvedRev,
    agents: AGENTS,
    policy: 'experimental',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_STALE_REVISION');
});

test('T10: Cambiar estado del asesor a pausa/ocupado tras recomendar -> Bloqueado (ERR_NO_CAPACITY_OR_SKILL)', () => {
  const c = { ...CASES[0], branch: 'Salud' };
  const out = processCase(c, AGENTS, 'actual');

  const dynamicAgents = AGENTS.map(a => {
    if (a.id === 'AG-01') return { ...a, status: 'Ocupado', load: 10 };
    if (a.id === 'AG-04') return { ...a, status: 'Refrigerio' };
    return { ...a };
  });

  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: 'Aceptar',
    approvedRevision: out.revision,
    agents: dynamicAgents,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_NO_CAPACITY_OR_SKILL');
});

test('T11: Elevar carga del asesor tras recomendar -> No sobrepasa 10 unidades (ERR_NO_CAPACITY_OR_SKILL)', () => {
  const c = CASES[0];
  const out = processCase(c, AGENTS, 'actual');
  const saturatedAgents = AGENTS.map(a => (a.id === 'AG-01' ? { ...a, load: 8 } : { ...a, load: 10 }));

  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: 'Aceptar',
    approvedRevision: out.revision,
    agents: saturatedAgents,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_NO_CAPACITY_OR_SKILL');
});

test('T12: Cambiar especialidad/ramo a uno sin skill compatible -> Bloqueado (ERR_NO_CAPACITY_OR_SKILL)', () => {
  const c = { ...CASES[0], branch: 'EspecialidadInexistente' };
  const out = processCase(c, AGENTS, 'actual');
  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: 'Aceptar',
    approvedRevision: out.revision,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_NO_CAPACITY_OR_SKILL');
});

test('T13: Intentar confirmar el mismo caso dos veces -> Bloqueado por duplicado (ERR_DUPLICATE_ASSIGNMENT)', () => {
  const c = CASES[0];
  const out = processCase(c, AGENTS, 'actual');
  const activeWip = [{ id: c.id, status: 'En curso', agent: 'Asesor Demo 01' }];

  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: 'Aceptar',
    approvedRevision: out.revision,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: activeWip
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_DUPLICATE_ASSIGNMENT');
});

test('T14: Verificación IVR pendiente exige confirmación manual del asesor (R02-06)', () => {
  const cPend = CASES[1];
  const out = processCase(cPend, AGENTS, 'actual');

  const authBlocked = canConfirmAssignment({
    caseData: { ...cPend, ivrManualVerified: false },
    output: out,
    decision: 'Aceptar',
    approvedRevision: out.revision,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(authBlocked.allowed, false);
  assert.equal(authBlocked.code, 'ERR_IVR_UNVERIFIED');

  const authOk = canConfirmAssignment({
    caseData: { ...cPend, ivrManualVerified: true },
    output: out,
    decision: 'Aceptar',
    approvedRevision: out.revision,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(authOk.allowed, true);
  assert.equal(authOk.code, 'OK_APPROVED');
});

test('T15: Exportar bitácora tras aprobación, bloqueo, escalamiento e invalidación', () => {
  let logs = [];
  logs = log_event(logs, {
    caseId: 'DEMO-001',
    revision: 'rev-001',
    caseStatus: 'APROBADO',
    event: 'Decisión humana',
    level: 'A',
    source: 'KB-DEMO-001',
    action: 'Aceptar',
    result: 'PERMITIDO',
    agent: 'AG-01',
    policy: 'actual'
  });

  logs = log_event(logs, {
    caseId: 'DEMO-003',
    revision: 'rev-003',
    caseStatus: 'ESCALAMIENTO_REQUERIDO',
    event: 'Intento de asignación bloqueado',
    level: 'C',
    source: 'KB-DEMO-003',
    action: 'Aceptar',
    result: 'BLOQUEADO',
    blockReason: 'Clase C exige escalamiento obligatorio',
    agent: '—',
    policy: 'actual'
  });

  assert.equal(logs.length, 2);
  assert.equal(logs[0].version, VERSION);

  const jsonStr = export_evidence(logs, 'json');
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.app, 'SAI-GC');
  assert.equal(parsed.weightSchemeVersion, 'A3_B5_C8_v1');
  assert.equal(parsed.records.length, 2);

  const csvStr = export_evidence(logs, 'csv');
  assert.match(csvStr, /^Timestamp_ISO,Fecha_Hora,Caso,Revision/);
  assert.match(csvStr, /"BLOQUEADO"/);
  assert.match(csvStr, /"PERMITIDO"/);
});

// --- SUITE DATASET v0.8_operacion_aprobada (30 CASOS) ---

test('V08-01: Dataset v0.8 contiene 30 casos sin campos de data leakage', () => {
  assert.equal(V08_DATASET.dataset_version, 'v0.8_operacion_aprobada');
  assert.equal(V08_DATASET.cases.length, 30);
  const excluded = V08_DATASET.privacy_and_leakage_controls.excluded_fields;
  for (const c of V08_DATASET.cases) {
    for (const field of excluded) {
      assert.equal(c[field], undefined, `Campo excluido ${field} presente en ${c.case_id}`);
    }
  }
});

test('V08-02: Clasificación exacta de los 30 casos v0.8 (10 A, 10 B, 10 C)', () => {
  const report = evaluateDatasetV08(V08_DATASET);
  assert.equal(report.summary.total_cases, 30);
  assert.deepEqual(report.summary.class_distribution, { A: 10, B: 10, C: 10 });

  for (let i = 0; i < 10; i++) {
    assert.equal(report.results[i].predicted_class, 'A', `${report.results[i].case_id} debía ser A`);
  }
  for (let i = 10; i < 20; i++) {
    assert.equal(report.results[i].predicted_class, 'B', `${report.results[i].case_id} debía ser B`);
  }
  for (let i = 20; i < 30; i++) {
    assert.equal(report.results[i].predicted_class, 'C', `${report.results[i].case_id} debía ser C`);
  }
});

test('V08-03: Desempate por last_assignment_age y protección de agentes con Clase C (CASO-005 y CASO-011)', () => {
  const report = evaluateDatasetV08(V08_DATASET);
  const c05 = report.results.find(r => r.case_id === 'CASO-005');
  // En CASO-005: AGT-02 tiene un caso C (carga exp=8, carga actual=5 y age=55).
  // Regla actual asigna a AGT-02 por age=55; Experimental protege a AGT-02 y asigna a AGT-03 (carga exp=3 -> 6/10).
  assert.equal(c05.assigned_agent_actual, 'AGT-02');
  assert.equal(c05.assigned_agent_experimental, 'AGT-03');

  const c11 = report.results.find(r => r.case_id === 'CASO-011');
  assert.equal(c11.assigned_agent_actual, 'AGT-01');
  assert.equal(c11.assigned_agent_experimental, 'AGT-03');
});

test('V08-04: Exclusividad de Clase C (peso 8) evita asignar casos C a asesores con carga previa (CASO-024..026)', () => {
  const report = evaluateDatasetV08(V08_DATASET);
  for (const id of ['CASO-024', 'CASO-025', 'CASO-026']) {
    const item = report.results.find(r => r.case_id === id);
    assert.notEqual(item.assigned_agent_actual, 'EN_COLA');
    assert.equal(item.assigned_agent_experimental, 'EN_COLA');
  }
});
