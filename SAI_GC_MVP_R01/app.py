"""
SAI-GC — Sistema de Asistencia Inteligente y Gestión de Capacidad
MVP Académico Demostrativo en Streamlit · Fase Escalable Python
"""

import streamlit as st
import pandas as pd
from logic import (
    VERSION, CAPACITY, CASES, AGENTS,
    classify, weight_for, route, respond, process_case, export_evidence
)
from database import init_db, insert_log, fetch_logs, clear_logs, export_db_evidence

st.set_page_config(
    page_title="SAI-GC | MVP R01",
    page_icon="⚖️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Inicializar DB y estado de sesión
init_db()

if "agents" not in st.session_state:
    st.session_state.agents = [dict(a) for a in AGENTS]
if "policy" not in st.session_state:
    st.session_state.policy = "actual"
if "assignments" not in st.session_state:
    st.session_state.assignments = []
if "last_output" not in st.session_state:
    st.session_state.last_output = None
if "selected_case_id" not in st.session_state:
    st.session_state.selected_case_id = "DEMO-001"

# Barra de navegación superior
st.markdown("""
<div style="background-color: #014486; padding: 12px 20px; border-radius: 6px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; color: white;">
  <div>
    <h2 style="margin: 0; color: white; display: inline;">SAI-GC</h2>
    <span style="font-size: 14px; opacity: 0.9; margin-left: 10px;">Sistema de Asistencia Inteligente y Gestión de Capacidad</span>
  </div>
  <div>
    <span style="background-color: #bad5f9; color: #014486; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 12px; margin-right: 10px;">DEMO · DATOS SINTÉTICOS</span>
    <span style="background-color: #fff5d7; color: #76520c; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 12px;">NO CONECTADO A SALESFORCE</span>
  </div>
</div>
""", unsafe_allow_html=True)

# Pestañas
tab_names = [
    "Atención Asistida",
    "Representantes de Atención",
    "Retraso de Colas",
    "Trabajo en Curso",
    "Bitácora y Trazabilidad",
    "Configuración"
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

    col_chat, col_assist = st.columns([1.1, 1.0])

    with col_chat:
        st.subheader("Conversación WhatsApp (Simulación)")
        
        case_options = {c['id']: f"{c['id']} · {c['name']}" for c in CASES}
        selected_id = st.selectbox(
            "Seleccionar caso de prueba:",
            options=list(case_options.keys()),
            format_func=lambda x: case_options[x],
            key="case_picker"
        )
        
        current_case = next(c for c in CASES if c['id'] == selected_id)

        # Ajustes de escenario
        if current_case.get('scenario') == 'all_busy':
            st.session_state.agents = [dict(a, status='Ocupado', load=10) for a in AGENTS]
        elif current_case.get('scenario') == 'agent_paused':
            st.session_state.agents = [
                {'id': 'AG-01', 'display': 'Asesor Demo 01', 'status': 'Ocupado', 'load': 10, 'skills': ['Vida', 'Vehicular']},
                {'id': 'AG-02', 'display': 'Asesor Demo 02', 'status': 'Ocupado', 'load': 10, 'skills': ['Vida', 'Vehicular']},
                {'id': 'AG-03', 'display': 'Asesor Demo 03', 'status': 'Ocupado', 'load': 10, 'skills': ['Vehicular']},
                {'id': 'AG-04', 'display': 'Asesor Demo 04', 'status': 'Refrigerio', 'load': 0, 'skills': ['Vida', 'Salud']}
            ]

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

        query_text = st.text_area("Motivo de consulta (anonimizado):", value=current_case['text'], height=90)

        # Historial visual de chat
        st.markdown(f"""
        <div style="background-color: white; border: 1px solid #d8dde4; border-radius: 6px; padding: 15px; margin-bottom: 15px;">
          <div style="text-align: center; color: #596579; font-size: 11px; margin-bottom: 10px;">
            ◉ Caso {current_case['id']} · Transferencia desde canal digital
          </div>
          <div style="background-color: #f1f2f4; padding: 10px; border-radius: 6px; margin-bottom: 8px; width: 80%;">
            <b>Cliente (demostración):</b><br>{query_text}
          </div>
          <div style="text-align: center; color: #596579; font-size: 11px; margin-top: 10px;">
            {'✓ Identidad validada previamente en IVR.' if ivr_validated else '! Identidad no validada: verificación requerida.'}
          </div>
        </div>
        """, unsafe_allow_html=True)

        btn_process = st.button("Procesar Consulta (Triaje y Recomendación)", type="primary")

    with col_assist:
        st.subheader("Asistencia Inteligente y Routing")

        if btn_process:
            test_obj = {
                'id': current_case['id'],
                'text': query_text,
                'validated': ivr_validated,
                'branch': branch
            }
            output = process_case(test_obj, st.session_state.agents, st.session_state.policy)
            st.session_state.last_output = output

            # Registrar evento en DB
            insert_log({
                'time': None,
                'case': current_case['id'],
                'event': 'Triaje y recomendación',
                'level': output['classification']['level'],
                'source': output['guidance']['id'],
                'action': 'Pendiente',
                'agent': output['recommendation']['agent']['display'] if output['recommendation']['agent'] else 'En cola',
                'policy': st.session_state.policy,
                'version': VERSION
            })

        out = st.session_state.last_output

        if out:
            # Tarjeta de Triaje
            level = out['classification']['level']
            color_badge = "#e0f4e4" if level == 'A' else ("#fff2d7" if level == 'B' else "#fbe7e7")
            text_badge = "#1a6337" if level == 'A' else ("#8b5c07" if level == 'B' else "#ab2e2e")
            
            st.markdown(f"""
            <div style="background-color: white; border: 1px solid #d8dde4; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
              <span style="font-weight: bold; color: #014486;">Triaje A/B/C:</span>
              <span style="background-color: {color_badge}; color: {text_badge}; padding: 3px 10px; border-radius: 4px; font-weight: bold; font-size: 16px; margin-left: 8px;">Clase {level}</span>
              <div style="font-size: 12px; color: #596579; margin-top: 6px;"><b>Riesgo:</b> {out['classification']['risk']} | <b>Motivo:</b> {out['classification']['reason']}</div>
            </div>
            """, unsafe_allow_html=True)

            # Tarjeta de Asistencia
            st.markdown(f"""
            <div style="background-color: white; border: 1px solid #d8dde4; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
              <div style="font-size: 11px; font-weight: bold; color: #0176d3; text-transform: uppercase;">Fuente Recuperada: {out['guidance']['id']} · {out['guidance']['title']}</div>
              <div style="background-color: #fafbfc; border: 1px solid #e2e7ed; border-radius: 4px; padding: 10px; margin-top: 8px; font-size: 13px;">
                {out['guidance']['text']}
              </div>
            </div>
            """, unsafe_allow_html=True)

            # Decisión Humana (HITL)
            st.markdown("<b>Decisión Humana Requerida (Human-in-the-Loop):</b>", unsafe_allow_html=True)
            b1, b2, b3, b4 = st.columns(4)
            agent_disp = out['recommendation']['agent']['display'] if out['recommendation']['agent'] else '—'

            with b1:
                if st.button("Aceptar"):
                    insert_log({'case': out['caseId'], 'event': 'Decisión humana', 'level': level, 'source': out['guidance']['id'], 'action': 'Aceptar', 'agent': agent_disp, 'policy': st.session_state.policy, 'version': VERSION})
                    st.success("Acción registrada: Aceptar (mensaje no enviado automáticamente)")
            with b2:
                if st.button("Editar"):
                    insert_log({'case': out['caseId'], 'event': 'Decisión humana', 'level': level, 'source': out['guidance']['id'], 'action': 'Editar', 'agent': agent_disp, 'policy': st.session_state.policy, 'version': VERSION})
                    st.info("Acción registrada: Editar (plantilla en modo edición)")
            with b3:
                if st.button("Rechazar"):
                    insert_log({'case': out['caseId'], 'event': 'Decisión humana', 'level': level, 'source': out['guidance']['id'], 'action': 'Rechazar', 'agent': agent_disp, 'policy': st.session_state.policy, 'version': VERSION})
                    st.warning("Acción registrada: Rechazar")
            with b4:
                if st.button("Escalar"):
                    insert_log({'case': out['caseId'], 'event': 'Decisión humana', 'level': level, 'source': out['guidance']['id'], 'action': 'Escalar', 'agent': agent_disp, 'policy': st.session_state.policy, 'version': VERSION})
                    st.error("Acción registrada: Escalar a supervisor")

            # Tarjeta de Routing
            rec = out['recommendation']
            st.markdown(f"""
            <div style="background-color: white; border: 1px solid #d8dde4; border-radius: 6px; padding: 12px; margin-top: 12px;">
              <span style="font-weight: bold; color: #6a47a6;">Capacidad y Routing:</span><br>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; font-size: 12px;">
                <div><b>Peso asignado:</b> {rec['weight']} unidades</div>
                <div><b>Asesor recomendado:</b> {rec['agent']['display'] if rec['agent'] else 'En cola'}</div>
                <div><b>Carga proyectada:</b> {rec['projected'] if rec['projected'] else '—'} / 10</div>
                <div><b>Diagnóstico:</b> {rec['reason']}</div>
              </div>
            </div>
            """, unsafe_allow_html=True)

            if rec['agent']:
                if st.button("Confirmar asignación demostrativa"):
                    target = next(a for a in st.session_state.agents if a['id'] == rec['agent']['id'])
                    target['load'] += rec['weight']
                    st.session_state.assignments.append({
                        'id': out['caseId'],
                        'agent': target['display'],
                        'level': level,
                        'status': 'En curso'
                    })
                    insert_log({'case': out['caseId'], 'event': 'Asignación confirmada', 'level': level, 'source': out['guidance']['id'], 'action': 'Asignado', 'agent': target['display'], 'policy': st.session_state.policy, 'version': VERSION})
                    st.success(f"Asignación confirmada a {target['display']} (Carga actualizada: {target['load']}/10)")
        else:
            st.info("Seleccione un caso y pulse 'Procesar Consulta' para visualizar triaje, sugerencia y routing.")

# --- TAB 2: REPRESENTANTES DE ATENCIÓN ---
with tabs[1]:
    st.subheader("Supervisión de Asesores (Datos Sintéticos)")
    df_agents = pd.DataFrame(st.session_state.agents)
    df_agents['utilizacion'] = df_agents['load'].apply(lambda x: f"{x * 10}% ({x}/10 unidades)")
    df_agents['skills_str'] = df_agents['skills'].apply(lambda s: ", ".join(s))
    
    st.dataframe(
        df_agents[['id', 'display', 'status', 'load', 'utilizacion', 'skills_str']],
        column_config={
            'id': 'ID',
            'display': 'Asesor',
            'status': 'Estado Operativo',
            'load': 'Carga Actual (u)',
            'utilizacion': 'Utilización Nominal',
            'skills_str': 'Ramos / Skills'
        },
        use_container_width=True,
        hide_index=True
    )
    if st.button("Restablecer Carga de Asesores"):
        st.session_state.agents = [dict(a) for a in AGENTS]
        st.success("Cargas restablecidas a estado inicial.")

# --- TAB 3: RETRASO DE COLAS ---
with tabs[2]:
    st.subheader("Retraso de Colas Multicanal (Datos Sintéticos)")
    queues_data = [
        {"Cola": "WhatsApp", "Prioridad": 3, "Pendientes": "2 pendientes", "Tipo": "Mensajería", "Espera Total": "06:40", "Tiempo Máximo": "04:25", "Espera Media": "03:20", "Riesgo": "Monitorizar"},
        {"Cola": "Correo", "Prioridad": 11, "Pendientes": "1 pendiente", "Tipo": "Caso", "Espera Total": "05:10", "Tiempo Máximo": "05:10", "Espera Media": "05:10", "Riesgo": "Monitorizar"},
        {"Cola": "Facebook", "Prioridad": 1, "Pendientes": "0 pendientes", "Tipo": "Mensajería", "Espera Total": "00:00", "Tiempo Máximo": "—", "Espera Media": "—", "Riesgo": "Normal"}
    ]
    st.table(pd.DataFrame(queues_data))
    st.caption("Nota: Tiempos de espera sintéticos para validar el diseño de supervisión sin integración de telemetría.")

# --- TAB 4: TRABAJO EN CURSO ---
with tabs[3]:
    st.subheader("Casos en Curso Asignados")
    base_wip = [
        {"Cola": "WhatsApp", "Caso": "DEMO-WIP-001", "Tipo": "Conversación", "Asesor": "Asesor Demo 02", "Tiempo": "05:40", "Clase": "B", "Estado": "En curso"},
        {"Cola": "Correo", "Caso": "DEMO-WIP-002", "Tipo": "Caso", "Asesor": "Asesor Demo 03", "Tiempo": "12:30", "Clase": "N/A", "Estado": "En curso"}
    ]
    for a in st.session_state.assignments:
        base_wip.append({
            "Cola": "WhatsApp",
            "Caso": a['id'],
            "Tipo": "Conversación",
            "Asesor": a['agent'],
            "Tiempo": "00:15",
            "Clase": a['level'],
            "Estado": a['status']
        })
    st.table(pd.DataFrame(base_wip))

# --- TAB 5: BITÁCORA Y TRAZABILIDAD ---
with tabs[4]:
    st.subheader("Bitácora de Interacciones (SQLite)")
    logs_db = fetch_logs(limit=100)
    
    col_exp1, col_exp2, col_clear = st.columns([1, 1, 2])
    with col_exp1:
        st.download_button(
            label="Descargar Bitácora JSON",
            data=export_db_evidence(fmt='json'),
            file_name="sai_gc_bitacora.json",
            mime="application/json"
        )
    with col_exp2:
        st.download_button(
            label="Descargar Bitácora CSV",
            data=export_db_evidence(fmt='csv'),
            file_name="sai_gc_bitacora.csv",
            mime="text/csv"
        )
    with col_clear:
        if st.button("Limpiar Bitácora"):
            clear_logs()
            st.rerun()

    if logs_db:
        st.dataframe(pd.DataFrame(logs_db), use_container_width=True, hide_index=True)
    else:
        st.info("No se registran eventos en la base de datos local SQLite.")

# --- TAB 6: CONFIGURACIÓN ---
with tabs[5]:
    st.subheader("Configuración Metodológica de Capacidad")
    st.markdown("Conserve separada la regla confirmada en la operación y los supuestos de investigación:")
    
    selected_pol = st.radio(
        "Seleccionar Política Operativa:",
        options=["actual", "experimental"],
        format_func=lambda x: "Regla Actual Confirmada (WhatsApp = 5 unidades, Capacidad = 10 unidades)" if x == "actual" else "Política Experimental Hipotética (A = 4, B = 5, C = 7 unidades)",
        index=0 if st.session_state.policy == "actual" else 1
    )
    if selected_pol != st.session_state.policy:
        st.session_state.policy = selected_pol
        st.success(f"Política cambiada a: {selected_pol}")
        st.rerun()

    st.markdown("""
    ---
    ### Condiciones de Verdad Académicas
    - **Línea base histórica:** 55,924 interacciones (ene-jul 2026), TMO 16.76 min, abandono 16.93%.
    - **Política real confirmada:** 10 unidades por asesor, 5 por WhatsApp, 10 por correo.
    - **Política experimental:** A4, B5, C7 son valores hipotéticos no calibrados.
    - **Sin conexión productiva:** No se accede a la API de Salesforce ni WhatsApp.
    - **Human-in-the-Loop:** La herramienta sugiere; el asesor valida y decide.
    """)
