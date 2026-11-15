"""Depura los temarios de Anual Integral (BOL7 ACTUALIZADO + BOLETÍN 8) → 32 temas por curso.

Regla para deducir el N.º de tema (t) de cada fila, ante columnas inconsistentes:
  1. Si "Boletín" (F) es 1..8 y "Semana CVI" (C) cae dentro de ese boletín → t = C
  2. Si F es 1..8 y "Semana base" (G) cae dentro de ese boletín      → t = G
  3. Si C == G                                                          → t = C
  4. Si C es 1..8 (C se usó como boletín) y G cae dentro de C         → t = G
Uso: python3 -I depurar_temario.py bol7.xlsx bol8.xlsx salida.csv
"""
import csv
import sys
import openpyxl

def num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None

def en_bol(t, b):
    return t is not None and b is not None and 1 <= b <= 8 and 4 * (b - 1) < t <= 4 * b

NOMBRES = {'razonamiento matematico': 'Razonamiento Matemático', 'razonamiento verbal': 'Razonamiento Verbal'}

def curso_norm(c):
    import unicodedata
    c = str(c or '').strip()
    k = unicodedata.normalize('NFD', c.lower()).encode('ascii', 'ignore').decode()
    return NOMBRES.get(k, c)

def leer(ruta, fuente):
    filas = []
    ws = openpyxl.load_workbook(ruta, data_only=True).worksheets[0]
    for i, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        curso, area, C, ia, real, F, G, pags = (list(r) + [None] * 8)[:8]
        real = str(real or '').strip()
        if not curso or not real:
            continue
        C, F, G = num(C), num(F), num(G)
        if en_bol(C, F): t, regla = C, 1
        elif en_bol(G, F): t, regla = G, 2
        elif C is not None and C == G: t, regla = C, 3
        elif C is not None and 1 <= C <= 8 and en_bol(G, C): t, regla = G, 4
        else: t, regla = None, 0
        filas.append(dict(curso=curso_norm(curso), area=str(area or '').strip(), t=t, tema=real, paginas=num(pags), fuente=f'{fuente}:fila {i}', regla=regla, C=C, F=F, G=G))
    return filas

if __name__ == '__main__':
    bol7, bol8, salida = sys.argv[1:4]
    filas = leer(bol7, 'BOL7') + leer(bol8, 'BOL8')
    temario, conflictos, sin_t = {}, [], []
    for f in filas:
        if f['t'] is None:
            sin_t.append(f); continue
        k = (f['curso'], f['t'])
        if k in temario and temario[k]['tema'].lower() != f['tema'].lower():
            conflictos.append((temario[k], f))
        temario.setdefault(k, f)
    cursos = sorted({c for c, _ in temario})
    print('CURSOS:', len(cursos))
    for c in cursos:
        tiene = sorted(t for cc, t in temario if cc == c)
        faltan = [t for t in range(1, 33) if t not in tiene]
        print(f'  {c:26s} {len(tiene):2d}/32  faltan: {faltan if faltan else "—"}')
    print('\nCONFLICTOS (mismo curso y tema, título distinto):')
    for a, b in conflictos: print('  ', a['curso'], a['t'], '|', a['tema'], '(', a['fuente'], ') vs', b['tema'], '(', b['fuente'], ')')
    print('\nFILAS CON TEMA PERO SIN N.º DEDUCIBLE:')
    for f in sin_t: print('  ', f['curso'], f['tema'], 'C/F/G=', f['C'], f['F'], f['G'], f['fuente'])
    with open(salida, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh, lineterminator='\n')
        w.writerow(['curso', 'area', 'n_tema', 'boletin', 'tema', 'paginas', 'fuente'])
        for (c, t) in sorted(temario):
            f = temario[(c, t)]
            w.writerow([c, f['area'], t, (t - 1) // 4 + 1, f['tema'], f['paginas'] or '', f['fuente']])
