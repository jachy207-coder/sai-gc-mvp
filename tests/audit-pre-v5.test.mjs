import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { V08_DATASET } from '../logic.mjs';
import {
  AUDIT_FIELDS, validateV08Input, buildBatchEvidence,
  buildAuditRecord, exportAuditCSV, exportAuditJSON,
  buildEventEvidence, createAuditRunId
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
  const base={runId:'CONTROL-001',testCase:V08_DATASET.cases[20],
    output:{classification:{level:'C'},guidance:{text:'Prueba'},revision:'rev-test'},
    event:'Escalamiento registrado',status:'DERIVADO_SUPERVISOR'};
  assert.equal(buildAuditRecord(base).Escalamiento_Realizado,'NO_REGISTRADO');
  assert.equal(buildAuditRecord({...base,escalationPerformed:true}).Escalamiento_Realizado,'SIMULADO_EN_MVP');
  const rows=buildEventEvidence([{case:'CASO-021',extendedPreV5:buildAuditRecord({...base,escalationPerformed:true})}],'CONTROL-001');
  assert.equal(rows.records.length,1);
});
test('PV5-10: Selector no anticipa clases y etiqueta V5 como pendiente', () => {
  const script=fs.readFileSync(new URL('../script.mjs',import.meta.url),'utf8');
  const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.doesNotMatch(script,/Lote v0\.8 \(Clase \$\{cl\.level\}\)/);
  assert.match(script,/name: `\$\{c\.query_text\.slice\(0, 72\)\}/);
  assert.match(index,/prevalidaci[oó]n t[eé]cnica/i);
});
test('PV5-11: Registro de corrida independiente', () => {
  assert.notEqual(createAuditRunId(),createAuditRunId());
});
