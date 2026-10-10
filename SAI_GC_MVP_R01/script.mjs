import {
  VERSION,
  CAPACITY,
  CASES,
  AGENTS,
  processCase,
  weightFor,
  log_event,
  export_evidence
} from './logic.mjs';

const $ = id => document.getElementById(id);
const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const state = {
  agents: structuredClone(AGENTS),
  cases: structuredClone(CASES),
  selected: CASES[0],
  output: null,
  policy: 'actual',
  logs: [],
  decisions: {},
  assignments: [],
  counter: 0
};

function navigate(name) {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x.id === `page-${name}`));
  renderTables();
}

document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => navigate(b.dataset.tab)));

// Inicializar selector de casos
const select = $('case-select');
for (const c of state.cases) {
  const o = document.createElement('option');
  o.value = c.id;
  o.textContent = `${c.id} · ${c.name}`;
  select.append(o);
}
select.addEventListener('change', () => setCase(select.value));

function setCase(id) {
  const c = state.cases.find(x => x.id === id);
  if (!c) return;
  state.selected = c;
  state.output = null;

  // Ajustes especiales de simulación según el escenario
  if (c.scenario === 'all_busy') {
    state.agents = AGENTS.map(a => ({ ...a, status: 'Ocupado', load: 10 }));
  } else if (c.scenario === 'agent_paused') {
    state.agents = [
      { id: 'AG-01', display: 'Asesor Demo 01', status: 'Ocupado', load: 10, skills: ['Vida', 'Vehicular'] },
      { id: 'AG-02', display: 'Asesor Demo 02', status: 'Ocupado', load: 10, skills: ['Vida', 'Vehicular'] },
      { id: 'AG-03', display: 'Asesor Demo 03', status: 'Ocupado', load: 10, skills: ['Vehicular'] },
      { id: 'AG-04', display: 'Asesor Demo 04', status: 'Refrigerio', load: 0, skills: ['Vida', 'Salud'] }
    ];
  } else if (c.scenario === 'policy_compare') {
    state.agents = structuredClone(AGENTS);
  } else {
    // Escenarios estándar restauran asesores si estaban saturados por demo 006
    if (state.agents.every(a => a.load === 10)) {
      state.agents = structuredClone(AGENTS);
    }
  }

  $('question').value = c.text;
  $('validation').value = String(c.validated);
  $('branch').value = c.branch;
  renderChat();
  resetOutput();
  renderTables();
}

function renderChat() {
  const d = $('chat');
  const c = state.selected;
  const check = $('validation').value === 'true';
  d.innerHTML = `
    <div class="event">◉ Cliente inicia contacto en canal WhatsApp · caso ${escapeHTML(c.id)}</div>
    <div class="message customer"><span class="who">Cliente (demostración)</span>Hola, necesito asistencia con mi póliza.</div>
    <div class="message system"><span class="who">IVR actual · demostración</span>Gracias por comunicarse. Por favor, indique brevemente el motivo de su consulta.</div>
    <div class="message customer"><span class="who">Cliente (demostración)</span>${escapeHTML($('question').value || c.text)}</div>
    <div class="event">${check ? '✓ Identidad previamente validada por IVR.' : '! Identidad sin validar: asesor debe ejecutar verificación.'}<br>Transferencia simulada a cola WhatsApp.</div>
  `;
  if (state.output) {
    const o = state.output;
    d.innerHTML += `
      <div class="message system">
        <span class="who">SAI-GC · propuesta interna (no enviada al cliente)</span>
        Clase ${o.classification.level} · Fuente: ${o.guidance.id}<br>
        <em>Acción humana requerida: el asesor debe validar y decidir.</em>
      </div>
    `;
  }
  d.scrollTop = d.scrollHeight;
}

$('validation').addEventListener('change', () => {
  state.output = null;
  renderChat();
  resetOutput();
});

$('branch').addEventListener('change', () => {
  state.output = null;
  resetOutput();
});

function resetOutput() {
  $('class-chip').className = 'classchip empty';
  $('class-chip').textContent = '—';
  $('risk').textContent = 'Pendiente';
  $('rule-reason').textContent = 'Seleccione un caso y pulse “Procesar consulta”.';
  $('kb-source').textContent = 'Pendiente de consulta';
  $('suggestion').textContent = 'La asistencia aparecerá cuando se procese el caso.';
  $('suggestion').contentEditable = 'false';
  $('suggestion').style.background = '';
  $('suggestion').style.outline = '';
  $('action-result').className = 'result muted';
  $('action-result').textContent = 'Sin decisión humana registrada.';
  document.querySelectorAll('[data-action]').forEach(b => b.disabled = true);
  $('weight').textContent = state.policy === 'experimental' ? 'Depende de clase' : '5 unidades';
  $('recommended').textContent = 'Pendiente';
  $('projected').textContent = '—';
  $('route-reason').textContent = 'Se recomienda el asesor disponible con menor carga y skill compatible.';
  $('progress-fill').style.width = '0%';
  $('assign-btn').disabled = true;
}

function addLog(type, action = '—', agent = '—') {
  const o = state.output || {};
  state.logs = log_event(state.logs, {
    caseId: state.selected.id,
    event: type,
    level: o.classification?.level || '—',
    source: o.guidance?.id || '—',
    action,
    agent,
    policy: state.policy,
    version: VERSION
  });
  renderTables();
}

function runCase() {
  const c = {
    ...state.selected,
    text: $('question').value,
    validated: $('validation').value === 'true',
    branch: $('branch').value
  };

  state.output = processCase(c, state.agents, state.policy);
  const o = state.output;

  $('class-chip').className = `classchip ${o.classification.level}`;
  $('class-chip').textContent = o.classification.level;
  $('risk').textContent = o.classification.risk;
  $('rule-reason').textContent = o.classification.reason;
  $('kb-source').textContent = `${o.guidance.id} · ${o.guidance.title}`;
  $('suggestion').textContent = o.guidance.text;
  $('weight').textContent = `${o.recommendation.weight} unidades`;
  $('recommended').textContent = o.recommendation.agent?.display || 'En cola';
  $('projected').textContent = o.recommendation.agent ? `${o.recommendation.projected} / 10` : '—';
  $('route-reason').textContent = o.recommendation.reason;
  $('progress-fill').style.width = `${100 * (o.recommendation.projected || 0) / CAPACITY}%`;

  $('assign-btn').disabled = !o.recommendation.agent;
  document.querySelectorAll('[data-action]').forEach(b => b.disabled = false);

  $('action-result').textContent = 'Pendiente: el asesor debe decidir antes de actuar.';
  $('action-result').className = 'result muted';

  renderChat();
  addLog('Triaje y recomendación');
}

$('process-btn').addEventListener('click', runCase);

$('reset-btn').addEventListener('click', () => {
  state.agents = structuredClone(AGENTS);
  state.logs = [];
  state.decisions = {};
  state.assignments = [];
  state.counter = 0;
  setCase(CASES[0].id);
  select.value = CASES[0].id;
  renderTables();
});

for (const b of document.querySelectorAll('[data-action]')) {
  b.addEventListener('click', () => {
    if (!state.output) return;
    const act = b.dataset.action;
    if (act === 'Editar') {
      $('suggestion').contentEditable = 'true';
      $('suggestion').style.background = '#fffef0';
      $('suggestion').style.outline = '2px solid #94bce6';
      $('suggestion').focus();
    } else {
      $('suggestion').contentEditable = 'false';
      $('suggestion').style.background = '';
      $('suggestion').style.outline = '';
    }
    state.decisions[state.selected.id] = act;
    $('action-result').textContent = `Decisión registrada: ${act}. ${act === 'Escalar' ? 'Requiere revisión humana reforzada.' : 'Sugerencia no enviada automáticamente.'}`;
    $('action-result').className = 'result done';
    addLog('Decisión humana', act, state.output.recommendation.agent?.display || '—');
  });
}

$('assign-btn').addEventListener('click', () => {
  if (!state.output || !state.output.recommendation.agent) return;
  const choice = state.agents.find(a => a.id === state.output.recommendation.agent.id);
  const w = state.output.recommendation.weight;
  if (!choice || (choice.load + w > CAPACITY)) {
    alert('No hay capacidad disponible; reprocesar el caso.');
    return;
  }
  choice.load += w;
  state.counter++;
  state.assignments.push({
    id: state.selected.id,
    agent: choice.display,
    level: state.output.classification.level,
    age: '00:00',
    status: 'En curso'
  });
  $('assign-btn').disabled = true;
  addLog('Asignación confirmada', state.decisions[state.selected.id] || 'Pendiente', choice.display);
  $('route-reason').textContent = `Asignación DEMO confirmada: ${choice.display} · ${choice.load}/10 unidades ocupadas.`;
  renderTables();
});

document.querySelectorAll('input[name="policy"]').forEach(x => {
  x.addEventListener('change', () => {
    state.policy = x.value;
    state.output = null;
    resetOutput();
    renderChat();
  });
});

function renderTables() {
  // 1. Representantes
  $('agents-body').innerHTML = state.agents.map(a => `
    <tr>
      <td><span class="link">${escapeHTML(a.display)}</span></td>
      <td><span class="status ${a.status === 'Disponible' ? 'ok' : a.status === 'Ocupado' ? 'bad' : 'wait'}"></span>${escapeHTML(a.status)}</td>
      <td>${a.load === 0 ? '0 casos' : `${Math.ceil(a.load / 5)} caso(s)`}</td>
      <td>WhatsApp</td>
      <td><div class="meter ${a.load === 10 ? 'full' : ''}"><span style="width:${a.load * 10}%"></span></div><small>${a.load * 10}%</small></td>
      <td>${a.load} / 10</td>
      <td><span class="link">Ver carga</span></td>
    </tr>
  `).join('');

  // 2. Colas
  const queues = [
    ['WhatsApp', '3', `${state.counter > 0 ? 3 : 2} pendientes`, 'Mensajería', '06:40', '04:25', '03:20', 'Monitorizar'],
    ['Correo', '11', '1 pendiente', 'Caso', '05:10', '05:10', '05:10', 'Monitorizar'],
    ['Facebook', '1', '0 pendientes', 'Mensajería', '00:00', '—', '—', 'Normal']
  ];
  $('queues-body').innerHTML = queues.map(q => `<tr>${q.map(v => `<td>${escapeHTML(v)}</td>`).join('')}</tr>`).join('');

  // 3. Trabajo en curso
  const rows = [
    ...state.assignments.map(x => ['WhatsApp', x.id, 'Conversación', x.agent, '1', '1', x.age, x.level, x.status]),
    ['WhatsApp', 'DEMO-WIP-001', 'Conversación', 'Asesor Demo 02', '1', '1', '05:40', 'B', 'En curso'],
    ['Correo', 'DEMO-WIP-002', 'Caso', 'Asesor Demo 03', '1', '1', '12:30', 'N/A', 'En curso']
  ];
  $('wip-body').innerHTML = rows.map(q => `<tr>${q.map(v => `<td>${escapeHTML(v)}</td>`).join('')}</tr>`).join('');

  // 4. Bitácora
  $('log-body').innerHTML = state.logs.length
    ? state.logs.map(r => `
        <tr>
          <td>${escapeHTML(r.time)}</td>
          <td>${escapeHTML(r.case)}</td>
          <td>${escapeHTML(r.event)}</td>
          <td>${escapeHTML(r.level)}</td>
          <td>${escapeHTML(r.source)}</td>
          <td>${escapeHTML(r.action)}</td>
          <td>${escapeHTML(r.agent)}</td>
          <td>${escapeHTML(r.policy)}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="8">Aún no se han registrado eventos. Procese consultas en “Atención asistida”.</td></tr>';
}

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

$('export-json-btn').addEventListener('click', () => {
  const jsonContent = export_evidence(state.logs, 'json');
  downloadFile(jsonContent, 'SAI_GC_BITACORA_DEMO.json', 'application/json');
});

$('export-csv-btn').addEventListener('click', () => {
  const csvContent = export_evidence(state.logs, 'csv');
  downloadFile(csvContent, 'SAI_GC_BITACORA_DEMO.csv', 'text/csv;charset=utf-8;');
});

$('clear-btn').addEventListener('click', () => {
  state.logs = [];
  renderTables();
});

setCase(CASES[0].id);
renderTables();
