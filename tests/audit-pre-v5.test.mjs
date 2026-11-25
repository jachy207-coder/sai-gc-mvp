import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { V08_DATASET } from '../logic.mjs';
import {
  VALIDATION_VERSION, VERSION_HISTORY, ESCALATION_STATES,
  AUDIT_FIELDS, validateV08Input, buildBatchEvidence,
  buildAuditRecord, exportAuditCSV, exportAuditJSON,
  buildEventEvidence, createBatchId, createAuditRunId, createEventId,
  resolveEscalationState, createValidationSession, startNewValidationBatch
} from '../audit-pre-v5.mjs';

test('PV5-01: JSON de 30 casos sin filtración del gold standard', () => {
  assert.equal(validateV08Input(V08_DATASET),true);
});
test('PV5-02: Los 29 campos mínimos más complementarios están presentes', () => {
  for (const x of ['ID_Ejecucion','Version_MVP','Version_Dataset','Version_Pesos','Clase_Observada','Peso_Asignado',
    'Capacidad_Nominal','Sesiones_Activas_Por_Agente','Clases_Activas_Por_Agente','Antiguedad_Ultima_Asignacion',
    'Carga_Actual_Fija_Por_Agente','Carga_Proyectada_Fija_Por_Agente','Agentes_Elegibles_Fijo_5',
    'Agente_Recomendado_Fijo_5','Caso_En_Cola_Fijo_5','Carga_Actual_358_Por_Agente',
    'Carga_Proyectada_358_Por_Agente','Agentes_Elegibles_358','Agente_Recomendado_358','Caso_En_Cola_358',
    'Respuesta_Sugerida','Decision_Humana','Respuesta_Automatica_Bloqueada',
    'Revision_Humana_Requerida','Escalamiento_Requerido','Escalamiento_Realizado',
    'Latencia_Total_Milisegundos','Estado_Ejecucion','Mensaje_Error']) {
    assert.ok(AUDIT_FIELDS.includes(x),x);
  }
});
test('PV5-03: Exportación 30 casos preserva 10/10/10 y ambas políticas', () => {
  const evidence=buildBatchEvidence(V08_DATASET,{runId:'CONTROL-001'});
  assert.equal(evidence.records.length,30);
  assert.deepEqual(evidence.summary.class_distribution,{A:10,B:10,C:10});
  assert.equal(evidence.summary.routing_comparison.routing_differences,8);
  assert.deepEqual(evidence.summary.routing_comparison,{actual_assigned:26,actual_queued:4,experimental_assigned:23,experimental_queued:7,routing_differences:8});
  assert.equal(evidence.records[0].Carga_Actual_Fija_Por_Agente['AGT-02'],5);
  assert.equal(evidence.records[0].Carga_Actual_358_Por_Agente['AGT-03'],8);
});
test('PV5-04: No inventa decisiones humanas, ni escalamiento hecho', () => {
  const e=buildBatchEvidence(V08_DATASET,{runId:'CONTROL-001'});
  assert.equal(e.records.filter(x=>x.Decision_Humana==='SIN_EJECUTAR').length,30);
  assert.equal(e.records.filter(x=>x.Escalamiento_Requerido).length,10);
  assert.equal(e.records.filter(x=>x.Escalamiento_Realizado==='SIMULADO_EN_MVP').length,0);
  assert.equal(e.records.filter(x=>x.Estado_Ejecucion==='CALCULO_TECNICO_NO_V5').length,30);
});
test('PV5-05: Los casos C conservan control reforzado y sin asignación ordinaria', () => {
  const rows=buildBatchEvidence(V08_DATASET,{runId:'CONTROL-001'}).records;
  for(const r of rows.filter(x=>x.Clase_Observada==='C')){
    assert.equal(r.Respuesta_Automatica_Bloqueada,true);
    assert.equal(r.Revision_Humana_Requerida,true);
  }
});
test('PV5-06: Latencia del motor queda medida sin confundirla con TMO', () => {
  const rows=buildBatchEvidence(V08_DATASET,{runId:'CONTROL-001'}).records;
  assert.equal(rows.filter(r=>Number.isFinite(r.Latencia_Total_Milisegundos)).length,30);
  assert.match(rows[0].Metodo_Latencia,/NO es TMO/);
});
test('PV5-07: CSV y JSON contienen las columnas y los mismos 30 registros', () => {
  const e=buildBatchEvidence(V08_DATASET,{runId:'CONTROL-001'});
  const csv=exportAuditCSV(e.records);
  assert.ok(csv.charCodeAt(0)===0xFEFF);
  assert.match(csv,/Agentes_Elegibles_358/);
  assert.equal(csv.split('\r\n').length,31);
  assert.equal(JSON.parse(exportAuditJSON(e)).records.length,30);
});
test('PV5-08: Validador impide incluir clase esperada en JSON', () => {
  const copy=structuredClone(V08_DATASET);
  copy.cases[0].expected_class='A';
  assert.throws(()=>validateV08Input(copy),/prohibido/);
});
test('PV5-09: Bitácora interactiva registra escalamiento solo si fue ejecutado', () => {
  const base = {
    batchId: 'LOTE-CONTROL-001',
    runId: 'EJEC-CONTROL-001',
    eventId: 'EVT-001',
    testCase: V08_DATASET.cases[20],
    output: { classification: { level: 'C' }, guidance: { text: 'Prueba' }, revision: 'rev-test' },
    event: 'Escalamiento registrado',
    status: 'DERIVADO_SUPERVISOR'
  };
  assert.equal(buildAuditRecord(base).Escalamiento_Realizado, ESCALATION_STATES.PENDIENTE);
  assert.equal(buildAuditRecord({ ...base, escalationPerformed: true }).Escalamiento_Realizado, ESCALATION_STATES.REALIZADO);
  const rows = buildEventEvidence([{ case: 'CASO-021', extendedPreV5: buildAuditRecord({ ...base, escalationPerformed: true }) }], 'LOTE-CONTROL-001');
  assert.equal(rows.records.length, 1);
  assert.equal(rows.records[0].ID_Lote, 'LOTE-CONTROL-001');
});
test('PV5-10: Selector no anticipa clases y etiqueta V5 como pendiente', () => {
  const script = fs.readFileSync(new URL('../script.mjs', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /Lote v0\.8 \(Clase \$\{cl\.level\}\)/);
  assert.match(script, /name: `\$\{c\.query_text\.slice\(0, 72\)\}/);
  assert.match(index, /prevalidaci[oó]n t[eé]cnica/i);
});
test('PV5-11: Registro de corrida independiente', () => {
  assert.notEqual(createAuditRunId(), createAuditRunId());
});

test('V10-01: Relación jerárquica ID_Lote -> ID_Ejecucion único -> ID_Evento en CSV y JSON', () => {
  const batchId = createBatchId('LOTE-TEST');
  const evidence = buildBatchEvidence(V08_DATASET, { batchId });
  assert.equal(evidence.ID_Lote, batchId);
  assert.equal(evidence.batchId, batchId);
  assert.equal(evidence.records.length, 30);

  const uniqueLotes = new Set(evidence.records.map(r => r.ID_Lote));
  const uniqueRuns = new Set(evidence.records.map(r => r.ID_Ejecucion));
  const uniqueEvents = new Set(evidence.records.map(r => r.ID_Evento));
  assert.equal(uniqueLotes.size, 1);
  assert.ok(uniqueLotes.has(batchId));
  assert.equal(uniqueRuns.size, 30);
  assert.equal(uniqueEvents.size, 30);

  const csv = exportAuditCSV(evidence.records);
  const lines = csv.split('\r\n');
  assert.match(lines[0], /^\uFEFFID_Lote,ID_Ejecucion,ID_Evento,/);
  assert.equal(lines.length, 31);
  for (let i = 1; i <= 30; i++) {
    assert.ok(lines[i].includes(`"${batchId}"`));
    assert.ok(lines[i].includes(`"${evidence.records[i - 1].ID_Ejecucion}"`));
    assert.ok(lines[i].includes(`"${evidence.records[i - 1].ID_Evento}"`));
  }

  const parsed = JSON.parse(exportAuditJSON(evidence));
  assert.equal(parsed.ID_Lote, batchId);
  assert.equal(parsed.records[0].ID_Lote, batchId);
  assert.equal(parsed.records[0].ID_Ejecucion, evidence.records[0].ID_Ejecucion);
  assert.equal(parsed.records[0].ID_Evento, 'BATCH-001');
});

test('V10-02: Estados estrictos de Escalamiento_Realizado e incidencia por escalamiento inesperado', () => {
  // 1. NO_APLICA únicamente cuando no es requerido y no se realiza (Clase A y B)
  const rA = buildAuditRecord({
    batchId: 'LOTE-1', runId: 'EJEC-1', eventId: 'EVT-001',
    testCase: V08_DATASET.cases[0],
    output: { classification: { level: 'A' }, guidance: { text: 'Ok' }, revision: 'r1' },
    escalationPerformed: false
  });
  assert.equal(rA.Escalamiento_Requerido, false);
  assert.equal(rA.Escalamiento_Realizado, 'NO_APLICA');
  assert.equal(rA.Incidencia_Escalamiento, null);

  // 2. PENDIENTE cuando es requerido (Clase C) y todavía no se registra
  const rCPending = buildAuditRecord({
    batchId: 'LOTE-1', runId: 'EJEC-2', eventId: 'EVT-002',
    testCase: V08_DATASET.cases[20],
    output: { classification: { level: 'C' }, guidance: { text: 'Escalar' }, revision: 'r2' },
    escalationPerformed: false
  });
  assert.equal(rCPending.Escalamiento_Requerido, true);
  assert.equal(rCPending.Escalamiento_Realizado, 'PENDIENTE');
  assert.equal(rCPending.Incidencia_Escalamiento, null);

  // 3. REALIZADO cuando es requerido (Clase C) y existe el evento correspondiente
  const rCDone = buildAuditRecord({
    batchId: 'LOTE-1', runId: 'EJEC-2', eventId: 'EVT-003',
    testCase: V08_DATASET.cases[20],
    output: { classification: { level: 'C' }, guidance: { text: 'Escalar' }, revision: 'r2' },
    escalationPerformed: true
  });
  assert.equal(rCDone.Escalamiento_Requerido, true);
  assert.equal(rCDone.Escalamiento_Realizado, 'REALIZADO');
  assert.equal(rCDone.Incidencia_Escalamiento, null);

  // 4. NO_EVALUADO cuando el estado aún no ha sido determinado (sin output/clasificación)
  const rUnEval = buildAuditRecord({
    batchId: 'LOTE-1', runId: null, eventId: 'EVT-004',
    testCase: V08_DATASET.cases[0],
    output: null,
    escalationPerformed: false
  });
  assert.equal(rUnEval.Escalamiento_Requerido, 'NO_EVALUADO');
  assert.equal(rUnEval.Escalamiento_Realizado, 'NO_EVALUADO');
  assert.equal(rUnEval.Incidencia_Escalamiento, null);

  // 5. Incidencia por escalamiento inesperado (Clase A con escalationPerformed=true)
  const rUnexpected = buildAuditRecord({
    batchId: 'LOTE-1', runId: 'EJEC-3', eventId: 'EVT-005',
    testCase: V08_DATASET.cases[0],
    output: { classification: { level: 'A' }, guidance: { text: 'Info' }, revision: 'r3' },
    escalationPerformed: true
  });
  assert.equal(rUnexpected.Escalamiento_Requerido, false);
  assert.equal(rUnexpected.Escalamiento_Realizado, 'INCIDENCIA_ESCALAMIENTO_INESPERADO');
  assert.equal(rUnexpected.Resultado_Evento, 'INCIDENCIA');
  assert.equal(rUnexpected.Estado_Ejecucion, 'INCIDENCIA_ESCALAMIENTO');
  assert.match(rUnexpected.Incidencia_Escalamiento, /inesperado/i);
  assert.match(rUnexpected.Mensaje_Error, /inesperado/i);

  // 6. Incidencia por escalamiento sin evaluación previa
  const rUnexpectedNoEval = resolveEscalationState({ level: null, escalationPerformed: true });
  assert.equal(rUnexpectedNoEval.status, 'INCIDENCIA_ESCALAMIENTO_INESPERADO');
  assert.match(rUnexpectedNoEval.incidence, /sin clasificaci[oó]n previa/i);
});

test('V10-03: Lote v0.8 clasifica Escalamiento_Realizado como 20 NO_APLICA y 10 PENDIENTE (0 REALIZADO)', () => {
  const e = buildBatchEvidence(V08_DATASET);
  assert.equal(e.records.filter(r => r.Escalamiento_Realizado === 'NO_APLICA').length, 20);
  assert.equal(e.records.filter(r => r.Escalamiento_Realizado === 'PENDIENTE').length, 10);
  assert.equal(e.records.filter(r => r.Escalamiento_Realizado === 'REALIZADO').length, 0);
  assert.equal(e.records.filter(r => r.Incidencia_Escalamiento !== null).length, 0);
});

test('V10-04: Identificación SAI-GC R02 Validación v1.0, historial de versiones y estado V5 no concluido', () => {
  assert.equal(VALIDATION_VERSION, 'SAI-GC R02 Validación v1.0');
  assert.ok(Array.isArray(VERSION_HISTORY) && VERSION_HISTORY.length >= 5);
  assert.ok(VERSION_HISTORY.some(v => v.version === 'R01'));
  assert.ok(VERSION_HISTORY.some(v => v.version === 'v0.8-r02-operacion-aprobada'));
  assert.ok(VERSION_HISTORY.some(v => v.version === 'R02 - PRE-V5'));
  assert.ok(VERSION_HISTORY.some(v => v.version === VALIDATION_VERSION && v.status === 'PREPARACION_V5_NO_CONCLUIDA'));

  const e = buildBatchEvidence(V08_DATASET);
  assert.equal(e.version, 'SAI-GC R02 Validación v1.0');
  assert.equal(e.status, 'PREPARACION_V5_NO_CONCLUIDA');
  assert.equal(e.records[0].Version_MVP, 'SAI-GC R02 Validación v1.0');

  const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /SAI-GC R02 Validaci[oó]n v1\.0/);
  assert.match(index, /new-batch-btn/);
});

test('V10-05: Separación de lotes independientes preserva exportación del lote anterior sin mezclar bitácoras', () => {
  const session1 = createValidationSession('LOTE');
  const run1 = createAuditRunId('EJEC');
  const rec1 = buildAuditRecord({
    batchId: session1.batchId,
    runId: run1,
    eventId: createEventId(1, 'EVT'),
    testCase: V08_DATASET.cases[0],
    output: { classification: { level: 'A' }, guidance: { text: 'Info' }, revision: 'r1' },
    event: 'Triaje y recomendación'
  });
  session1.logs.push({ case: 'CASO-001', extendedPreV5: rec1 });

  const session2 = startNewValidationBatch(session1, { preserveArchive: true });
  assert.notEqual(session2.batchId, session1.batchId);
  assert.equal(session2.logs.length, 0);
  assert.equal(session2.eventSeq, 0);
  assert.equal(session2.archivedBatches.length, 1);
  assert.equal(session2.archivedBatches[0].batchId, session1.batchId);
  assert.equal(session2.archivedBatches[0].eventCount, 1);
  assert.ok(session2.archivedBatches[0].csv.includes(session1.batchId));
  assert.equal(JSON.parse(session2.archivedBatches[0].json).ID_Lote, session1.batchId);

  const run2 = createAuditRunId('EJEC');
  assert.notEqual(run2, run1);
  const rec2 = buildAuditRecord({
    batchId: session2.batchId,
    runId: run2,
    eventId: createEventId(1, 'EVT'),
    testCase: V08_DATASET.cases[10],
    output: { classification: { level: 'B' }, guidance: { text: 'Pago' }, revision: 'r2' },
    event: 'Triaje y recomendación'
  });
  session2.logs.push({ case: 'CASO-011', extendedPreV5: rec2 });

  const ev2 = buildEventEvidence(session2.logs, session2.batchId);
  assert.equal(ev2.ID_Lote, session2.batchId);
  assert.equal(ev2.records.length, 1);
  assert.equal(ev2.records[0].ID_Lote, session2.batchId);
  assert.notEqual(ev2.records[0].ID_Lote, session1.batchId);
});
