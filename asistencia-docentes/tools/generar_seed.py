"""Genera apps-script/Seed.gs y la hoja base (.xlsx) a partir de datos/*.csv.

Uso:  python3 asistencia-docentes/tools/generar_seed.py
"""
import csv
import json
import pathlib

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

BASE = pathlib.Path(__file__).resolve().parent.parent
DATOS = BASE / "datos"


def leer(nombre):
    with open(DATOS / nombre, encoding="utf-8") as f:
        return list(csv.reader(f))


horario = leer("horario_monte_azul_2026.csv")
docentes = leer("docentes.csv")

# ---------- Seed.gs ----------
def filas_js(filas):
    return "[\n  " + ",\n  ".join(json.dumps(f, ensure_ascii=False) for f in filas) + "\n]"


seed = (
    "/** Seed.gs — GENERADO por tools/generar_seed.py. No editar a mano.\n"
    " *  Datos base: horario por salón 2026 (HORARIO MONTE AZUL 2026 - 21.03.26.xlsx)\n"
    " *  y docentes encontrados en el horario. Solo se usan en setup() si las hojas están vacías. */\n\n"
    f"var SEED_HORARIO = {filas_js(horario[1:])};\n\n"
    f"var SEED_DOCENTES = {filas_js(docentes[1:])};\n"
)
(BASE / "apps-script" / "Seed.gs").write_text(seed, encoding="utf-8")

# ---------- Hoja base (.xlsx) ----------
NEGRO, ROJO, AMARILLO = "000000", "920000", "EEBE4F"
ENC = {
    "Config": ["Clave", "Valor", "Descripción"],
    "Docentes": ["DNI", "Docente (igual que en Horario)", "Nombre completo", "Especialidad", "Celular", "Correo", "Activo (SI/NO)", "Notas"],
    "Horario": ["ID", "Salón", "Día", "Inicio", "Fin", "Curso", "Docente", "Nota"],
    "Marcaciones": ["ID", "Fecha", "DNI", "Docente", "Hora ingreso", "Hora salida", "Estado ingreso", "Min. tardanza",
                    "Clases propias (IDs)", "Reemplazos (IDs)", "Observación", "Detalle observación", "Dispositivo",
                    "Horas marcadas", "Horas dictadas", "Horas programadas", "Registrado"],
    "Clases dictadas": ["Fecha", "Mes", "Marcación", "Bloque", "Salón", "Curso", "Docente titular", "Docente que dictó",
                        "DNI", "Tipo", "Inicio programado", "Fin programado", "Horas dictadas"],
}
CONFIG = [
    ["SEDE", "Monte Azul", "Nombre de la sede"],
    ["TOLERANCIA_MIN", "5", "Minutos de tolerancia para considerar puntual"],
    ["PIN_PANEL", "91515", "PIN para entrar al panel de coordinación"],
    ["LOGO_FILE_ID", "1lq4fr6oIeE7kkoQ33l6qUpzjJWS8mx3u", "ID en Drive del logo CVI 2025 actualizado"],
    ["FECHA_INICIO", "2026-11-16", "Inicio del piloto"],
    ["PERMITIR_CELULAR", "SI", "SI = se puede marcar desde el celular"],
]
DATOS_HOJA = {"Config": CONFIG, "Docentes": docentes[1:], "Horario": horario[1:]}

wb = Workbook()
wb.remove(wb.active)
for nombre, enc in ENC.items():
    ws = wb.create_sheet(nombre)
    ws.append(enc)
    for c in ws[1]:
        c.font = Font(bold=True, color=AMARILLO)
        c.fill = PatternFill("solid", fgColor=NEGRO)
        c.alignment = Alignment(vertical="center")
    for fila in DATOS_HOJA.get(nombre, []):
        ws.append(fila)
    # Todo como texto (DNI con 0 inicial, horas "08:00")
    for row in ws.iter_rows(min_row=2, max_row=max(ws.max_row, 300), max_col=len(enc)):
        for c in row:
            c.number_format = "@"
    for i, titulo in enumerate(enc, start=1):
        ancho = max([len(str(titulo))] + [len(str(r[i - 1])) for r in DATOS_HOJA.get(nombre, []) if len(r) >= i])
        ws.column_dimensions[ws.cell(1, i).column_letter].width = min(max(10, ancho + 2), 48)
    ws.freeze_panes = "A2"
    if nombre == "Horario":
        for r in range(2, ws.max_row + 1):
            if ws.cell(r, 8).value:
                ws.cell(r, 8).font = Font(color=ROJO, italic=True)

salida = BASE / "datos" / "CVI_Asistencia_Docente_MonteAzul.xlsx"
wb.save(salida)
print("OK:", BASE / "apps-script" / "Seed.gs", "|", salida, "|", len(horario) - 1, "bloques,", len(docentes) - 1, "docentes")
