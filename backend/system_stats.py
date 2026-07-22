import os

import psutil


def disk_status(path: str = "/") -> dict:
    u = psutil.disk_usage(path)
    return {"total": u.total, "used": u.used, "free": u.free, "percent": round(u.percent, 1)}


def disk_guard(path: str = "/") -> tuple:
    """Return (ok, status, limits). ok=False when free space is below the configured floor."""
    min_mb = int(os.environ.get("DISK_GUARD_MIN_FREE_MB", "2048"))
    min_pct = float(os.environ.get("DISK_GUARD_MIN_FREE_PCT", "5"))
    s = disk_status(path)
    free_mb = s["free"] / 1024 / 1024
    free_pct = round(100 - s["percent"], 1)
    ok = free_mb >= min_mb and free_pct >= min_pct
    return ok, s, {"min_mb": min_mb, "min_pct": min_pct, "free_mb": round(free_mb), "free_pct": free_pct}


def get_system_stats() -> dict:
    cpu_percent = psutil.cpu_percent(interval=0.3)
    load1, load5, load15 = (0.0, 0.0, 0.0)
    try:
        load1, load5, load15 = os.getloadavg()
    except (OSError, AttributeError):
        pass
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    boot = psutil.boot_time()
    return {
        "cpu": {
            "percent": round(cpu_percent, 1),
            "cores": psutil.cpu_count(logical=True) or 0,
            "load": [round(load1, 2), round(load5, 2), round(load15, 2)],
        },
        "memory": {
            "total": vm.total,
            "used": vm.used,
            "available": vm.available,
            "percent": vm.percent,
        },
        "disk": {
            "total": disk.total,
            "used": disk.used,
            "free": disk.free,
            "percent": disk.percent,
        },
        "boot_time": boot,
    }
