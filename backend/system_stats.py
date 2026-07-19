import os

import psutil


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
