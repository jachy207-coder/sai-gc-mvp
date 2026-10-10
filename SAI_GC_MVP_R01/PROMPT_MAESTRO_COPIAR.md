# PROMPT MAESTRO — SAI-GC | MVP funcional académico R01

**Instrucción para Codex, ChatGPT Work o una herramienta de desarrollo asistido por IA.**

Actúa como arquitecto de software, desarrollador full-stack, diseñador de interfaces de operaciones de servicio y especialista en Ingeniería Industrial. Construye y prueba un prototipo académico funcional denominado **SAI-GC — Sistema de Asistencia Inteligente y Gestión de Capacidad**, para una tesis sobre TMO del canal WhatsApp de postventa de una aseguradora peruana. Trabaja de manera incremental, dejando código, pruebas, instrucciones de ejecución, capturas reales y documentación reproducible. No te limites a generar mockups o ilustraciones: el usuario tiene que poder hacer clic en los módulos y observar cambios de estado, cálculos y registros reales del prototipo.

## 0. Condiciones de verdad y límites del proyecto

1. Se trata de un **MVP académico local, autónomo de Salesforce**, no de una integración de producción. No accedas a la API real de Salesforce, WhatsApp ni sistemas core de seguros.
2. Nunca inventes pólizas, clientes reales, saldos, coberturas, fechas de pago, validaciones corporativas ni resultados de pilotos. Usa casos `DEMO-*`, agentes `AG-*` y datos sintéticos claramente rotulados.
3. La evidencia histórica confirmada que SÍ puede mostrarse como línea base: **55,924 interacciones WhatsApp–Post Venta (ene–jul 2026); TMO corporativo 16.76 min; meta 14.50 min; TMO de atenciones efectivas 18.45 min; abandono 16.93%**. Son valores históricos; no presentarlos como resultados del nuevo MVP.
4. La política actual declarada por el tesista: **capacidad máxima 10 unidades por asesor; conversación WhatsApp = 5 unidades; caso de correo = 10 unidades**, por lo cual la regla usual de WhatsApp permite dos chats paralelos si no hay otra carga.
5. La clasificación por complejidad A/B/C y sus reglas son **preliminares**: A=informativa/simple, B=requiere validaciones, C=alta sensibilidad/riesgo/escalamiento. El sistema debe marcar explícitamente “pendiente de validación experta”.
6. En una política experimental independiente, ofrecer como **valores puramente ilustrativos configurables**: peso A=4, B=5, C=7, con capacidad 10. Nunca afirmar que son pesos reales de la empresa ni que han sido calibrados.
7. **Human-in-the-loop**: la herramienta propone respuestas y opciones, pero jamás envía automáticamente mensajes a un cliente. Acciones disponibles: Aceptar, Editar, Rechazar y Escalar. Las operaciones sensibles clase C requieren control reforzado.
8. La base de conocimiento de prueba es demostrativa y visible, con identificador de fuente y versión. No afirmar haber implementado IA generativa o RAG/LLM si solo hay recuperación y plantillas. Si se incorpora un LLM, debe ser opcional, autorizado, con manejo de datos sintéticos y evidencia claramente diferenciada.
9. Las capturas de pantalla entregadas por el tesista son **referencias de diseño y flujo**; no debes copiar nombres, mensajes de clientes, identificadores, correos ni información visible de usuarios reales.
10. No se puede concluir reducción causal del TMO sin validación experta, piloto y simulación As-Is/To-Be calibrada. No presentar cifras To-Be inventadas.

## 1. Flujo operacional que se debe representar

**AS-IS observado:** cliente ingresa al IVR/bot existente → bot maneja respuestas básicas → si requiere asesor, deriva a cola → el asesor pregunta o recibe el motivo y puede necesitar validar identidad → consulta procedimientos/plataformas → responde → finaliza. El supervisor dispone de una vista de agentes con estado, capacidad y carga; otra para retraso de colas y otra para trabajo en curso. La asistencia actualmente disponible puede sugerir mensajes de espera, pero no debe suponerse que consulta información transaccional verificada.

**TO-BE propuesto, sin integrar con Salesforce:** IVR existente (representación) → capturar motivo principal y estado de validación → triaje A/B/C → estimar peso para routing → recomendar asesor disponible con skill y capacidad → recuperar contenido de KB-demo → construir sugerencia → solicitar decisión humana → registrar trazabilidad → exponer indicadores de prueba. No se deben volver a solicitar datos si el flujo indica que ya se validaron; cuando la validación esté pendiente, la herramienta solo alerta al asesor y no simula autenticaciones reales.

## 2. Módulos y pantallas exigidos

### P1. Atención asistida / conversación
- Barra superior “SAI-GC”, texto “DEMO · DATOS SINTÉTICOS”, versión y aviso “NO CONECTADO A SALESFORCE”.
- Pestañas de navegación estilo consola profesional, similares a: “Atención asistida”, “Representantes de atención al cliente”, “Retraso de colas”, “Trabajo en curso”, “Bitácora”, “Configuración”.
- Históricos en cuatro tarjetas *claramente rotuladas*: TMO corporativo 16.76 min, meta 14.50 min, TMO ajustado 18.45 min, abandono 16.93%.
- A la izquierda: panel “Conversación” con mensajes de cliente en gris muy claro a la izquierda; mensajes del bot en gris oscuro a la derecha; evento de transferencia de cola centrado; selector de caso `DEMO-001..004`; selector de validación `Validado por bot` / `Pendiente: valida asesor`; selector de ramo Vida/Salud/Vehicular; cuadro de texto anonimizado; botón “Procesar consulta”.
- A la derecha: “Triaje A/B/C” con clase, nivel de riesgo y motivo de la regla; “Asistencia de respuesta” con KB recuperada, sugerencia y controles Aceptar/Editar/Rechazar/Escalar; “Capacidad y routing” con peso del caso, asesor recomendado, carga actual/proyectada y confirmación de asignación demostrativa.
- Al procesar, los campos cambian a partir de reglas ejecutables y se registra un evento.

### P2. Representantes de atención al cliente
Tabla con columnas: Agente; Estado; Resumen de trabajo; Canal; Capacidad principal; Carga de trabajo; Acciones. Mostrar indicadores de disponibilidad verde, ocupado rojo, refrigerio/pausa amarillo. Usar agentes ficticios. Capacidad/10 y barra de utilización, sin sobrepasar el umbral.

### P3. Retraso de colas
Tabla con cola, prioridad, tamaño de trabajo, tipo, espera total, tiempo de espera más largo, espera media y riesgo operativo. Colas de ejemplo: WhatsApp, Correo, Facebook. Todos los conteos y esperas del demo serán sintéticos.

### P4. Trabajo en curso
Tabla de casos asignados, canal, asesor, conversaciones abiertas, tiempo transcurrido, clase y estado. Las asignaciones confirmadas desde P1 deben verse aquí.

### P5. Bitácora
Registro por evento, con fecha/hora, caso, versión, clase, fuente KB, acción humana, asesor/recomendación y política actual/experimental. Incluir exportación descargable a JSON/CSV. Para versión Python, preferir SQLite con esquema simple e índices.

### P6. Configuración
Selector visible entre “Regla actual (WhatsApp =5, capacidad 10)” y “Política A/B/C experimental (pesos hipotéticos A4 B5 C7)”. No permitir que cambiar parámetros borre evidencia histórica ni mezcle escenarios. Mostrar límites metodológicos.

## 3. Sistema visual — fiel a las capturas, sin usar logos propietarios

- Apariencia de consola Salesforce Lightning-like a nivel de *lenguaje visual*, no imitar marcas ni datos. Tablas de supervisión blancas, encabezados azul nítido y gris oscuro, líneas horizontales delgadas, filas gris claro alternadas.
- Paleta propuesta, estimada visualmente: azul de acción `#0176D3`, azul oscuro `#014486`, fondo `#F5F7FA`, blanco `#FFFFFF`, líneas `#D8DDE4`, texto `#181818`, secundario `#596579`, verde disponible `#2E844A`, rojo ocupado `#C23934`, amarillo alerta `#D7891E`.
- Tipografía Arial o Calibri, base 12–13 px, títulos 20–22 px. No usar tipografías decorativas.
- Menú de pestañas con subrayado azul, barra superior blanca, paneles rectangulares con borde de 1 px y radios discretos. Iconos simples, no caricaturas.
- Conversación: mensajes entrantes gris casi blanco; salientes gris oscuro; eventos de bot y transferencia como texto centrado pequeño. Mantener texto suficientemente legible.
- Desktop 1440–1650 px de ancho; capturas 16:9 o ancho panorámico. Evitar 3D, sombras, degradados, adornos, efectos publicitarios.
- Todas las pantallas deben mostrar un aviso inequívoco de modo demostrativo y datos sintéticos.

## 4. Arquitectura técnica objetivo

**Fase rápida demostrativa:** HTML, CSS y JavaScript sin dependencias externas, ejecutable en un navegador local. Incluir fichero único autocontenido para un evaluador sin conocimientos técnicos y ficheros modulares para desarrollo.

**Fase académica escalable:** Python 3.11+, Streamlit para interfaz, pandas para preparación de datos, scikit-learn para TF-IDF/recuperación preliminar, SQLite para bitácora. Si Streamlit no está disponible sin conexión, entregar igualmente archivos `app.py` / `requirements.txt` y explicar que necesitan instalación antes de ser declarados probados. No afirmar uso efectivo de librerías sin pruebas.

Diseñar las siguientes funciones puras para facilitar auditoría y tests:
- `classify(text)->{class,risk,reason,confidence}`: coincidencia de reglas de demostración, clase C en términos críticos, escalamiento precautorio si no hay cobertura.
- `respond(class,validated)` que devuelve fuente KB-demo y sugerencia controlada sin datos transaccionales.
- `weightFor(class,policy)` que separa regla real vs experimental.
- `route(agents,class,branch,policy)` que filtra `status == Disponible`, skill requerido y `(carga_actual + peso) <= 10`; selecciona el asesor elegible de menor carga, o conserva el caso en cola.
- `log_event(...)` y `export_evidence()` que soportan auditoría de actividades, incluyendo versión del artefacto.

## 5. Casos de demostración / cobertura de prueba

- `DEMO-001`: solicitud de constancia → A preliminar, KB informativa, asistente sugiere y asesor acepta.
- `DEMO-002`: consulta de deuda/estado de cuenta → B preliminar, fuente de consulta verificada, asesor edita o revisa; advertencia si IVR no validó.
- `DEMO-003`: siniestro/indemnización → C preliminar, riesgo alto, procedimiento controlado y botón Escalar.
- `DEMO-004`: anulación por excepción → C preliminar, requiere revisión humana, no ejecutar acción contractual.
- `DEMO-005`: texto no reconocido → C precautoria; no alucinar fuente ni respuesta.
- `DEMO-006`: todos los agentes ocupados o sin capacidad → mantener en cola y no forzar asignación.
- `DEMO-007`: agente en refrigerio/capacitación → excluido de routing.
- `DEMO-008`: política actual vs experimental → mostrar peso, diferencia y declarar que experimental no está calibrada.

## 6. Criterios de aceptación antes de reportar “MVP funcional”

1. La aplicación inicia en entorno documentado sin errores de JavaScript/Python.
2. Se puede navegar entre todas las pantallas, y las acciones afectan los datos mostrados.
3. Un caso C nunca recibe sugerencia de envío automático, y un caso sin cobertura es escalado precautoriamente.
4. Se conserva la distinción entre validación IVR completa y pendiente.
5. El routing no supera 10 unidades ni asigna a un asesor ocupado/en pausa.
6. Se registran eventos de triaje, decisión humana y asignación; se exporta la bitácora.
7. La política actual mantiene peso 5; la experimental exhibe advertencia visible.
8. Los valores del diagnóstico histórico permanecen constantes y separados de números sintéticos.
9. La interfaz contiene rótulos DEMO y no muestra datos reales ni propietarios.
10. Ejecutar pruebas automáticas y pruebas de navegador; registrar fecha, entorno, versión y resultados. Una captura solo puede denominarse “evidencia funcional” si proviene de la aplicación ejecutada, no de generación de imágenes.

## 7. Capturas y evidencia para el Capítulo IV

Generar y guardar capturas en `evidencias/` de:
- `01_atencion_triaje_A.png`: caso simple y fuente.
- `02_atencion_triaje_B.png`: consulta intermedia y validación pendiente.
- `03_atencion_triaje_C.png`: siniestro, clase C y acción Escalar.
- `04_supervision_agentes.png`: estado/capacidad/carga.
- `05_retraso_colas.png`: tabla de pendientes.
- `06_trabajo_en_curso.png`: asignaciones y estado.
- `07_bitacora.png`: registros de acciones.
- `08_configuracion.png`: regla real vs política experimental.

Las figuras deben llevar fuera de la imagen su número y leyenda APA correspondiente. Dentro de las capturas preservar solo la marca de modo demo. La Figura 6 debe ser un diagrama de arquitectura/flujo; la Figura 7 un esquema por capas; la Figura 8 un gráfico estadístico de datos históricos; la Figura 9 puede apoyarse en una captura auténtica de la aplicación; la Figura 10 solo se puede llamar “simulación” cuando exista un motor calibrado: mientras tanto mostrarla como bitácora o prueba técnica, no como evidencia To-Be.

## 8. Entregables finales exigidos

1. `README.md` con instrucciones de apertura, mapa de pantallas, límites y condiciones.
2. Código fuente modular + variante autocontenida offline.
3. `tests/` con pruebas automáticas ejecutables.
4. `evidencias/` con capturas **reales de la ejecución del MVP**.
5. `CONFIGURACION.md` con parámetros confirmados y supuestos experimentales separados.
6. `ALINEAMIENTO_CAP_IV.md` con qué declarar en secciones 4.1–4.5 y qué no afirmar.
7. `VALIDACION_CAP_V.md` con plan de expertos, piloto, simulación calibrada y métricas de efectividad, sin inventar resultados.

Procede en pequeños incrementos, prueba antes de capturar, registra cualquier bloqueo y entrega al usuario un informe honesto de funciones implementadas, no implementadas y pendientes de validar. No detengas el proyecto a la espera de credenciales productivas: usa datos sintéticos controlados.
