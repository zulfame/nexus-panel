import os
import subprocess
from pathlib import Path

NEXUS_HOME = os.environ.get("NEXUS_HOME", "/opt/nexus-panel")
SCRIPTS_DIR = os.environ.get("NEXUS_SCRIPTS_DIR", f"{NEXUS_HOME}/current/scripts")
BACKUP_DIR = os.environ.get("NEXUS_BACKUP_DIR", f"{NEXUS_HOME}/backups")
RELEASES_DIR = f"{NEXUS_HOME}/releases"
CURRENT = f"{NEXUS_HOME}/current"


def list_backups():
    d = Path(BACKUP_DIR)
    if not d.is_dir():
        return []
    items = []
    for f in sorted(d.glob("nexus-backup-*.tar.gz"), reverse=True):
        st = f.stat()
        items.append({"name": f.name, "size": st.st_size, "created": int(st.st_mtime)})
    return items


def ops_info():
    cur = None
    if os.path.islink(CURRENT) or os.path.exists(CURRENT):
        cur = os.path.basename(os.path.realpath(CURRENT))
    releases = []
    rd = Path(RELEASES_DIR)
    if rd.is_dir():
        releases = [p.name for p in sorted(rd.iterdir(), reverse=True) if p.is_dir()][:10]
    return {
        "nexus_home": NEXUS_HOME,
        "current_release": cur,
        "releases": releases,
        "scripts_available": Path(SCRIPTS_DIR).is_dir(),
        "backup_dir": BACKUP_DIR,
    }


def run_script(name: str, *args: str) -> bool:
    """Launch an ops script detached so it survives a service restart (rollback)."""
    script = Path(SCRIPTS_DIR) / name
    if not script.is_file():
        raise FileNotFoundError(
            f"{name} not found in {SCRIPTS_DIR}. Server operations run on the VPS install."
        )
    cmd = ["setsid", "bash", str(script), *args]
    subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return True


def valid_backup(name: str) -> bool:
    return any(b["name"] == name for b in list_backups())
