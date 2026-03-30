import os
import psycopg2
from psycopg2.extras import RealDictCursor


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    role VARCHAR(20) NOT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
        conn.commit()


def save_message(role: str, content: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO messages (role, content) VALUES (%s, %s)",
                (role, content)
            )
        conn.commit()


def get_history() -> list[dict]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT role, content FROM messages ORDER BY created_at")
            return [dict(r) for r in cur.fetchall()]


def clear_history():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM messages")
        conn.commit()
