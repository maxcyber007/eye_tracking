"""Centralised logging configuration.

The application never calls ``logging.basicConfig`` from business modules; every
module only asks for a named logger via :func:`get_logger`.  The root handlers
are installed exactly once, at start-up, by :func:`configure_logging`.
"""

from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler

from app.config import Settings, get_settings

_CONFIGURED: bool = False


def configure_logging(settings: Settings | None = None, *, force: bool = False) -> None:
    """Install the root logging handlers according to the application settings.

    Args:
        settings: Settings object to read the log level/format from.  When
            ``None`` the cached application settings are used.
        force: Re-install the handlers even if logging was already configured.

    Returns:
        None
    """
    global _CONFIGURED
    if _CONFIGURED and not force:
        return

    settings = settings or get_settings()
    root = logging.getLogger()
    root.setLevel(settings.log_level)

    for handler in list(root.handlers):
        root.removeHandler(handler)

    formatter = logging.Formatter(settings.log_format)

    stream_handler = logging.StreamHandler(stream=sys.stdout)
    stream_handler.setFormatter(formatter)
    root.addHandler(stream_handler)

    if settings.log_to_file:
        settings.log_dir.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            filename=settings.log_dir / settings.log_filename,
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)

    # Third-party libraries are extremely chatty at INFO level.
    for noisy in ("matplotlib", "PIL", "mediapipe", "absl"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """Return a module level logger, configuring logging on first use.

    Args:
        name: Logger name, conventionally ``__name__`` of the calling module.

    Returns:
        logging.Logger: Configured logger instance.
    """
    configure_logging()
    return logging.getLogger(name)
