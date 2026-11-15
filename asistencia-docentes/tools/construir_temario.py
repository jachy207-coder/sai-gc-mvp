"""Construye la base depurada del Control Académico (Anual Integral 2026):

  datos/temario_anual_integral_2026.csv   15 cursos × 32 temas (8 boletines × 4)
  datos/calendario_academico_2026.csv     semanas de clase, exámenes y vacaciones
  datos/cursos_anual_integral_2026.csv    cursos con su alias en el horario

Fuentes (en orden de prioridad):
  1. Boletines impresos (PDF/Word "BASE" de cada boletín): títulos por SEMANA.
  2. TEMARIO CURSOS 2026 – BOL7 ACTUALIZADO.xlsx y TEMARIO_BOLETÍN_8.xlsx (vía depurar_temario.py).
  3. Si no hay fuente: "Tema N (por confirmar)" para completarlo desde el panel.

Uso: python3 -I tools/construir_temario.py <temario_extraido.csv>
"""
import csv
import datetime as dt
import pathlib
import sys

BASE = pathlib.Path(__file__).resolve().parent.parent
DATOS = BASE / "datos"

CURSOS = [  # id, curso, área, alias en el horario
    ("AI-ALG", "Álgebra", "Matemáticas", "ÁLGEBRA"),
    ("AI-ARI", "Aritmética", "Matemáticas", "ARITMÉTICA"),
    ("AI-GEOM", "Geometría", "Matemáticas", "GEOMETRÍA"),
    ("AI-TRI", "Trigonometría", "Matemáticas", "TRIGONOMETRÍA"),
    ("AI-RM", "Razonamiento Matemático", "Aptitud Académica", "RAZ. MATEMÁTICO|RAZONAMIENTO MATEMÁTICO|RM"),
    ("AI-RV", "Razonamiento Verbal", "Aptitud Académica", "RAZ. VERBAL|RAZONAMIENTO VERBAL|RV"),
    ("AI-FIS", "Física", "Ciencias", "FÍSICA"),
    ("AI-QUI", "Química", "Ciencias", "QUÍMICA"),
    ("AI-BIO", "Biología", "Ciencias", "BIOLOGÍA"),
    ("AI-LEN", "Lenguaje", "Letras", "LENGUAJE"),
    ("AI-ING", "Inglés", "Letras", "INGLÉS"),
    ("AI-HIS", "Historia", "Letras", "HISTORIA"),
    ("AI-GEOG", "Geografía", "Letras", "GEOGRAFÍA"),
    ("AI-ECO", "Economía", "Letras", "ECONOMÍA"),
    ("AI-FIL", "Filosofía", "Letras", "FILOSOFÍA"),
]

# Títulos tomados de los boletines impresos (semana → título). Prevalecen sobre el Excel.
B = {
    "Razonamiento Verbal": {1: "Introducción al curso de Habilidad Verbal", 2: "Naturaleza de la comprensión lectora", 3: "Coherencia y jerarquía textual", 4: "Cohesión textual I",
        5: "Cohesión textual II", 6: "Primer taller de lectura", 7: "Primera práctica de reforzamiento", 8: "Método de lectura láser",
        9: "Técnicas de lectura I", 10: "Técnicas de lectura II", 11: "Segundo taller de lectura", 12: "Segunda práctica de reforzamiento",
        13: "Niveles de comprensión lectora", 14: "Preguntas de sentido contextual", 15: "Preguntas de jerarquía textual", 16: "Tercer taller de lectura",
        17: "Tercera práctica de reforzamiento", 18: "Niveles de comprensión lectora (II)", 19: "Preguntas de inferencia", 20: "Preguntas de extrapolación",
        25: "Textos argumentativos", 26: "Textos dialécticos", 27: "Quinto taller de lectura", 28: "Textos según su estructura jerárquica",
        29: "Intención comunicativa y contexto", 30: "Textos literarios", 31: "Textos científicos", 32: "Textos filosóficos"},
    "Razonamiento Matemático": {1: "Habilidad operativa", 2: "Elementos recreativos", 3: "Situaciones lógicas I", 4: "Situaciones lógicas II",
        5: "Situaciones lógicas III", 6: "Situaciones lógicas IV", 7: "Lazos familiares", 8: "Ordenamiento de información I",
        9: "Ordenamiento de información II", 10: "Lógica proposicional", 11: "Deducción simple y deducción compuesta", 12: "Lógica de clases",
        13: "Verdades y mentiras", 14: "Problemas sobre certezas", 15: "Arreglos numéricos I", 16: "Arreglos numéricos II",
        17: "Arreglos numéricos III", 18: "Calendarios I", 19: "Calendarios II", 20: "Inductivo numérico y geométrico",
        25: "Planteo de ecuaciones II", 26: "Planteo de ecuaciones III", 27: "Cronometría I", 28: "Cronometría II",
        29: "Cronometría III", 30: "Frecuencia de sucesos", 31: "Conteo de figuras y semejanza de figuras", 32: "Áreas y perímetros de regiones planas"},
    "Aritmética": {9: "Magnitudes proporcionales III", 10: "Magnitudes proporcionales IV", 11: "Promedios I", 12: "Promedios II",
        13: "Regla de mezcla I", 14: "Regla de mezcla II", 15: "Teoría de conjuntos I", 16: "Teoría de conjuntos II",
        17: "Teoría de conjuntos III", 18: "Teoría de conjuntos IV", 19: "Numeración I", 20: "Numeración II",
        29: "Números simples y compuestos I", 30: "Números simples y compuestos II", 31: "MCD y MCM I", 32: "MCD y MCM II"},
    "Álgebra": {3: "Sistemas de ecuaciones 2×2", 9: "Polinomios II", 10: "División algebraica", 11: "Factorización I", 12: "Factorización II",
        13: "Ecuación lineal y cuadrática", 14: "Teoría de ecuaciones cuadráticas II", 15: "Ecuaciones polinomiales de grado superior", 16: "Ecuación bicuadrada y fraccionaria",
        17: "Problemas DECO", 18: "Sistemas de ecuaciones lineales I", 19: "Teoría de sistemas de ecuaciones lineales II", 20: "Problemas tipo DECO",
        29: "Valor absoluto II", 30: "Logaritmos", 31: "Ecuaciones logarítmicas", 32: "Funciones reales"},
    "Geometría": {4: "Triángulos I", 9: "Aplicaciones de la congruencia II", 10: "Cuadriláteros I", 11: "Cuadriláteros II", 12: "Cuadriláteros III",
        13: "Circunferencia II", 14: "Circunferencia III", 15: "Figuras inscritas y circunscritas", 16: "Puntos notables I",
        17: "Puntos notables II", 18: "Proporcionalidad de segmentos", 19: "Semejanza de triángulos", 20: "Relaciones métricas en la circunferencia",
        29: "Geometría del espacio II", 30: "Prisma", 31: "Cilindro", 32: "Pirámide"},
    "Trigonometría": {9: "Resolución de triángulos rectángulos I", 10: "Resolución de triángulos rectángulos II", 11: "Ángulos verticales", 12: "Introducción a la geometría analítica",
        13: "Ángulos en posición normal I", 14: "Ángulos en posición normal II", 15: "Ángulos en posición normal III", 16: "Identidades trigonométricas fundamentales I",
        17: "Identidades fundamentales II", 18: "Identidades fundamentales III", 19: "Identidades de ángulos compuestos I", 20: "Identidades de ángulos compuestos II",
        29: "Transformaciones trigonométricas II", 30: "Triángulos oblicuángulos I", 31: "Triángulos oblicuángulos II", 32: "Circunferencia trigonométrica I"},
    "Física": {1: "Análisis dimensional", 9: "Estática I", 10: "Estática II", 11: "Estática III", 12: "Estática IV",
        13: "Dinámica I", 14: "Dinámica II", 15: "Trabajo mecánico", 16: "Energía mecánica I",
        17: "Energía mecánica II: Potencia mecánica", 18: "Cantidad de movimiento e impulso I", 19: "Cantidad de movimiento e impulso II", 20: "Movimiento Armónico Simple (MAS)",
        29: "Electrostática II", 30: "Electrostática III", 31: "Electrostática IV", 32: "Electrodinámica I"},
    "Química": {1: "Introducción a la Química", 9: "Enlace químico I", 10: "Enlace químico II", 11: "Geometría molecular", 12: "Fuerzas intermoleculares",
        13: "Nomenclatura inorgánica I", 14: "Nomenclatura inorgánica II", 15: "Nomenclatura inorgánica III", 16: "Cálculos en química I",
        17: "Cálculos en química II", 18: "Gases I", 19: "Gases II", 20: "Estado líquido",
        29: "Cinética química", 30: "Equilibrio químico", 31: "Ácidos y bases I", 32: "Ácidos y bases II"},
    "Biología": {4: "Bioquímica III: Ácidos nucleicos", 9: "Replicación del ADN y expresión génica", 10: "Ciclo celular eucariota: Mitosis", 11: "Ciclo celular eucariota: Meiosis", 12: "Genética I: Genética mendeliana",
        13: "Genética II: Herencia sanguínea y herencia ligada al sexo", 14: "Citogenética y Bioética", 15: "Evolución I", 16: "Evolución II",
        17: "Virus", 18: "Bacterias", 19: "Plantas I: Taxonomía", 20: "Plantas II: Organografía e histología vegetal",
        29: "Sistema digestivo humano", 30: "Sistema cardiovascular humano", 31: "Sistema respiratorio y excretor humano", 32: "Sistema nervioso humano"},
    "Economía": {13: "Teoría de la demanda I", 14: "Teoría de la demanda II", 15: "La oferta", 16: "Equilibrio de mercado",
        29: "Agregados e indicadores económicos", 30: "Ciclos económicos, consumo, distribución e inversión", 31: "Normas y Constitución Política", 32: "Derechos"},
    "Filosofía": {13: "Filosofía moderna I: Racionalismo", 14: "Filosofía moderna II: Empirismo", 15: "Ilustración", 16: "Criticismo",
        29: "Epistemología II: teorías epistemológicas", 30: "Axiología: el valor", 31: "La moral I", 32: "Ética II: teorías éticas"},
    "Geografía": {13: "Clima del Perú I", 14: "Clima del Perú II", 15: "Clima del Perú III", 16: "Geósfera",
        19: "Relieve costero", 20: "Relieve andino I",
        29: "Vertiente hidrográfica del Amazonas", 30: "Mar peruano", 31: "Fenómeno de El Niño", 32: "Actividades económicas I"},
    "Historia": {13: "Incas I", 14: "Incas II", 15: "Invasión a América", 16: "Reforma y Contrarreforma",
        18: "Virreinato II", 19: "Primera Revolución Industrial", 20: "Revolución francesa I",
        29: "República Aristocrática", 30: "Primera Guerra Mundial", 31: "Revolución rusa", 32: "Oncenio y Tercer Militarismo"},
    "Inglés": {1: "Greetings and Introductions", 2: "Pronouns", 3: "Present simple of be", 4: "Present simple I",
        13: "Past Simple II", 14: "Past Simple III", 15: "Past Simple IV", 16: "Present Perfect I",
        17: "Future Simple I", 18: "Future II", 19: "Review: Verb Tenses", 20: "Prepositions",
        29: "Modal Verbs II", 30: "Past Perfect", 31: "Relative Clauses I", 32: "Relative Clauses II"},
    "Lenguaje": {9: "La fonética", 13: "Uso de las mayúsculas I", 14: "Uso de las mayúsculas II", 15: "Los signos de puntuación I", 16: "Los signos de puntuación II",
        17: "La morfología", 18: "Los procesos formativos de palabras", 19: "El sustantivo", 20: "Los accidentes del sustantivo",
        29: "La preposición", 30: "La conjunción", 31: "La sintaxis", 32: "El sujeto"},
}

# Títulos deducidos del contenido del boletín 3 de Letras (el PDF no trae el título explícito) → por confirmar.
DEDUCIDOS = {
    "Economía": {9: "Factores productivos: el trabajo y el empleo", 10: "Empresa y ciclo de vida del producto", 11: "Emprendimiento", 12: "Estructuras de mercado"},
    "Filosofía": {9: "Filosofía helenística (cinismo, estoicismo, epicureísmo)", 10: "Filosofía medieval: Patrística", 11: "Filosofía medieval: Escolástica", 12: "Filosofía renacentista: Humanismo"},
    "Geografía": {9: "Calentamiento global", 10: "Tiempo atmosférico y clima", 11: "Presión atmosférica", 12: "Práctica dirigida"},
    "Historia": {9: "Wari (Horizonte Medio)", 10: "Edad Media"},
}


def cargar_extraido(ruta):
    out = {}
    with open(ruta, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out[(r["curso"], int(r["n_tema"]))] = (r["tema"], r["paginas"], r["fuente"])
    return out


def main():
    extraido = cargar_extraido(sys.argv[1])
    filas, faltan = [], {}
    for cid, curso, area, _ in CURSOS:
        for n in range(1, 33):
            if n in B.get(curso, {}):
                tema, fuente, estado = B[curso][n], f"Boletín {(n - 1) // 4 + 1} impreso", "OK"
            elif (curso, n) in extraido:
                tema, _, f = extraido[(curso, n)]
                fuente, estado = "Temario Excel (" + f.split(":")[0] + ")", "OK"
            elif n in DEDUCIDOS.get(curso, {}):
                tema, fuente, estado = DEDUCIDOS[curso][n], f"Deducido del contenido del boletín {(n - 1) // 4 + 1}", "POR CONFIRMAR"
            else:
                tema, fuente, estado = f"Tema {n} (por completar)", "Sin fuente", "POR CONFIRMAR"
                faltan.setdefault(curso, []).append(n)
            filas.append([f"{cid}-{n:02d}", cid, curso, n, (n - 1) // 4 + 1, tema.strip(), estado, fuente])
    with open(DATOS / "temario_anual_integral_2026.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["id", "curso_id", "curso", "n_tema", "boletin", "tema", "estado_dato", "fuente"])
        w.writerows(filas)
    with open(DATOS / "cursos_anual_integral_2026.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["id", "salon", "curso", "area", "alias_horario", "total_temas", "avance_inicial", "activo"])
        for cid, curso, area, alias in CURSOS:
            w.writerow([cid, "ANUAL INTEGRAL", curso, area, alias, 32, 28, "SI"])

    # ---------- Calendario 2026 (Cronograma_CVI_Monte_Azul_2026.xlsx, hoja PADRES) ----------
    especiales = {  # lunes de la semana → (tipo, descripción)
        "2026-04-06": ("EXAMEN", "Exámenes mensuales"), "2026-05-11": ("EXAMEN", "Exámenes bimestrales (horario reducido)"),
        "2026-05-18": ("VACACIONES", "Vacaciones"), "2026-06-15": ("EXAMEN", "Exámenes mensuales"),
        "2026-07-20": ("EXAMEN", "Exámenes bimestrales (sáb. 25/07 recupera jue. 23/07)"), "2026-07-27": ("VACACIONES", "Vacaciones (27 jul – 04 ago)"),
        "2026-08-31": ("EXAMEN", "Exámenes mensuales"), "2026-10-05": ("EXAMEN", "Exámenes bimestrales (sáb. 10/10 recupera jue. 08/10)"),
        "2026-10-12": ("VACACIONES", "Vacaciones"), "2026-11-16": ("EXAMEN", "Exámenes mensuales"),
        "2026-12-21": ("CIERRE", "Exámenes bimestrales (17–22 dic) y clausura 22/12"),
    }
    notas = {"2026-03-02": "Inicio de clases 04/03 (clase introductoria)", "2026-03-30": "Jue 02 y vie 03: Semana Santa (feriado)",
             "2026-04-27": "Vie 01/05: Día del Trabajo (feriado)", "2026-05-04": "Vie 08/05: Simulacro", "2026-06-29": "Lun 29/06: San Pedro y San Pablo (feriado)",
             "2026-07-06": "Lun 06/07: Día del Maestro · Vie 10/07: Simulacro", "2026-08-03": "Clases 05–07 ago · Jue 06/08: Batalla de Junín (feriado)",
             "2026-09-21": "Mié 23/09: Día del Estudiante", "2026-09-28": "Vie 02/10: Simulacro", "2026-11-23": "Semana de Aniversario",
             "2026-12-07": "Mar 08 y mié 09: feriados · Vie 11/12: Simulacro", "2026-12-14": "Clases 14–16 dic; exámenes bimestrales desde el 17/12"}
    bimestres = [("2026-03-02", 1), ("2026-05-25", 2), ("2026-08-03", 3), ("2026-10-19", 4)]
    lunes, n, cal = dt.date(2026, 3, 2), 0, []
    while lunes <= dt.date(2026, 12, 21):
        k = lunes.isoformat()
        bim = max(b for f, b in bimestres if f <= k)
        if k in especiales:
            tipo, desc = especiales[k]; sem = ""
        else:
            n += 1; tipo, desc, sem = "CLASE", notas.get(k, ""), n
        cal.append([k, (lunes + dt.timedelta(days=5)).isoformat(), tipo, sem, (sem - 1) // 4 + 1 if sem else "", bim, desc])
        lunes += dt.timedelta(days=7)
    assert n == 32, f"Se esperaban 32 semanas de clase y hay {n}"
    with open(DATOS / "calendario_academico_2026.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["semana_inicio", "semana_fin", "tipo", "n_semana_clase", "boletin", "bimestre", "descripcion"])
        w.writerows(cal)

    total = len(filas)
    ok = sum(1 for f in filas if f[6] == "OK")
    print(f"Temario: {len(CURSOS)} cursos × 32 = {total} temas · confirmados {ok} · por confirmar {total - ok}")
    for c, ns in faltan.items():
        print(f"  {c:24s} sin fuente: {ns}")
    print(f"Calendario: {len(cal)} semanas, {n} de clase")


if __name__ == "__main__":
    main()
