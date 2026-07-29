"""Command line management of dashboard accounts.

Usage::

    python scripts/manage_users.py list
    python scripts/manage_users.py add researcher1 --name "นักวิจัย 1"
    python scripts/manage_users.py passwd admin
    python scripts/manage_users.py disable researcher1
    python scripts/manage_users.py enable  researcher1

Passwords are never taken from the command line, so they cannot end up in the
shell history or in the process list; the script always prompts for them.
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

# Allow ``python scripts/manage_users.py`` from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.auth import SessionRepository, UserRepository  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.database import init_database  # noqa: E402
from app.exceptions import EyeTrackingError  # noqa: E402

#: Minimum accepted password length.
MIN_PASSWORD_LENGTH = 8


def prompt_password(confirm: bool = True) -> str:
    """Ask for a password twice and return it once both entries agree.

    Args:
        confirm: Whether to ask for the password a second time.

    Returns:
        str: The chosen password.

    Raises:
        SystemExit: When the entries differ or the password is too short.
    """
    password = getpass.getpass("รหัสผ่านใหม่: ")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise SystemExit(f"รหัสผ่านต้องยาวอย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร")
    if confirm and password != getpass.getpass("ยืนยันรหัสผ่าน: "):
        raise SystemExit("รหัสผ่านทั้งสองครั้งไม่ตรงกัน")
    return password


def command_list(users: UserRepository) -> int:
    """Print every account as a table.

    Args:
        users: User repository.

    Returns:
        int: Process exit code.
    """
    accounts = users.list()
    if not accounts:
        print("ยังไม่มีบัญชีผู้ใช้")
        return 0

    print(f"{'id':>3}  {'username':<20} {'role':<12} {'active':<7} last login")
    print("-" * 74)
    for account in accounts:
        print(
            f"{account.id:>3}  {account.username:<20} {account.role:<12} "
            f"{'yes' if account.is_active else 'no':<7} {account.last_login_at or '-'}"
        )
    return 0


def command_add(users: UserRepository, args: argparse.Namespace) -> int:
    """Create an account, prompting for its password.

    Args:
        users: User repository.
        args: Parsed command line arguments.

    Returns:
        int: Process exit code.
    """
    password = prompt_password()
    account = users.create(
        args.username,
        password,
        display_name=args.name,
        role=args.role,
    )
    print(f"สร้างบัญชี '{account.username}' (role={account.role}) แล้ว")
    return 0


def command_passwd(
    users: UserRepository,
    sessions: SessionRepository,
    args: argparse.Namespace,
) -> int:
    """Change an account's password and revoke its existing sessions.

    Args:
        users: User repository.
        sessions: Session repository.
        args: Parsed command line arguments.

    Returns:
        int: Process exit code.
    """
    record = users.get_by_username(args.username)
    if record is None:
        print(f"ไม่พบบัญชี '{args.username}'")
        return 1

    password = prompt_password()
    users.set_password(args.username, password)
    revoked = sessions.revoke_all(record[0].id)
    print(f"เปลี่ยนรหัสผ่านของ '{args.username}' แล้ว (ยกเลิก {revoked} เซสชันที่ค้างอยู่)")
    return 0


def command_set_active(
    users: UserRepository,
    sessions: SessionRepository,
    args: argparse.Namespace,
    active: bool,
) -> int:
    """Enable or disable an account.

    Disabling also revokes live sessions, so access stops immediately rather
    than when the token happens to expire.

    Args:
        users: User repository.
        sessions: Session repository.
        args: Parsed command line arguments.
        active: Desired state.

    Returns:
        int: Process exit code.
    """
    record = users.get_by_username(args.username)
    if record is None:
        print(f"ไม่พบบัญชี '{args.username}'")
        return 1

    users.set_active(args.username, active)
    if not active:
        sessions.revoke_all(record[0].id)
    print(f"{'เปิด' if active else 'ปิด'}ใช้งานบัญชี '{args.username}' แล้ว")
    return 0


def build_parser() -> argparse.ArgumentParser:
    """Build the command line parser.

    Returns:
        argparse.ArgumentParser: Configured parser.
    """
    parser = argparse.ArgumentParser(description=__doc__.split("\n", maxsplit=1)[0])
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="แสดงบัญชีทั้งหมด")

    add = sub.add_parser("add", help="สร้างบัญชีใหม่")
    add.add_argument("username")
    add.add_argument("--name", default=None, help="ชื่อที่แสดงในแดชบอร์ด")
    add.add_argument("--role", default="researcher", choices=["admin", "researcher"])

    passwd = sub.add_parser("passwd", help="เปลี่ยนรหัสผ่าน")
    passwd.add_argument("username")

    disable = sub.add_parser("disable", help="ปิดใช้งานบัญชี")
    disable.add_argument("username")

    enable = sub.add_parser("enable", help="เปิดใช้งานบัญชี")
    enable.add_argument("username")

    return parser


def main(argv: list[str] | None = None) -> int:
    """Entry point of the script.

    Args:
        argv: Argument list; ``sys.argv[1:]`` is used when omitted.

    Returns:
        int: Process exit code.
    """
    args = build_parser().parse_args(argv)
    settings = get_settings()
    settings.ensure_directories()
    database = init_database(settings)

    users = UserRepository(database)
    sessions = SessionRepository(database, settings)

    try:
        if args.command == "list":
            return command_list(users)
        if args.command == "add":
            return command_add(users, args)
        if args.command == "passwd":
            return command_passwd(users, sessions, args)
        if args.command == "disable":
            return command_set_active(users, sessions, args, active=False)
        if args.command == "enable":
            return command_set_active(users, sessions, args, active=True)
    except EyeTrackingError as exc:
        print(f"ผิดพลาด: {exc.message}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
