"""
SAI-GC R02 — Módulo de Base de Datos SQLite para Auditoría y Bitácora
Sistema de Asistencia Inteligente y Gestión de Capacidad
Versión R02 Verificable
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
        timestamp_iso TEXT,
        fecha_hora TEXT NOT NULL,
        caso TEXT NOT NULL,
        revision TEXT,
        case_status TEXT,
        evento TEXT NOT NULL,
        clase TEXT,
        fuente TEXT,
        decision_humana TEXT,
        resultado TEXT,
        motivo_bloqueo TEXT,
        rol_actor TEXT,
        asesor_routing TEXT,
        politica TEXT,
        version TEXT
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_bitacora_caso ON bitacora_eventos(caso)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_bitacora_fecha ON bitacora_eventos(fecha_hora)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_bitacora_clase ON bitacora_eventos(clase)")
    
    # Migración no destructiva de columnas si la base de datos ya existía
    existing_cols = {row['name'] for row in cursor.execute("PRAGMA table_info(bitacora_eventos)").fetchall()}
    for col, col_type in [
        ('timestamp_iso', 'TEXT'),
        ('revision', 'TEXT'),
        ('case_status', 'TEXT'),
        ('resultado', 'TEXT'),
        ('motivo_bloqueo', 'TEXT'),
        ('rol_actor', 'TEXT')
    ]:
        if col not in existing_cols:
            try:
                cursor.execute(f"ALTER TABLE bitacora_eventos ADD COLUMN {col} {col_type}")
            except Exception:
                pass

    conn.commit()
    conn.close()

def insert_log(entry: dict):
    init_db()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO bitacora_eventos (
        timestamp_iso, fecha_hora, caso, revision, case_status, evento, clase, fuente,
        decision_humana, resultado, motivo_bloqueo, rol_actor, asesor_routing, politica, version
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        entry.get('timestampIso', entry.get('timestamp_iso', '')),
        entry.get('time', entry.get('fecha_hora', '')),
        entry.get('case', entry.get('caso', '')),
        entry.get('revision', ''),
        entry.get('caseStatus', entry.get('case_status', '')),
        entry.get('event', entry.get('evento', '')),
        entry.get('level', entry.get('clase', '')),
        entry.get('source', entry.get('fuente', '')),
        entry.get('action', entry.get('decision_humana', '')),
        entry.get('result', entry.get('resultado', 'PERMITIDO')),
        entry.get('blockReason', entry.get('motivo_bloqueo', '—')),
        entry.get('actorRole', entry.get('rol_actor', 'Asesor WhatsApp')),
        entry.get('agent', entry.get('asesor_routing', '')),
        entry.get('policy', entry.get('politica', '')),
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
        fieldnames = [
            'id', 'timestamp_iso', 'fecha_hora', 'caso', 'revision', 'case_status', 'evento',
            'clase', 'fuente', 'decision_humana', 'resultado', 'motivo_bloqueo', 'rol_actor',
            'asesor_routing', 'politica', 'version'
        ]
        writer = csv.DictWriter(output, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for r in logs:
            writer.writerow({k: r.get(k, '') for k in fieldnames})
        return output.getvalue()

    return json.dumps({
        'app': 'SAI-GC',
        'db': 'SQLite',
        'records': logs
    }, indent=2, ensure_ascii=False)
