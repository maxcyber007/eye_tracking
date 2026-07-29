"""Authentication endpoints backing the dashboard login screen."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Request, Response, status

from app.auth import verify_password
from app.dependencies import (
    CurrentUserDep,
    SessionRepositoryDep,
    SettingsDep,
    UserRepositoryDep,
    read_session_token,
)
from app.exceptions import UnauthorizedError
from app.logging_config import get_logger
from app.schemas import ErrorResponse, LoginRequest, LoginResponse, LogoutResponse, UserPayload

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

#: Minimum time a login attempt takes, to blunt username enumeration timing.
_MIN_LOGIN_SECONDS = 0.25


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Sign in and receive a session cookie",
    responses={401: {"model": ErrorResponse, "description": "Invalid credentials."}},
)
def login(
    payload: LoginRequest,
    response: Response,
    settings: SettingsDep,
    users: UserRepositoryDep,
    sessions: SessionRepositoryDep,
) -> LoginResponse:
    """Verify credentials and start a session.

    The same generic message is returned whether the username is unknown, the
    password is wrong or the account is disabled, so the endpoint cannot be used
    to discover which accounts exist.

    Args:
        payload: Submitted username and password.
        response: Response object used to attach the session cookie.
        settings: Injected application settings.
        users: Injected user repository.
        sessions: Injected session repository.

    Returns:
        LoginResponse: The signed-in account and the session expiry.

    Raises:
        UnauthorizedError: When the credentials are not valid.
    """
    started = time.monotonic()
    record = users.get_by_username(payload.username)

    authenticated = False
    if record is not None:
        user, password_hash = record
        authenticated = user.is_active and verify_password(payload.password, password_hash)

    # Keep failures roughly constant-time regardless of which branch failed.
    elapsed = time.monotonic() - started
    if elapsed < _MIN_LOGIN_SECONDS:
        time.sleep(_MIN_LOGIN_SECONDS - elapsed)

    if not authenticated or record is None:
        logger.warning("Failed sign-in attempt for '%s'", payload.username)
        raise UnauthorizedError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")

    user, _ = record
    token, expires = sessions.create(user.id)
    users.touch_login(user.id)
    sessions.purge_expired()

    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_minutes * 60,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        path="/",
    )

    logger.info("User '%s' signed in", user.username)
    return LoginResponse(
        success=True,
        message=f"ยินดีต้อนรับ {user.display_name}",
        user=UserPayload(**user.to_dict()),
        expires_at=expires.isoformat(),
    )


@router.post(
    "/logout",
    response_model=LogoutResponse,
    summary="End the current session",
)
def logout(
    request: Request,
    response: Response,
    settings: SettingsDep,
    sessions: SessionRepositoryDep,
) -> LogoutResponse:
    """Revoke the current session and clear the cookie.

    The endpoint is deliberately tolerant: signing out without a valid session
    still succeeds, so a stale tab can always clear itself.

    Args:
        request: Incoming request carrying the session token.
        response: Response object used to clear the cookie.
        settings: Injected application settings.
        sessions: Injected session repository.

    Returns:
        LogoutResponse: Confirmation that the session was cleared.
    """
    token = read_session_token(request, settings)
    if token:
        sessions.revoke(token)

    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
    )
    return LogoutResponse(success=True, message="ออกจากระบบแล้ว")


@router.get(
    "/me",
    response_model=UserPayload,
    summary="Describe the currently signed-in account",
    responses={401: {"model": ErrorResponse, "description": "Not signed in."}},
)
def read_me(user: CurrentUserDep) -> UserPayload:
    """Return the signed-in account, used by the dashboard on page load.

    Args:
        user: Injected signed-in account.

    Returns:
        UserPayload: Safe representation of the account.
    """
    return UserPayload(**user.to_dict())


@router.get(
    "/status",
    summary="Report whether authentication is enabled and a session is active",
    status_code=status.HTTP_200_OK,
)
def read_status(
    request: Request,
    settings: SettingsDep,
    sessions: SessionRepositoryDep,
) -> dict[str, Any]:
    """Report the auth state without requiring a session.

    The login page calls this before showing the form, so an already-signed-in
    visitor goes straight to the dashboard.

    Args:
        request: Incoming request.
        settings: Injected application settings.
        sessions: Injected session repository.

    Returns:
        dict[str, Any]: Whether auth is enabled and whether a session is active.
    """
    if not settings.auth_enabled:
        return {"auth_enabled": False, "authenticated": True, "user": None}

    user = sessions.resolve(read_session_token(request, settings) or "")
    return {
        "auth_enabled": True,
        "authenticated": user is not None,
        "user": user.to_dict() if user else None,
    }
