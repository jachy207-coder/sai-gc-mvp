"""Genera dist/CVI_Asistencia_TodoEnUno.gs: TODO el aplicativo en un solo archivo para pegar en Apps Script.

Uso: python3 asistencia-docentes/tools/generar_todo_en_uno.py
"""
import json
import pathlib

BASE = pathlib.Path(__file__).resolve().parent.parent
SRC = BASE / "apps-script"
partes = [
    "/**\n * CVI Monte Azul · Control de Asistencia Docente — ARCHIVO ÚNICO (generado).\n"
    " * INICIO DEL ARCHIVO (no debe haber nada encima de esta línea).\n * Pega TODO este contenido en Extensiones → Apps Script → Código.gs de la hoja\n"
    " * \"CVI Asistencia Docente - Monte Azul (piloto)\", guarda, ejecuta setup() e implementa como aplicación web.\n */\n",
]
for n in ["Logic", "Seed", "Code"]:
    partes.append(f"\n/* ========================= {n}.gs ========================= */\n")
    partes.append((SRC / f"{n}.gs").read_text(encoding="utf-8"))
html = {n: (SRC / f"{n}.html").read_text(encoding="utf-8") for n in ["Index", "Dashboard", "Styles", "QRLib"]}
partes.append("\n/* ========================= Pantallas (HTML) ========================= */\n")
# HTML embebido línea por línea (sin líneas gigantes, para que se copie/pegue sin problemas).
bloques = []
for nombre, contenido in html.items():
    lineas = ",\n    ".join(json.dumps(l, ensure_ascii=False) for l in contenido.split("\n"))
    bloques.append(f"  {nombre}: [\n    {lineas}\n  ].join('\\n')")
partes.append("var __HTML = {\n" + ",\n".join(bloques) + "\n};\n")
partes.append("/* ==================== FIN DEL ARCHIVO (no debe haber nada debajo de esta línea) ==================== */\n")
out = BASE / "dist" / "CVI_Asistencia_TodoEnUno.gs"
out.parent.mkdir(exist_ok=True)
out.write_text("".join(partes), encoding="utf-8")
print("OK:", out, round(out.stat().st_size / 1024), "KB")
