"""Backend package for the Alzheimer eye-tracking risk prototype.

Layers:

* ``app.api``      - HTTP handlers (FastAPI routers)
* ``app.ai``       - computer vision, feature engineering, training, inference
* ``app.database`` - SQLite persistence (repository pattern)
* ``app.config``   - environment driven configuration
"""

from __future__ import annotations

__all__ = ["__version__"]

#: Package version, mirrored by ``Settings.app_version``.
__version__ = "0.1.0"
