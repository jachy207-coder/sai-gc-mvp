# CONFIGURACIÓN DEL SISTEMA Y PARÁMETROS OPERATIVOS — SAI-GC
**Sistema de Asistencia Inteligente y Gestión de Capacidad**  
**Proyecto de Tesis:** Reducción del TMO en el canal WhatsApp de Postventa en una Aseguradora Peruana  
**Versión de Corte:** R01 (v0.3-r01-demo) · 09/10/2026  

---

## 1. Declaración de Integridad Metodológica

Para salvaguardar la validez científica y ética de la tesis, este documento establece una **separación estricta e inquebrantable** entre:
1. **Los parámetros operativos y estadísticos confirmados**, extraídos directamente del diagnóstico real de la operación de postventa de la aseguradora (Enero a Julio 2026).
2. **Los supuestos e hipótesis experimentales del prototipo SAI-GC**, los cuales constituyen propuestas académicas de diseño pendientes de calibración empírica en el Capítulo V.

Bajo ninguna circunstancia los evaluadores o tesistas deben presentar los valores experimentales como mediciones definitivas de la aseguradora.

---

## 2. Parámetros Operativos Confirmados (Línea Base Real As-Is)

Estos datos provienen de la telemetría corporativa y de las vistas operativas de supervisión provistas por la gerencia de servicio al cliente:

| Parámetro | Valor Confirmado | Fuente / Contexto Operativo |
|---|---|---|
| **Periodo de Diagnóstico** | Ene – Jul 2026 (7 meses) | Registro consolidado de CRM y telefonía |
| **Volumen de Interacciones** | 55,924 interacciones | Canal WhatsApp Postventa |
| **TMO Corporativo Observado** | **16.76 minutos** | Promedio general As-Is de todas las interacciones |
| **Meta Corporativa de TMO** | **14.50 minutos** | KPI contractual / objetivo de la gerencia |
| **TMO Operativo Ajustado** | **18.45 minutos** | Promedio calculado únicamente sobre atenciones efectivas (excluye abandonos) |
| **Tasa de Abandono Histórica** | **16.93%** | Clientes que desisten durante la espera en cola |
| **Capacidad Nominal por Asesor** | **10 unidades** | Regla de capacidad máxima simultánea en Salesforce Omni-Channel |
| **Peso por Conversación WhatsApp** | **5 unidades** | Regla actual: permite un máximo de 2 chats simultáneos por asesor |
| **Peso por Caso de Correo** | **10 unidades** | Regla actual: dedicación exclusiva (no permite chats paralelos) |
| **Ramos de Seguro en Alcance** | Vida, Salud, Vehicular | Especialización operativa de los asesores |
| **Validación IVR Observada** | Dual: Validado / Pendiente | El bot actual valida DNI en ciertos flujos; en otros deriva sin autenticar |

### Restricciones de la Operación Actual:
- Si un asesor atiende 1 caso de correo (10 unidades), su utilización es del 100% y no puede recibir interacciones de WhatsApp.
- Si un asesor atiende 1 chat de WhatsApp (5 unidades), solo puede recibir como máximo 1 chat adicional de WhatsApp (5 unidades), alcanzando las 10 unidades de capacidad.
- El enrutamiento actual no distingue la complejidad intrínseca de la consulta: una consulta simple de constancia consume los mismos 5 puntos de capacidad que un reclamo de siniestro complejo.

---

## 3. Supuestos y Parámetros Experimentales (Propuesta To-Be en SAI-GC)

Estos parámetros forman parte de la arquitectura propuesta por el SAI-GC para resolver la variabilidad del tiempo de atención mediante gestión de capacidad diferenciada:

### 3.1 Clasificación Preliminar por Complejidad (Triaje A/B/C)
La taxonomía propuesta agrupa las solicitudes entrantes en tres clases preliminares:

- **Clase A (Informativa / Baja Complejidad):**
  - *Definición:* Consultas estandarizadas de respuesta directa que no requieren verificaciones profundas en sistemas transaccionales.
  - *Ejemplos sintéticos:* Solicitud de copia de póliza digital, reenvío de constancia de seguro, consulta de vigencia informativa, horarios de atención.
  - *Nivel de Riesgo:* Bajo.

- **Clase B (Transaccional Intermedia / Requiere Verificación):**
  - *Definición:* Consultas que exigen consulta a sistemas core, comprobación de estados financieros o validación documental por parte del asesor.
  - *Ejemplos sintéticos:* Consulta de deuda acumulada, estado de cuenta, cuota pendiente, fechas de cobranza, deducibles de póliza, relación de clínicas/talleres afiliados.
  - *Nivel de Riesgo:* Medio.

- **Clase C (Alta Sensibilidad / Contractual / Excepciones):**
  - *Definición:* Gestiones críticas con impacto económico, legal, contractual o de retención del asegurado, así como cualquier consulta no tipificada o fuera de catálogo.
  - *Ejemplos sintéticos:* Denuncia de siniestro vehicular, orientación sobre indemnizaciones, anulación de póliza, rescate de fondos de vida, cartas de garantía, fraudes, quejas graves.
  - *Nivel de Riesgo:* Alto (Escalamiento precautorio prioritario).

### 3.2 Política Experimental de Capacidad Ponderada (Valores Ilustrativos)
Para el modelado de simulación y contraste, se propone la siguiente escala hipotética:

| Clase de Complejidad | Peso Experimental Hipotético | Capacidad Nominal | Concurrencia Teórica Máxima |
|---|---|---|---|
| **Clase A (Simple)** | **4 unidades** | 10 unidades | 2 chats simultáneos (carga 8/10) |
| **Clase B (Intermedia)** | **5 unidades** | 10 unidades | 2 chats simultáneos (carga 10/10) |
| **Clase C (Sensible)** | **7 unidades** | 10 unidades | 1 chat exclusivo (carga 7/10; no permite un 2° chat C) |

> **ADVERTENCIA:**  
> Los pesos A=4, B=5 y C=7 son hipótesis preliminares para el diseño de la lógica de ruteo. **No constituyen valores calibrados ni aprobados por la aseguradora**. Su impacto en la utilización del asesor, tiempos de espera y TMO debe demostrarse formalmente mediante Simulación de Eventos Discretos (DES) en el Capítulo V.

---

## 4. Reglas del Motor de Ruteo Inteligente

El algoritmo de routing del SAI-GC opera bajo las siguientes condiciones deterministas:
1. **Filtro de Disponibilidad:** El asesor debe tener `status == 'Disponible'`. Se excluyen de forma mandatoria asesores en `Ocupado`, `Refrigerio`, `Capacitación` o `Pausa`.
2. **Filtro de Habilidad (Skill):** El asesor debe poseer en su perfil la competencia del ramo correspondiente (`branch in agent.skills`: Vida, Salud o Vehicular).
3. **Control de Capacidad Restante:** Se verifica la condición `(carga_actual + peso_caso) <= 10`. Si la adición del peso supera 10 unidades, el asesor es descartado para esa asignación.
4. **Criterio de Selección:** Entre los asesores elegibles, se selecciona aquel con la **menor carga acumulada actual** (mínima utilización proyectada). En caso de empate, se utiliza orden ascendente por identificador (`id`).
5. **Preservación de Cola:** Si ningún asesor cumple los cuatro criterios simultáneamente, el caso **no se asigna y permanece en cola** con el estado `"Sin capacidad o skill disponible; mantener en cola"`.

---

## 5. Control Human-in-the-Loop (HITL) y Base de Conocimiento

1. **Envío Autónomo Bloqueado:** Ninguna respuesta generada por el sistema se despacha directamente al cliente de WhatsApp. La intervención humana es obligatoria.
2. **Acciones Disponibles para el Asesor:**
   - **Aceptar:** El asesor aprueba la plantilla sugerida para su despacho manual.
   - **Editar:** El asesor modifica el texto en un editor controlado antes de usarlo.
   - **Rechazar:** El asesor descarta la sugerencia y elabora una respuesta manual.
   - **Escalar:** El asesor remite el caso al supervisor o área de siniestros/fraude (obligatorio para Clase C de alta criticidad).
3. **Gestión de Validación IVR:**
   - Si `validado == true`: La sugerencia instruye no solicitar nuevamente el documento de identidad.
   - Si `validado == false`: La sugerencia alerta al asesor que debe ejecutar el protocolo de autenticación antes de revelar información sensible.
4. **Base de Conocimiento de Prueba (KB-Demo):**
   - Identificadores transparentes: `KB-DEMO-001` (Constancia), `KB-DEMO-002` (Estado de Cuenta), `KB-DEMO-003` (Siniestros), `KB-NO-COBERTURA` (Fuera de catálogo).
   - En ningún caso la base de conocimiento sintética contiene datos reales de clientes, números de póliza vigentes, saldos contables ni compromisos de indemnización.
