"""
SAI-GC — Sistema de Asistencia Inteligente y Gestión de Capacidad
MVP Académico Demostrativo en Streamlit · Fase Escalable Python (v0.5-r02-verificable)
"""

import html
import streamlit as st
import pandas as pd
from datetime import datetime
from logic import (
    VERSION, CAPACITY, CASES, AGENTS,
    classify, weight_for, route, respond, process_case,
    compute_case_revision, can_confirm_assignment, register_escalation,
    calculate_capacity_recovery, export_evidence
)
from database import init_db, insert_log, fetch_logs, clear_logs, export_db_evidence

st.set_page_config(
    page_title="SAI-GC | MVP R02 Verificable",
    page_icon="⚖️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Inicializar DB y estado de sesión
init_db()

if "agents" not in st.session_state:
    st.session_state.agents = [dict(a, skills=list(a["skills"])) for a in AGENTS]
if "policy" not in st.session_state:
    st.session_state.policy = "actual"
if "assignments" not in st.session_state:
    st.session_state.assignments = [
        {"uid": "WIP-BASE-1", "Cola": "WhatsApp", "Caso": "DEMO-WIP-001", "Ramo": "Vida", "Tipo": "Conversación", "agentId": "AG-02", "Asesor": "Asesor Demo 02", "Unidades": 5, "Tiempo": "05:40", "Clase": "B", "Estado": "En curso"},
        {"uid": "WIP-BASE-2", "Cola": "Correo", "Caso": "DEMO-WIP-002", "Ramo": "Salud", "Tipo": "Caso Correo", "agentId": "AG-03", "Asesor": "Asesor Demo 03", "Unidades": 10, "Tiempo": "12:30", "Clase": "N/A", "Estado": "En curso"}
    ]
if "held_cases" not in st.session_state:
    st.session_state.held_cases = []
if "escalated_cases" not in st.session_state:
    st.session_state.escalated_cases = []
if "chat_messages" not in st.session_state:
    st.session_state.chat_messages = {}
if "decisions" not in st.session_state:
    st.session_state.decisions = {}
if "approved_revisions" not in st.session_state:
    st.session_state.approved_revisions = {}
if "is_editing" not in st.session_state:
    st.session_state.is_editing = False
if "edit_approved" not in st.session_state:
    st.session_state.edit_approved = False
if "ivr_manual_verified" not in st.session_state:
    st.session_state.ivr_manual_verified = False
if "last_output" not in st.session_state:
    st.session_state.last_output = None
if "selected_case_id" not in st.session_state:
    st.session_state.selected_case_id = "DEMO-001"

# Barra de navegación superior
pol_badge = "Actual (5u)" if st.session_state.policy == "actual" else "Experimental (A4/B5/C7)"
st.markdown(f"""
<div style="background: linear-gradient(135deg, #014486, #0176d3); padding: 12px 20px; border-radius: 6px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; color: white;">
  <div>
    <h2 style="margin: 0; color: white; display: inline;">SAI-GC</h2>
    <span style="font-size: 14px; opacity: 0.92; margin-left: 10px;">Sistema de Asistencia Inteligente y Gestión de Capacidad · {html.escape(VERSION)}</span>
  </div>
  <div>
    <span style="background-color: #f3f0ff; color: #4f2d91; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 12px; margin-right: 8px;">Política: {html.escape(pol_badge)}</span>
    <span style="background-color: #bad5f9; color: #014486; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 12px; margin-right: 8px;">DEMO · DATOS SINTÉTICOS</span>
    <span style="background-color: #fff5d7; color: #76520c; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 12px;">NO CONECTADO A SALESFORCE</span>
  </div>
</div>
""", unsafe_allow_html=True)

avail_agents_count = sum(1 for a in st.session_state.agents if a["status"] == "Disponible" and a["load"] < CAPACITY)
active_wip_count = sum(1 for w in st.session_state.assignments if w["Estado"] == "En curso")
held_count = len(st.session_state.held_cases)

tab_names = [
    "1. Atención Asistida",
    f"2. Representantes ({avail_agents_count} disp.)",
    f"3. Retraso de Colas ({2 + held_count} pend.)",
    f"4. Trabajo en Curso ({active_wip_count})",
    "5. Bitácora de Auditoría",
    "6. Configuración y Cap. V"
]
tabs = st.tabs(tab_names)

# --- TAB 1: ATENCIÓN ASISTIDA ---
with tabs[0]:
    st.markdown("### Línea Base Histórica de Diagnóstico (Ene–Jul 2026)")
    c1, c2, c3, c4 = st.columns(4)
    with c1:
        st.metric(label="TMO As-Is Observado", value="16.76 min", help="Histórico corporativo (55,924 interacciones)")
    with c2:
        st.metric(label="Meta Interna Corporativa", value="14.50 min", help="Referencia oficial de gestión")
    with c3:
        st.metric(label="TMO Atenciones Efectivas", value="18.45 min", help="Línea base ajustada sin abandonos")
    with c4:
        st.metric(label="Tasa Histórica de Abandono", value="16.93 %", help="Línea base de diagnóstico")

    st.markdown("---")

    col_chat, col_assist = st.columns([1.08, 1.0])

    with col_chat:
        st.subheader("Conversación WhatsApp (Simulación Interactiva)")

        case_options = {c['id']: f"{c['id']} · {c['name']}" for c in CASES}
        selected_id = st.selectbox(
            "Seleccionar caso de prueba:",
            options=list(case_options.keys()),
            format_func=lambda x: case_options[x],
            key="case_picker"
        )

        current_case = next(c for c in CASES if c['id'] == selected_id)

        if st.session_state.selected_case_id != selected_id:
            st.session_state.selected_case_id = selected_id
            st.session_state.last_output = None
            st.session_state.ivr_manual_verified = False
            st.session_state.is_editing = False
            st.session_state.edit_approved = False
            st.session_state.approved_revisions.pop(selected_id, None)
            st.session_state.decisions.pop(selected_id, None)

            if current_case.get('scenario') == 'all_busy':
                st.session_state.agents = [dict(a, status='Ocupado', load=10, skills=list(a['skills'])) for a in AGENTS]
            elif current_case.get('scenario') == 'agent_paused':
                st.session_state.agents = [
                    {'id': 'AG-01', 'display': 'Asesor Demo 01', 'status': 'Ocupado', 'load': 10, 'skills': ['Vida', 'Vehicular']},
                    {'id': 'AG-02', 'display': 'Asesor Demo 02', 'status': 'Ocupado', 'load': 10, 'skills': ['Vida', 'Vehicular']},
                    {'id': 'AG-03', 'display': 'Asesor Demo 03', 'status': 'Ocupado', 'load': 10, 'skills': ['Vehicular']},
                    {'id': 'AG-04', 'display': 'Asesor Demo 04', 'status': 'Refrigerio', 'load': 0, 'skills': ['Vida', 'Salud']}
                ]
            elif all(a['load'] == 10 for a in st.session_state.agents):
                st.session_state.agents = [dict(a, skills=list(a['skills'])) for a in AGENTS]

        c_v1, c_v2 = st.columns(2)
        with c_v1:
            ivr_validated = st.selectbox(
                "Estado de validación IVR:",
                options=[True, False],
                index=0 if current_case['validated'] else 1,
                format_func=lambda x: "✓ Validado por bot" if x else "! Pendiente: valida asesor"
            )
        with c_v2:
            branch = st.selectbox(
                "Ramo de seguro:",
                options=["Vida", "Salud", "Vehicular"],
                index=["Vida", "Salud", "Vehicular"].index(current_case['branch'])
            )

        query_text = st.text_area("Motivo de consulta (anonimizado / editable):", value=current_case['text'], height=85)

        # Si el usuario modificó parámetros, invalidar aprobación previa
        case_obj_temp = {
            'id': current_case['id'],
            'text': query_text,
            'validated': ivr_validated,
            'branch': branch
        }
        live_revision = compute_case_revision(case_obj_temp, st.session_state.policy)
        if st.session_state.approved_revisions.get(current_case['id']) and st.session_state.approved_revisions.get(current_case['id']) != live_revision:
            st.session_state.approved_revisions.pop(current_case['id'], None)
            st.session_state.decisions.pop(current_case['id'], None)

        out = st.session_state.last_output
        custom_msgs = st.session_state.chat_messages.get(current_case['id'], [])

        # Construir burbujas dinámicas con html.escape
        proposal_html = ""
        if out and out.get('caseId') == current_case['id']:
            proposal_html = f"""
            <div style="background-color: #f2f8ff; border: 1.5px dashed #69a6e8; color: #164370; padding: 10px; border-radius: 6px; margin-top: 8px; margin-left: auto; width: 88%; font-size: 12.5px;">
              <b>⚙ SAI-GC · BORRADOR INTERNO (Clase {html.escape(out['classification']['level'])} · {html.escape(out['guidance']['id'])} · Rev: {html.escape(out.get('revision', '—'))}):</b><br>
              "{html.escape(out['guidance']['text'])}"<br>
              <em style="font-size: 11px;">🔒 Control Human-in-the-Loop activo: revise, valide identidad y apruebe antes de despachar o asignar.</em>
            </div>
            """

        dispatched_html = ""
        for m in custom_msgs:
            if m["type"] == "advisor":
                dispatched_html += f"""
                <div style="background-color: #0176d3; color: white; padding: 10px; border-radius: 6px; margin-top: 8px; margin-left: auto; width: 85%; font-size: 12.5px;">
                  <b>👤 {html.escape(m['sender'])} (Validado HITL: {html.escape(m['decision'])} · {html.escape(m['time'])} ✓✓):</b><br>{html.escape(m['text'])}
                </div>
                """
            elif m["type"] == "escalation":
                dispatched_html += f"""
                <div style="background-color: #fef2f2; border: 1px solid #f3b7b7; color: #9b1c1c; padding: 10px; border-radius: 6px; margin-top: 8px; font-size: 12px;">
                  <b>⚠ ESCALAMIENTO OPERACIONAL ({html.escape(m['time'])}):</b><br>{html.escape(m['text'])}
                </div>
                """

        ivr_label = '✓ Identidad validada en IVR' if ivr_validated else ('✓ Identidad verificada manualmente' if st.session_state.ivr_manual_verified else '! Identidad pendiente de verificación')
        st.markdown(f"""
        <div style="background-color: #f9fafb; border: 1px solid #d8dde4; border-radius: 6px; padding: 15px; margin-bottom: 12px;">
          <div style="text-align: center; color: #596579; font-size: 11px; margin-bottom: 10px;">
            ◉ Caso <b>{html.escape(current_case['id'])}</b> · Ramo {html.escape(branch)} · {html.escape(ivr_label)}
          </div>
          <div style="background-color: white; border: 1px solid #e1e6ec; padding: 10px; border-radius: 6px; margin-bottom: 8px; width: 82%; font-size: 12.5px;">
            <b>Cliente (demostración · 10:15 ✓✓):</b><br>{html.escape(query_text)}
          </div>
          {proposal_html}
          {dispatched_html}
        </div>
        """, unsafe_allow_html=True)

        col_btn1, col_btn2 = st.columns([2, 1])
        with col_btn1:
            btn_process = st.button("⚡ Procesar Consulta (Triaje + KB + Routing)", type="primary", use_container_width=True)
        with col_btn2:
            if st.button("↺ Reiniciar Demo", use_container_width=True):
                st.session_state.agents = [dict(a, skills=list(a["skills"])) for a in AGENTS]
                st.session_state.chat_messages = {}
                st.session_state.decisions = {}
                st.session_state.approved_revisions = {}
                st.session_state.held_cases = []
                st.session_state.escalated_cases = []
                st.session_state.ivr_manual_verified = False
                st.session_state.is_editing = False
                st.session_state.edit_approved = False
                st.session_state.last_output = None
                st.rerun()

    with col_assist:
        st.subheader("Asistencia Inteligente y Routing (R02)")

        if btn_process:
            test_obj = {
                'id': current_case['id'],
                'text': query_text,
                'validated': ivr_validated,
                'branch': branch
            }
            output = process_case(test_obj, st.session_state.agents, st.session_state.policy)
            st.session_state.last_output = output
            st.session_state.is_editing = False
            st.session_state.edit_approved = False
            st.session_state.approved_revisions.pop(current_case['id'], None)
            st.session_state.decisions.pop(current_case['id'], None)

            insert_log({
                'timestampIso': datetime.now().isoformat(),
                'time': datetime.now().strftime('%d/%m/%Y, %H:%M:%S'),
                'case': current_case['id'],
                'revision': output.get('revision', '—'),
                'caseStatus': output.get('caseStatus', 'PENDIENTE_REVISION'),
                'event': 'Triaje y recomendación',
                'level': output['classification']['level'],
                'source': output['guidance']['id'],
                'action': 'Pendiente',
                'result': 'PERMITIDO',
                'blockReason': '—',
                'actorRole': 'Sistema SAI-GC',
                'agent': output['recommendation']['agent']['display'] if output['recommendation']['agent'] else 'En cola',
                'policy': st.session_state.policy,
                'version': VERSION
            })
            st.rerun()

        out = st.session_state.last_output

        if out and out.get('caseId') == current_case['id']:
            level = out['classification']['level']
            color_badge = "#e0f4e4" if level == 'A' else ("#fff2d7" if level == 'B' else "#fbe7e7")
            text_badge = "#1a6337" if level == 'A' else ("#8b5c07" if level == 'B' else "#ab2e2e")
            kws = out['classification'].get('matchedKeywords', [])
            kw_str = ", ".join(f'"{html.escape(k)}"' for k in kws) if kws else "0 coincidencias → Salvaguarda Precautoria Clase C"

            rev_token = out.get('revision', '—')
            case_status_display = "ESCALAMIENTO REQUERIDO" if level == 'C' else ("APROBADO" if st.session_state.approved_revisions.get(current_case['id']) == rev_token else ("EDITANDO" if st.session_state.is_editing else "PENDIENTE REVISIÓN"))

            st.markdown(f"""
            <div style="background-color: white; border: 1px solid #d8dde4; border-radius: 6px; padding: 12px; margin-bottom: 10px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <span style="font-weight: bold; color: #014486;">Triaje A/B/C:</span>
                  <span style="background-color: {color_badge}; color: {text_badge}; padding: 3px 10px; border-radius: 4px; font-weight: bold; font-size: 15px; margin-left: 8px;">Clase {html.escape(level)}</span>
                </div>
                <div>
                  <span style="font-size: 11px; background:#eef2f6; border:1px solid #cbd7e3; padding:2px 6px; border-radius:3px; font-family:monospace;">Rev: {html.escape(rev_token)}</span>
                  <span style="font-size: 11px; font-weight:bold; color:#014486; margin-left:6px;">[{html.escape(case_status_display)}]</span>
                </div>
              </div>
              <div style="font-size: 12px; color: #596579; margin-top: 6px;"><b>Riesgo:</b> {html.escape(out['classification']['risk'])} | <b>Motivo:</b> {html.escape(out['classification']['reason'])}</div>
              <div style="font-size: 11.5px; color: #01549b; margin-top: 5px; background:#f0f7ff; padding:4px 8px; border-radius:4px;"><b>Términos detectados:</b> {kw_str}</div>
            </div>
            """, unsafe_allow_html=True)

            checklist_items = "".join(f"<li>{html.escape(item)}</li>" for item in out['guidance'].get('checklist', []))
            st.markdown(f"""
            <div style="background-color: white; border: 1px solid #d8dde4; border-radius: 6px; padding: 12px; margin-bottom: 10px;">
              <div style="font-size: 11px; font-weight: bold; color: #0176d3; text-transform: uppercase;">Fuente Recuperada: {html.escape(out['guidance']['id'])} · {html.escape(out['guidance']['title'])}</div>
              <ul style="font-size: 11.5px; color: #3f5164; margin: 6px 0; padding-left: 18px;">{checklist_items}</ul>
            </div>
            """, unsafe_allow_html=True)

            if not ivr_validated:
                st.session_state.ivr_manual_verified = st.checkbox(
                    "Verificación manual obligatoria: Confirmo haber validado la identidad del titular conforme al procedimiento autorizado.",
                    value=st.session_state.ivr_manual_verified,
                    key="chk_ivr_manual"
                )

            edited_reply = st.text_area(
                "Respuesta sugerida para revisión / edición del asesor (HITL):",
                value=out['guidance']['text'],
                height=85,
                key=f"reply_box_{current_case['id']}"
            )

            st.markdown("<b>Decisión Humana Requerida (Human-in-the-Loop):</b>", unsafe_allow_html=True)
            b1, b2, b3, b4 = st.columns(4)
            agent_disp = out['recommendation']['agent']['display'] if out['recommendation']['agent'] else 'Asesor en Turno'
            now_iso = datetime.now().isoformat()
            now_str = datetime.now().strftime('%d/%m/%Y, %H:%M:%S')
            short_time = datetime.now().strftime('%H:%M')

            with b1:
                btn_accept_disabled = (level == 'C')
                if st.button("✓ Aceptar", use_container_width=True, disabled=btn_accept_disabled, help="Bloqueado en Clase C por seguridad operacional"):
                    if not ivr_validated and not st.session_state.ivr_manual_verified:
                        st.error("Validación IVR pendiente: Debe marcar la casilla de verificación manual de identidad antes de aceptar.")
                    else:
                        st.session_state.decisions[out['caseId']] = 'Aceptar'
                        st.session_state.approved_revisions[out['caseId']] = rev_token
                        st.session_state.is_editing = False
                        st.session_state.edit_approved = False
                        insert_log({
                            'timestampIso': now_iso,
                            'time': now_str,
                            'case': out['caseId'],
                            'revision': rev_token,
                            'caseStatus': 'APROBADO',
                            'event': 'Decisión humana',
                            'level': level,
                            'source': out['guidance']['id'],
                            'action': 'Aceptar',
                            'result': 'PERMITIDO',
                            'blockReason': '—',
                            'actorRole': 'Asesor WhatsApp (HITL)',
                            'agent': agent_disp,
                            'policy': st.session_state.policy,
                            'version': VERSION
                        })
                        st.rerun()

            with b2:
                if st.button("✎ Guardar Edición", use_container_width=True):
                    if not ivr_validated and not st.session_state.ivr_manual_verified:
                        st.error("Validación IVR pendiente: Debe marcar la casilla de verificación manual de identidad antes de aprobar la edición.")
                    else:
                        st.session_state.decisions[out['caseId']] = 'Editar'
                        st.session_state.approved_revisions[out['caseId']] = rev_token
                        st.session_state.is_editing = False
                        st.session_state.edit_approved = True
                        insert_log({
                            'timestampIso': now_iso,
                            'time': now_str,
                            'case': out['caseId'],
                            'revision': rev_token,
                            'caseStatus': 'APROBADO',
                            'event': 'Edición aprobada',
                            'level': level,
                            'source': out['guidance']['id'],
                            'action': 'Editar y Aprobar',
                            'result': 'PERMITIDO',
                            'blockReason': '—',
                            'actorRole': 'Asesor WhatsApp (HITL)',
                            'agent': agent_disp,
                            'policy': st.session_state.policy,
                            'version': VERSION
                        })
                        st.rerun()

            with b3:
                if st.button("✕ Rechazar", use_container_width=True):
                    st.session_state.decisions[out['caseId']] = 'Rechazar'
                    st.session_state.approved_revisions.pop(out['caseId'], None)
                    insert_log({
                        'timestampIso': now_iso,
                        'time': now_str,
                        'case': out['caseId'],
                        'revision': rev_token,
                        'caseStatus': 'RECHAZADO',
                        'event': 'Decisión humana',
                        'level': level,
                        'source': out['guidance']['id'],
                        'action': 'Rechazar',
                        'result': 'PERMITIDO',
                        'blockReason': 'Sugerencia rechazada',
                        'actorRole': 'Asesor WhatsApp (HITL)',
                        'agent': agent_disp,
                        'policy': st.session_state.policy,
                        'version': VERSION
                    })
                    st.warning("Sugerencia rechazada. Asignación ordinaria bloqueada.")
                    st.rerun()

            with b4:
                if st.button("⚠ Escalar", use_container_width=True):
                    esc = register_escalation({
                        'caseData': current_case,
                        'output': out,
                        'reason': out['classification']['reason'],
                        'actorRole': 'Asesor WhatsApp'
                    })
                    st.session_state.decisions[out['caseId']] = 'Escalar'
                    st.session_state.approved_revisions.pop(out['caseId'], None)
                    st.session_state.escalated_cases.insert(0, esc)
                    st.session_state.chat_messages.setdefault(out['caseId'], []).append({
                        "type": "escalation",
                        "time": short_time,
                        "text": f"Caso {out['caseId']} (Clase {level}) derivado a supervisión. Motivo: {esc['reason']}. No se emite respuesta ordinaria al cliente."
                    })
                    insert_log({
                        'timestampIso': now_iso,
                        'time': now_str,
                        'case': out['caseId'],
                        'revision': rev_token,
                        'caseStatus': 'DERIVADO_SUPERVISOR',
                        'event': 'Escalamiento operacional',
                        'level': level,
                        'source': out['guidance']['id'],
                        'action': 'Escalar',
                        'result': 'ESCALADO',
                        'blockReason': esc['reason'],
                        'actorRole': 'Asesor WhatsApp (HITL)',
                        'agent': agent_disp,
                        'policy': st.session_state.policy,
                        'version': VERSION
                    })
                    st.rerun()

            # Despacho al chat
            can_dispatch = (st.session_state.approved_revisions.get(out['caseId']) == rev_token)
            if st.button("➤ Confirmar y despachar respuesta al chat (HITL)", disabled=not can_dispatch, use_container_width=True):
                st.session_state.chat_messages.setdefault(out['caseId'], []).append({
                    "type": "advisor",
                    "sender": agent_disp,
                    "decision": st.session_state.decisions.get(out['caseId'], 'Aprobado'),
                    "time": short_time,
                    "text": edited_reply
                })
                insert_log({
                    'timestampIso': now_iso,
                    'time': now_str,
                    'case': out['caseId'],
                    'revision': rev_token,
                    'caseStatus': 'APROBADO',
                    'event': 'Respuesta despachada (HITL)',
                    'level': level,
                    'source': out['guidance']['id'],
                    'action': 'Despachar',
                    'result': 'PERMITIDO',
                    'blockReason': '—',
                    'actorRole': 'Asesor WhatsApp (HITL)',
                    'agent': agent_disp,
                    'policy': st.session_state.policy,
                    'version': VERSION
                })
                st.rerun()

            rec = out['recommendation']
            cmp = out.get('policyComparison', {})
            act_r = cmp.get('actual', {})
            exp_r = cmp.get('experimental', {})
            act_txt = f"{act_r.get('weight', 5)}u → {act_r['agent']['display']} ({act_r['projected']}/10)" if act_r.get('agent') else f"{act_r.get('weight', 5)}u → En cola"
            exp_txt = f"{exp_r.get('weight', 7)}u → {exp_r['agent']['display']} ({exp_r['projected']}/10)" if exp_r.get('agent') else f"{exp_r.get('weight', 7)}u → En cola"

            st.markdown(f"""
            <div style="background-color: white; border: 1px solid #d8dde4; border-radius: 6px; padding: 12px; margin-top: 10px;">
              <span style="font-weight: bold; color: #6a47a6;">Capacidad y Routing Dinámico:</span><br>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; font-size: 12px;">
                <div><b>Peso asignado:</b> {rec['weight']} unidades</div>
                <div><b>Asesor recomendado:</b> {rec['agent']['display'] if rec['agent'] else 'En cola (Sin capacidad)'}</div>
                <div><b>Carga proyectada:</b> {rec['projected'] if rec['projected'] else 'Saturado'} / 10</div>
                <div><b>Diagnóstico:</b> {html.escape(rec['reason'])}</div>
              </div>
              <div style="background-color:#f7f5ff; border:1px solid #ded6f7; padding:6px 10px; border-radius:4px; margin-top:8px; font-size:11.5px; color:#3d2c6d;">
                <b>Contraste en Vivo:</b> Actual: {html.escape(act_txt)} &nbsp;|&nbsp; Experimental: {html.escape(exp_txt)}
              </div>
            </div>
            """, unsafe_allow_html=True)

            # Evaluación pura de can_confirm_assignment
            auth_context = {
                'caseData': {
                    'id': current_case['id'],
                    'text': query_text,
                    'validated': ivr_validated,
                    'branch': branch,
                    'ivrManualVerified': st.session_state.ivr_manual_verified
                },
                'output': out,
                'decision': st.session_state.decisions.get(out['caseId']),
                'approvedRevision': st.session_state.approved_revisions.get(out['caseId']),
                'isEditing': st.session_state.is_editing,
                'editApproved': st.session_state.edit_approved,
                'agents': st.session_state.agents,
                'policy': st.session_state.policy,
                'activeAssignments': st.session_state.assignments
            }
            auth_res = can_confirm_assignment(auth_context)

            if level == 'C':
                st.warning("🔒 Regla de seguridad R02: Clase C exige derivación a supervisión. Asignación ordinaria bloqueada.")
                if st.button("⚠ Registrar y derivar a supervisión (Clase C)", type="primary", use_container_width=True):
                    esc = register_escalation({'caseData': current_case, 'output': out, 'reason': out['classification']['reason']})
                    st.session_state.escalated_cases.insert(0, esc)
                    insert_log({
                        'timestampIso': now_iso,
                        'time': now_str,
                        'case': out['caseId'],
                        'revision': rev_token,
                        'caseStatus': 'DERIVADO_SUPERVISOR',
                        'event': 'Escalamiento obligatorio Clase C',
                        'level': level,
                        'source': out['guidance']['id'],
                        'action': 'Derivar a Supervisor',
                        'result': 'ESCALADO',
                        'blockReason': esc['reason'],
                        'actorRole': 'Asesor WhatsApp (HITL)',
                        'agent': 'Cola Supervisión',
                        'policy': st.session_state.policy,
                        'version': VERSION
                    })
                    st.success("Caso Clase C derivado formalmente a supervisión.")
                    st.rerun()
            else:
                if auth_res['allowed']:
                    if st.button("✓ Confirmar asignación demostrativa", use_container_width=True):
                        target = next(a for a in st.session_state.agents if a['id'] == auth_res['targetAgent']['id'])
                        target['load'] += auth_res['weight']
                        if target['load'] >= CAPACITY:
                            target['status'] = 'Ocupado'
                        st.session_state.assignments.insert(0, {
                            'uid': f"WIP-{int(datetime.now().timestamp())}",
                            'Cola': 'WhatsApp',
                            'Caso': out['caseId'],
                            'Ramo': branch,
                            'Tipo': 'Conversación',
                            'agentId': target['id'],
                            'Asesor': target['display'],
                            'Unidades': auth_res['weight'],
                            'Tiempo': '00:15',
                            'Clase': level,
                            'Estado': 'En curso'
                        })
                        insert_log({
                            'timestampIso': now_iso,
                            'time': now_str,
                            'case': out['caseId'],
                            'revision': rev_token,
                            'caseStatus': 'ASIGNADO',
                            'event': 'Asignación confirmada',
                            'level': level,
                            'source': out['guidance']['id'],
                            'action': st.session_state.decisions.get(out['caseId'], 'Aprobado'),
                            'result': 'PERMITIDO',
                            'blockReason': '—',
                            'actorRole': 'Asesor WhatsApp (HITL)',
                            'agent': target['display'],
                            'policy': st.session_state.policy,
                            'version': VERSION
                        })
                        st.success(f"Asignación confirmada a {target['display']} (Carga actualizada: {target['load']}/10)")
                        st.rerun()
                else:
                    st.caption(f"🔒 Asignación bloqueada [{auth_res['code']}]: {auth_res['reason']}")
                    st.button("✓ Confirmar asignación demostrativa", disabled=True, use_container_width=True)

                if not rec['agent']:
                    if st.button("⏳ Retener caso en cola controlada", use_container_width=True):
                        st.session_state.held_cases.append({
                            'uid': f"HELD-{int(datetime.now().timestamp())}",
                            'Caso': out['caseId'],
                            'Ramo': branch,
                            'Clase': level,
                            'Peso': rec['weight'],
                            'Motivo': rec['reason'],
                            'Hora': datetime.now().strftime('%H:%M:%S')
                        })
                        insert_log({
                            'timestampIso': now_iso,
                            'time': now_str,
                            'case': out['caseId'],
                            'revision': rev_token,
                            'caseStatus': 'EN_COLA',
                            'event': 'Caso retenido en cola',
                            'level': level,
                            'source': out['guidance']['id'],
                            'action': 'Retención por saturación',
                            'result': 'PERMITIDO',
                            'blockReason': 'Capacidad agotada',
                            'actorRole': 'Asesor WhatsApp (HITL)',
                            'agent': 'Cola WhatsApp',
                            'policy': st.session_state.policy,
                            'version': VERSION
                        })
                        st.warning(f"Caso {out['caseId']} retenido en la pestaña '3. Retraso de Colas'.")
                        st.rerun()
        else:
            st.info("Seleccione un caso y pulse '⚡ Procesar Consulta' para visualizar triaje, checklist KB, sugerencia HITL y routing.")

# --- TAB 2: REPRESENTANTES DE ATENCIÓN ---
with tabs[1]:
    st.subheader("Supervisión Interactiva de Asesores (Datos Sintéticos)")
    total_used = sum(a['load'] for a in st.session_state.agents)
    k1, k2, k3, k4 = st.columns(4)
    k1.metric("Asesores Disponibles", f"{avail_agents_count} / {len(st.session_state.agents)}")
    k2.metric("Capacidad Nominal Turno", f"{len(st.session_state.agents) * CAPACITY} u.")
    k3.metric("Unidades Ocupadas", f"{total_used} u.")
    k4.metric("Utilización Global", f"{round(total_used * 100 / (len(st.session_state.agents) * CAPACITY))}%")

    for idx, ag in enumerate(st.session_state.agents):
        cols = st.columns([1.5, 1.3, 1.5, 1.2, 1.2])
        cols[0].markdown(f"**{ag['display']}** (`{ag['id']}`)")
        new_status = cols[1].selectbox(
            "Estado",
            options=["Disponible", "Ocupado", "Refrigerio"],
            index=["Disponible", "Ocupado", "Refrigerio"].index(ag["status"]),
            key=f"ag_status_{ag['id']}",
            label_visibility="collapsed"
        )
        if new_status != ag["status"]:
            ag["status"] = new_status
            if new_status == "Disponible" and ag["load"] >= CAPACITY:
                ag["load"] = 5
            st.rerun()
        cols[2].markdown(f"Skills: `{', '.join(ag['skills'])}`")
        cols[3].progress(min(1.0, ag['load'] / 10.0), text=f"{ag['load']}/10 u. ({ag['load']*10}%)")
        if cols[4].button("↺ Liberar / Activar", key=f"rel_{ag['id']}", disabled=(ag['load'] == 0 and ag['status'] == 'Disponible')):
            ag['load'] = 0
            ag['status'] = 'Disponible'
            insert_log({
                'timestampIso': datetime.now().isoformat(),
                'time': datetime.now().strftime('%d/%m/%Y, %H:%M:%S'),
                'case': 'SUPERVISIÓN',
                'revision': '—',
                'caseStatus': '—',
                'event': 'Capacidad liberada manual',
                'level': '—',
                'source': 'P2-CONTROL',
                'action': 'Carga → 0/10',
                'result': 'PERMITIDO',
                'blockReason': '—',
                'actorRole': 'Supervisor',
                'agent': ag['display'],
                'policy': st.session_state.policy,
                'version': VERSION
            })
            st.rerun()

    if st.button("↺ Restablecer Asesores por Defecto"):
        st.session_state.agents = [dict(a, skills=list(a['skills'])) for a in AGENTS]
        st.rerun()

# --- TAB 3: RETRASO DE COLAS ---
with tabs[2]:
    st.subheader("Retraso de Colas Multicanal (Datos Sintéticos)")
    wa_pend = 2 + len(st.session_state.held_cases)
    queues_data = [
        {"Cola": "WhatsApp", "Prioridad": 3, "Pendientes": f"{wa_pend} pendientes", "Tipo": "Mensajería", "Espera Total": "06:40", "Tiempo Máximo": "04:25", "Espera Media": "03:20", "Riesgo": "Alto (Saturación)" if wa_pend > 2 else "Monitorizar"},
        {"Cola": "Correo", "Prioridad": 11, "Pendientes": "1 pendiente", "Tipo": "Caso", "Espera Total": "05:10", "Tiempo Máximo": "05:10", "Espera Media": "05:10", "Riesgo": "Monitorizar"},
        {"Cola": "Facebook", "Prioridad": 1, "Pendientes": "0 pendientes", "Tipo": "Mensajería", "Espera Total": "00:00", "Tiempo Máximo": "—", "Espera Media": "—", "Riesgo": "Normal"}
    ]
    st.table(pd.DataFrame(queues_data))

    st.markdown("#### Casos Retenidos en Cola por Saturación (Reintento Dinámico)")
    if st.session_state.held_cases:
        for idx, hc in enumerate(st.session_state.held_cases):
            hc_cols = st.columns([1.2, 1.0, 0.8, 1.0, 2.5, 1.5])
            hc_cols[0].markdown(f"**{hc['Caso']}**")
            hc_cols[1].write(hc['Ramo'])
            hc_cols[2].write(f"Clase {hc['Clase']}")
            hc_cols[3].write(f"{hc['Peso']} u.")
            hc_cols[4].write(hc['Motivo'])
            if hc_cols[5].button("↪ Reintentar routing", key=f"retry_{hc['uid']}"):
                rec = route(st.session_state.agents, hc['Clase'], hc['Ramo'], st.session_state.policy)
                if not rec['agent']:
                    st.error(f"Aún no hay asesor disponible para {hc['Ramo']} ({rec['weight']}u). Libere un asesor en la pestaña 2 o 4.")
                else:
                    target = next(a for a in st.session_state.agents if a['id'] == rec['agent']['id'])
                    target['load'] += rec['weight']
                    if target['load'] >= CAPACITY:
                        target['status'] = 'Ocupado'
                    st.session_state.held_cases.pop(idx)
                    st.session_state.assignments.insert(0, {
                        'uid': f"WIP-RETRY-{int(datetime.now().timestamp())}",
                        'Cola': 'WhatsApp',
                        'Caso': hc['Caso'],
                        'Ramo': hc['Ramo'],
                        'Tipo': 'Conversación (Desencolado)',
                        'agentId': target['id'],
                        'Asesor': target['display'],
                        'Unidades': rec['weight'],
                        'Tiempo': '00:05',
                        'Clase': hc['Clase'],
                        'Estado': 'En curso'
                    })
                    insert_log({
                        'timestampIso': datetime.now().isoformat(),
                        'time': datetime.now().strftime('%d/%m/%Y, %H:%M:%S'),
                        'case': hc['Caso'],
                        'revision': '—',
                        'caseStatus': 'ASIGNADO',
                        'event': 'Desencolado y asignado',
                        'level': hc['Clase'],
                        'source': 'P3-COLA',
                        'action': 'Reintento exitoso',
                        'result': 'PERMITIDO',
                        'blockReason': '—',
                        'actorRole': 'Supervisor',
                        'agent': target['display'],
                        'policy': st.session_state.policy,
                        'version': VERSION
                    })
                    st.rerun()
    else:
        st.info("No hay casos retenidos actualmente. Procese DEMO-006 o DEMO-007 y pulse 'Retener caso en cola controlada'.")

# --- TAB 4: TRABAJO EN CURSO ---
with tabs[3]:
    st.subheader("Casos en Curso Asignados (WIP) · Liberación de Capacidad")
    for item in st.session_state.assignments:
        wcols = st.columns([1.0, 1.3, 1.4, 1.4, 0.9, 0.8, 1.0, 1.5])
        wcols[0].write(item['Cola'])
        wcols[1].markdown(f"**{item['Caso']}**")
        wcols[2].write(f"{item.get('Ramo', 'General')} · {item['Tipo']}")
        wcols[3].write(item['Asesor'])
        wcols[4].write(f"{item.get('Unidades', 5)} u.")
        wcols[5].write(f"Clase {item['Clase']}")
        wcols[6].write(item['Estado'])
        if item['Estado'] == 'En curso':
            if wcols[7].button(f"✓ Finalizar (-{item.get('Unidades', 5)}u)", key=f"fin_{item['uid']}"):
                item['Estado'] = 'Completado'
                ag = next((a for a in st.session_state.agents if a['id'] == item.get('agentId') or a['display'] == item['Asesor']), None)
                if ag:
                    ag['load'] = max(0, ag['load'] - item.get('Unidades', 5))
                    if ag['status'] == 'Ocupado' and ag['load'] < CAPACITY:
                        ag['status'] = 'Disponible'
                insert_log({
                    'timestampIso': datetime.now().isoformat(),
                    'time': datetime.now().strftime('%d/%m/%Y, %H:%M:%S'),
                    'case': item['Caso'],
                    'revision': '—',
                    'caseStatus': 'COMPLETADO',
                    'event': 'Atención finalizada (WIP)',
                    'level': item['Clase'],
                    'source': 'P4-WIP',
                    'action': f"Liberadas {item.get('Unidades', 5)}u",
                    'result': 'PERMITIDO',
                    'blockReason': '—',
                    'actorRole': 'Asesor WhatsApp',
                    'agent': item['Asesor'],
                    'policy': st.session_state.policy,
                    'version': VERSION
                })
                st.rerun()
        else:
            wcols[7].caption("Cerrado")

# --- TAB 5: BITÁCORA Y TRAZABILIDAD ---
with tabs[4]:
    st.subheader("Bitácora de Auditoría de Sesión Local (SQLite)")
    logs_db = fetch_logs(limit=100)

    col_exp1, col_exp2, col_clear = st.columns([1, 1, 2])
    with col_exp1:
        st.download_button(
            label="⬇ Descargar Bitácora JSON",
            data=export_db_evidence(fmt='json'),
            file_name="sai_gc_bitacora_r02.json",
            mime="application/json"
        )
    with col_exp2:
        st.download_button(
            label="⬇ Descargar Bitácora CSV",
            data=export_db_evidence(fmt='csv'),
            file_name="sai_gc_bitacora_r02.csv",
            mime="text/csv"
        )
    with col_clear:
        if st.button("✕ Limpiar Bitácora"):
            clear_logs()
            st.rerun()

    if logs_db:
        st.dataframe(pd.DataFrame(logs_db), use_container_width=True, hide_index=True)
    else:
        st.info("No se registran eventos en la base de datos local SQLite.")

# --- TAB 6: CONFIGURACIÓN Y CAP. V ---
with tabs[5]:
    col_cfg1, col_cfg2 = st.columns(2)
    with col_cfg1:
        st.subheader("Selector de Política Operativa")
        selected_pol = st.radio(
            "Política de Capacidad y Routing:",
            options=["actual", "experimental"],
            format_func=lambda x: "Regla Actual Confirmada (WhatsApp = 5 unidades, Capacidad = 10 unidades)" if x == "actual" else "Política Experimental Hipotética (A = 4, B = 5, C = 7 unidades)",
            index=0 if st.session_state.policy == "actual" else 1
        )
        if selected_pol != st.session_state.policy:
            st.session_state.policy = selected_pol
            st.rerun()
        st.caption("Advertencia metodológica: Los pesos 4, 5 y 7 son valores ilustrativos pendientes de validación en el Capítulo V.")

    with col_cfg2:
        st.subheader("Calculadora de Capacidad Recuperada (Cap. V)")
        vol_input = st.slider("Volumen mensual (interacciones/mes):", min_value=2000, max_value=15000, value=8000, step=500)
        delta_input = st.slider("Reducción hipotética ΔTMO (minutos):", min_value=0.5, max_value=4.5, value=2.0, step=0.25)
        cap_res = calculate_capacity_recovery(vol_input, delta_input)
        m1, m2 = st.columns(2)
        m1.metric("Horas-Hombre Liberadas / Mes", f"{cap_res['hoursRecovered']} h/mes")
        m2.metric("Equivalencia (Turnos de 8h)", f"{cap_res['equivalentShifts8h']} turnos/mes")
        st.caption(cap_res['disclaimer'])
