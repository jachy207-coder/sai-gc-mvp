# Control de Asistencia Docente — CVI Monte Azul (piloto desde el lunes 16/11/2026)

Aplicativo web sobre **Google Sheets + Google Apps Script** (gratis, sin servidores). Los docentes marcan ingreso y salida con su **DNI** o con el **QR** de su fotocheck, desde la PC del colegio o desde su celular. Coordinación ve todo **en vivo** en un panel y saca el **reporte mensual de horas dictadas** para gestionar los pagos.

| Pantalla | Para quién | Qué hace |
|---|---|---|
| **Marcación** (URL de la app) | Docentes | DNI o QR → marca los salones del día (casillas) → **Marcar INGRESO**. Al irse: DNI → **Marcar SALIDA**. Puede cubrir la clase de otro docente (reemplazo) y dejar una observación. |
| **Panel** (`URL?page=panel`, con PIN) | Coordinación / Dirección | En vivo (se actualiza cada 30 s): docentes que llegaron, tardanzas, línea de tiempo por salón, quién falta. Reporte mensual **Docente · Mes · Salón · N.º horas dictadas**. Fotochecks QR para imprimir. |

## Reglas del piloto

- **Horas cronológicas.** Las *horas dictadas* son el tiempo entre el ingreso y la salida que coincide con las clases marcadas en el horario. Ejemplo: si el docente llega 8:10 a una clase de 8:00 a 10:00, cuenta 1 h 50 min.
- **Tolerancia de 5 minutos.** Después de ese plazo el ingreso queda como *tardanza*, con los minutos de retraso. Por ahora solo se registra; no se descuenta nada.
- **Clases simultáneas.** Si un docente dicta en varios salones a la vez (por ejemplo, Jordy los lunes a la 1:00 pm), esa hora cuenta **una sola vez** y se reparte entre los salones.
- **Reemplazo.** Otro docente marca la clase en la opción "¿Vas a cubrir la clase de otro docente?", y la hora va a quien la dictó. Si nadie la cubre, en el panel aparece como **No dictado**.
- **Observaciones disponibles.** Tardanza justificada, Permiso, Salida anticipada, Reemplazo de docente, Clase de recuperación, Salud, Problema de transporte, y **Otro** (con comentario libre).
- **Hora del servidor.** La hora se toma del servidor de Google en hora de Lima, no del reloj de la PC ni del celular, para que no se pueda adelantar.

## Instalación (unos 10 minutos, una sola vez)

1. Abre la hoja **"CVI Asistencia Docente - Monte Azul (piloto)"**, que está en tu Drive dentro de *CVI MONTE AZUL 2026*. Ya tiene a los docentes con su celular y el horario.
2. Ve a **Extensiones → Apps Script**. Se abre el editor con un archivo llamado `Código.gs`.
3. Abre el archivo **`CVI_Asistencia_TodoEnUno.gs`**. Está en la carpeta *CÓDIGO APP ASISTENCIA DOCENTE* de tu Drive y también en [`dist/`](dist/CVI_Asistencia_TodoEnUno.gs).
   1. Selecciona todo su contenido (Ctrl+A) y cópialo (Ctrl+C).
   2. En `Código.gs`, borra lo que haya, pega (Ctrl+V) y guarda (Ctrl+S).
4. Arriba, en la lista de funciones, elige **`setup`** y pulsa **▶ Ejecutar**.
   1. Google te pide permisos: elige tu cuenta.
   2. Si aparece la advertencia, entra en *Configuración avanzada* y luego en *Ir a… (no seguro)*. Es normal porque la app es tuya.
   3. Pulsa **Permitir**.
5. Publica la app:
   1. Pulsa **Implementar → Nueva implementación**.
   2. En el engranaje ⚙ elige **Aplicación web**.
   3. Configúrala así:
      - *Descripción:* Piloto
      - *Ejecutar como:* **Yo**
      - *Quién tiene acceso:* **Cualquier usuario**
   4. Pulsa **Implementar** y copia la **URL de la aplicación web**.
6. Pruébala:
   - Abre la URL y marca con tu celular.
   - Para el panel, agrega `?page=panel` al final de la URL. El PIN es **2026**; cámbialo en la pestaña *Config*.
7. Deja todo listo para el lunes:
   - En la PC del colegio, abre la URL en Chrome, pon pantalla completa (F11) y guárdala en favoritos.
   - Comparte la URL por WhatsApp con los docentes para que marquen desde su celular.
   - Imprime los fotochecks desde la pestaña **Fotochecks QR** del panel.

**Si actualizas el código más adelante:**
1. Pega la nueva versión en `Código.gs` y guarda.
2. Ve a **Implementar → Gestionar implementaciones → ✏ Editar → Versión: Nueva versión → Implementar**. Así la URL no cambia.

**Para actualizar el horario:** edita la pestaña **Horario**. Cada fila es un bloque con este formato: `ID único | Salón | Día (LUNES…SABADO) | Inicio HH:mm | Fin HH:mm | Curso | Docente`. El nombre del docente debe ser igual al de la pestaña **Docentes**.

### ¿Con qué marca cada docente?
- Con su **DNI** (8 dígitos) cuando esté registrado en la pestaña **Docentes**.
- Mientras tanto, con su **celular** (9 dígitos), tomado del formulario de registro.
- Faltan los datos de **Jhon Vásquez, Jorge Adama, Susan Adama y Yuly**, que no llenaron el formulario. Hay que escribir su DNI o celular en la pestaña **Docentes**.

## Por confirmar en el horario (tomado de `HORARIO MONTE AZUL 2026 - 21.03.26.xlsx`)

- **Celdas con dos cursos** (por ejemplo, Lunes 12:15 "Biología Susan / Edu. Física Jordy" en Anual Integral): las dividí por la mitad.
- **Celdas sin docente:** las asigné por deducción.
  - Aritmética de Anual Integral (martes 9:30 y 12:15) → Jhon Quispe.
  - Inglés de Líderes y Creadores → Ivonne.
  - Tutoría de Líderes → Alanis Tambo.
- **Prácticas de los sábados** (Anual Integral, 11:00–12:00): no tienen docente.
- **Inicial** (Exploradores y Pequeñines): lo registré como "Jornada inicial" de 8:00 a 13:00 con la tutora.
- **Hora de salida de los bloques de 12:15:** asumí 14:00.

## Estructura

```
asistencia-docentes/
├── apps-script/         ← código para pegar en Apps Script
│   ├── Code.gs          backend: marcación, panel, reportes, setup()
│   ├── Logic.gs         reglas de negocio (tolerancia, horas, estados, resumen)
│   ├── Seed.gs          horario y docentes base (generado)
│   ├── Index.html       pantalla de marcación (PC y celular)
│   ├── Dashboard.html   panel en vivo + reporte + QR
│   ├── Styles.html      branding CVI (negro, rojo #920000, amarillo #eebe4f, Cantata One)
│   └── appsscript.json
├── datos/               horario y docentes en CSV + hoja base .xlsx
├── tools/
│   ├── generar_seed.py  CSV → Seed.gs y .xlsx
│   ├── generar_todo_en_uno.py  apps-script/ → dist/ (archivo único)
│   └── servidor-local.js  simulador de Apps Script para probar sin desplegar
├── dist/CVI_Asistencia_TodoEnUno.gs  ← TODO en un archivo (para pegar en Apps Script)
└── tests/
    ├── logic.test.js    pruebas de reglas  (node --test tests/logic.test.js)
    └── e2e.js           flujo completo con navegador (requiere el simulador)
```

Para probar en local, ejecuta `FAKE_NOW="2026-11-16T07:58:00-05:00" node tools/servidor-local.js` y abre http://localhost:8787. El simulador asigna DNIs de prueba del 70000001 al 70000020; el PIN del panel es 2026.

## Limitaciones del piloto

- Cualquier persona que tenga la URL y el DNI de un docente puede marcar por él. El panel muestra el dispositivo (PC o celular) de cada marcación; si hace falta, se puede desactivar el celular con `PERMITIR_CELULAR = NO` en la pestaña **Config**.
- Las horas se calculan cuando el docente marca **salida**. Si olvida marcarla, el panel lo muestra como "En el colegio" y coordinación puede completar la hora de salida a mano en la pestaña *Marcaciones*.
- El próximo módulo es **Control de clases**: tema dictado y avance académico.
