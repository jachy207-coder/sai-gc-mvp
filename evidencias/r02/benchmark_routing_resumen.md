# Benchmark Comparativo de Políticas de Enrutamiento (R02)

**Proyecto:** Sistema de Asistencia Inteligente y Gestión de Capacidad para WhatsApp Posventa  
**Carrera:** Ingeniería Industrial — UPC  
**Script de Reproducción:** `node experiments/benchmark_routing.mjs`  
**Dataset:** Carga sintética estandarizada de 60 interacciones multirramo (Vehicular, Salud, Vida)  
**Parámetros:** Capacidad máxima por asesor = 10 unidades | 4 Asesores multifuncionales  

---

## 1. Tabla Comparativa de Resultados

| Política Evaluada | Casos Asignados | Casos en Cola (Espera) | Casos Escalados a Supervisión | Carga Media por Asesor | Desviación Estándar ($\sigma$) | Rango Carga (Máx - Mín) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **FIFO Clásico** | 8 (13.3%) | 52 (86.7%) | 0 (0.0%) | 10.00 / 10 | 0.00 | 10 - 10 (0) |
| **Regla Actual (Greedy)** | 8 (13.3%) | 52 (86.7%) | 0 (0.0%) | 10.00 / 10 | 0.00 | 10 - 10 (0) |
| **LBF Adaptada** | 8 (13.3%) | 52 (86.7%) | 0 (0.0%) | 10.00 / 10 | 0.00 | 10 - 10 (0) |
| **SAI-GC R02 (Propuesta)** | 8 (13.3%) | 31 (51.7%) | 21 (35.0%) | 8.25 / 10 | 0.43 | 9 - 8 (1) |

---

## 2. Análisis desde la Ingeniería de Métodos y Gestión de Operaciones

### A. Desaturación de la Cola Ordinaria mediante Triaje Especializado
En las políticas tradicionales (**FIFO**, **Regla Actual** y **LBF Adaptada**), todos los casos que ingresan por WhatsApp son tratados con un peso plano ($w = 5$) y vertidos a la cola ordinaria sin distinguir complejidad ni riesgo. Como resultado:
- La capacidad total del equipo ($4 \times 10 = 40$ unidades) se agota de inmediato con los primeros 8 casos asignados.
- Quedan **52 casos retenidos en cola**, acumulando tiempos de espera elevados sin importar si se trata de un duplicado de constancia (Clase A) o de un choque grave con heridos (Clase C).

Por el contrario, la política **SAI-GC R02**:
- Filtra desde el triaje inicial los casos críticos (Clase C) y fuera de catálogo, derivando **21 casos directamente a la Cola de Supervisión**.
- Reduce la cola de espera de atención ordinaria de **52 a 31 casos**, evitando que casos sensibles queden estancados esperando un asesor de línea.

### B. Balanceo de Carga y Factor de Utilización
- En las tres políticas basales, los 4 asesores alcanzan el **100% de saturación inmediata** (10/10 unidades), anulando cualquier colchón de seguridad ante contingencias o variabilidad del servicio.
- En **SAI-GC R02**, la utilización se estabiliza en un promedio de **8.25 unidades (82.5%)** con una dispersión mínima ($\sigma = 0.43$, rango entre 8 y 9 unidades), garantizando holgura operativa para atender gestiones urgentes.

---

## 3. Conclusión para la Tesis (Capítulo V)

El benchmark demuestra de forma cuantitativa y reproducible que la introducción de un **triaje por complejidad con barreras de escalamiento obligatorio**:
1. Protege la capacidad de los asesores operativos frente a casos de alta carga.
2. Garantiza un enrutamiento seguro y especializado para casos sensibles.
3. Previene el colapso por saturación homogénea de colas en el canal WhatsApp.
