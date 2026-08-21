"""Database package.

Deliberately does **not** import ``app.db.session``: importing that module reads
settings and builds the engine, and the import chain ``app.models.enums`` →
``app.models`` → ``app.db.base`` → this init must stay side-effect free so pure
consumers (the match engine, unit tests) never touch engine construction. Import
``app.db.session`` explicitly where a database is actually wanted.
"""

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

__all__ = [
    "Base",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
]
