"""SQLite persistence layer for the ``test_history`` table.

Implemented with the repository pattern over the standard-library ``sqlite3``
driver: one short-lived connection per operation (safe under Uvicorn's thread
pool) plus WAL mode so concurrent readers are never blocked by a writer.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

from app.ai import utils
from app.config import Settings, get_settings
from app.exceptions import RepositoryError
from app.logging_config import get_logger

logger = get_logger(__name__)

#: DDL for the assessment history table.
CREATE_TEST_HISTORY_SQL = """
CREATE TABLE IF NOT EXISTS test_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL,
    filename    TEXT    NOT NULL,
    risk_score  REAL    NOT NULL,
    risk_level  TEXT    NOT NULL,
    confidence  REAL    NOT NULL,
    model_type  TEXT,
    subject_id  TEXT,
    features    TEXT,
    metadata    TEXT
)
"""

#: Secondary index supporting the "most recent first" history listing.
CREATE_TEST_HISTORY_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS idx_test_history_created_at "
    "ON test_history (created_at DESC)"
)


@dataclass(slots=True)
class TestHistoryRecord:
    """One row of the ``test_history`` table.

    Attributes:
        id: Auto-incremented primary key.
        created_at: ISO-8601 UTC creation timestamp.
        filename: Stored filename of the analysed recording.
        risk_score: Continuous risk in ``[0, 1]``.
        risk_level: Discrete band label.
        confidence: Probability of the predicted class.
        model_type: Registry key of the model that produced the prediction.
        subject_id: Optional participant identifier.
        features: Aggregated features used for the prediction.
        metadata: Free-form descriptive information.
    """

    id: int
    created_at: str
    filename: str
    risk_score: float
    risk_level: str
    confidence: float
    model_type: str | None = None
    subject_id: str | None = None
    features: dict[str, float] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "TestHistoryRecord":
        """Build a record from a ``sqlite3.Row``.

        Args:
            row: Row returned by a ``SELECT`` on ``test_history``.

        Returns:
            TestHistoryRecord: Deserialised record with parsed JSON columns.
        """
        return cls(
            id=int(row["id"]),
            created_at=str(row["created_at"]),
            filename=str(row["filename"]),
            risk_score=float(row["risk_score"]),
            risk_level=str(row["risk_level"]),
            confidence=float(row["confidence"]),
            model_type=row["model_type"],
            subject_id=row["subject_id"],
            features=_loads(row["features"]),
            metadata=_loads(row["metadata"]),
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialise the record into a JSON friendly mapping.

        Returns:
            dict[str, Any]: Plain mapping suitable for API responses.
        """
        return {
            "id": self.id,
            "created_at": self.created_at,
            "filename": self.filename,
            "risk_score": self.risk_score,
            "risk_level": self.risk_level,
            "confidence": self.confidence,
            "model_type": self.model_type,
            "subject_id": self.subject_id,
            "features": dict(self.features),
            "metadata": dict(self.metadata),
        }


def _loads(raw: Any) -> dict[str, Any]:
    """Parse a JSON text column, tolerating ``NULL`` and malformed payloads.

    Args:
        raw: Raw column value.

    Returns:
        dict[str, Any]: Parsed mapping, empty when the value is unusable.
    """
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("Malformed JSON column encountered; returning an empty mapping")
        return {}
    return value if isinstance(value, dict) else {}


def _dumps(value: Any) -> str:
    """Serialise a mapping into a JSON text column.

    Args:
        value: Mapping to serialise.

    Returns:
        str: Compact JSON text, ``"{}"`` when the value is not serialisable.
    """
    try:
        return json.dumps(value or {}, ensure_ascii=False, default=str)
    except (TypeError, ValueError):  # pragma: no cover - defensive
        return "{}"


class Database:
    """Connection factory and schema manager for the SQLite database.

    Attributes:
        settings: Application settings supplying the database location.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        """Create a database handle bound to a settings object.

        Args:
            settings: Settings instance; the cached global settings are used when
                omitted.
        """
        self.settings: Settings = settings or get_settings()

    @property
    def path(self) -> Path:
        """Filesystem path of the SQLite database file."""
        return self.settings.database_path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """Yield a configured connection, committing or rolling back on exit.

        Yields:
            sqlite3.Connection: Connection with row factory and foreign keys on.

        Raises:
            RepositoryError: When the database cannot be opened or the statement
                fails.
        """
        utils.ensure_directory(self.path.parent)
        connection: sqlite3.Connection | None = None
        try:
            connection = sqlite3.connect(self.path, timeout=15.0)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA foreign_keys=ON")
            yield connection
            connection.commit()
        except sqlite3.Error as exc:
            if connection is not None:
                connection.rollback()
            raise RepositoryError(f"Database operation failed: {exc}") from exc
        finally:
            if connection is not None:
                connection.close()

    def init_schema(self) -> None:
        """Create the schema when it does not exist yet.

        The authentication tables live in :mod:`app.auth` and are created here
        too, so a single call leaves the database fully usable.  The import is
        local to avoid a circular import at module load time.

        Returns:
            None
        """
        with self.connect() as connection:
            connection.execute(CREATE_TEST_HISTORY_SQL)
            connection.execute(CREATE_TEST_HISTORY_INDEX_SQL)

        from app.auth import init_auth_schema

        init_auth_schema(self)
        logger.info("SQLite schema ready at %s", self.path)

    def healthy(self) -> bool:
        """Check that the database is reachable.

        Returns:
            bool: ``True`` when a trivial query succeeds.
        """
        try:
            with self.connect() as connection:
                connection.execute("SELECT 1").fetchone()
            return True
        except RepositoryError:
            logger.warning("Database health check failed", exc_info=True)
            return False


class TestHistoryRepository:
    """CRUD operations on the ``test_history`` table.

    Attributes:
        database: Connection factory used for every statement.
    """

    def __init__(self, database: Database | None = None) -> None:
        """Create a repository bound to a database handle.

        Args:
            database: Database handle; a default one is created when omitted.
        """
        self.database: Database = database or Database()

    def create(
        self,
        *,
        filename: str,
        risk_score: float,
        risk_level: str,
        confidence: float,
        model_type: str | None = None,
        subject_id: str | None = None,
        features: dict[str, float] | None = None,
        metadata: dict[str, Any] | None = None,
        created_at: str | None = None,
    ) -> TestHistoryRecord:
        """Insert one assessment result.

        Args:
            filename: Stored filename of the analysed recording.
            risk_score: Continuous risk in ``[0, 1]``.
            risk_level: Discrete band label.
            confidence: Probability of the predicted class.
            model_type: Registry key of the model used.
            subject_id: Optional participant identifier.
            features: Aggregated features used for the prediction.
            metadata: Free-form descriptive information.
            created_at: Explicit creation timestamp; defaults to "now" in UTC.

        Returns:
            TestHistoryRecord: The persisted record, including its new ``id``.
        """
        timestamp = created_at or utils.utc_now_iso()
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO test_history (
                    created_at, filename, risk_score, risk_level, confidence,
                    model_type, subject_id, features, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    timestamp,
                    filename,
                    float(risk_score),
                    risk_level,
                    float(confidence),
                    model_type,
                    subject_id,
                    _dumps(features),
                    _dumps(metadata),
                ),
            )
            record_id = int(cursor.lastrowid or 0)

        logger.info("Stored assessment #%d for %s (%s)", record_id, filename, risk_level)
        return TestHistoryRecord(
            id=record_id,
            created_at=timestamp,
            filename=filename,
            risk_score=float(risk_score),
            risk_level=risk_level,
            confidence=float(confidence),
            model_type=model_type,
            subject_id=subject_id,
            features=dict(features or {}),
            metadata=dict(metadata or {}),
        )

    def list(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        subject_id: str | None = None,
    ) -> list[TestHistoryRecord]:
        """List assessments, most recent first.

        Args:
            limit: Maximum number of rows to return.
            offset: Number of rows to skip.
            subject_id: Optional participant filter.

        Returns:
            list[TestHistoryRecord]: Matching records.
        """
        query = "SELECT * FROM test_history"
        parameters: list[Any] = []
        if subject_id:
            query += " WHERE subject_id = ?"
            parameters.append(subject_id)
        query += " ORDER BY id DESC LIMIT ? OFFSET ?"
        parameters.extend([max(1, int(limit)), max(0, int(offset))])

        with self.database.connect() as connection:
            rows = connection.execute(query, parameters).fetchall()
        return [TestHistoryRecord.from_row(row) for row in rows]

    def get(self, record_id: int) -> TestHistoryRecord | None:
        """Fetch a single assessment by primary key.

        Args:
            record_id: Primary key to look up.

        Returns:
            TestHistoryRecord | None: The record, or ``None`` when absent.
        """
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT * FROM test_history WHERE id = ?", (int(record_id),)
            ).fetchone()
        return TestHistoryRecord.from_row(row) if row else None

    def count(self, *, subject_id: str | None = None) -> int:
        """Count the stored assessments, optionally for one participant.

        Args:
            subject_id: When given, only that participant's rows are counted.

        Returns:
            int: Number of matching rows in ``test_history``.
        """
        with self.database.connect() as connection:
            if subject_id:
                row = connection.execute(
                    "SELECT COUNT(*) AS total FROM test_history WHERE subject_id = ?",
                    (subject_id,),
                ).fetchone()
            else:
                row = connection.execute("SELECT COUNT(*) AS total FROM test_history").fetchone()
        return int(row["total"]) if row else 0

    def delete(self, record_id: int) -> bool:
        """Delete one assessment.

        Args:
            record_id: Primary key to delete.

        Returns:
            bool: ``True`` when a row was removed.
        """
        with self.database.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM test_history WHERE id = ?", (int(record_id),)
            )
            return cursor.rowcount > 0

    def delete_all(self, *, subject_id: str | None = None) -> int:
        """Delete every assessment, optionally limited to one participant.

        This only clears the prediction log.  The training dataset and the
        stored recordings live outside the database and are left untouched.

        Args:
            subject_id: When given, only that participant's rows are removed.

        Returns:
            int: Number of rows deleted.
        """
        with self.database.connect() as connection:
            if subject_id:
                cursor = connection.execute(
                    "DELETE FROM test_history WHERE subject_id = ?", (subject_id,)
                )
            else:
                cursor = connection.execute("DELETE FROM test_history")
            removed = int(cursor.rowcount)
            # Reclaim the identity counter so a cleared log restarts from id 1.
            if not subject_id:
                connection.execute(
                    "DELETE FROM sqlite_sequence WHERE name = 'test_history'"
                )

        logger.info(
            "Deleted %d assessment(s)%s",
            removed,
            f" for subject {subject_id}" if subject_id else " (full reset)",
        )
        return removed


#: Process-wide database handle reused by the FastAPI dependency layer.
_DATABASE: Database | None = None


def get_database(settings: Settings | None = None) -> Database:
    """Return the process-wide :class:`Database` singleton.

    Args:
        settings: Optional settings override used on first construction.

    Returns:
        Database: Shared database handle.
    """
    global _DATABASE
    if _DATABASE is None:
        _DATABASE = Database(settings=settings)
    return _DATABASE


def init_database(settings: Settings | None = None) -> Database:
    """Create the database file and schema, returning the shared handle.

    Args:
        settings: Optional settings override used on first construction.

    Returns:
        Database: Shared, initialised database handle.
    """
    database = get_database(settings)
    database.init_schema()
    return database
