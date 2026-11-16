# Control de Asistencia Docente — CVI Monte Azul (piloto desde el lunes 16/11/2026)

Aplicativo web sobre **Google Sheets + Google Apps Script** (gratis, sin servidores). Los docentes marcan ingreso y salida con su **DNI** o con el **QR** de su fotocheck, desde la PC del colegio o desde su celular. Coordinación ve todo **en vivo** en un panel y saca el **reporte mensual de horas dictadas** para gestionar los pagos.

| Pantalla | Para quién | Qué hace |
|---|---|---|
| **Marcación** (URL de la app) | Docentes | DNI o QR → marca los salones del día (casillas) → **Marcar INGRESO**. Al irse: DNI → **Marcar SALIDA**. Puede cubrir la clase de otro docente (reemplazo) y dejar una observación. |
| **Panel** (`URL?page=panel`, con PIN) | Coordinación / Dirección | 📍 **En vivo**: llegadas, tardanzas, salones del día, quién falta (se actualiza cada 30 s). ✍️ **Marcar asistencia**: coordinación registra ingreso/salida de cualquier docente (puede corregir la hora). 🗓️ **Horario**: ver por salón o por docente y agregar/editar/eliminar bloques. 👥 **Docentes**: agregar, editar datos (DNI, celular, correo, especialidad, notas) y activar/desactivar. 📊 **Reporte** mensual Docente · Mes · Salón · N.º horas. 🪪 **QR**: fotochecks descargables (PNG o ZIP en Drive) e imprimibles. En celular, navegación inferior tipo app. |

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
3. Abre el Google Doc **"CÓDIGO PARA PEGAR v5 - CVI Asistencia"** (o la versión más reciente), que está en la carpeta *CÓDIGO APP ASISTENCIA DOCENTE*.
   1. Haz clic dentro del texto, pulsa **Ctrl+A** y luego **Ctrl+C**.
   2. En el editor de Apps Script, haz clic dentro de `Código.gs`, pulsa **Ctrl+A** y **Supr** para borrar lo que haya, y luego **Ctrl+V** y **Ctrl+S**.
   3. Revisa que la **primera línea** sea `/**` y que la **última** diga `FIN DEL ARCHIVO`.
   - No copies desde la vista previa del archivo `.gs` de Drive: copia mal las líneas largas y agrega el nombre del archivo.
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
   - Para el panel, agrega `?page=panel` al final de la URL. El PIN es **91515** (se puede cambiar en la pestaña *Config*).
7. Deja todo listo para el lunes:
   - En la PC del colegio, abre la URL en Chrome, pon pantalla completa (F11) y guárdala en favoritos.
   - Comparte la URL por WhatsApp con los docentes para que marquen desde su celular.
   - Imprime los fotochecks desde la pestaña **Fotochecks QR** del panel.

**Si actualizas el código más adelante** (por ejemplo, al pasar a una nueva versión):
1. Copia el Google Doc de la versión nueva y reemplaza **todo** el contenido de `Código.gs`. Guarda.
2. Ejecuta **`setup`** otra vez. Completa datos faltantes y aplica renombres **sin borrar** lo que ya escribiste. Si pide permisos nuevos (por ejemplo, Drive para guardar fotochecks), acéptalos.
3. Ve a **Implementar → Gestionar implementaciones → ✏ Editar → Versión: Nueva versión → Implementar**. La URL no cambia.

**Detalle de la publicación de versiones:**
1. Pega la nueva versión en `Código.gs` y guarda.
2. Ve a **Implementar → Gestionar implementaciones → ✏ Editar → Versión: Nueva versión → Implementar**. Así la URL no cambia.

**Para actualizar el horario:** edita la pestaña **Horario**. Cada fila es un bloque con este formato: `ID único | Salón | Día (LUNES…SABADO) | Inicio HH:mm | Fin HH:mm | Curso | Docente`. El nombre del docente debe ser igual al de la pestaña **Docentes**.

### ¿Con qué marca cada docente?
- Con su **DNI** (8 dígitos) cuando esté registrado en la pestaña **Docentes**.
- Mientras tanto, con su **celular** (9 dígitos), tomado del formulario de registro.
- **Jhon Vásquez, Jorge Adama, Susan Adama y Yuli Cucho** ya tienen su celular cargado (v2).

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
│   ├── QRLib.html       generador de QR incluido (MIT), sin depender de internet
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
    ├── e2e.js           flujo completo con navegador (requiere el simulador)
    └── e2e_v2.js        coordinación, horario editable, QR, vista móvil, actualización de datos
```

Para probar en local, ejecuta `FAKE_NOW="2026-11-16T07:58:00-05:00" node tools/servidor-local.js` y abre http://localhost:8787. El simulador asigna DNIs de prueba del 70000001 al 70000020; el PIN del panel es 91515.


## 📚 Control académico (Anual Integral)

- **Temario depurado:** 15 cursos × 32 temas = 480 (8 boletines × 4 temas). Se tomó de los boletines impresos y de los Excel de temario. Los temas sin fuente aparecen como **"por confirmar"** y se completan desde el panel (✏️ en el detalle del curso).
- **Calendario 2026:** 32 semanas de clase, 1 tema por semana. Las semanas de exámenes y de vacaciones no cuentan. Está en la hoja **Calendario** y se puede ajustar ahí.
- **Docente:**
  - Al marcar **SALIDA**, la app pregunta *"¿Qué tema dictaste?"* con el tema sugerido ya seleccionado. El docente elige Completado, Avance parcial, Repaso o Práctica/evaluación.
  - Si elige "Más tarde", la app se lo recuerda la próxima vez que ingrese su DNI.
- **Coordinación (panel → 📚 Académico):**
  - **Avance:** semáforo por curso (al día, 1 tema de atraso, 2 o más), cobertura, tema actual vs. esperado, alertas.
  - **Detalle del curso:** los 32 temas con su estado, editar títulos, registrar un tema y fijar el *avance inicial*, es decir, los temas ya completados antes de usar el sistema. El valor inicial es 28.
  - **Leccionario:** historial con validar ✔️, corregir ✏️, eliminar 🗑️ y "＋ Registrar tema" por coordinación.
  - **Calendario:** semanas de clase, exámenes y vacaciones, con la semana actual resaltada.
- **Hojas nuevas:** Cursos, Temario, Calendario y Leccionario. `setup()` las crea y carga una sola vez; no pisa los cambios hechos después.

## Limitaciones del piloto

- Cualquier persona que tenga la URL y el DNI de un docente puede marcar por él. El panel muestra el dispositivo (PC o celular) de cada marcación; si hace falta, se puede desactivar el celular con `PERMITIR_CELULAR = NO` en la pestaña **Config**.
- Las horas se calculan cuando el docente marca **salida**. Si olvida marcarla, el panel lo muestra como "En el colegio" y coordinación puede completar la hora de salida a mano en la pestaña *Marcaciones*.
- El próximo módulo es **Control de clases**: tema dictado y avance académico.
