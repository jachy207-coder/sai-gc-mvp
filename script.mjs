import {
  VERSION,
  CAPACITY,
  CASES,
  AGENTS,
  processCase,
  route,
  weightFor,
  computeCaseRevision,
  canConfirmAssignment,
  registerEscalation,
  calculateCapacityRecovery,
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

const INITIAL_WIP = [
  {
    uid: 'WIP-BASE-1',
    queue: 'WhatsApp',
    id: 'DEMO-WIP-001',
    branch: 'Vida',
    type: 'Conversación',
    agentId: 'AG-02',
    agent: 'Asesor Demo 02',
    weight: 5,
    age: '05:40',
    level: 'B',
    status: 'En curso'
  },
  {
    uid: 'WIP-BASE-2',
    queue: 'Correo',
    id: 'DEMO-WIP-002',
    branch: 'Salud',
    type: 'Caso Correo',
    agentId: 'AG-03',
    agent: 'Asesor Demo 03',
    weight: 10,
    age: '12:30',
    level: 'N/A',
    status: 'En curso'
  }
];

const state = {
  agents: structuredClone(AGENTS),
  cases: structuredClone(CASES),
  selected: CASES[0],
  output: null,
  policy: 'actual',
  logs: [],
  caseStatus: 'PENDIENTE_REVISION',
  decisions: {},           // { [caseId]: 'Aceptar' | 'Editar' | 'Rechazar' | 'Escalar' }
  approvedRevisions: {},   // { [caseId]: 'rev-xxxx' }
  isEditing: false,
  editApproved: false,
  ivrManualVerified: false,
  chatMessages: {},        // { [caseId]: Array<{ type, sender, decision, time, text }> }
  assignments: structuredClone(INITIAL_WIP),
  heldCases: [],
  escalatedCases: [],
  logFilterClass: 'ALL',
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

function updateContextBar() {
  const c = state.selected;
  const check = $('validation').value === 'true';
  const branch = $('branch').value;
  $('ctx-case-id').textContent = c.id;
  $('ctx-topic').textContent = c.topic || c.name;
  $('ctx-branch').textContent = branch;
  const pill = $('ctx-ivr-pill');
  if (check) {
    pill.className = 'ivr-pill ok';
    pill.textContent = '✓ IVR Validado';
    $('ivr-verification-box').style.display = 'none';
  } else {
    pill.className = state.ivrManualVerified ? 'ivr-pill ok' : 'ivr-pill pending';
    pill.textContent = state.ivrManualVerified ? '✓ Verificado por Asesor' : '! IVR Pendiente (Verifica Asesor)';
    $('ivr-verification-box').style.display = 'block';
    $('ivr-verified-check').checked = state.ivrManualVerified;
  }
}

function invalidateCurrentApproval(reason = 'Cambio de parámetros') {
  const cid = state.selected.id;
  if (state.approvedRevisions[cid]) {
    addLog(
      'Invalidación de aprobación previa',
      'Revocación automática',
      'Motor R02',
      cid,
      state.output?.classification?.level || '—',
      'SEGURIDAD-R02',
      'INVALIDADO',
      reason
    );
  }
  delete state.approvedRevisions[cid];
  delete state.decisions[cid];
  state.isEditing = false;
  state.editApproved = false;
  state.caseStatus = 'PENDIENTE_REVISION';
}

function setCase(id) {
  const c = state.cases.find(x => x.id === id);
  if (!c) return;
  state.selected = c;
  state.output = null;
  state.ivrManualVerified = false;
  invalidateCurrentApproval('Cambio de caso activo');

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
    if (state.agents.every(a => a.load === 10)) {
      state.agents = structuredClone(AGENTS);
    }
  }

  $('question').value = c.text;
  $('validation').value = String(c.validated);
  $('branch').value = c.branch;
  updateContextBar();
  renderChat();
  resetOutput();
  renderTables();
}

function renderChat() {
  const d = $('chat');
  const c = state.selected;
  const check = $('validation').value === 'true';
  const branch = $('branch').value;
  const customMsgs = state.chatMessages[c.id] || [];

  let html = `
    <div class="event">◉ Cliente inicia contacto en canal WhatsApp · Caso <strong>${escapeHTML(c.id)}</strong> · Ramo ${escapeHTML(branch)}</div>
    <div class="message customer">
      <span class="who"><span>Cliente (demostración)</span><span>10:14 ✓✓</span></span>Hola, necesito asistencia con mi póliza de seguro (${escapeHTML(branch)}).
    </div>
    <div class="message system">
      <span class="who"><span>Bot IVR · Canal Digital</span><span>10:14</span></span>Gracias por comunicarse. Por favor, indique brevemente el motivo de su consulta.
    </div>
    <div class="message customer">
      <span class="who"><span>Cliente (demostración)</span><span>10:15 ✓✓</span></span>${escapeHTML($('question').value || c.text)}
    </div>
    <div class="event">${check ? '✓ Identidad previamente validada por IVR.' : (state.ivrManualVerified ? '✓ Identidad validada manualmente por el asesor en turno.' : '! Identidad sin validar: asesor debe ejecutar verificación antes de informar datos.')} · Transferencia a cola WhatsApp.</div>
  `;

  if (state.output) {
    const o = state.output;
    html += `
      <div class="message proposal">
        <span class="who"><span>⚙ SAI-GC · BORRADOR INTERNO (No visible para el cliente)</span><span>Clase ${escapeHTML(o.classification.level)} · ${escapeHTML(o.guidance.id)}</span></span>
        <strong>Sugerencia recuperada:</strong> "${escapeHTML(o.guidance.text)}"<br>
        <em style="font-size: 11px;">🔒 Control Human-in-the-Loop activo: revise, valide identidad y apruebe antes de despachar o asignar.</em>
      </div>
    `;
  }

  for (const m of customMsgs) {
    if (m.type === 'advisor') {
      html += `
        <div class="message advisor">
          <span class="who"><span>👤 ${escapeHTML(m.sender)} (Validado HITL: ${escapeHTML(m.decision)})</span><span>${escapeHTML(m.time)} ✓✓</span></span>${escapeHTML(m.text)}
        </div>
      `;
    } else if (m.type === 'escalation') {
      html += `
        <div class="message escalation">
          <span class="who"><span>⚠ ESCALAMIENTO OPERACIONAL REGISTRADO</span><span>${escapeHTML(m.time)}</span></span>${escapeHTML(m.text)}
        </div>
      `;
    }
  }

  d.innerHTML = html;
  d.scrollTop = d.scrollHeight;
}

$('validation').addEventListener('change', () => {
  invalidateCurrentApproval('Modificación de estado IVR');
  state.output = null;
  state.ivrManualVerified = false;
  updateContextBar();
  renderChat();
  resetOutput();
});

$('branch').addEventListener('change', () => {
  invalidateCurrentApproval('Modificación de ramo');
  state.output = null;
  updateContextBar();
  renderChat();
  resetOutput();
});

$('question').addEventListener('input', () => {
  invalidateCurrentApproval('Modificación de texto de consulta');
  if (!state.output) {
    renderChat();
  }
});

$('ivr-verified-check').addEventListener('change', e => {
  state.ivrManualVerified = e.target.checked;
  updateContextBar();
  renderChat();
  updateAuthUI();
});

function resetOutput() {
  $('chat-stage-badge').textContent = 'Estado: En espera de triaje';
  $('class-chip').className = 'classchip empty';
  $('class-chip').textContent = '—';
  $('risk').textContent = 'Pendiente';
  $('rule-id-badge').textContent = 'M3 · Reglas preliminares';
  $('keywords-list').innerHTML = '<span class="kw-chip muted">Sin procesar</span>';
  $('rule-reason').textContent = 'Seleccione un caso y pulse “Procesar consulta”.';
  $('kb-source').textContent = 'Pendiente de consulta';
  $('kb-checklist').innerHTML = '<li>Procese un caso para visualizar los pasos obligatorios de verificación.</li>';
  $('suggestion').textContent = 'La asistencia aparecerá cuando se procese el caso.';
  $('suggestion').contentEditable = 'false';
  $('suggestion').style.background = '';
  $('suggestion').style.outline = '';
  $('save-edit-btn').style.display = 'none';
  $('action-result').className = 'result muted';
  $('action-result').textContent = 'Sin decisión humana registrada.';

  document.querySelectorAll('.fourbtn button').forEach(b => {
    b.disabled = true;
    b.classList.remove('active-choice');
  });
  $('send-chat-btn').disabled = true;
  $('weight').textContent = state.policy === 'experimental' ? 'Depende de clase' : '5 unidades';
  $('recommended').textContent = 'Pendiente';
  $('projected').textContent = '—';
  $('route-reason').textContent = 'Se recomienda el asesor disponible con menor carga y skill compatible.';
  $('progress-fill').style.width = '0%';
  $('cmp-actual').textContent = '—';
  $('cmp-exp').textContent = '—';
  $('assign-btn').disabled = true;
  $('assign-btn').style.display = 'inline-block';
  $('enqueue-btn').disabled = true;
  $('escalate-action-btn').style.display = 'none';
  $('escalate-action-btn').disabled = true;

  updateStatusChip('PENDIENTE_REVISION');
  $('case-revision-token').textContent = '—';
}

function updateStatusChip(status) {
  state.caseStatus = status;
  const chip = $('case-status-chip');
  chip.className = `case-status-chip ${status}`;
  chip.textContent = status.replace(/_/g, ' ');
}

function addLog(type, action = '—', agent = '—', customCaseId = null, customLevel = null, customSource = null, result = 'PERMITIDO', blockReason = '—') {
  const o = state.output || {};
  const currentCase = {
    ...state.selected,
    text: $('question').value,
    branch: $('branch').value,
    validated: $('validation').value === 'true'
  };
  const rev = o.revision || computeCaseRevision(currentCase, state.policy, o.classification);
  state.logs = log_event(state.logs, {
    timestampIso: new Date().toISOString(),
    caseId: customCaseId || state.selected.id,
    revision: rev,
    caseStatus: state.caseStatus,
    event: type,
    level: customLevel || o.classification?.level || '—',
    source: customSource || o.guidance?.id || '—',
    action,
    result,
    blockReason,
    actorRole: 'Asesor WhatsApp (HITL)',
    agent,
    policy: state.policy,
    version: VERSION
  });
  renderTables();
}

function getCurrentAuthCheck() {
  const c = {
    ...state.selected,
    text: $('question').value,
    validated: $('validation').value === 'true',
    branch: $('branch').value,
    ivrManualVerified: state.ivrManualVerified
  };
  return canConfirmAssignment({
    caseData: c,
    output: state.output,
    decision: state.decisions[c.id],
    approvedRevision: state.approvedRevisions[c.id],
    isEditing: state.isEditing,
    editApproved: state.editApproved,
    agents: state.agents,
    policy: state.policy,
    activeAssignments: state.assignments
  });
}

function updateAuthUI() {
  if (!state.output) return;
  const cid = state.selected.id;
  const level = state.output.classification.level;
  const auth = getCurrentAuthCheck();

  $('case-revision-token').textContent = state.output.revision;
  updateStatusChip(state.caseStatus);

  if (level === 'C') {
    // Clase C: bloqueo estricto de asignación ordinaria (R02-02)
    $('assign-btn').style.display = 'none';
    $('assign-btn').disabled = true;
    $('escalate-action-btn').style.display = 'inline-block';
    $('escalate-action-btn').disabled = (state.caseStatus === 'DERIVADO_SUPERVISOR');
    $('route-reason').textContent = '🔒 Regla de seguridad R02: Clase C exige derivación obligatoria a supervisor. Asignación directa bloqueada.';
    $('btn-accept').disabled = true; // Bloqueado aceptar directo en Clase C
    $('btn-accept').title = 'No permitido en Clase C por salvaguarda de seguridad operacional';
  } else {
    $('assign-btn').style.display = 'inline-block';
    $('escalate-action-btn').style.display = 'none';
    $('btn-accept').disabled = false;
    $('btn-accept').title = '';

    if (auth.allowed) {
      $('assign-btn').disabled = false;
      $('route-reason').textContent = `✓ Autorizado para confirmación: ${auth.targetAgent.display} (${auth.projected}/10 u.)`;
    } else {
      $('assign-btn').disabled = true;
      $('route-reason').textContent = `🔒 Asignación pendiente: ${auth.reason}`;
    }
  }
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

  // Si se reprocesa, la aprobación previa se invalida
  delete state.approvedRevisions[c.id];
  delete state.decisions[c.id];
  state.isEditing = false;
  state.editApproved = false;
  state.caseStatus = o.caseStatus;

  $('chat-stage-badge').textContent = `Estado: Triaje Clase ${o.classification.level} · Revisión HITL`;
  $('class-chip').className = `classchip ${o.classification.level}`;
  $('class-chip').textContent = o.classification.level;
  $('risk').textContent = o.classification.risk;
  $('rule-id-badge').textContent = `M3 · ${o.classification.ruleId || 'RULE-DEMO'}`;
  $('rule-reason').textContent = o.classification.reason;

  const kws = o.classification.matchedKeywords || [];
  if (kws.length > 0) {
    $('keywords-list').innerHTML = kws.map(k => `<span class="kw-chip">“${escapeHTML(k)}”</span>`).join('');
  } else {
    $('keywords-list').innerHTML = '<span class="kw-chip alert">0 coincidencias en catálogo → Salvaguarda Precautoria Clase C</span>';
  }

  $('kb-source').textContent = `${o.guidance.id} · ${o.guidance.title}`;
  const checklist = o.guidance.checklist || [];
  $('kb-checklist').innerHTML = checklist.map(item => `<li>${escapeHTML(item)}</li>`).join('');
  $('suggestion').textContent = o.guidance.text;

  $('weight').textContent = `${o.recommendation.weight} unidades`;
  $('recommended').textContent = o.recommendation.agent?.display || 'En cola (Sin capacidad)';
  $('projected').textContent = o.recommendation.agent ? `${o.recommendation.projected} / 10` : 'Saturado';
  $('progress-fill').style.width = `${100 * (o.recommendation.projected || 0) / CAPACITY}%`;

  if (o.policyComparison) {
    const act = o.policyComparison.actual;
    const exp = o.policyComparison.experimental;
    $('cmp-actual').textContent = `${act.weight}u → ${act.agent ? `${act.agent.display} (${act.projected}/10)` : 'En cola'}`;
    $('cmp-exp').textContent = `${exp.weight}u → ${exp.agent ? `${exp.agent.display} (${exp.projected}/10)` : 'En cola'}`;
  }

  $('enqueue-btn').disabled = Boolean(o.recommendation.agent);

  document.querySelectorAll('.fourbtn button').forEach(b => {
    b.disabled = false;
    b.classList.remove('active-choice');
  });
  $('send-chat-btn').disabled = true;

  if (o.classification.level === 'C') {
    $('action-result').textContent = '⚠ Caso sensible Clase C: pulse "Escalar" para derivar formalmente al supervisor.';
    $('action-result').className = 'result escalated';
  } else {
    $('action-result').textContent = 'Pendiente: el asesor debe elegir una acción HITL antes de despachar o confirmar.';
    $('action-result').className = 'result muted';
  }

  updateAuthUI();
  renderChat();
  addLog('Triaje y recomendación');
}

$('process-btn').addEventListener('click', runCase);

$('reset-btn').addEventListener('click', () => {
  state.agents = structuredClone(AGENTS);
  state.logs = [];
  state.decisions = {};
  state.approvedRevisions = {};
  state.chatMessages = {};
  state.assignments = structuredClone(INITIAL_WIP);
  state.heldCases = [];
  state.escalatedCases = [];
  state.ivrManualVerified = false;
  state.counter = 0;
  setCase(CASES[0].id);
  select.value = CASES[0].id;
  renderTables();
});

// Botones de acción Human-in-the-Loop
$('btn-accept').addEventListener('click', () => {
  if (!state.output) return;
  const cid = state.selected.id;
  const isIvrPending = $('validation').value !== 'true';

  if (state.output.classification.level === 'C') {
    alert('Bloqueado por seguridad R02: Las consultas Clase C no admiten aceptación directa; deben ser escaladas.');
    return;
  }

  if (isIvrPending && !state.ivrManualVerified) {
    alert('Validación IVR pendiente: Debe marcar la casilla de verificación manual de identidad antes de autorizar la sugerencia.');
    $('ivr-verified-check').focus();
    return;
  }

  document.querySelectorAll('.fourbtn button').forEach(b => b.classList.remove('active-choice'));
  $('btn-accept').classList.add('active-choice');

  state.decisions[cid] = 'Aceptar';
  state.approvedRevisions[cid] = state.output.revision;
  state.isEditing = false;
  state.editApproved = false;
  state.caseStatus = 'APROBADO';

  $('suggestion').contentEditable = 'false';
  $('suggestion').style.background = '';
  $('suggestion').style.outline = '';
  $('save-edit-btn').style.display = 'none';
  $('send-chat-btn').disabled = false;

  $('action-result').textContent = '✓ Sugerencia aprobada por el asesor humano. Autorización concedida para despacho y asignación.';
  $('action-result').className = 'result done';

  addLog('Decisión humana', 'Aceptar', state.output.recommendation.agent?.display || '—', cid, state.output.classification.level, state.output.guidance.id, 'PERMITIDO');
  updateAuthUI();
});

$('btn-edit').addEventListener('click', () => {
  if (!state.output) return;
  const cid = state.selected.id;

  document.querySelectorAll('.fourbtn button').forEach(b => b.classList.remove('active-choice'));
  $('btn-edit').classList.add('active-choice');

  state.decisions[cid] = 'Editar';
  delete state.approvedRevisions[cid]; // Editar invalida aprobación hasta pulsar Guardar y Aprobar
  state.isEditing = true;
  state.editApproved = false;
  state.caseStatus = 'EDITANDO';

  $('suggestion').contentEditable = 'true';
  $('suggestion').style.background = '#fffef0';
  $('suggestion').style.outline = '2px solid #0176d3';
  $('suggestion').focus();
  $('save-edit-btn').style.display = 'block';
  $('send-chat-btn').disabled = true; // No se puede enviar hasta guardar

  $('action-result').textContent = 'Modo edición activo: modifique el texto y pulse “✓ Guardar y aprobar texto editado” para validar.';
  $('action-result').className = 'result done';

  addLog('Decisión humana', 'Editar (iniciado)', state.output.recommendation.agent?.display || '—', cid, state.output.classification.level, state.output.guidance.id, 'PERMITIDO');
  updateAuthUI();
});

$('save-edit-btn').addEventListener('click', () => {
  if (!state.output) return;
  const cid = state.selected.id;
  const isIvrPending = $('validation').value !== 'true';

  if (isIvrPending && !state.ivrManualVerified) {
    alert('Validación IVR pendiente: Debe marcar la casilla de verificación manual de identidad antes de aprobar la versión editada.');
    $('ivr-verified-check').focus();
    return;
  }

  const finalTxt = $('suggestion').textContent.trim();
  if (!finalTxt) {
    alert('El texto de respuesta no puede estar vacío.');
    return;
  }

  state.isEditing = false;
  state.editApproved = true;
  state.approvedRevisions[cid] = state.output.revision;
  state.caseStatus = 'APROBADO';

  $('suggestion').contentEditable = 'false';
  $('suggestion').style.background = '#f2fff5';
  $('suggestion').style.outline = '1px solid #7bc696';
  $('save-edit-btn').style.display = 'none';
  $('send-chat-btn').disabled = false;

  $('action-result').textContent = '✓ Texto editado guardado y aprobado por el asesor humano. Autorización concedida.';
  $('action-result').className = 'result done';

  addLog('Edición aprobada', 'Guardar y aprobar', state.output.recommendation.agent?.display || '—', cid, state.output.classification.level, state.output.guidance.id, 'PERMITIDO');
  updateAuthUI();
});

$('btn-reject').addEventListener('click', () => {
  if (!state.output) return;
  const cid = state.selected.id;

  document.querySelectorAll('.fourbtn button').forEach(b => b.classList.remove('active-choice'));
  $('btn-reject').classList.add('active-choice');

  state.decisions[cid] = 'Rechazar';
  delete state.approvedRevisions[cid];
  state.isEditing = false;
  state.editApproved = false;
  state.caseStatus = 'RECHAZADO';

  $('suggestion').contentEditable = 'false';
  $('suggestion').style.background = '';
  $('suggestion').style.outline = '';
  $('save-edit-btn').style.display = 'none';
  $('send-chat-btn').disabled = true;

  $('action-result').textContent = '✕ Recomendación rechazada. Asignación y despacho automático bloqueados.';
  $('action-result').className = 'result muted';

  addLog('Decisión humana', 'Rechazar', state.output.recommendation.agent?.display || '—', cid, state.output.classification.level, state.output.guidance.id, 'PERMITIDO', 'Sugerencia rechazada');
  updateAuthUI();
});

function executeEscalation() {
  if (!state.output) return;
  const cid = state.selected.id;
  const esc = registerEscalation({
    caseData: state.selected,
    output: state.output,
    reason: state.output.classification.reason,
    actorRole: 'Asesor WhatsApp'
  });

  document.querySelectorAll('.fourbtn button').forEach(b => b.classList.remove('active-choice'));
  $('btn-escalate').classList.add('active-choice');

  state.decisions[cid] = 'Escalar';
  delete state.approvedRevisions[cid];
  state.caseStatus = 'DERIVADO_SUPERVISOR';
  state.escalatedCases.unshift(esc);

  $('suggestion').contentEditable = 'false';
  $('suggestion').style.background = '';
  $('suggestion').style.outline = '';
  $('save-edit-btn').style.display = 'none';
  $('send-chat-btn').disabled = true;
  $('chat-stage-badge').textContent = 'Estado: Escalado formal a Supervisor';

  $('action-result').textContent = `⚠ Caso derivado formalmente a ${esc.targetQueue}. Envío ordinario bloqueado por seguridad.`;
  $('action-result').className = 'result escalated';

  if (!state.chatMessages[cid]) state.chatMessages[cid] = [];
  state.chatMessages[cid].push({
    type: 'escalation',
    time: new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
    text: `Caso ${cid} (Clase ${state.output.classification.level}) derivado a supervisión. Motivo: ${esc.reason}. No se emite respuesta ordinaria al cliente.`
  });

  addLog('Escalamiento registrado', 'Derivado a Supervisor', esc.targetQueue, cid, state.output.classification.level, state.output.guidance.id, 'ESCALADO', esc.reason);
  updateAuthUI();
  renderChat();
}

$('btn-escalate').addEventListener('click', executeEscalation);
$('escalate-action-btn').addEventListener('click', executeEscalation);

// Despacho controlado al hilo del chat
$('send-chat-btn').addEventListener('click', () => {
  if (!state.output) return;
  const cid = state.selected.id;
  const decision = state.decisions[cid] || 'Aceptar';
  const finalReply = $('suggestion').textContent.trim();
  if (!finalReply) return;

  const sender = state.output.recommendation.agent?.display || 'Asesor en Turno';
  if (!state.chatMessages[cid]) state.chatMessages[cid] = [];
  state.chatMessages[cid].push({
    type: 'advisor',
    sender,
    decision,
    time: new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
    text: finalReply
  });

  $('send-chat-btn').disabled = true;
  $('chat-stage-badge').textContent = 'Estado: Respuesta despachada (HITL)';
  $('action-result').textContent = `✓ Respuesta despachada al cliente tras validación humana (${decision}).`;
  $('action-result').className = 'result done';

  renderChat();
  addLog('Respuesta despachada (HITL)', decision, sender, cid, state.output.classification.level, state.output.guidance.id, 'PERMITIDO');
});

// Confirmar asignación ordinaria (Sometido a canConfirmAssignment)
$('assign-btn').addEventListener('click', () => {
  const auth = getCurrentAuthCheck();
  const cid = state.selected.id;

  if (!auth.allowed) {
    alert(`Asignación bloqueada por seguridad R02 [${auth.code}]:\n${auth.reason}`);
    addLog(
      'Intento de asignación bloqueado',
      auth.code,
      '—',
      cid,
      state.output?.classification?.level || '—',
      'SEGURIDAD-R02',
      'BLOQUEADO',
      auth.reason
    );
    return;
  }

  const choice = state.agents.find(a => a.id === auth.targetAgent.id);
  const w = auth.weight;

  choice.load += w;
  if (choice.load >= CAPACITY) {
    choice.status = 'Ocupado';
  }
  state.counter++;
  state.caseStatus = 'ASIGNADO';

  state.assignments.unshift({
    uid: `WIP-${Date.now()}-${state.counter}`,
    queue: 'WhatsApp',
    id: cid,
    branch: $('branch').value,
    type: 'Conversación',
    agentId: choice.id,
    agent: choice.display,
    weight: w,
    age: '00:10',
    level: state.output.classification.level,
    status: 'En curso'
  });

  $('assign-btn').disabled = true;
  addLog(
    'Asignación confirmada',
    state.decisions[cid] || 'Aprobado',
    choice.display,
    cid,
    state.output.classification.level,
    state.output.guidance.id,
    'PERMITIDO'
  );
  $('route-reason').textContent = `✓ Asignación confirmada: ${choice.display} · ${choice.load}/10 u. ocupadas.`;
  updateAuthUI();
  renderTables();
});

// Retener caso en cola cuando no hay capacidad
$('enqueue-btn').addEventListener('click', () => {
  if (!state.output) return;
  const cid = state.selected.id;
  const branch = $('branch').value;
  const level = state.output.classification.level;
  const weight = state.output.recommendation.weight;

  state.heldCases.push({
    uid: `HELD-${Date.now()}`,
    id: cid,
    branch,
    level,
    weight,
    reason: state.output.recommendation.reason,
    time: new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  });

  $('enqueue-btn').disabled = true;
  $('route-reason').textContent = `⏳ Caso ${cid} retenido en cola controlada (Pestaña 3). Libere un asesor para reintentar routing.`;
  addLog('Caso retenido en cola', 'Retención por saturación', 'Cola WhatsApp', cid, level, 'P3-COLA', 'PERMITIDO', 'Capacidad agotada');
  renderTables();
});

// Sincronizar cambio de política
function setPolicy(newPolicy) {
  state.policy = newPolicy;
  $('header-policy-label').textContent = newPolicy === 'experimental' ? 'Experimental (A4/B5/C7)' : 'Actual (5u)';
  document.querySelectorAll('input[name="policy"]').forEach(r => {
    r.checked = (r.value === newPolicy);
  });
  invalidateCurrentApproval('Cambio de política operativa');
  if (state.output) {
    runCase();
  } else {
    resetOutput();
    renderChat();
  }
}

$('quick-policy-btn').addEventListener('click', () => {
  setPolicy(state.policy === 'actual' ? 'experimental' : 'actual');
});

document.querySelectorAll('input[name="policy"]').forEach(x => {
  x.addEventListener('change', () => setPolicy(x.value));
});

$('reset-agents-btn').addEventListener('click', () => {
  state.agents = structuredClone(AGENTS);
  addLog('Supervisión de turno', 'Restablecer asesores', 'Supervisor', 'SUPERVISIÓN', '—', 'P2-CONTROL', 'PERMITIDO');
  renderTables();
  updateAuthUI();
});

$('log-filter-class').addEventListener('change', e => {
  state.logFilterClass = e.target.value;
  renderTables();
});

function updateCalculator() {
  const vol = Number($('calc-vol').value);
  const delta = Number($('calc-delta').value);
  $('calc-vol-val').textContent = vol.toLocaleString('es-PE');
  $('calc-delta-val').textContent = `${delta.toFixed(2)} min`;
  const res = calculateCapacityRecovery(vol, delta);
  $('calc-hours').textContent = `${res.hoursRecovered.toLocaleString('es-PE')} h/mes`;
  $('calc-shifts').textContent = `${res.equivalentShifts8h.toLocaleString('es-PE')} turnos/mes`;
}
$('calc-vol').addEventListener('input', updateCalculator);
$('calc-delta').addEventListener('input', updateCalculator);

function renderTables() {
  const availCount = state.agents.filter(a => a.status === 'Disponible' && a.load < CAPACITY).length;
  const totalUsedUnits = state.agents.reduce((acc, a) => acc + a.load, 0);
  const totalCapacity = state.agents.length * CAPACITY;
  const utilPct = Math.round((totalUsedUnits / totalCapacity) * 100);

  $('badge-agents').textContent = `${availCount} disp.`;
  const waPendingCount = 2 + state.heldCases.length;
  $('badge-queues').textContent = String(waPendingCount + 1);
  $('badge-wip').textContent = String(state.assignments.filter(a => a.status === 'En curso').length);
  $('badge-logs').textContent = String(state.logs.length);

  $('kpi-avail-agents').textContent = `${availCount} / ${state.agents.length}`;
  $('kpi-used-units').innerHTML = `${totalUsedUnits} <em>u.</em>`;
  $('kpi-util-pct').innerHTML = `${utilPct}<em>%</em>`;

  // 1. Representantes (P2)
  $('agents-body').innerHTML = state.agents.map(a => `
    <tr>
      <td><span class="link">${escapeHTML(a.display)}</span> <small style="color:#6c7684;">(${escapeHTML(a.id)})</small></td>
      <td>
        <span class="status ${a.status === 'Disponible' ? 'ok' : a.status === 'Ocupado' ? 'bad' : 'wait'}"></span>
        <select class="status-select" data-agent-status="${escapeHTML(a.id)}">
          <option value="Disponible" ${a.status === 'Disponible' ? 'selected' : ''}>Disponible</option>
          <option value="Ocupado" ${a.status === 'Ocupado' ? 'selected' : ''}>Ocupado</option>
          <option value="Refrigerio" ${a.status === 'Refrigerio' ? 'selected' : ''}>Refrigerio</option>
        </select>
      </td>
      <td>${escapeHTML(a.skills.join(', '))}</td>
      <td>${a.load === 0 ? '0 casos' : `${Math.ceil(a.load / 5)} activo(s)`}</td>
      <td>WhatsApp</td>
      <td><div class="meter ${a.load >= 10 ? 'full' : ''}"><span style="width:${Math.min(100, a.load * 10)}%"></span></div><small>${a.load * 10}%</small></td>
      <td><strong>${a.load} / 10</strong></td>
      <td>
        <button class="btn-mini" data-release-agent="${escapeHTML(a.id)}" ${a.load === 0 && a.status === 'Disponible' ? 'disabled' : ''}>
          ↺ Liberar / Activar
        </button>
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('[data-agent-status]').forEach(sel => {
    sel.addEventListener('change', () => {
      const ag = state.agents.find(x => x.id === sel.dataset.agentStatus);
      if (!ag) return;
      ag.status = sel.value;
      if (ag.status === 'Disponible' && ag.load >= CAPACITY) {
        ag.load = 5;
      }
      addLog('Cambio estado asesor', `Estado → ${ag.status}`, ag.display, 'SUPERVISIÓN', '—', 'P2-CONTROL', 'PERMITIDO');
      renderTables();
      updateAuthUI();
    });
  });

  document.querySelectorAll('[data-release-agent]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ag = state.agents.find(x => x.id === btn.dataset.releaseAgent);
      if (!ag) return;
      ag.load = 0;
      ag.status = 'Disponible';
      addLog('Capacidad liberada manual', 'Carga → 0/10 (Disponible)', ag.display, 'SUPERVISIÓN', '—', 'P2-CONTROL', 'PERMITIDO');
      renderTables();
      updateAuthUI();
    });
  });

  // 2. Colas (P3)
  const queues = [
    ['WhatsApp', '3', `${waPendingCount} pendientes`, 'Mensajería', '06:40', '04:25', '03:20', waPendingCount > 2 ? 'Alto (Saturación)' : 'Monitorizar'],
    ['Correo', '11', '1 pendiente', 'Caso', '05:10', '05:10', '05:10', 'Monitorizar'],
    ['Facebook', '1', '0 pendientes', 'Mensajería', '00:00', '—', '—', 'Normal']
  ];
  $('queues-body').innerHTML = queues.map(q => `<tr>${q.map(v => `<td>${escapeHTML(v)}</td>`).join('')}</tr>`).join('');

  // Casos retenidos en cola dinámica (P3)
  $('held-cases-body').innerHTML = state.heldCases.length
    ? state.heldCases.map(h => `
        <tr>
          <td><strong>${escapeHTML(h.id)}</strong></td>
          <td>${escapeHTML(h.branch)}</td>
          <td><span class="classchip ${escapeHTML(h.level)}" style="min-width:26px;min-height:22px;font-size:12px;">${escapeHTML(h.level)}</span></td>
          <td>${escapeHTML(h.weight)} u.</td>
          <td>${escapeHTML(h.reason)}</td>
          <td>${escapeHTML(h.time)}</td>
          <td><button class="btn-mini" data-retry-held="${escapeHTML(h.uid)}">↪ Reintentar routing</button></td>
        </tr>
      `).join('')
    : '<tr><td colspan="7">No hay casos retenidos por saturación en este momento. Puede simular saturación con DEMO-006 o DEMO-007 en “Atención asistida”.</td></tr>';

  document.querySelectorAll('[data-retry-held]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = state.heldCases.findIndex(x => x.uid === btn.dataset.retryHeld);
      if (idx === -1) return;
      const h = state.heldCases[idx];
      const rec = route(state.agents, h.level, h.branch, state.policy);
      if (!rec.agent) {
        alert(`Aún no hay un asesor disponible con skill ${h.branch} y capacidad para ${rec.weight} unidades. Libere carga en la pestaña Representantes o Trabajo en Curso.`);
        return;
      }
      const target = state.agents.find(a => a.id === rec.agent.id);
      target.load += rec.weight;
      if (target.load >= CAPACITY) target.status = 'Ocupado';
      state.heldCases.splice(idx, 1);
      state.assignments.unshift({
        uid: `WIP-RETRY-${Date.now()}`,
        queue: 'WhatsApp',
        id: h.id,
        branch: h.branch,
        type: 'Conversación (Desencolado)',
        agentId: target.id,
        agent: target.display,
        weight: rec.weight,
        age: '00:05',
        level: h.level,
        status: 'En curso'
      });
      addLog('Desencolado y asignado', `Asignado tras liberar cola (${rec.weight}u)`, target.display, h.id, h.level, 'P3-COLA', 'PERMITIDO');
      renderTables();
    });
  });

  // 3. Trabajo en curso (P4)
  $('wip-body').innerHTML = state.assignments.map(x => `
    <tr>
      <td>${escapeHTML(x.queue)}</td>
      <td><strong>${escapeHTML(x.id)}</strong></td>
      <td>${escapeHTML(x.branch)} · ${escapeHTML(x.type)}</td>
      <td>${escapeHTML(x.agent)}</td>
      <td>${escapeHTML(x.weight)} u.</td>
      <td>${escapeHTML(x.age)}</td>
      <td>${escapeHTML(x.level)}</td>
      <td><span class="status ${x.status === 'En curso' ? 'ok' : 'wait'}"></span>${escapeHTML(x.status)}</td>
      <td>
        ${x.status === 'En curso'
          ? `<button class="btn-mini" data-complete-wip="${escapeHTML(x.uid)}">✓ Finalizar (Liberar ${escapeHTML(x.weight)}u)</button>`
          : '<small style="color:#6c7684;">Cerrado</small>'}
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('[data-complete-wip]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = state.assignments.find(x => x.uid === btn.dataset.completeWip);
      if (!item || item.status !== 'En curso') return;
      item.status = 'Completado';
      const ag = state.agents.find(a => a.id === item.agentId || a.display === item.agent);
      if (ag) {
        ag.load = Math.max(0, ag.load - (item.weight || 5));
        if (ag.status === 'Ocupado' && ag.load < CAPACITY) {
          ag.status = 'Disponible';
        }
      }
      addLog('Atención finalizada (WIP)', `Liberadas ${item.weight}u`, item.agent, item.id, item.level, 'P4-WIP', 'PERMITIDO');
      renderTables();
      updateAuthUI();
    });
  });

  // 4. Bitácora (P5)
  $('log-kpi-total').textContent = String(state.logs.length);
  $('log-kpi-accepted').textContent = String(state.logs.filter(l => l.action === 'Aceptar' || l.action === 'Guardar y aprobar').length);
  $('log-kpi-escalated').textContent = String(state.logs.filter(l => l.result === 'ESCALADO' || l.action === 'Escalar' || l.level === 'C').length);
  $('log-kpi-routed').textContent = String(state.logs.filter(l => l.event.includes('Asignación') || l.event.includes('despachada')).length);

  const filteredLogs = state.logFilterClass === 'ALL'
    ? state.logs
    : state.logs.filter(r => r.level === state.logFilterClass);

  $('log-body').innerHTML = filteredLogs.length
    ? filteredLogs.map(r => `
        <tr>
          <td><small>${escapeHTML(r.time)}</small></td>
          <td><strong>${escapeHTML(r.case)}</strong></td>
          <td><code class="rev-token">${escapeHTML(r.revision || '—')}</code></td>
          <td><small>${escapeHTML(r.caseStatus || '—')}</small></td>
          <td>${escapeHTML(r.event)}</td>
          <td>${r.level !== '—' ? `<span class="classchip ${escapeHTML(r.level)}" style="min-width:24px;min-height:20px;font-size:11px;">${escapeHTML(r.level)}</span>` : '—'}</td>
          <td>
            <span class="status ${r.result === 'PERMITIDO' ? 'ok' : (r.result === 'BLOQUEADO' ? 'bad' : 'wait')}"></span>
            <strong>${escapeHTML(r.result || 'PERMITIDO')}</strong>
          </td>
          <td>${escapeHTML(r.action)}</td>
          <td><small style="color:${r.result === 'BLOQUEADO' ? '#c23934' : '#555'}">${escapeHTML(r.blockReason || '—')}</small></td>
          <td>${escapeHTML(r.agent)}</td>
          <td><small>${escapeHTML(r.policy)}</small></td>
        </tr>
      `).join('')
    : '<tr><td colspan="11">No hay eventos para el filtro seleccionado. Procese consultas en “Atención asistida”.</td></tr>';
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
  downloadFile(jsonContent, 'SAI_GC_BITACORA_R02.json', 'application/json');
});

$('export-csv-btn').addEventListener('click', () => {
  const csvContent = export_evidence(state.logs, 'csv');
  downloadFile(csvContent, 'SAI_GC_BITACORA_R02.csv', 'text/csv;charset=utf-8;');
});

$('clear-btn').addEventListener('click', () => {
  state.logs = [];
  renderTables();
});

updateCalculator();
setCase(CASES[0].id);
renderTables();
