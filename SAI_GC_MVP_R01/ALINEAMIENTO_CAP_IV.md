# ALINEAMIENTO DEL CAPÍTULO IV — DESARROLLO DE LA SOLUCIÓN (SAI-GC)
**Guía de Redacción Científica, Matriz de Honestidad y Mapeo de Evidencias**  
**Tesis:** Sistema de Asistencia Inteligente y Gestión de Capacidad para el Canal WhatsApp Postventa  
**Norma Editorial:** APA 7.ª Edición · Universidad Peruana de Ciencias Aplicadas (UPC)  

---

## 1. Matriz de Honestidad Académica para el Capítulo IV

Esta matriz establece el límite epistemológico exacto entre lo efectivamente desarrollado en el prototipo y lo que debe redactarse en el cuerpo de la tesis:

| Aspecto Evaluado | Evidencia Real Disponible en el MVP | Lo que NUNCA debe afirmarse | Redacción Científica Correcta para la Tesis |
|---|---|---|---|
| **Naturaleza del Prototipo** | Aplicación web funcional offline (HTML5/ES Modules y Python/Streamlit/SQLite) con 6 vistas interactivas. | "El sistema se encuentra integrado en producción con Salesforce CRM y la API de WhatsApp Cloud." | *"Se diseñó e implementó un prototipo académico funcional offline (SAI-GC v0.3) compuesto por seis interfaces navegables que operan de manera desacoplada con datos sintéticos."* |
| **Módulo de Triaje** | Motor determinista basado en reglas semánticas y expresiones regulares con salida A/B/C y salvaguarda precautoria. | "Se implementó un modelo de Machine Learning / NLP supervisado con 98% de precisión en producción." | *"El triaje se estructuró mediante un motor de reglas demostrativo y conservador; la validación estadística de precisión y recall queda sujeta a juicio de expertos en el Capítulo V."* |
| **Asistencia al Asesor** | Recuperación parametrizada de plantillas (KB-Demo) e interfaz Human-in-the-Loop (Aceptar, Editar, Rechazar, Escalar). | "Se implementó un sistema de IA generativa autónoma (RAG con LLM) que responde directamente a los clientes." | *"El sistema asiste al asesor recuperando plantillas estructuradas con identificador de fuente; la intervención humana es mandatoria, bloqueando cualquier envío autónomo de mensajes."* |
| **Gestión de Capacidad** | Ruteo dinámico basado en umbral nominal de 10 unidades, canal WhatsApp (5 u) y política experimental (A4/B5/C7). | "Se reemplazó el motor de enrutamiento omnicanal de Salesforce corporativo y se optimizaron las colas en tiempo real." | *"Se modeló un algoritmo de ruteo demostrativo que evalúa disponibilidad, skill y carga remanente sin sobrepasar la capacidad de 10 unidades, conservando el caso en cola si hay saturación."* |
| **Impacto en el TMO** | Línea base histórica documentada (16.76 min corporativo, 18.45 min ajustado, 16.93% abandono). | "El prototipo SAI-GC redujo el TMO en 3.5 minutos y el abandono en un 5%." | *"Los tiempos históricos corresponden a la línea base diagnóstica As-Is; la reducción causal del TMO en el escenario To-Be requiere verificación mediante simulación calibrada y prueba piloto."* |
| **Trazabilidad** | Bitácora en memoria y SQLite con exportación a JSON y CSV de todos los eventos y decisiones. | "Base de datos transaccional corporativa conectada a BigQuery / Data Warehouse." | *"Se estructuró una bitácora de auditoría local (JSON/CSV/SQLite) que registra fecha, caso, clase, fuente, decisión humana y asesor asignado para garantizar reproducibilidad."* |

---

## 2. Directrices de Redacción por Sección del Capítulo IV

### Sección 4.1: Arquitectura General de la Solución Propuesta
- **Qué declarar:**
  - Describir la arquitectura conceptual en 4 capas: (1) Capa de Interacción e Ingesta Sintética, (2) Capa de Triaje y Clasificación A/B/C, (3) Capa de Asistencia HITL y Repositorio de Conocimiento, y (4) Capa de Ruteo por Capacidad Ponderada y Auditoría.
  - Explicar la decisión ingenieril de construir un prototipo autónomo de alta fidelidad para validar la lógica operacional antes de acometer costos de integración en Salesforce.
- **Qué no afirmar:** No declarar conexiones WebSocket activas con Meta/WhatsApp Business API ni Webhooks productivos.

### Sección 4.2: Módulo de Triaje Inteligente y Taxonomía de Complejidad
- **Qué declarar:**
  - Fundamentar la descomposición en Clases A (informativa), B (validación intermedia) y C (sensible/contractual).
  - Destacar el principio de **seguridad operacional (escalamiento precautorio)**: cualquier texto no reconocido, ambiguo o fuera de catálogo es asignado automáticamente a Clase C con recomendación de escalamiento humano, evitando alucinaciones o respuestas erróneas.
- **Qué no afirmar:** No incluir matrices de confusión ni métricas F1 en este capítulo; dichas métricas pertenecen a la validación formal del Capítulo V.

### Sección 4.3: Módulo de Asistencia de Respuestas y Control Human-in-the-Loop
- **Qué declarar:**
  - Detallar el flujo de trabajo: la herramienta no reemplaza al operador, sino que reduce su fatiga cognitiva al buscar y estructurar el procedimiento aplicable.
  - Especificar el tratamiento del estado del IVR: si el cliente ya fue autenticado por el bot, se ahorran preguntas redundantes; si está pendiente, el sistema instruye al asesor a solicitar validación antes de dar saldos.
  - Explicar la botonera de control: Aceptar, Editar, Rechazar y Escalar.
- **Qué no afirmar:** No afirmar que el asesor envía respuestas con un solo clic sin leerlas, ni que la base de datos contiene saldos reales de clientes.

### Sección 4.4: Módulo de Gestión de Capacidad y Algoritmo de Ruteo Dinámico
- **Qué declarar:**
  - Explicar la regla vigente de la empresa: 10 unidades por asesor, WhatsApp = 5 unidades, correo = 10 unidades (máximo 2 WhatsApp simultáneos).
  - Contrastar esta regla con la política experimental (A=4, B=5, C=7): un caso C demanda 7 unidades, impidiendo que el asesor reciba otro caso C en paralelo, protegiendo la calidad de atención en siniestros y reclamos.
  - Documentar el pseudocódigo del algoritmo de selección: filtro por estado 'Disponible', filtro por skill de ramo, restricción de capacidad `<= 10`, y selección del mínimo cargado.
- **Qué no afirmar:** No presentar los pesos 4/5/7 como estándares certificados de la industria aseguradora; son valores de prueba para la hipótesis de investigación.

### Sección 4.5: Trazabilidad, Gobernanza de Datos y Registro de Auditoría
- **Qué declarar:**
  - Describir el esquema de la bitácora: campos capturados (`fecha_hora`, `caso`, `evento`, `clase`, `fuente`, `decision_humana`, `asesor_routing`, `politica`, `version`).
  - Mostrar la capacidad de exportación a formatos estándar JSON y CSV para auditoría de procesos industriales y cumplimiento normativo de la SBS (Superintendencia de Banca y Seguros).

---

## 3. Catálogo de Figuras y Tablas con Formato y Leyendas APA 7.ª Edición

Las siguientes leyendas deben colocarse textualmente debajo de cada figura o tabla en el documento de tesis:

### Figuras del Capítulo IV

- **Figura 6: Diagrama de flujo de atención multicanal y arquitectura funcional del SAI-GC**  
  *Nota.* Flujo operacional To-Be que ilustra la captura del motivo, triaje de complejidad A/B/C, control Human-in-the-Loop y ruteo dinámico respetando el límite de capacidad de 10 unidades. Elaboración propia (2026).

- **Figura 7: Esquema arquitectural por capas del prototipo desacoplado**  
  *Nota.* Estructura desacoplada en cuatro niveles: interfaz de supervisión tipo consola, motor de triaje determinista, repositorio de conocimiento asistido y gestor de capacidad con bitácora SQLite. Elaboración propia (2026).

- **Figura 8: Distribución de interacciones y línea base histórica de TMO (Ene–Jul 2026)**  
  *Nota.* Comportamiento del TMO corporativo (16.76 min), TMO ajustado de atenciones efectivas (18.45 min) y tasa de abandono (16.93%) sobre 55,924 contactos en el canal WhatsApp de postventa. Fuente: Reporte de operaciones de la aseguradora (2026).

- **Figura 9: Interfaz del módulo de atención asistida en ejecución del prototipo (Caso DEMO-003, Clase C)**  
  *Nota.* Captura auténtica del prototipo SAI-GC ejecutado localmente, evidenciando la clasificación en Clase C, la plantilla controlada de siniestros, la acción humana de escalamiento y el peso asignado para ruteo. Archivo: `evidencias/03_atencion_triaje_C.png`.

- **Figura 10: Registro de trazabilidad y bitácora de auditoría exportable**  
  *Nota.* Vista de la bitácora de eventos generada por las interacciones del operador en el prototipo, mostrando trazabilidad de decisiones humanas y políticas de capacidad. Archivo: `evidencias/07_bitacora.png`. *(Nota metodológica: Esta figura ilustra la verificación técnica de trazabilidad del prototipo; no representa una corrida de simulación de eventos discretos calibrada).*

### Mapeo de Capturas Reales en la Carpeta `evidencias/`

| Archivo de Evidencia | Pantalla del MVP | Descripción de la Evidencia Técnica |
|---|---|---|
| `01_atencion_triaje_A.png` | P1. Atención Asistida | Procesamiento del caso DEMO-001 (constancia), clasificación Clase A, riesgo bajo, plantilla informativa y peso 5. |
| `02_atencion_triaje_B.png` | P1. Atención Asistida | Procesamiento de DEMO-002 (deuda), Clase B, riesgo medio, alerta de validación IVR pendiente y edición de respuesta. |
| `03_atencion_triaje_C.png` | P1. Atención Asistida | Procesamiento de DEMO-003 (siniestro), Clase C, riesgo alto, botón Escalar y control reforzado sin envío automático. |
| `04_supervision_agentes.png` | P2. Representantes | Vista de supervisión de asesores, visualización de estados (disponible, ocupado, refrigerio) y barras de carga sobre 10 unidades. |
| `05_retraso_colas.png` | P3. Retraso de Colas | Monitoreo sintético de colas por canal (WhatsApp, Correo, Facebook), tiempos de espera y niveles de prioridad. |
| `06_trabajo_en_curso.png` | P4. Trabajo en Curso | Tabla de casos WIP (Work In Progress), reflejando la asignación confirmada desde la consola de atención. |
| `07_bitacora.png` | P5. Bitácora | Trazabilidad cronológica de eventos, casos, decisiones humanas y botones de exportación JSON/CSV. |
| `08_configuracion.png` | P6. Configuración | Panel de control metodológico con selector entre la regla actual confirmada y la política experimental A4/B5/C7. |

### Tablas del Capítulo IV (Tablas 9 a 15)

- **Tabla 9:** Parámetros comparativos entre el proceso As-Is observado y el proceso To-Be propuesto.
- **Tabla 10:** Reglas léxicas y sintácticas preliminares para la clasificación A/B/C del triaje.
- **Tabla 11:** Especificación del repositorio demostrativo de conocimiento (KB-Demo) y plantillas asistidas.
- **Tabla 12:** Estructura de capacidades, ponderaciones por canal y políticas de routing.
- **Tabla 13:** Esquema relacional de la bitácora de eventos para trazabilidad de auditoría.
- **Tabla 14:** Cobertura de casos de prueba sintéticos implementados en el prototipo (DEMO-001 a DEMO-008).
- **Tabla 15:** Resultados de las pruebas de ejecución unitaria y verificación de interfaz de usuario.
