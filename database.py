"""
SAI-GC R01 — Módulo de Base de Datos SQLite para Auditoría y Bitácora
Sistema de Asistencia Inteligente y Gestión de Capacidad
"""

import sqlite3
import json
import csv
import io
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / 'sai_gc_bitacora.db'

def get_connection():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS bitacora_eventos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha_hora TEXT NOT NULL,
        caso TEXT NOT NULL,
        evento TEXT NOT NULL,
        clase TEXT,
        fuente TEXT,
        decision_humana TEXT,
        asesor_routing TEXT,
        politica TEXT,
        version TEXT
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_bitacora_caso ON bitacora_eventos(caso)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_bitacora_fecha ON bitacora_eventos(fecha_hora)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_bitacora_clase ON bitacora_eventos(clase)")
    conn.commit()
    conn.close()

def insert_log(entry: dict):
    init_db()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO bitacora_eventos (fecha_hora, caso, evento, clase, fuente, decision_humana, asesor_routing, politica, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        entry.get('time', ''),
        entry.get('case', ''),
        entry.get('event', ''),
        entry.get('level', ''),
        entry.get('source', ''),
        entry.get('action', ''),
        entry.get('agent', ''),
        entry.get('policy', ''),
        entry.get('version', '')
    ))
    conn.commit()
    conn.close()

def fetch_logs(limit: int = 100):
    init_db()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM bitacora_eventos ORDER BY id DESC LIMIT ?", (limit,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def clear_logs():
    init_db()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM bitacora_eventos")
    conn.commit()
    conn.close()

def export_db_evidence(fmt: str = 'json') -> str:
    logs = fetch_logs(limit=1000)
    if fmt == 'csv':
        output = io.StringIO()
        fieldnames = ['id', 'fecha_hora', 'caso', 'evento', 'clase', 'fuente', 'decision_humana', 'asesor_routing', 'politica', 'version']
        writer = csv.DictWriter(output, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for r in logs:
            writer.writerow(r)
        return output.getvalue()

    return json.dumps({
        'app': 'SAI-GC',
        'db': 'SQLite',
        'records': logs
    }, indent=2, ensure_ascii=False)
