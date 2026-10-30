# PLAN DE VALIDACIÓN METODOLÓGICA — CAPÍTULO V
**Protocolos de Juicio de Expertos, Prueba Piloto Controlada, Simulación DES y Evaluación Económica**  
**Tesis:** Sistema de Asistencia Inteligente y Gestión de Capacidad para el Canal WhatsApp Postventa  
**Carrera:** Ingeniería Industrial / Ingeniería de Sistemas de Información · UPC  

---

## 1. Introducción y Enfoque Científico

El Capítulo V tiene como propósito someter la propuesta teórica y el prototipo funcional **SAI-GC** a una validación científica rigurosa. Conforme a las condiciones de verdad establecidas, **no se deben inventar resultados empíricos ni asegurar reducciones causales del TMO sin haber ejecutado los protocolos aquí especificados**.

El proceso de validación se divide en cuatro fases metodológicas:
1. **Validación del Triaje A/B/C por Juicio de Expertos** (precisión taxonómica y seguridad).
2. **Evaluación de la Calidad de Asistencia Human-in-the-Loop** (rúbrica de contenido y control).
3. **Protocolo del Piloto Cuasiexperimental Controlado** (comparación Grupo Control vs Grupo Experimental).
4. **Simulación de Eventos Discretos (DES) As-Is vs To-Be** (calibración estocástica y escenarios de estrés).
5. **Evaluación de Capacidad y Análisis Económico Industrial** (horas liberadas sin reducciones de FTE inventadas).

---

## 2. Fase 1: Validación del Motor de Triaje por Juicio de Expertos

### 2.1 Conformación del Panel y Muestra Estratificada
- **Composición del Panel:** Dos supervisores senior de operaciones de postventa y un especialista de calidad y procesos de la aseguradora (mínimo 3 años de experiencia en el canal WhatsApp).
- **Tamaño de Muestra de Validación:** $N = 384$ interacciones históricas reales anonimizadas (muestreo estratificado por ramo y mes del periodo ene–jul 2026, con 95% de confianza y 5% de margen de error).

### 2.2 Proceso de Etiquetado y Construcción del "Gold Standard"
1. **Etiquetado Independiente:** Cada experto clasifica a ciegas las 384 interacciones en Clases A, B o C sin conocer el resultado del prototipo ni la opinión de sus pares.
2. **Medición de Concordancia Interjuez:** Cálculo del coeficiente Kappa de Fleiss ($\kappa$). Se requiere $\kappa \ge 0.75$ para considerar el etiquetado consistente.
3. **Consenso Gold Standard:** Las discrepancias se resuelven en una sesión de consenso moderada para fijar la matriz de referencia definitiva (*Ground Truth*).

### 2.3 Métricas de Evaluación y Criterios de Seguridad Operacional
Se compara la salida del motor del SAI-GC contra el Gold Standard mediante:
- **Matriz de Confusión Multiclase:** Conteo de Verdaderos Positivos ($VP$), Falsos Positivos ($FP$), Verdaderos Negativos ($VN$) y Falsos Negativos ($FN$) para cada clase ($A, B, C$).
- **Métricas por Clase:**
  $$\text{Precisión}_i = \frac{VP_i}{VP_i + FP_i}, \quad \text{Recall}_i = \frac{VP_i}{VP_i + FN_i}, \quad F1_i = 2 \cdot \frac{\text{Precisión}_i \cdot \text{Recall}_i}{\text{Precisión}_i + \text{Recall}_i}$$
- **Macro-F1:** Promedio aritmético no ponderado de los $F1$ individuales:
  $$\text{Macro-F1} = \frac{F1_A + F1_B + F1_C}{3}$$
- **Criterio Crítico de Parada (Seguridad):**  
  El **Recall de la Clase C debe ser igual al 100%** ($\text{Recall}_C = 1.0$) y la tasa de error $C \to A$ (clasificar un siniestro o anulación como simple consulta de constancia) debe ser **cero ($0\%$)**. Si una consulta sensible es clasificada como baja complejidad, el modelo falla el control de seguridad operacional.

---

## 3. Fase 2: Validación de la Asistencia de Respuestas y Control HITL

### 3.1 Rúbrica de Calidad Operacional
Se evalúa una muestra de 100 sugerencias emitidas por el módulo de asistencia mediante una rúbrica ciega calificada por los supervisores en escala de 1 a 5:

| Dimensión | Definición del Criterio | Peso | Umbral Aceptable |
|---|---|:---:|:---:|
| **1. Exactitud Procedimental** | Apego a la normativa corporativa de pólizas y directivas de la SBS. | 30% | $\ge 4.5 / 5.0$ |
| **2. Completitud de la Información** | Provee los pasos requeridos sin omitir advertencias ni requisitos legales. | 25% | $\ge 4.0 / 5.0$ |
| **3. Claridad y Tono de Comunicación** | Lenguaje empático, estructurado, adecuado para mensajería instantánea. | 20% | $\ge 4.2 / 5.0$ |
| **4. Ausencia de Falsedad Transaccional** | Cero alucinación de saldos contables, fechas de pago o pólizas vigentes. | 25% | **5.0 / 5.0 (Mandatorio)** |

*Nota de Seguridad:* Cualquier sugerencia que invente un compromiso contractual o un importe monetario recibe calificación de **Falla Crítica Inmediata**.

### 3.2 Trazabilidad de la Intervención Humana (Tasa HITL)
Durante las pruebas de interacción se medirá la distribución de decisiones tomadas por los operadores:
- $\% \text{ Aceptadas Directamente}$ (plantilla válida sin cambios).
- $\% \text{ Editadas}$ (requirió ajuste humano previo al despacho).
- $\% \text{ Rechazadas}$ (plantilla descartada, redacción manual total).
- $\% \text{ Escaladas}$ (derivación obligatoria a supervisor/área técnica).

---

## 4. Fase 3: Protocolo del Piloto Operacional Controlado

### 4.1 Diseño Experimental
- **Diseño:** Cuasiexperimental con grupo de control concurrente durante 4 semanas.
- **Grupo de Control ($N_1 = 8$ asesores):** Continúa atendiendo el canal WhatsApp con la operativa actual As-Is (Salesforce tradicional, capacidad nominal 10, peso fijo 5 por chat, búsqueda manual de procedimientos).
- **Grupo Experimental ($N_2 = 8$ asesores):** Opera con el soporte del SAI-GC (asistencia de respuestas controladas, validación IVR transparente y ruteo con gestión de capacidad).

### 4.2 Control de Variables Confusoras
Para evitar sesgos y atribuir válidamente los efectos, se equilibran:
1. **Curva de Aprendizaje:** Asesores con igual antigüedad promedio (entre 6 y 18 meses).
2. **Franjas Horarias:** Rotación equivalente en turnos pico (10:00–13:00) y valle (15:00–18:00).
3. **Mezcla de Ramos:** Distribución homogénea de consultas de Vida, Salud y Vehicular.
4. **Volumen Entrante y Caídas de Sistema:** Pruebas ejecutadas en los mismos días hábiles bajo idénticas condiciones de red.

### 4.3 Métricas de Evaluación del Piloto
- **Variable Primaria 1:** TMO de atenciones efectivas (tiempo de conversación + tiempo de postatención o ACW).
- **Variable Primaria 2:** Tasa de abandono en cola de espera (%).
- **Variable Secundaria 1:** First Contact Resolution (FCR en WhatsApp).
- **Variable Secundaria 2:** Calificación CSAT postatención.
- **Prueba de Hipótesis:** Test t de Student para muestras independientes o prueba U de Mann-Whitney (si los datos de TMO no presentan normalidad en el test de Shapiro-Wilk) con nivel de significancia $\alpha = 0.05$.

---

## 5. Fase 4: Simulación de Eventos Discretos (DES) As-Is vs To-Be

Dado que un piloto operacional tiene restricciones de duración y costo, se plantea una **Simulación de Eventos Discretos en software Simio o Arena** para contrastar políticas operativas a gran escala.

### 5.1 Calibración del Modelo As-Is
1. **Distribución de Llegadas:** Proceso de Poisson no homogéneo (NHPP) con tasa variable $\lambda(t)$ estimada a partir de las 55,924 llegadas históricas (ene–jul 2026).
2. **Distribución de Tiempos de Servicio:** Ajuste de bondad de ajuste (Kolmogorov-Smirnov / Anderson-Darling) sobre los tiempos reales de atención por clase:
   - Clase A: Típicamente ajustada a distribución Lognormal o Gamma ($\mu_A, \sigma_A$).
   - Clase B: Típicamente ajustada a distribución Weibull ($\mu_B, \sigma_B$).
   - Clase C: Distribución Lognormal con cola pesada ($\mu_C, \sigma_C$).
3. **Paciencia del Cliente y Abandono:** Curva de supervivencia para el tiempo de renuncia en cola (exponencial con media $\theta$).
4. **Prueba de Validación As-Is:** El modelo se ejecuta con 50 réplicas independientes de 7 meses. El modelo se considera calibrado si el TMO medio y el abandono simulados se encuentran dentro del intervalo de confianza al 95% de la línea base histórica:
   $$\text{TMO}_{\text{simulado}} \in [16.50, 17.00] \text{ min}, \quad \text{Abandono}_{\text{simulado}} \in [16.5\%, 17.4\%]$$

### 5.2 Escenarios de Simulación To-Be
- **Escenario S0 (Línea Base As-Is):** Operación actual (capacidad 10, peso WhatsApp 5, búsqueda manual).
- **Escenario S1 (Solo Asistencia HITL):** Reducción estimada de 2.0 a 3.5 minutos en el tiempo de redacción y consulta procedimental por el uso de plantillas recuperadas.
- **Escenario S2 (Asistencia + Ruteo Dinámico A4/B5/C7):** Se incorpora la política experimental de capacidad ponderada por complejidad.
- **Escenario S3 (Escenario de Estrés Operacional):** Incremento de demanda de llegadas en $+20\%$ y $+40\%$ para evaluar la resiliencia del sistema ante picos de siniestralidad o campañas comerciales.

### 5.3 Criterios de Réplica Estadística
- Cantidad de réplicas: $R = 40$ corridas independientes con semillas aleatorias distintas.
- Periodo de calentamiento (*warm-up*): 2 semanas para estabilizar las colas.
- Intervalos de confianza al 95% para cada KPI.

---

## 6. Fase 5: Evaluación de Capacidad Recuperada y Análisis Económico

### 6.1 Cálculo Industrial de Capacidad Liberada
Si la intervención logra reducir el TMO promedio de atenciones efectivas en $\Delta \text{TMO}$ minutos sobre un volumen mensual $V$ de interacciones:
$$\text{Horas-Hombre Liberadas/Mes} = \frac{V \cdot \Delta \text{TMO}}{60}$$

Para un volumen representativo de 8,000 interacciones mensuales:
- Con $\Delta \text{TMO} = 2.0 \text{ min} \implies 266.7 \text{ horas-hombre/mes}$.
- Con $\Delta \text{TMO} = 3.5 \text{ min} \implies 466.7 \text{ horas-hombre/mes}$.

### 6.2 Criterio de Honestidad Económica
- **Lo que SÍ se debe declarar:** Esta capacidad liberada se traduce en:
  1. Absorción del crecimiento vegetativo de la demanda de clientes sin incrementar la plantilla.
  2. Disminución drástica del trabajo en sobretiempo (horas extras de asesores).
  3. Reducción del estrés cognitivo y rotación del personal (turnover).
  4. Reducción del abandono del cliente (mayor satisfacción y retención).
- **Lo que NUNCA se debe declarar:** No equiparar automáticamente las horas recuperadas con "reducción de personal o despido de asesores (FTE)", ya que en operaciones de postventa de seguros la capacidad excedente se reasigna a retención proactiva y cobranza.

---

## 7. Compuerta de Entrada Metodológica: Verificación R02 Previa al Piloto

Antes de autorizar la ejecución del juicio de expertos o del piloto cuasiexperimental descritos en este capítulo, el prototipo debe haber aprobado sin excepciones la suite de control de calidad y seguridad operacional de la versión **R02 (`v0.5-r02-verificable`)**:

1. **Protocolo Automatizado de Pruebas Unitarias (T01 a T15):**  
   Verificación al 100% (31/31 pruebas aprobadas) en `tests/logic.test.mjs` y `tests/test_logic.py`, acreditando que ningún caso sensible Clase C o consulta no cubierta sea asignada a cola estándar sin revisión ni escalamiento supervisor.
2. **Benchmark Preliminar de Enrutamiento:**  
   Resultados de la simulación algorítmica (`experiments/benchmark_routing.mjs`) que evidencian la viabilidad estocástica de la política propuesta frente a FIFO, Regla Actual y LBF Adaptada (`evidencias/r02/benchmark_routing_resumen.md`).
3. **Trazabilidad y Bitácora Estructurada:**  
   Conformidad del esquema de auditoría con registro de `timestampIso`, `revision`, `caseStatus`, `resultado`, `motivo_bloqueo` y `rol_actor` (`evidencias/r02/log_eventos_sinteticos.json` y `evidencias/r02/matriz_T01_T15.csv`).

