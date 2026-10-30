# Informe Técnico: Incidencias Identificadas en R01 y Correcciones Implementadas en R02 (SAI-GC)

**Proyecto:** Sistema de Asistencia Inteligente y Gestión de Capacidad para WhatsApp Posventa  
**Carrera:** Ingeniería Industrial — Universidad Peruana de Ciencias Aplicadas (UPC)  
**Tesista:** Víctor Chunga  
**Versión de Entrega:** `v0.5-r02-verificable`  
**Fecha de Publicación:** 30 de Octubre de 2026  

---

## 1. Resumen Ejecutivo

Durante la auditoría de control de calidad y seguridad operacional de la versión inicial `R01`, se identificaron **seis (6) incidencias críticas** relacionadas con la gobernanza del bucle humano (*human-in-the-loop*), la sincronización de estados y la gestión estricta de capacidad. 

La versión `R02 (v0.5-r02-verificable)` subsana de raíz cada una de estas fallas mediante la incorporación de una **función pura central de autorización (`canConfirmAssignment`)**, una **huella criptográfica de revisión (`computeCaseRevision`)**, **barreras obligatorias de escalamiento para casos Clase C** y un protocolo de pruebas unitarias automatizado de **31 pruebas (16 de línea base + 15 de aceptación T01 a T15)** con una tasa de éxito del **100%**.

---

## 2. Matriz Detallada de Incidencias y Correcciones

### Incidencia 1: Asignación permitida sin revisión humana previa (*Bypass* de Aprobación)
- **Diagnóstico en R01:** El botón de asignación (`assign-btn`) se habilitaba automáticamente tras procesar el triaje, permitiendo que un operador o script asignara un caso a un asesor disponible sin haber pulsado explícitamente "Aceptar", "Rechazar" ni "Editar".
- **Impacto Operacional:** Violación del principio *Human-in-the-Loop*; riesgo de automatización ciega de respuestas no revisadas.
- **Corrección en R02:**
  - Implementación de la barrera de decisión humana en `canConfirmAssignment`: Si `decision` no es `'Aceptar'` (o `'Editar'` con aprobación guardada), se retorna `allowed: false` con código `ERR_NO_APPROVAL`.
  - El botón "Confirmar y asignar" permanece inhabilitado (`disabled`) y con mensaje contextual hasta que el asesor emita su decisión.
- **Pruebas de Aceptación:** `T01` (Caso A), `T02` (Caso B).

---

### Incidencia 2: Casos críticos Clase C y fuera de dominio asignables en cola ordinaria
- **Diagnóstico en R01:** Si un operador forzaba la aceptación en un caso de siniestro grave (DEMO-003) o en una consulta no cubierta por el repositorio (DEMO-005), el sistema procedía a calcular la ruta y asignaba el caso a la bandeja estándar del asesor.
- **Impacto Operacional:** Un siniestro o reclamo legal nunca debe ingresar a una cola masiva ordinaria de WhatsApp sin supervisión jerárquica.
- **Corrección en R02:**
  - Barrera 1 en `canConfirmAssignment`: Todo caso con nivel `'C'` o con identificador `'KB-NO-COBERTURA'` queda categóricamente bloqueado para asignación ordinaria (`ERR_CLASS_C_ESCALATION`).
  - En la interfaz se sustituye el flujo ordinario por un botón primario de **"Escalar a Supervisión"**, el cual ejecuta `registerEscalation` y deriva el caso a la *Cola de Supervisión / Siniestros y Excepciones* con rol auditable.
- **Pruebas de Aceptación:** `T06`, `T07`.

---

### Incidencia 3: Huellas de aprobación obsoletas tras mutación de parámetros (*Stale Approvals*)
- **Diagnóstico en R01:** Si el operador aprobaba un caso y con posterioridad modificaba el texto del cliente, cambiaba el ramo del seguro o conmutaba la política de asignación (de Actual a Experimental), la aprobación previa se mantenía activa, despachando el caso con una recomendación desactualizada.
- **Impacto Operacional:** Inconsistencia grave entre la decisión humana registrada y los datos finales del caso.
- **Corrección en R02:**
  - Función de hashing estricto `computeCaseRevision(caseData, policy, classification)` que genera un token unívoco (p. ej. `rev-3d8a104f`) a partir de: `id`, `ramo`, `estado IVR`, `política`, `nivel` y `contenido del texto`.
  - Barrera 6 en `canConfirmAssignment`: Valida que `approvedRevision === currentRevision`. Cualquier alteración de campos invalida automáticamente la aprobación previa con código `ERR_STALE_REVISION`, exigiendo una nueva revisión explícita del asesor.
- **Pruebas de Aceptación:** `T08` (mutación de texto/ramo), `T09` (cambio de política).

---

### Incidencia 4: Modificación de texto sin guardar ni consolidar el borrador
- **Diagnóstico en R01:** Al ingresar en modo edición de respuesta, era posible presionar el botón de asignación sin haber guardado el borrador, generando incertidumbre sobre si se enviaría el texto original o el texto en edición.
- **Impacto Operacional:** Despacho de mensajes incompletos o errores de redacción hacia el cliente final.
- **Corrección en R02:**
  - Barrera 2 en `canConfirmAssignment`: Si `isEditing === true` y `editApproved === false`, se bloquea la confirmación con código `ERR_EDIT_NOT_APPROVED`.
  - Se implementó el botón interactivo **"Guardar y aprobar respuesta"** (`save-edit-btn`), que consolida el texto, recalcula la huella y formaliza la aprobación humana.
- **Pruebas de Aceptación:** `T04`, `T05` (bloqueo en caso de rechazo).

---

### Incidencia 5: Pérdida de revalidación en tiempo real de capacidad y skill del asesor
- **Diagnóstico en R01:** La recomendación del asesor se calculaba en el instante inicial del triaje. Si transcurrían minutos y dicho asesor pasaba a estado "Ocupado", salía a "Refrigerio" o recibía otros casos en paralelo saturando su tope de 10 unidades, la asignación se ejecutaba sin revalidación.
- **Impacto Operacional:** Sobrecarga de asesores más allá de la capacidad máxima autorizada (10 unidades) e incumplimiento de asignación por especialidad técnica.
- **Corrección en R02:**
  - Barrera 9 en `canConfirmAssignment`: Justo antes de autorizar la confirmación, se revalida el estado en vivo de todo el equipo de asesores (`status === 'Disponible'`, `skills.includes(branch)` y `(load + weight) <= 10`). Si no existe ningún asesor que cumpla estrictamente los tres requisitos, se bloquea la asignación (`ERR_NO_CAPACITY_OR_SKILL`) y se retiene el caso en cola.
- **Pruebas de Aceptación:** `T10` (cambio a pausa), `T11` (saturación de carga), `T12` (incompatibilidad de especialidad).

---

### Incidencia 6: Riesgo de asignaciones duplicadas y falta de verificación IVR
- **Diagnóstico en R01:** 
  1. Pulsar reiteradamente el botón de asignación podía generar registros duplicados para un mismo caso en la cola de trabajo en curso (*WIP*).
  2. Los casos con validación previa de bot pendiente (`validated: false`) no obligaban al asesor a corroborar la identidad del asegurado antes de despachar información confidencial.
- **Impacto Operacional:** Duplicidad de esfuerzo y fuga de información sensible conforme a la normativa de protección de datos.
- **Corrección en R02:**
  - Barrera 8 en `canConfirmAssignment`: Chequeo de idempotencia sobre la lista de asignaciones activas. Si el caso ya se encuentra "En curso" o "Asignado", se bloquea con `ERR_DUPLICATE_ASSIGNMENT`.
  - Barrera 7 en `canConfirmAssignment`: Si el caso no viene validado por el IVR (`validated: false`), es estrictamente obligatorio que el asesor marque el checkbox interactivo **"Verificación manual de identidad completada conforme al procedimiento"** (`ivrManualVerified`). De no estar marcado, se bloquea con `ERR_IVR_UNVERIFIED`.
- **Pruebas de Aceptación:** `T13` (duplicados), `T14` (control IVR).

---

## 3. Esquema de Trazabilidad y Bitácora R02

Tanto el exportador JSON como el CSV fueron actualizados para registrar el estándar de auditoría completo:

```
[Timestamp_ISO] | [Fecha_Hora] | [Caso] | [Revision] | [Estado_Caso] | [Evento] | [Nivel] | [Fuente_KB] | [Accion] | [Resultado] | [Motivo_Bloqueo] | [Rol_Actor] | [Asesor] | [Politica] | [Version]
```

Donde:
- `Resultado`: `PERMITIDO` o `BLOQUEADO`.
- `Motivo_Bloqueo`: Causa técnica explicada (código de error y texto comprensible para auditoría).
- `Rol_Actor`: `Asesor WhatsApp`, `Supervisor / Nivel 2` o `Sistema / Barrera de Seguridad`.

---

## 4. Conclusión de Conformidad

La versión `R02 (v0.5-r02-verificable)` satisface plenamente las exigencias del plan de mejora, garantizando:
1. **Control Humano Centralizado:** La máquina asiste y recomienda; el humano audita, valida y aprueba.
2. **Paridad Tecnológica:** Idéntico comportamiento en la aplicación Web Modular, la versión Monolítica autocontenida y el backend Python / Streamlit.
3. **Verificabilidad Académica:** 31 pruebas unitarias automatizadas reproducibles sin dependencias ocultas.
