"""Local storage for completed text chat turns."""
from contextlib import closing
import sqlite3

MAX_MESSAGES = 60


class ChatMemory:
    def __init__(self, path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as db, db:
            db.execute('''CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                text TEXT NOT NULL
            )''')

    def read(self):
        with closing(sqlite3.connect(self.path)) as db:
            rows = db.execute('SELECT role, text FROM messages ORDER BY id').fetchall()
        return [{'role': role, 'text': text} for role, text in rows]

    def append(self, text, answer):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executemany('INSERT INTO messages(role, text) VALUES (?, ?)',
                           [('user', text), ('assistant', answer)])
            db.execute('''DELETE FROM messages WHERE id IN (
                SELECT id FROM messages ORDER BY id DESC LIMIT -1 OFFSET ?
            )''', (MAX_MESSAGES,))

    def clear(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('DELETE FROM messages')
