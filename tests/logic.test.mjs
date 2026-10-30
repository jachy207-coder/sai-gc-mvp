import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERSION,
  CAPACITY,
  CASES,
  AGENTS,
  classify,
  weightFor,
  route,
  comparePolicies,
  respond,
  processCase,
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

test('8. Política experimental: pesos A=4, B=5, C=7 ilustrativos', () => {
  assert.equal(weightFor('A', 'experimental'), 4);
  assert.equal(weightFor('B', 'experimental'), 5);
  assert.equal(weightFor('C', 'experimental'), 7);
  assert.equal(weightFor('DESCONOCIDO', 'experimental'), 7);
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

test('15. comparePolicies contrasta pesos y concurrencias máximas', () => {
  const cmp = comparePolicies(AGENTS, 'C', 'Vehicular');
  assert.equal(cmp.actual.weight, 5);
  assert.equal(cmp.experimental.weight, 7);
  assert.equal(cmp.weightDelta, 2);
  assert.equal(cmp.maxConcurrencyActual, 2);
  assert.equal(cmp.maxConcurrencyExperimental, 1);
});

test('16. calculateCapacityRecovery aplica ecuación industrial ((V * deltaTMO) / 60)', () => {
  const r1 = calculateCapacityRecovery(8000, 2.0);
  assert.equal(r1.hoursRecovered, 266.7);
  const r2 = calculateCapacityRecovery(8000, 3.5);
  assert.equal(r2.hoursRecovered, 466.7);
});

// --- PROTOCOLO DE 15 PRUEBAS R02 (T01 a T15) ---

test('T01: Caso A con asesor libre; pulsar confirmar sin revisión humana -> Bloqueado (ERR_NO_APPROVAL)', () => {
  const c = CASES[0]; // DEMO-001 (Clase A)
  const out = processCase(c, AGENTS, 'actual');
  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: undefined, // Sin decisión previa
    approvedRevision: undefined,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_NO_APPROVAL');
});

test('T02: Caso B con asesor libre; pulsar confirmar sin revisión humana -> Bloqueado (ERR_NO_APPROVAL)', () => {
  const c = CASES[1]; // DEMO-002 (Clase B)
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
  const c = CASES[0]; // DEMO-001 (Clase A, validated: true)
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
    editApproved: false, // No se pulsó "Guardar y aprobar"
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
  const c = CASES[2]; // DEMO-003 (Clase C)
  const out = processCase(c, AGENTS, 'actual');
  const auth = canConfirmAssignment({
    caseData: c,
    output: out,
    decision: 'Aceptar', // Intento de aceptar caso C
    approvedRevision: out.revision,
    agents: AGENTS,
    policy: 'actual',
    activeAssignments: []
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'ERR_CLASS_C_ESCALATION');

  // Verificar que la ruta de escalamiento opera correctamente
  const esc = registerEscalation({ caseData: c, output: out, reason: out.classification.reason });
  assert.equal(esc.status, 'DERIVADO_SUPERVISOR');
  assert.equal(esc.level, 'C');
  assert.match(esc.targetQueue, /Supervisión/);
});

test('T07: Texto desconocido o vacío (DEMO-005) -> C precautoria y escalamiento obligatorio', () => {
  const c = CASES[4]; // DEMO-005
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

  // El usuario altera el texto (conservando Clase A) y el ramo después de aprobar
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
    approvedRevision: approvedRev, // huella obsoleta
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

  // Cambia la política a experimental
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
  const c = { ...CASES[0], branch: 'Salud' }; // Asesor AG-01 y AG-04 tienen Salud
  const out = processCase(c, AGENTS, 'actual');

  // Mutación de estado en vivo: AG-01 pasa a Ocupado y AG-04 a Refrigerio
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
  const c = CASES[0]; // peso 5
  const out = processCase(c, AGENTS, 'actual');

  // El asesor AG-01 recibió carga en paralelo y ahora tiene 8/10
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

  const activeWip = [
    { id: c.id, status: 'En curso', agent: 'Asesor Demo 01' }
  ];

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
  const cPend = CASES[1]; // DEMO-002 (validated: false)
  const out = processCase(cPend, AGENTS, 'actual');

  // Intento de confirmar sin marcar verificación manual
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

  // Tras marcar verificación manual por el asesor
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
  assert.equal(parsed.records.length, 2);

  const csvStr = export_evidence(logs, 'csv');
  assert.match(csvStr, /^Timestamp_ISO,Fecha_Hora,Caso,Revision/);
  assert.match(csvStr, /"BLOQUEADO"/);
  assert.match(csvStr, /"PERMITIDO"/);
  assert.match(csvStr, /"Clase C exige escalamiento obligatorio"/);
});
