"""Authentication: password hashing, user accounts and opaque session tokens.

Design choices, and why:

* **PBKDF2-HMAC-SHA256** from the standard library hashes passwords.  It needs
  no extra dependency and is a sound choice at a high iteration count; the
  parameters are stored inside the hash string so they can be raised later
  without invalidating existing accounts.
* **Opaque random session tokens** stored server-side, rather than a signed
  stateless token.  Sessions can then be revoked immediately on logout, which
  a self-contained JWT cannot do without extra machinery.
* Only the **SHA-256 of the token** is stored.  A leaked database therefore does
  not hand over usable sessions.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Final

from app.config import Settings, get_settings
from app.database import Database
from app.exceptions import BadRequestError, RepositoryError
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Identifier stored at the front of every hash string.
HASH_SCHEME: Final[str] = "pbkdf2_sha256"
#: Iteration count for new hashes; raise over time as hardware improves.
DEFAULT_ITERATIONS: Final[int] = 600_000
#: Salt length in bytes.
SALT_BYTES: Final[int] = 16
#: Session token length in bytes before base64 encoding.
TOKEN_BYTES: Final[int] = 32

CREATE_USERS_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    display_name  TEXT,
    role          TEXT    NOT NULL DEFAULT 'researcher',
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL,
    last_login_at TEXT
)
"""

CREATE_SESSIONS_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT    NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL,
    created_at TEXT    NOT NULL,
    expires_at TEXT    NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
)
"""

CREATE_SESSIONS_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token_hash)"
)


# --------------------------------------------------------------------------- #
# Password hashing                                                            #
# --------------------------------------------------------------------------- #
def hash_password(password: str, *, iterations: int = DEFAULT_ITERATIONS) -> str:
    """Hash a password with PBKDF2-HMAC-SHA256 and a fresh random salt.

    Args:
        password: Plain text password.
        iterations: PBKDF2 iteration count.

    Returns:
        str: ``pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>``.

    Raises:
        BadRequestError: When the password is empty.
    """
    if not password:
        raise BadRequestError("The password must not be empty.")

    salt = secrets.token_bytes(SALT_BYTES)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{HASH_SCHEME}${iterations}${_b64(salt)}${_b64(derived)}"


def verify_password(password: str, encoded: str) -> bool:
    """Check a password against a stored hash in constant time.

    Args:
        password: Plain text password supplied by the client.
        encoded: Hash string previously produced by :func:`hash_password`.

    Returns:
        bool: ``True`` when the password matches.
    """
    try:
        scheme, iterations, salt_b64, hash_b64 = encoded.split("$")
        if scheme != HASH_SCHEME:
            logger.warning("Unsupported password hash scheme: %s", scheme)
            return False
        derived = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), _unb64(salt_b64), int(iterations)
        )
    except (ValueError, TypeError):
        logger.warning("Malformed password hash encountered")
        return False
    return hmac.compare_digest(derived, _unb64(hash_b64))


def _b64(raw: bytes) -> str:
    """Encode bytes as unpadded URL-safe base64.

    Args:
        raw: Bytes to encode.

    Returns:
        str: Encoded text.
    """
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    """Decode unpadded URL-safe base64 back into bytes.

    Args:
        text: Encoded text.

    Returns:
        bytes: Decoded bytes.
    """
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def hash_token(token: str) -> str:
    """Hash a session token for storage.

    Args:
        token: Raw session token handed to the client.

    Returns:
        str: Hex SHA-256 digest of the token.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class User:
    """An account allowed to sign in to the dashboard.

    Attributes:
        id: Primary key.
        username: Unique login name.
        display_name: Human readable name shown in the dashboard.
        role: Coarse role label, currently informational only.
        is_active: Whether the account may sign in.
        created_at: ISO-8601 UTC creation timestamp.
        last_login_at: ISO-8601 UTC timestamp of the last successful sign-in.
    """

    id: int
    username: str
    display_name: str
    role: str
    is_active: bool
    created_at: str
    last_login_at: str | None = None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "User":
        """Build a user from a ``sqlite3.Row``.

        Args:
            row: Row selected from ``users``.

        Returns:
            User: Parsed account.
        """
        return cls(
            id=int(row["id"]),
            username=str(row["username"]),
            display_name=str(row["display_name"] or row["username"]),
            role=str(row["role"]),
            is_active=bool(row["is_active"]),
            created_at=str(row["created_at"]),
            last_login_at=row["last_login_at"],
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialise the account for API responses, without any secret.

        Returns:
            dict[str, Any]: Safe representation of the account.
        """
        return {
            "id": self.id,
            "username": self.username,
            "display_name": self.display_name,
            "role": self.role,
            "created_at": self.created_at,
            "last_login_at": self.last_login_at,
        }


# --------------------------------------------------------------------------- #
# Repositories                                                                #
# --------------------------------------------------------------------------- #
class UserRepository:
    """CRUD operations on the ``users`` table.

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
        username: str,
        password: str,
        *,
        display_name: str | None = None,
        role: str = "researcher",
    ) -> User:
        """Create an account.

        Args:
            username: Unique login name.
            password: Plain text password, hashed before storage.
            display_name: Optional human readable name.
            role: Coarse role label.

        Returns:
            User: The created account.

        Raises:
            BadRequestError: When the username already exists or is empty.
        """
        name = (username or "").strip().lower()
        if not name:
            raise BadRequestError("The username must not be empty.")

        timestamp = datetime.now(timezone.utc).isoformat()
        try:
            with self.database.connect() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO users (username, password_hash, display_name, role,
                                       is_active, created_at)
                    VALUES (?, ?, ?, ?, 1, ?)
                    """,
                    (name, hash_password(password), display_name or name, role, timestamp),
                )
                user_id = int(cursor.lastrowid or 0)
        except RepositoryError as exc:
            if "UNIQUE" in str(exc).upper():
                raise BadRequestError(f"The user '{name}' already exists.") from exc
            raise

        logger.info("Created user '%s' (role=%s)", name, role)
        return User(
            id=user_id,
            username=name,
            display_name=display_name or name,
            role=role,
            is_active=True,
            created_at=timestamp,
        )

    def get_by_username(self, username: str) -> tuple[User, str] | None:
        """Look up an account and its stored password hash.

        Args:
            username: Login name, matched case-insensitively.

        Returns:
            tuple[User, str] | None: The account and its hash, or ``None``.
        """
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE username = ?", ((username or "").strip().lower(),)
            ).fetchone()
        return (User.from_row(row), str(row["password_hash"])) if row else None

    def get(self, user_id: int) -> User | None:
        """Fetch an account by primary key.

        Args:
            user_id: Primary key.

        Returns:
            User | None: The account, or ``None`` when absent.
        """
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE id = ?", (int(user_id),)
            ).fetchone()
        return User.from_row(row) if row else None

    def list(self) -> list[User]:
        """List every account, oldest first.

        Returns:
            list[User]: All accounts.
        """
        with self.database.connect() as connection:
            rows = connection.execute("SELECT * FROM users ORDER BY id").fetchall()
        return [User.from_row(row) for row in rows]

    def count(self) -> int:
        """Count the accounts.

        Returns:
            int: Number of rows in ``users``.
        """
        with self.database.connect() as connection:
            row = connection.execute("SELECT COUNT(*) AS total FROM users").fetchone()
        return int(row["total"]) if row else 0

    def set_password(self, username: str, password: str) -> bool:
        """Replace an account's password.

        Args:
            username: Login name.
            password: New plain text password.

        Returns:
            bool: ``True`` when an account was updated.
        """
        with self.database.connect() as connection:
            cursor = connection.execute(
                "UPDATE users SET password_hash = ? WHERE username = ?",
                (hash_password(password), (username or "").strip().lower()),
            )
            return cursor.rowcount > 0

    def set_active(self, username: str, active: bool) -> bool:
        """Enable or disable an account.

        Args:
            username: Login name.
            active: Desired state.

        Returns:
            bool: ``True`` when an account was updated.
        """
        with self.database.connect() as connection:
            cursor = connection.execute(
                "UPDATE users SET is_active = ? WHERE username = ?",
                (1 if active else 0, (username or "").strip().lower()),
            )
            return cursor.rowcount > 0

    def touch_login(self, user_id: int) -> None:
        """Record a successful sign-in timestamp.

        Args:
            user_id: Primary key of the account that signed in.

        Returns:
            None
        """
        with self.database.connect() as connection:
            connection.execute(
                "UPDATE users SET last_login_at = ? WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(), int(user_id)),
            )


class SessionRepository:
    """Issue, resolve and revoke session tokens.

    Attributes:
        database: Connection factory used for every statement.
        settings: Settings supplying the session lifetime.
    """

    def __init__(
        self,
        database: Database | None = None,
        settings: Settings | None = None,
    ) -> None:
        """Create a repository bound to a database handle.

        Args:
            database: Database handle; a default one is created when omitted.
            settings: Settings instance; the cached global settings are used when
                omitted.
        """
        self.database: Database = database or Database()
        self.settings: Settings = settings or get_settings()

    def create(self, user_id: int) -> tuple[str, datetime]:
        """Issue a new session token for an account.

        Args:
            user_id: Account the session belongs to.

        Returns:
            tuple[str, datetime]: The raw token (shown once) and its expiry.
        """
        token = secrets.token_urlsafe(TOKEN_BYTES)
        now = datetime.now(timezone.utc)
        expires = now + timedelta(minutes=self.settings.session_ttl_minutes)

        with self.database.connect() as connection:
            connection.execute(
                """
                INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (hash_token(token), int(user_id), now.isoformat(), expires.isoformat()),
            )
        return token, expires

    def resolve(self, token: str) -> User | None:
        """Return the account behind a token, when it is valid and unexpired.

        Args:
            token: Raw session token from the client.

        Returns:
            User | None: The signed-in account, or ``None`` when the token is
            unknown, expired or belongs to a disabled account.
        """
        if not token:
            return None

        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT users.*, sessions.expires_at AS session_expires_at
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ?
                """,
                (hash_token(token),),
            ).fetchone()

        if row is None:
            return None
        if not bool(row["is_active"]):
            logger.info("Rejected a token belonging to the disabled user '%s'", row["username"])
            return None

        try:
            expires = datetime.fromisoformat(str(row["session_expires_at"]))
        except ValueError:
            return None
        if expires <= datetime.now(timezone.utc):
            self.revoke(token)
            return None

        return User.from_row(row)

    def revoke(self, token: str) -> bool:
        """Delete a single session.

        Args:
            token: Raw session token to revoke.

        Returns:
            bool: ``True`` when a session was removed.
        """
        with self.database.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),)
            )
            return cursor.rowcount > 0

    def revoke_all(self, user_id: int) -> int:
        """Delete every session of an account.

        Args:
            user_id: Account whose sessions should be revoked.

        Returns:
            int: Number of sessions removed.
        """
        with self.database.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM sessions WHERE user_id = ?", (int(user_id),)
            )
            return int(cursor.rowcount)

    def purge_expired(self) -> int:
        """Delete sessions whose expiry has passed.

        Returns:
            int: Number of sessions removed.
        """
        with self.database.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM sessions WHERE expires_at <= ?",
                (datetime.now(timezone.utc).isoformat(),),
            )
            removed = int(cursor.rowcount)
        if removed:
            logger.info("Purged %d expired session(s)", removed)
        return removed


# --------------------------------------------------------------------------- #
# Bootstrap                                                                   #
# --------------------------------------------------------------------------- #
def init_auth_schema(database: Database) -> None:
    """Create the authentication tables when they do not exist yet.

    Args:
        database: Database handle to run the DDL on.

    Returns:
        None
    """
    with database.connect() as connection:
        connection.execute(CREATE_USERS_SQL)
        connection.execute(CREATE_SESSIONS_SQL)
        connection.execute(CREATE_SESSIONS_INDEX_SQL)


def ensure_initial_admin(database: Database, settings: Settings) -> None:
    """Create the first administrator account when the user table is empty.

    When ``ADMIN_PASSWORD`` is not configured a strong random password is
    generated and written to the log **once**.  This is deliberate: shipping a
    known default password would leave every deployment that skips the setup
    step wide open.

    Args:
        database: Database handle.
        settings: Settings supplying the initial credentials.

    Returns:
        None
    """
    repository = UserRepository(database)
    if repository.count() > 0:
        _report_ignored_admin_password(repository, settings)
        return

    password = settings.admin_password or secrets.token_urlsafe(12)
    generated = not settings.admin_password
    repository.create(
        settings.admin_username,
        password,
        display_name=settings.admin_display_name,
        role="admin",
    )

    if generated:
        logger.warning(
            "\n%s\n  No ADMIN_PASSWORD was configured, so an account was created with a\n"
            "  generated password. Save it now - it is not shown again.\n\n"
            "      username: %s\n      password: %s\n\n"
            "  Change it with:  python scripts/manage_users.py passwd %s\n%s",
            "=" * 68,
            settings.admin_username,
            password,
            settings.admin_username,
            "=" * 68,
        )
    else:
        logger.info("Created the initial admin account '%s'", settings.admin_username)


def _report_ignored_admin_password(repository: UserRepository, settings: Settings) -> None:
    """Warn when ``ADMIN_PASSWORD`` is set but cannot take effect.

    Accounts are only seeded into an empty user table, so adding
    ``ADMIN_PASSWORD`` to ``.env`` after the first start silently does nothing
    and the operator is left unable to sign in.  Rather than fail quietly, say
    exactly what happened and how to fix it.  Setting
    ``ADMIN_PASSWORD_RESET=true`` opts in to applying the value on every start,
    which suits container deployments that manage credentials declaratively.

    Args:
        repository: User repository used to inspect the existing account.
        settings: Settings carrying the configured admin credentials.

    Returns:
        None
    """
    if not settings.admin_password:
        return

    record = repository.get_by_username(settings.admin_username)
    if record is None:
        logger.warning(
            "ADMIN_PASSWORD is set but no account named '%s' exists. Create it with: "
            "python scripts/manage_users.py add %s",
            settings.admin_username,
            settings.admin_username,
        )
        return

    user, password_hash = record
    if verify_password(settings.admin_password, password_hash):
        return

    if settings.admin_password_reset:
        repository.set_password(settings.admin_username, settings.admin_password)
        SessionRepository(repository.database, settings).revoke_all(user.id)
        logger.warning(
            "ADMIN_PASSWORD_RESET is enabled: reset the password of '%s' from the "
            "environment and revoked its sessions.",
            settings.admin_username,
        )
        return

    logger.warning(
        "\n%s\n  ADMIN_PASSWORD does not match the stored password for '%s' and was\n"
        "  IGNORED. Accounts are only seeded when the user table is empty, so\n"
        "  editing .env after the first start has no effect.\n\n"
        "  To use the password from .env, either:\n"
        "      python scripts/manage_users.py passwd %s\n"
        "  or set ADMIN_PASSWORD_RESET=true to apply it on every start.\n%s",
        "=" * 68,
        settings.admin_username,
        settings.admin_username,
        "=" * 68,
    )
