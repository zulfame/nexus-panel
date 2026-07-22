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


def scripts_available() -> bool:
    return Path(SCRIPTS_DIR).is_dir()


SERVICE = os.environ.get("NEXUS_SERVICE_NAME", "nexus-panel")


def _detached(cmd: list) -> None:
    subprocess.Popen(
        ["setsid", *cmd],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def restart_panel() -> None:
    """Restart the panel systemd service (detached so the running request can finish)."""
    _detached(["bash", "-c", f"sleep 1; systemctl restart {SERVICE}"])


def restart_server() -> None:
    """Reboot the host VPS (detached)."""
    _detached(["bash", "-c", "sleep 1; systemctl reboot || reboot"])


def _panel_git_dir() -> Path:
    """Directory holding the panel's git checkout."""
    cur = Path(CURRENT)
    if (cur / ".git").exists():
        return cur
    root = Path(__file__).resolve().parent.parent  # repo root (parent of backend/)
    return root


def check_panel_updates() -> dict:
    """git fetch + compare local HEAD vs origin/<branch> to detect a newer panel release."""
    d = _panel_git_dir()
    if not (d / ".git").exists():
        return {"available": False, "behind": 0, "error": "not a git repository"}

    def _git(*args, timeout=20):
        return subprocess.run(["git", "-C", str(d), *args], capture_output=True, text=True, timeout=timeout)

    try:
        branch = (_git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip() or "main")
        fetch = _git("fetch", "--quiet", "origin", branch)
        if fetch.returncode != 0:
            return {"available": False, "behind": 0, "branch": branch, "error": (fetch.stderr or "fetch failed").strip()[:200]}
        behind = int(_git("rev-list", "--count", f"HEAD..origin/{branch}").stdout.strip() or "0")
        cur_sha = _git("rev-parse", "--short", "HEAD").stdout.strip()
        remote_sha = _git("rev-parse", "--short", f"origin/{branch}").stdout.strip()
        commits = []
        if behind > 0:
            log = _git("log", "--no-merges", "--pretty=%h%x1f%s%x1f%cr", f"HEAD..origin/{branch}", "-n", "20").stdout.strip()
            for line in log.splitlines():
                parts = line.split("\x1f")
                if len(parts) == 3:
                    commits.append({"sha": parts[0], "subject": parts[1], "when": parts[2]})
        return {"available": behind > 0, "behind": behind, "branch": branch, "current": cur_sha, "remote": remote_sha, "commits": commits, "error": None}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "behind": 0, "error": str(e)[:200]}


def prune_backups(keep: int) -> int:
    """Delete backup archives beyond the newest `keep`. Returns count removed."""
    d = Path(BACKUP_DIR)
    if not d.is_dir() or keep < 0:
        return 0
    files = sorted(d.glob("nexus-backup-*.tar.gz"), key=lambda f: f.stat().st_mtime, reverse=True)
    removed = 0
    for f in files[keep:]:
        try:
            f.unlink()
            removed += 1
        except Exception:
            pass
    return removed
