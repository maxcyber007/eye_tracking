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
    age         INTEGER,
    features    TEXT,
    metadata    TEXT
)
"""

#: Secondary index supporting the "most recent first" history listing.
CREATE_TEST_HISTORY_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS idx_test_history_created_at "
    "ON test_history (created_at DESC)"
)

#: Columns added after the first release, applied to databases created earlier.
#: ``CREATE TABLE IF NOT EXISTS`` is a no-op on an existing table, so without
#: this an upgraded deployment would keep the old shape and every insert would
#: fail on the unknown column.
TEST_HISTORY_MIGRATIONS: tuple[tuple[str, str], ...] = (("age", "INTEGER"),)


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
        age: Participant age in years, when it was recorded.
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
    age: int | None = None
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
            age=int(row["age"]) if row["age"] is not None else None,
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
            "age": self.age,
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
            self._apply_migrations(connection)

        from app.auth import init_auth_schema

        init_auth_schema(self)
        logger.info("SQLite schema ready at %s", self.path)

    @staticmethod
    def _apply_migrations(connection: sqlite3.Connection) -> None:
        """Add any ``test_history`` columns introduced after the first release.

        Existing rows keep ``NULL`` for the new column, which is exactly right:
        an assessment recorded before the field existed genuinely has no value,
        and inventing one would be worse than leaving the gap visible.

        Args:
            connection: Open connection to run the ``ALTER TABLE`` statements on.

        Returns:
            None
        """
        existing = {
            str(row["name"]) for row in connection.execute("PRAGMA table_info(test_history)")
        }
        for column, column_type in TEST_HISTORY_MIGRATIONS:
            if column not in existing:
                connection.execute(f"ALTER TABLE test_history ADD COLUMN {column} {column_type}")
                logger.info("Added the '%s' column to test_history", column)

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


@dataclass(slots=True, frozen=True)
class HistoryFilter:
    """Criteria shared by every ``test_history`` query.

    Listing, counting and deleting must agree on what "matching" means — a
    report that says 12 rows and a delete that removes 30 is the kind of bug
    that is only noticed after the data is gone. Building the ``WHERE`` clause
    in one place is what keeps them honest.

    Attributes:
        subject_id: Exact participant identifier to match.
        age_min: Lowest participant age to include, inclusive.
        age_max: Highest participant age to include, inclusive.
    """

    subject_id: str | None = None
    age_min: int | None = None
    age_max: int | None = None

    @property
    def is_empty(self) -> bool:
        """Whether the filter matches every row."""
        return self.subject_id is None and self.age_min is None and self.age_max is None

    def where(self) -> tuple[str, list[Any]]:
        """Render the filter as a SQL fragment and its bound parameters.

        Rows whose age was never recorded are excluded as soon as an age bound
        is given: ``NULL`` comparisons are unknown in SQL, and silently keeping
        them would misreport an age-restricted cohort.

        Returns:
            tuple[str, list[Any]]: The ``WHERE ...`` clause (empty when nothing
            is filtered) and the parameters to bind to it.
        """
        clauses: list[str] = []
        parameters: list[Any] = []

        if self.subject_id:
            clauses.append("subject_id = ?")
            parameters.append(self.subject_id)
        if self.age_min is not None:
            clauses.append("age IS NOT NULL AND age >= ?")
            parameters.append(int(self.age_min))
        if self.age_max is not None:
            clauses.append("age IS NOT NULL AND age <= ?")
            parameters.append(int(self.age_max))

        if not clauses:
            return "", []
        return " WHERE " + " AND ".join(clauses), parameters


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
        age: int | None = None,
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
            age: Participant age in years, when it was recorded.
            features: Aggregated features used for the prediction.
            metadata: Free-form descriptive information.
            created_at: Explicit creation timestamp; defaults to "now" in UTC.

        Returns:
            TestHistoryRecord: The persisted record, including its new ``id``.
        """
        timestamp = created_at or utils.utc_now_iso()
        stored_age = int(age) if age is not None else None
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO test_history (
                    created_at, filename, risk_score, risk_level, confidence,
                    model_type, subject_id, age, features, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    timestamp,
                    filename,
                    float(risk_score),
                    risk_level,
                    float(confidence),
                    model_type,
                    subject_id,
                    stored_age,
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
            age=stored_age,
            features=dict(features or {}),
            metadata=dict(metadata or {}),
        )

    def list(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        filters: HistoryFilter | None = None,
    ) -> list[TestHistoryRecord]:
        """List assessments, most recent first.

        Args:
            limit: Maximum number of rows to return.
            offset: Number of rows to skip.
            filters: Participant and age criteria; unfiltered when omitted.

        Returns:
            list[TestHistoryRecord]: Matching records.
        """
        clause, parameters = (filters or HistoryFilter()).where()
        query = f"SELECT * FROM test_history{clause} ORDER BY id DESC LIMIT ? OFFSET ?"
        parameters = [*parameters, max(1, int(limit)), max(0, int(offset))]

        with self.database.connect() as connection:
            rows = connection.execute(query, parameters).fetchall()
        return [TestHistoryRecord.from_row(row) for row in rows]

    def age_range(self) -> tuple[int | None, int | None]:
        """Report the youngest and oldest recorded age.

        Used to bound the report's age filter to ages that actually exist,
        rather than offering an arbitrary 0–120 slider over data that spans
        four years.

        Returns:
            tuple[int | None, int | None]: Minimum and maximum age, both
            ``None`` when no assessment carries one.
        """
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT MIN(age) AS low, MAX(age) AS high FROM test_history WHERE age IS NOT NULL"
            ).fetchone()
        if not row or row["low"] is None:
            return None, None
        return int(row["low"]), int(row["high"])

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

    def count(self, *, filters: HistoryFilter | None = None) -> int:
        """Count the stored assessments matching a filter.

        Args:
            filters: Participant and age criteria; counts everything when
                omitted.

        Returns:
            int: Number of matching rows in ``test_history``.
        """
        clause, parameters = (filters or HistoryFilter()).where()
        with self.database.connect() as connection:
            row = connection.execute(
                f"SELECT COUNT(*) AS total FROM test_history{clause}", parameters
            ).fetchone()
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

    def delete_all(self, *, filters: HistoryFilter | None = None) -> int:
        """Delete every assessment matching a filter.

        This only clears the prediction log.  The training dataset and the
        stored recordings live outside the database and are left untouched.

        Args:
            filters: Participant and age criteria; deletes everything when
                omitted.

        Returns:
            int: Number of rows deleted.
        """
        criteria = filters or HistoryFilter()
        clause, parameters = criteria.where()

        with self.database.connect() as connection:
            cursor = connection.execute(f"DELETE FROM test_history{clause}", parameters)
            removed = int(cursor.rowcount)
            # Reclaim the identity counter so a fully cleared log restarts at 1.
            # Only safe when nothing was filtered, otherwise the surviving rows
            # would collide with ids handed out again.
            if criteria.is_empty:
                connection.execute("DELETE FROM sqlite_sequence WHERE name = 'test_history'")

        logger.info(
            "Deleted %d assessment(s)%s",
            removed,
            " (full reset)" if criteria.is_empty else f" matching {criteria}",
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
