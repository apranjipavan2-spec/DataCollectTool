"""Route modules for TableForge API."""

from .upload import router as upload_router
from .tabulate import router as tabulate_router
from .metrics import router as metrics_router
from .dataset import router as dataset_router
from .export import router as export_router
from .projects import router as projects_router
from .stats import router as stats_router
from .compare import router as compare_router
from .ai import router as ai_router
from .fg import router as fg_router

__all__ = [
    "upload_router", "tabulate_router", "metrics_router", "dataset_router",
    "export_router", "projects_router", "stats_router", "compare_router",
    "ai_router", "fg_router",
]
