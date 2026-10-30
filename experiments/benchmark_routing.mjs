/**
 * Módulo de Experimentación y Benchmark de Enrutamiento para SAI-GC (R02)
 * Proyecto: Sistema de Asistencia Inteligente y Gestión de Capacidad para WhatsApp Posventa
 * Escuela de Ingeniería Industrial - UPC
 * 
 * Compara 4 políticas de asignación sobre un lote sintético reproducible:
 *  1. FIFO Puro: Asignación por orden de llegada al primer asesor disponible con skill.
 *  2. Regla Actual: Asignación greedy con peso uniforme = 5 sin distinción de complejidad.
 *  3. LBF Adaptada: Least Busy First con peso uniforme = 5.
 *  4. SAI-GC R02 (Propuesta): Triaje por complejidad (A=4, B=5), escalamiento obligatorio
 *     de casos Clase C y baja cobertura fuera de la cola ordinaria, y asignación balanceada
 *     con revalidación estricta de capacidad (máx 10).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPACITY,
  classify,
  weightFor,
  canConfirmAssignment,
  registerEscalation
} from '../logic.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generador de carga sintética reproducible con semilla pseudoaleatoria
function createSyntheticWorkload(count = 60) {
  // LCG simple para reproducibilidad matemática
  let s = 123456789;
  function random() {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  }

  const ramos = ['Vehicular', 'Salud', 'Vida'];
  const pool = [
    // Clase A (50% aprox)
    { text: 'Solicito copia de póliza digital y vigencia informativa', level: 'A' },
    { text: 'Requiero constancia de seguro y horario de atención', level: 'A' },
    { text: 'Buenas tardes, deseo duplicado de certificado vigente', level: 'A' },
    // Clase B (30% aprox)
    { text: 'Necesito consultar estado de cuenta y facturación pendiente', level: 'B' },
    { text: 'Deseo actualizar mi dirección fiscal y número de contacto', level: 'B' },
    { text: 'Registro de nuevo conductor en la póliza y trámite de pago', level: 'B' },
    // Clase C (15% aprox)
    { text: 'Reporte de siniestro con choque múltiple, requiero peritaje urgente', level: 'C' },
    { text: 'Anulación de póliza por disconformidad y reclamo formal INDECOPI', level: 'C' },
    // Fuera de dominio / Fallback (5% aprox)
    { text: 'Cotización de paquete turístico internacional no asegurado', level: 'C' }
  ];

  const workload = [];
  for (let i = 1; i <= count; i++) {
    const r = random();
    let sample;
    if (r < 0.50) {
      sample = pool[Math.floor(random() * 3)];
    } else if (r < 0.80) {
      sample = pool[3 + Math.floor(random() * 3)];
    } else if (r < 0.95) {
      sample = pool[6 + Math.floor(random() * 2)];
    } else {
      sample = pool[8];
    }

    const branch = ramos[Math.floor(random() * ramos.length)];
    workload.push({
      id: `SYNTH-${String(i).padStart(3, '0')}`,
      text: sample.text,
      branch: branch,
      validated: random() > 0.35 // 65% validados por bot
    });
  }
  return workload;
}

function getInitialAgents() {
  return [
    { id: 'AG-01', display: 'Asesor 01', status: 'Disponible', load: 0, skills: ['Vehicular', 'Salud'] },
    { id: 'AG-02', display: 'Asesor 02', status: 'Disponible', load: 0, skills: ['Vehicular', 'Vida'] },
    { id: 'AG-03', display: 'Asesor 03', status: 'Disponible', load: 0, skills: ['Salud', 'Vida'] },
    { id: 'AG-04', display: 'Asesor 04', status: 'Disponible', load: 0, skills: ['Vehicular', 'Salud', 'Vida'] }
  ];
}

// Simulación de políticas
function simulate(policyName, workload) {
  const agents = getInitialAgents().map(a => ({ ...a }));
  const results = {
    policy: policyName,
    totalCases: workload.length,
    assigned: 0,
    queued: 0,
    escalated: 0,
    blockedSecurity: 0,
    agentUtilization: {},
    casesLog: []
  };

  for (const item of workload) {
    const classification = classify(item.text);
    const level = classification.level;
    const branch = item.branch;

    if (policyName === 'FIFO') {
      // Peso uniforme = 5, primer disponible con skill
      const weight = 5;
      const valid = agents.filter(a => a.status === 'Disponible' && a.skills.includes(branch) && (a.load + weight) <= CAPACITY);
      if (valid.length > 0) {
        const target = valid[0]; // Primer agente encontrado
        target.load += weight;
        results.assigned++;
        results.casesLog.push({ id: item.id, level, agent: target.id, weight, status: 'ASIGNADO' });
      } else {
        results.queued++;
        results.casesLog.push({ id: item.id, level, agent: null, weight, status: 'EN_COLA' });
      }
    } else if (policyName === 'Regla Actual') {
      // Peso uniforme = 5, menor carga (greedy)
      const weight = 5;
      const valid = agents.filter(a => a.status === 'Disponible' && a.skills.includes(branch) && (a.load + weight) <= CAPACITY);
      valid.sort((a, b) => a.load - b.load || a.id.localeCompare(b.id));
      if (valid.length > 0) {
        const target = valid[0];
        target.load += weight;
        results.assigned++;
        results.casesLog.push({ id: item.id, level, agent: target.id, weight, status: 'ASIGNADO' });
      } else {
        results.queued++;
        results.casesLog.push({ id: item.id, level, agent: null, weight, status: 'EN_COLA' });
      }
    } else if (policyName === 'LBF Adaptada') {
      // Least Busy First con peso uniforme = 5
      const weight = 5;
      const valid = agents.filter(a => a.status === 'Disponible' && a.skills.includes(branch) && (a.load + weight) <= CAPACITY);
      valid.sort((a, b) => a.load - b.load || a.id.localeCompare(b.id));
      if (valid.length > 0) {
        const target = valid[0];
        target.load += weight;
        results.assigned++;
        results.casesLog.push({ id: item.id, level, agent: target.id, weight, status: 'ASIGNADO' });
      } else {
        results.queued++;
        results.casesLog.push({ id: item.id, level, agent: null, weight, status: 'EN_COLA' });
      }
    } else if (policyName === 'SAI-GC R02') {
      // Propuesta: Clase C / Sin cobertura se escalan obligatoriamente fuera de cola de asesores
      if (level === 'C') {
        results.escalated++;
        results.casesLog.push({ id: item.id, level, agent: 'SUPERVISION', weight: 0, status: 'ESCALADO_SUPERVISOR' });
        continue;
      }

      // Ponderación de complejidad (A=4, B=5)
      const weight = weightFor(level, 'experimental');
      const valid = agents.filter(a => a.status === 'Disponible' && a.skills.includes(branch) && (a.load + weight) <= CAPACITY);
      valid.sort((a, b) => a.load - b.load || a.id.localeCompare(b.id));

      if (valid.length > 0) {
        const target = valid[0];
        target.load += weight;
        results.assigned++;
        results.casesLog.push({ id: item.id, level, agent: target.id, weight, status: 'ASIGNADO' });
      } else {
        results.queued++;
        results.casesLog.push({ id: item.id, level, agent: null, weight, status: 'EN_COLA' });
      }
    }
  }

  // Métricas finales de carga
  const loads = agents.map(a => a.load);
  const avgLoad = loads.reduce((a, b) => a + b, 0) / loads.length;
  const variance = loads.reduce((sum, l) => sum + Math.pow(l - avgLoad, 2), 0) / loads.length;
  const stdDev = Math.sqrt(variance);

  agents.forEach(a => {
    results.agentUtilization[a.id] = {
      finalLoad: a.load,
      maxCapacity: CAPACITY,
      utilizationPct: Math.round((a.load / CAPACITY) * 100)
    };
  });

  results.metrics = {
    avgLoad: Number(avgLoad.toFixed(2)),
    stdDev: Number(stdDev.toFixed(2)),
    maxLoad: Math.max(...loads),
    minLoad: Math.min(...loads),
    loadSpread: Math.max(...loads) - Math.min(...loads),
    assignedRatePct: Math.round((results.assigned / results.totalCases) * 100),
    queuedRatePct: Math.round((results.queued / results.totalCases) * 100),
    escalatedRatePct: Math.round((results.escalated / results.totalCases) * 100)
  };

  return results;
}

export function runBenchmark() {
  const workload = createSyntheticWorkload(60);
  const policies = ['FIFO', 'Regla Actual', 'LBF Adaptada', 'SAI-GC R02'];
  const comparison = {};

  policies.forEach(p => {
    comparison[p] = simulate(p, workload);
  });

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      sampleSize: workload.length,
      description: 'Benchmark comparativo de políticas de asignación sobre carga sintética demostrativa (UPC SAI-GC R02)'
    },
    workloadSample: workload.slice(0, 5),
    policies: comparison
  };
}

// Ejecución directa si se invoca desde CLI
if (process.argv[1] && process.argv[1].endsWith('benchmark_routing.mjs')) {
  console.log('================================================================================');
  console.log('  SAI-GC R02: BENCHMARK COMPARATIVO DE POLÍTICAS DE ENRUTAMIENTO');
  console.log('================================================================================\n');

  const report = runBenchmark();

  console.log(`Lote sintético procesado: ${report.metadata.sampleSize} interacciones`);
  console.log(`Fecha de ejecución: ${report.metadata.generatedAt}\n`);

  console.log('| Política          | Asignados | En Cola | Escalados | Carga Media | Desv. Est. | Dispersión (Max-Min) |');
  console.log('|-------------------|-----------|---------|-----------|-------------|------------|----------------------|');

  for (const [name, data] of Object.entries(report.policies)) {
    const m = data.metrics;
    const pName = name.padEnd(17);
    const asg = String(data.assigned).padStart(9);
    const que = String(data.queued).padStart(7);
    const esc = String(data.escalated).padStart(9);
    const avg = String(m.avgLoad).padStart(11);
    const std = String(m.stdDev).padStart(10);
    const spr = String(`${m.maxLoad} - ${m.minLoad} (${m.loadSpread})`).padStart(20);
    console.log(`| ${pName} | ${asg} | ${que} | ${esc} | ${avg} | ${std} | ${spr} |`);
  }

  console.log('\n--------------------------------------------------------------------------------');
  console.log('Desglose de utilización por asesor:\n');
  for (const [name, data] of Object.entries(report.policies)) {
    console.log(`[${name}]`);
    for (const [agId, u] of Object.entries(data.agentUtilization)) {
      console.log(`  ${agId}: ${u.finalLoad}/${u.maxCapacity} (${u.utilizationPct}%)`);
    }
  }

  // Guardar archivo de evidencia
  const outDir = path.resolve(__dirname, '../evidencias/r02');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const jsonPath = path.join(outDir, 'benchmark_routing_resultados.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n✔ Evidencia guardada en: ${jsonPath}`);
}
