# PLAN MAESTRO R01 — SAI-GC

Fecha de corte: 09/10/2026. Fuente: “Vistas de supervisión.docx” proporcionado por Víctor y acuerdo R01 del 08/10/2026. Este plan diferencia lo observado en capturas, lo explicado en la documentación y las decisiones de diseño del MVP.

## 1. Lectura fiel de las capturas del sistema actual

Se han identificado **nueve imágenes** incrustadas en el Word: las tres primeras documentan las pestañas de supervisión (representantes, retraso de colas, trabajo en curso); las restantes muestran el flujo de conversación, incluidos dos escenarios: bot con validación ya realizada y bot sin validación suficiente (el asesor debe pedir datos). La información textual señala estados de agente (disponible, ocupado, pausa, refrigerio, capacitación), recuentos de trabajo, capacidad por peso y métricas de cola.

### Lo confirmado, NO asumir innovación
- La empresa ya dispone de tablero de estado de asesores, colas y trabajo en curso.
- Regla actual confirmada: capacidad nominal 10, correo 10, conversación WhatsApp 5, por lo que un asesor puede manejar 2 chats WhatsApp al mismo tiempo en ausencia de otra carga.
- El IVR ya atiende ciertas consultas y deriva otras; la intervención humana y la validación dependen del estado previo del usuario.
- El SAI-GC **propone** clasificar por complejidad y vincular ese resultado con asistencia y routing; no forma parte del sistema productivo existente en el alcance de esta versión.

### Paleta referencial inferida visualmente
- Azul de acción / encabezados `#0176D3`.
- Azul acento oscuro `#014486`.
- Superficies blancas `#FFFFFF`; fondo general `#F5F7FA`; filas `#F4F4F4`.
- Divisores y bordes `#D8DDE4`.
- Texto principal `#181818`; texto secundario `#596579`.
- Disponibilidad verde `#2E844A`; ocupación roja `#C23934`; atención/pausa amarilla `#D7891E`.
- Conversaciones entrantes gris pálido `#F1F2F4`; bot/asesor gris medio `#73777E`.
**Nota:** los códigos HEX son aproximaciones de diseño propuestas, no una exportación del design system oficial de Salesforce.

## 2. MVP construido en este paquete

### Estado real
Se entrega una aplicación web **funcional y autónoma en un archivo HTML** con lógica JS, CSS y casos sintéticos. Su propósito es producir interacción y evidencia visual hoy, sin instalación de Python o credenciales. El prototipo permite navegar, procesar los casos A/B/C, visualizar fuentes y sugerencias, registrar acciones, recomendar y confirmar asignaciones, observar carga por asesor, colas, trabajo en curso y exportar bitácora JSON.

### Limitaciones reales
- No es una integración Salesforce, WhatsApp, IVR ni sistemas core.
- No utiliza un LLM ni implementa IA generativa productiva; la asistencia es recuperación por clase + plantillas controladas.
- No entrena un modelo supervisado real, ni produce probabilidades calibradas de confianza.
- No usa Streamlit/SQLite en esta edición offline: la bitácora reside en memoria durante la sesión y se exporta a JSON.
- No tiene todavía un motor de simulación de eventos discretos calibrado ni medición To-Be del TMO.
- Los conteos, agentes y tiempos de las pantallas del MVP son sintéticos. Los cuatro KPI de cabecera corresponden a la línea base histórica confirmada.

## 3. Mapa de pantallas y propósito académico

| Pantalla | Funciones | Evidencia |
|---|---|---|
| Atención asistida | IVR representado, consulta anonimizada, triage, KB, acción humana y routing | A/B/C, recuperación, control HITL, asignación |
| Representantes | disponibilidad, peso ocupado, capacidad y canales | estado/ocupación de asesores demo |
| Retraso de colas | tipo, prioridad, pendiente, esperas | salida analítica sintética, sin simulación calibrada |
| Trabajo en curso | seguimiento de casos asignados | cambios al confirmar asignación |
| Bitácora | eventos, fuente, acción y política, exportación | trazabilidad verificable de la interacción |
| Configuración | regla actual 10/5 y experimental A4/B5/C7 | separación entre evidencia y supuestos |

## 4. Arquitectura y capas futuras

A. Interfaz: versión actual HTML/CSS/JS autocontenida; en la siguiente iteración interfaz Streamlit si se decide Python.
B. Motor de triaje: reglas sintéticas conservadoras; validación con expertos → matriz Gold → precisión/recall.
C. Conocimiento: KB demostrativa con ID y contenido no sensible → sustituir por documentos aprobados.
D. Asistencia: sugerencia basada en plantilla, registro de aceptar/editar/rechazar/escalar → LLM/RAG opcional sujeto a autorización y pruebas.
E. Routing: disponibilidad, skill, carga proyectada y umbral 10; valores actuales/experimentales claramente diferenciados.
F. Gobernanza: bitácora en memoria/JSON en esta demo → SQLite en versión Python.
G. Evaluación: prevalidación de lógica → piloto controlado y simulación DES As-Is/To-Be en Capítulo V.

## 5. Orden de ejecución inmediato (una jornada de entrega)

**Hito H0 — Ya preparado en el paquete:** reglas ejecutables, pantallas, 10 pruebas unitarias y ocho capturas de navegador probadas. Evita perder horas en recrear diagramas vacíos.

**Hito H1 — Prueba presencial (30–45 min):** abrir HTML, recorrer DEMO-001 A, DEMO-002 B no validado, DEMO-003 C Escalar, confirmar routing, supervisión, colas, curso, bitácora y descarga.

**Hito H2 — Ajustes de fidelidad (60–90 min):** adaptar etiquetas de campos, secuencia IVR, ramo y cantidad de columnas de capturas; NO copiar datos personales ni pantallas íntegras propietarias.

**Hito H3 — Evidencias (30–45 min):** tomar capturas nuevas si se modifica la interfaz; conservar nombre de escenario, versión y registro de prueba; etiquetar “datos sintéticos”.

**Hito H4 — Capítulo IV (2–3 h):** reemplazar figuras conceptuales de “ejecución” por capturas reales de este MVP; declarar sin ambigüedad stack HTML/CSS/JS, reglas y plantillas, y especificar funcionalidades futuras; revisar Tablas 9–15, resumen y 4.3–4.5. El motor DES calibrado sigue pendiente.

**Hito H5 — Artículo y defensa (2–3 h):** condensar aporte y materiales/métodos, explicar diferencia actual vs propuesto y preparar un guion de 3 minutos. No insertar resultados To-Be ficticios.

## 6. Matriz de honestidad para el Capítulo IV

| Afirmación propuesta | Evidencia disponible | Redacción correcta |
|---|---|---|
| Se construyó una interfaz navegable | Sí, HTML funcional | “Se implementó un prototipo web académico offline con seis vistas interactivas.” |
| El triaje es inteligente y validado | Reglas preliminares, pruebas unitarias | “Se verificó la ejecución de reglas demostrativas; precisión pendiente de validación experta.” |
| Existe IA generativa productiva | No | “La versión actual propone respuestas mediante recuperación y plantillas; LLM/RAG es una extensión futura.” |
| El routing está integrado con Salesforce | No | “Se implementó una recomendación local que utiliza la capacidad actual declarada; sin API corporativa.” |
| Se ejecutó un modelo As-Is/To-Be calibrado | No | “El protocolo de simulación se diseñará y calibrará en la validación.” |
| Se redujo el TMO | No | “Se conserva el TMO histórico como línea base; la eficacia será evaluada en piloto.” |
| Existe evidencia gráfica real del MVP | Sí | “Se obtuvieron capturas de la navegación y las acciones de la aplicación en navegador, con casos sintéticos.” |

## 7. Validación ulterior (no completada)

- Validación A/B/C: dos especialistas, etiquetas independientes, consenso Gold, matriz de confusión, macro-F1, recall C y C→A.
- Calidad de asistencia: rúbrica exactitud, completitud, procedimiento, claridad y contenido autorizado; error crítico.
- Piloto: control vs SAI-GC, controlar asesor, tipología, franja, concurrencia, volumen y estado IVR; medir tiempo de tarea y TMO corporativo/ajustado, abandono y calidad.
- Simulación: distribución horaria de llegadas, dotación real/turnos/breaks, tiempos de servicio, paciencia, calibración As-Is; políticas S0, S1, S2 y S3 con parámetros empíricos; réplicas, intervalos de confianza y sensibilidad.
- Economía: horas de capacidad potencialmente recuperada; no equiparar automáticamente a ahorro monetario o reducción de FTE.

## 8. Capturas listas en `capturas/`

01 — Caso A · asistencia informativa.
02 — Caso B · verificación pendiente.
03 — Caso C · escalamiento humano.
04 — Supervisión de agentes.
05 — Retraso de colas.
06 — Trabajo en curso.
07 — Bitácora con evento y decisión.
08 — Configuración de política actual/experimental.

## 9. Cómo defender en la reunión

> El SAI-GC no reemplaza Salesforce. Toma como referencia la operación actual, donde el agente tiene una capacidad total de 10 unidades y WhatsApp consume 5. El MVP académico materializa un proceso nuevo que clasifica por complejidad, entrega apoyo informacional para revisión del asesor y recomienda una asignación compatible con la disponibilidad y la carga. Se ejecuta localmente con casos sintéticos, conserva trazabilidad y permite demostrar funcionamiento, pero todavía no acredita efectos sobre el TMO. La siguiente etapa valida expertos, piloto y simulación.
