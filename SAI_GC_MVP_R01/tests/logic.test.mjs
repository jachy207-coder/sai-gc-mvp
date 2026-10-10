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
  respond,
  processCase,
  log_event,
  export_evidence
} from '../logic.mjs';

test('1. DEMO-001 clasifica como Clase A (constancia informativa)', () => {
  const res = classify(CASES[0].text);
  assert.equal(res.level, 'A');
  assert.equal(res.risk, 'Bajo');
});

test('2. DEMO-002 clasifica como Clase B (deuda / estado de cuenta)', () => {
  const res = classify(CASES[1].text);
  assert.equal(res.level, 'B');
  assert.equal(res.risk, 'Medio');
});

test('3. DEMO-003 clasifica como Clase C (siniestro e indemnización)', () => {
  const res = classify(CASES[2].text);
  assert.equal(res.level, 'C');
  assert.equal(res.risk, 'Alto');
});

test('4. DEMO-004 clasifica como Clase C (anulación por excepción)', () => {
  const res = classify(CASES[3].text);
  assert.equal(res.level, 'C');
  assert.equal(res.risk, 'Alto');
});

test('5. DEMO-005 texto desconocido aplica escalamiento precautorio a Clase C', () => {
  const res = classify(CASES[4].text);
  assert.equal(res.level, 'C');
  assert.equal(res.risk, 'Alto');
  assert.match(res.reason, /Baja cobertura/);
});

test('6. Texto vacío o inválido aplica escalamiento precautorio a Clase C', () => {
  const res1 = classify('');
  const res2 = classify('   ');
  const res3 = classify(null);
  assert.equal(res1.level, 'C');
  assert.equal(res2.level, 'C');
  assert.equal(res3.level, 'C');
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
  // AG-01 carga 0, AG-02 carga 5 -> elige AG-01
  const r = route(AGENTS, 'C', 'Vehicular', 'actual');
  assert.equal(r.agent.id, 'AG-01');
  assert.equal(r.projected, 5);
});

test('10. Routing excluye asesores en estado Ocupado o Refrigerio', () => {
  // AG-03 es Ocupado, AG-04 es Refrigerio
  const r = route(AGENTS, 'A', 'Salud', 'actual');
  assert.notEqual(r.agent?.id, 'AG-03');
  assert.notEqual(r.agent?.id, 'AG-04');
  assert.equal(r.agent?.id, 'AG-01');
});

test('11. Routing no supera capacidad máxima de 10 unidades', () => {
  // Si AG-02 tiene carga 5 y peso es 7 (experimental C), 5 + 7 = 12 > 10, no es elegible
  const r = route([{ id: 'AG-02', display: 'Asesor 02', status: 'Disponible', load: 5, skills: ['Vehicular'] }], 'C', 'Vehicular', 'experimental');
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
  const onlyPausedAgent = [
    { id: 'AG-04', display: 'Asesor 04', status: 'Refrigerio', load: 0, skills: ['Salud'] }
  ];
  const r = route(onlyPausedAgent, 'B', 'Salud', 'actual');
  assert.equal(r.agent, null);
});

test('14. Asistencia diferencia validación completada por bot vs pendiente por asesor', () => {
  const respVal = respond('A', true);
  const respPend = respond('B', false);
  assert.match(respVal.text, /El bot realizó validación previa/);
  assert.match(respPend.text, /Validación pendiente/);
});

test('15. DEMO-005 en processCase no inventa fuente y exige escalamiento', () => {
  const res = processCase(CASES[4], AGENTS, 'actual');
  assert.equal(res.classification.level, 'C');
  assert.equal(res.guidance.id, 'KB-NO-COBERTURA');
  assert.match(res.guidance.text, /escalar/);
});

test('16. log_event y export_evidence generan trazabilidad JSON y CSV estructurada', () => {
  let logs = [];
  logs = log_event(logs, {
    caseId: 'DEMO-001',
    event: 'Triaje y recomendación',
    level: 'A',
    source: 'KB-DEMO-001',
    action: 'Aceptar',
    agent: 'Asesor Demo 01',
    policy: 'actual'
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].version, VERSION);

  const jsonStr = export_evidence(logs, 'json');
  const jsonParsed = JSON.parse(jsonStr);
  assert.equal(jsonParsed.app, 'SAI-GC');
  assert.equal(jsonParsed.records.length, 1);

  const csvStr = export_evidence(logs, 'csv');
  assert.match(csvStr, /^Fecha_Hora,Caso,Evento,Clase/);
  assert.match(csvStr, /"DEMO-001"/);
  assert.match(csvStr, /"KB-DEMO-001"/);
});
