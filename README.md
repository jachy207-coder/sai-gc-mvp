# SAI-GC | Sistema de Asistencia Inteligente y Gestión de Capacidad
**MVP Académico Funcional Demostrativo · Versión R01 (v0.3-r01-demo)**  
*Tesis para la Carrera de Ingeniería Industrial / Sistemas · UPC*  
*Fecha de corte: Octubre 2026*  

---

## 1. Instrucciones de Apertura Inmediata

Este repositorio contiene dos modalidades de ejecución para evaluación y defensa:

### Opción A — Ejecución Offline Inmediata (Recomendada para Jurados y Evaluadores)
No requiere instalación de software, servidores, Python, Node ni conexión a internet:
1. Navegue en el Explorador de Archivos de Windows a esta carpeta.
2. Haga **doble clic sobre el archivo [SAI_GC_MVP_ABRIR.html](file:///c:/Users/JAVIER%20CHUNGA/Desktop/SGI%20VICTOR%20UPC/SAI_GC_MVP_ABRIR.html)**.
3. Se abrirá inmediatamente en su navegador predeterminado (Google Chrome, Microsoft Edge, Mozilla Firefox o Safari) con todas las funcionalidades, estilos y lógica integradas en un archivo autocontenido.

### Opción B — Versión Modular para Desarrollo Web
Para desarrolladores que deseen inspeccionar o iterar el código en ficheros independientes:
1. Abra una terminal en esta carpeta.
2. Inicie un servidor web local:
   ```powershell
   npx serve .
   # o alternativamente:
   python -m http.server 8000
   ```
3. Abra en su navegador la URL `http://127.0.0.1:8000/index.html`.

### Opción C — Fase Escalable en Python (Streamlit + SQLite)
Para la arquitectura en Python con persistencia en base de datos SQLite indexada:
1. Instale las dependencias especificadas en `requirements.txt`:
   ```powershell
   pip install -r requirements.txt
   ```
2. Ejecute la aplicación Streamlit:
   ```powershell
   streamlit run app.py
   ```

---

## 2. Mapa de Pantallas del Prototipo

El prototipo implementa la consola de operaciones y supervisión inspirada en el lenguaje visual de Salesforce Lightning:

| Identificador | Nombre de Pantalla | Funcionalidades Principales | Evidencia Asociada |
|:---:|---|---|---|
| **P1** | **Atención asistida** | Simulación de chat de WhatsApp, selector de casos `DEMO-001..008`, validación IVR (completa vs pendiente), ramo, triaje automático A/B/C, recuperación de plantillas KB demostrativas, control Human-in-the-Loop (Aceptar, Editar, Rechazar, Escalar) y recomendación de routing. | `evidencias/01_atencion_triaje_A.png`<br>`evidencias/02_atencion_triaje_B.png`<br>`evidencias/03_atencion_triaje_C.png` |
| **P2** | **Representantes de atención** | Monitoreo de estado de asesores (Disponible, Ocupado, Refrigerio), resumen de trabajo, canal, barras de utilización sobre 10 unidades de capacidad y carga actual. | `evidencias/04_supervision_agentes.png` |
| **P3** | **Retraso de colas** | Monitoreo multicanal (WhatsApp, Correo, Facebook), prioridad, tamaño de pendientes, espera máxima, espera media y riesgo operacional sintético. | `evidencias/05_retraso_colas.png` |
| **P4** | **Trabajo en curso (WIP)** | Seguimiento en tiempo real de conversaciones activas asignadas a los asesores, reflejando dinámicamente las asignaciones confirmadas en P1. | `evidencias/06_trabajo_en_curso.png` |
| **P5** | **Bitácora y trazabilidad** | Registro cronológico inmutable de auditoría: fecha, caso, evento, clase, fuente, decisión humana, asesor y política. Descarga con un clic a formato **JSON** y formato **CSV**. | `evidencias/07_bitacora.png` |
| **P6** | **Configuración** | Panel metodológico para alternar entre la regla actual confirmada (WhatsApp = 5, capacidad = 10) y la política experimental hipotética (A=4, B=5, C=7). | `evidencias/08_configuracion.png` |

---

## 3. Cobertura de Casos Sintéticos (DEMO-001 a DEMO-008)

El prototipo incluye 8 casos preconfigurados para demostrar la totalidad de las reglas de negocio exigidas:

1. **`DEMO-001` · Solicitud de constancia (Clase A):**
   - *Comportamiento:* Consulta simple de orientación; triaje asigna Clase A (riesgo bajo), recupera `KB-DEMO-001`, peso 5 (actual) y asesor acepta la sugerencia.
2. **`DEMO-002` · Consulta de estado de cuenta y deuda (Clase B):**
   - *Comportamiento:* Procedimiento con validaciones; triaje asigna Clase B (riesgo medio); el IVR figura como *Pendiente*, alertando al asesor a verificar identidad antes de responder; permite edición de la respuesta.
3. **`DEMO-003` · Siniestro e indemnización (Clase C):**
   - *Comportamiento:* Gestión crítica de alta sensibilidad; triaje asigna Clase C (riesgo alto), recupera `KB-DEMO-003`, bloquea envío autónomo y habilita la acción *Escalar*.
4. **`DEMO-004` · Anulación de póliza por excepción (Clase C):**
   - *Comportamiento:* Trámite contractual sensible; triaje asigna Clase C con recomendación de revisión humana sin ejecución automática.
5. **`DEMO-005` · Texto no reconocido / fuera de catálogo (C precautoria):**
   - *Comportamiento:* Consulta fuera de dominio; aplica el principio de seguridad operacional asignando Clase C precautoria, fuente `KB-NO-COBERTURA` e instrucción obligatoria de escalamiento.
6. **`DEMO-006` · Saturación en cola (Sin capacidad disponible):**
   - *Comportamiento:* Simula momento de saturación con asesores ocupados al 100% de su capacidad (10/10); el algoritmo se niega a sobrecargar y retiene el caso en cola.
7. **`DEMO-007` · Especialista en refrigerio/pausa:**
   - *Comportamiento:* Asesor de ramo especializado en estado *Refrigerio*; el algoritmo lo excluye del ruteo, preservando el descanso del operador.
8. **`DEMO-008` · Comparativa de políticas Actual vs Experimental:**
   - *Comportamiento:* Caso sensible que contrasta el peso de 5 unidades de la regla real frente a 7 unidades de la política experimental, ilustrando la menor concurrencia permitida para casos complejos.

---

## 4. Guion Recomendado para Sustentación (5 Minutos)

1. **Minuto 1 — Introducción y Línea Base:**
   - Abrir [SAI_GC_MVP_ABRIR.html](file:///c:/Users/JAVIER%20CHUNGA/Desktop/SGI%20VICTOR%20UPC/SAI_GC_MVP_ABRIR.html).
   - Señalar los 4 KPI históricos en la barra superior (16.76 min TMO corporativo, 14.50 min meta, 18.45 min TMO ajustado, 16.93% abandono). Explicar que corresponden a 55,924 interacciones reales observadas.
2. **Minuto 2 — Triaje, Human-in-the-Loop y Seguridad:**
   - Seleccionar `DEMO-001`, pulsar *Procesar consulta* y mostrar la Clase A.
   - Seleccionar `DEMO-003`, pulsar *Procesar consulta* y mostrar cómo se reclasifica en tiempo real a Clase C (riesgo alto).
   - Pulsar *Escalar* y destacar que la herramienta **jamás envía mensajes sin revisión humana**.
3. **Minuto 3 — Routing y Capacidad Dinámica:**
   - Observar el asesor recomendado (Asesor Demo 01 con carga 0). Pulsar *Confirmar asignación demostrativa*.
   - Ir a la pestaña **Representantes** para observar cómo la barra de utilización de dicho asesor pasa a 5/10 unidades (50%).
   - Ir a **Trabajo en curso** y verificar que el caso ingresó a la lista de conversaciones activas.
4. **Minuto 4 — Trazabilidad y Descarga de Bitácora:**
   - Ir a la pestaña **Bitácora**. Mostrar la cronología inmutable de eventos.
   - Hacer clic en *Exportar bitácora JSON* y *Exportar bitácora CSV* para demostrar la reproducibilidad y cumplimiento para auditorías de procesos.
5. **Minuto 5 — Gobernanza y Cierre:**
   - Ir a **Configuración**, activar la *Política Experimental A/B/C* y explicar la diferencia con la regla real.
   - Enfatizar el mensaje de cierre: *"El prototipo demuestra la viabilidad técnica y operacional del flujo; la comprobación causal sobre la reducción de TMO se desarrollará en el Capítulo V mediante juicio de expertos, piloto controlado y simulación DES"*.

---

## 5. Pruebas Automáticas Ejecutables

El proyecto cuenta con suites de pruebas unitarias automáticas tanto en JavaScript como en Python:

### Pruebas en JavaScript / Node.js
Ejecutables con Node.js (v18+):
```powershell
node --test tests/logic.test.mjs
```
*Resultado:* 16/16 pruebas unitarias aprobadas (cobertura total de funciones puras `classify`, `weightFor`, `route`, `respond`, `processCase`, `log_event`, `export_evidence` y casos DEMO).

### Pruebas en Python
Ejecutables con la librería estándar `unittest`:
```powershell
python -m unittest tests/test_logic.py
```
*Resultado:* 15/15 pruebas unitarias aprobadas (cobertura de lógica, base de datos SQLite y exportación).

---

## 6. Límites Académicos y Condiciones de Verdad

1. **Sin Conexión Productiva:** El prototipo es 100% local y desacoplado. No realiza llamadas a la API de Salesforce, Meta WhatsApp Cloud ni bases de datos core.
2. **Datos Sintéticos:** Los clientes, pólizas, agentes `AG-*` y consultas son datos de prueba rotulados.
3. **Línea Base Histórica Inmutable:** Los 4 indicadores de cabecera son mediciones de diagnóstico As-Is; no son resultados de mejora logrados por el MVP.
4. **Asistencia por Recuperación:** El sistema utiliza plantillas estructuradas con identificador de fuente `KB-DEMO-*`; no afirma utilizar IA generativa productiva ni RAG en la nube.
5. **Pesos Experimentales No Calibrados:** Los valores A=4, B=5, C=7 son hipótesis ilustrativas; nunca deben presentarse como valores validados por la aseguradora.

---

## 7. Estructura de Entregables del Paquete

- `SAI_GC_MVP_ABRIR.html`: Aplicación web autocontenida de apertura directa con doble clic.
- `index.html`, `styles.css`, `logic.mjs`, `script.mjs`: Código fuente modular para desarrollo web.
- `app.py`, `database.py`, `logic.py`, `requirements.txt`: Código fuente de la versión Python/Streamlit/SQLite.
- `tests/logic.test.mjs`: Pruebas automáticas en Node.js.
- `tests/test_logic.py`: Pruebas automáticas en Python.
- `evidencias/`: 9 capturas reales obtenidas de la ejecución interactiva en navegador (`00` a `08`).
- `CONFIGURACION.md`: Especificación técnica de parámetros confirmados vs supuestos experimentales.
- `ALINEAMIENTO_CAP_IV.md`: Guía de redacción del Capítulo IV, matriz de honestidad y catálogo de figuras APA.
- `VALIDACION_CAP_V.md`: Plan metodológico para validación por expertos, piloto cuasiexperimental y simulación DES.
- `INFORME_PRUEBAS_R01.txt`: Registro formal de verificación técnica y resultados de tests.
- `PLAN_MAESTRO_R01.md`: Hoja de ruta estratégica de investigación.
