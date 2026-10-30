# SAI-GC | Sistema de Asistencia Inteligente y Gestión de Capacidad
**MVP Académico Funcional Demostrativo · Versión R02 (`v0.5-r02-verificable`)**  
*Tesis para la Carrera de Ingeniería Industrial · Universidad Peruana de Ciencias Aplicadas (UPC)*  
*Autor: Víctor Chunga · Fecha de corte: Octubre 2026*  

[![Node.js Tests](https://img.shields.io/badge/Unit%20Tests-31%2F31%20PASS-brightgreen?style=for-the-badge&logo=node.js)](file:///c:/Users/JAVIER%20CHUNGA/Desktop/SGI%20VICTOR%20UPC/evidencias/r02/pruebas_js.txt)
[![Gobernanza Humana](https://img.shields.io/badge/Gobernanza-Human--in--the--Loop%20R02-blue?style=for-the-badge)](file:///c:/Users/JAVIER%20CHUNGA/Desktop/SGI%20VICTOR%20UPC/evidencias/r02/matriz_T01_T15.csv)
[![Benchmark Enrutamiento](https://img.shields.io/badge/Benchmark-4%20Pol%C3%ADticas%20Comparadas-orange?style=for-the-badge)](file:///c:/Users/JAVIER%20CHUNGA/Desktop/SGI%20VICTOR%20UPC/evidencias/r02/benchmark_routing_resumen.md)

---

## 1. Instrucciones de Apertura Inmediata

Este repositorio contiene tres modalidades sincronizadas al 100% para evaluación, auditoría y defensa:

### Opción A — Ejecución Offline Inmediata (Recomendada para Jurados y Evaluadores)
No requiere instalación de software, servidores, Python, Node ni conexión a internet:
1. Navegue en el Explorador de Archivos de Windows a esta carpeta.
2. Haga **doble clic sobre el archivo [SAI_GC_MVP_ABRIR.html](file:///c:/Users/JAVIER%20CHUNGA/Desktop/SGI%20VICTOR%20UPC/SAI_GC_MVP_ABRIR.html)**.
3. Se abrirá inmediatamente en su navegador predeterminado (Google Chrome, Microsoft Edge, Mozilla Firefox o Safari) con todas las funcionalidades, estilos y lógica integradas en un archivo único autocontenido (101 KB).

### Opción B — Versión Modular Web para Inspección de Código
Para desarrolladores que deseen inspeccionar o iterar el código en ficheros independientes:
1. Abra una terminal en esta carpeta.
2. Inicie un servidor web local:
   ```powershell
   npx serve .
   # o alternativamente:
   python -m http.server 8000
   ```
3. Abra en su navegador la URL `http://127.0.0.1:8000/index.html`.

### Opción C — Versión Python (Streamlit + SQLite)
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

## 2. Novedades y Controles de Seguridad de la Versión R02

La versión `R02 (v0.5-r02-verificable)` implementa una estricta arquitectura de seguridad operacional y gobernanza humana (*Human-in-the-Loop*):

1. **Función Central Pura de Autorización (`canConfirmAssignment` / `can_confirm_assignment`):**  
   Ninguna asignación se ejecuta sin atravesar una barrera algorítmica centralizada que verifica decisiones humanas, huellas vigentes, capacidad y especialidad.
2. **Huella Criptográfica de Revisión (`computeCaseRevision` / `compute_case_revision`):**  
   Genera una huella unívoca por hash (`rev-xxxxxxxx`) combinando ID, texto, ramo, estado IVR y política. Cualquier modificación posterior al triaje invalida automáticamente la aprobación previa (`ERR_STALE_REVISION`).
3. **Escalamiento Obligatorio de Casos Clase C y Baja Cobertura:**  
   Los casos de siniestros, anulaciones por excepción o consultas desconocidas no pueden ser asignados a la cola estándar (`ERR_CLASS_C_ESCALATION`), requiriendo escalamiento formal a la *Cola de Supervisión / Siniestros*.
4. **Verificación Manual Obligatoria para Casos con IVR Pendiente:**  
   Cuando la validación previa del bot no fue completada (`validated: false`), el sistema exige al asesor marcar el checkbox de verificación de identidad antes de permitir la asignación (`ERR_IVR_UNVERIFIED`).
5. **Revalidación en Tiempo Real de Capacidad y Especialidad:**  
   Al momento de confirmar, el motor verifica el estado en vivo de los asesores (`Disponible`), coincidencia estricta de skill y tope de capacidad ($\le 10$ unidades), bloqueando con `ERR_NO_CAPACITY_OR_SKILL` si no hay disponibilidad real.
6. **Idempotencia y Prevención de Duplicados:**  
   Bloquea asignaciones repetidas sobre casos que ya cuenten con trabajo activo en curso (`ERR_DUPLICATE_ASSIGNMENT`).

---

## 3. Mapa de Pantallas del Prototipo

El prototipo implementa la consola de operaciones y supervisión inspirada en el lenguaje visual de Salesforce Lightning:

| Identificador | Nombre de Pantalla | Funcionalidades Principales |
|:---:|---|---|
| **P1** | **Atención asistida** | Triaje automático A/B/C, chip de estado de caso (`PENDIENTE_REVISION`, `APROBADO`, `ESCALAMIENTO_REQUERIDO`, etc.), token de revisión visual, verificación manual IVR, botones de decisión humana (Aceptar, Guardar y aprobar edición, Rechazar, Escalar a supervisión) y recomendación de routing. |
| **P2** | **Representantes de atención** | Monitoreo en tiempo real de asesores (Disponible, Ocupado, Refrigerio), barras de utilización sobre 10 unidades de capacidad y carga actual. |
| **P3** | **Retraso de colas** | Monitoreo multicanal (WhatsApp, Correo, Facebook), prioridad, tamaño de pendientes, espera máxima, espera media y riesgo operacional sintético. |
| **P4** | **Trabajo en curso (WIP)** | Seguimiento de conversaciones activas asignadas a los asesores, reflejando dinámicamente las asignaciones confirmadas en P1 con control de duplicados. |
| **P5** | **Bitácora y trazabilidad** | Registro cronológico inmutable con campos R02: `timestampIso`, `revision`, `caseStatus`, `resultado`, `motivo_bloqueo`, `rol_actor`. Exportación con un clic a **JSON** y **CSV**. |
| **P6** | **Configuración** | Panel metodológico para alternar entre la regla actual confirmada (WhatsApp = 5, capacidad = 10) y la política experimental hipotética (A=4, B=5, C=7). |

---

## 4. Benchmark Comparativo de Políticas de Enrutamiento

Ubicado en `experiments/benchmark_routing.mjs`, evalúa 4 políticas sobre un lote sintético reproducible de 60 casos:

```powershell
node experiments/benchmark_routing.mjs
```

| Política Evaluada | Asignados | En Cola (Espera) | Escalados Supervisión | Carga Media | Desv. Est. ($\sigma$) |
|---|:---:|:---:|:---:|:---:|:---:|
| **FIFO Clásico** | 8 (13.3%) | 52 (86.7%) | 0 (0.0%) | 10.00 / 10 | 0.00 |
| **Regla Actual** | 8 (13.3%) | 52 (86.7%) | 0 (0.0%) | 10.00 / 10 | 0.00 |
| **LBF Adaptada** | 8 (13.3%) | 52 (86.7%) | 0 (0.0%) | 10.00 / 10 | 0.00 |
| **SAI-GC R02 (Propuesta)** | 8 (13.3%) | 31 (51.7%) | 21 (35.0%) | 8.25 / 10 | 0.43 |

*Conclusión Técnica:* El triaje especializado y escalamiento de Clase C desatura la cola ordinaria (reduciendo de 52 a 31 los casos estancados) y preserva un margen operativo en los asesores (utilización media de 82.5% vs 100% de saturación en las basales).

---

## 5. Pruebas Automáticas Ejecutables (31/31 PASS)

El proyecto cuenta con un conjunto de **31 pruebas automatizadas** que validan la lógica base (16) y el protocolo de controles de seguridad R02 (T01 a T15):

```powershell
# Ejecución en JavaScript (Node.js nativo):
node --test tests/logic.test.mjs
```

```powershell
# Ejecución en Python (unittest):
python -m unittest tests/test_logic.py
```

*Resumen de Cobertura:*
- **1-16:** Clasificación A/B/C, pesos, routing greedy, exclusión de pausas, capacidad $\le 10$, retención en cola y ecuación industrial de capacidad.
- **T01-T02:** Bloqueo de asignación sin aprobación humana previa (`ERR_NO_APPROVAL`).
- **T03:** Aprobación válida y despacho con asignación única (`OK_APPROVED`).
- **T04:** Bloqueo de borrador en edición sin consolidar (`ERR_EDIT_NOT_APPROVED`).
- **T05:** Bloqueo ante rechazo explícito del asesor (`ERR_REJECTED`).
- **T06-T07:** Escalamiento mandatorio de casos Clase C y consultas fuera de dominio (`ERR_CLASS_C_ESCALATION`).
- **T08-T09:** Detección de huellas obsoletas tras mutación de parámetros (`ERR_STALE_REVISION`).
- **T10-T12:** Revalidación de capacidad, pausas y especialidad de asesores (`ERR_NO_CAPACITY_OR_SKILL`).
- **T13:** Prevención de asignaciones duplicadas (`ERR_DUPLICATE_ASSIGNMENT`).
- **T14:** Exigencia de verificación manual de identidad IVR (`ERR_IVR_UNVERIFIED`).
- **T15:** Auditoría, trazabilidad y exportación de bitácora con esquema R02.

---

## 6. Evidencias Verificables de la Versión R02

Todos los artefactos de verificación se encuentran consolidados en la carpeta `evidencias/r02/`:
- `version_commit.txt`: Hash de commit base, rama y metadatos de liberación.
- `entorno.txt`: Especificación de plataforma Windows 11, Node.js v24 y configuración de prueba.
- `pruebas_js.txt`: Salida íntegra de la consola de `node:test` (31 pruebas aprobadas).
- `matriz_T01_T15.csv`: Matriz formal de pruebas con condición de entrada, barrera y resultado observado.
- `log_eventos_sinteticos.json`: Bitácora JSON exportada con esquema de trazabilidad R02.
- `incidencias_y_correcciones.md`: Informe técnico de las 6 vulnerabilidades de R01 y sus soluciones.
- `benchmark_routing_resumen.md`: Reporte de resultados del benchmark comparativo entre 4 políticas.
- `benchmark_routing_resultados.json`: Datos estructurados de la simulación de benchmark.

---

## 7. Límites Académicos y Condiciones de Verdad

1. **Sin Conexión Productiva:** El prototipo es 100% local y desacoplado; no realiza llamadas a APIs reales de Salesforce ni Meta WhatsApp.
2. **Datos Sintéticos Demostrativos:** Los clientes, pólizas, asesores `AG-*` y consultas son datos de prueba rotulados.
3. **Línea Base Histórica Inmutable:** Los 4 indicadores de cabecera (16.76 min TMO, 14.50 min meta, 18.45 min TMO ajustado, 16.93% abandono) corresponden a las 55,924 interacciones históricas As-Is observadas; no son resultados To-Be inventados.
4. **Asistencia por Recuperación Estructurada:** El sistema utiliza plantillas con identificador de fuente `KB-*`; no afirma utilizar IA generativa productiva no supervisada.
5. **Pesos Experimentales No Calibrados:** Los valores A=4, B=5, C=7 son hipótesis demostrativas sujetas a la simulación DES del Capítulo V.
