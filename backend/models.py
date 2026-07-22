from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

from bson import ObjectId
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

PyObjectId = Annotated[str, BeforeValidator(str)]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    @classmethod
    def from_mongo(cls, doc: dict):
        if not doc:
            return None
        return cls(**doc)

    def to_mongo(self) -> dict:
        data = self.model_dump(by_alias=True, exclude_none=True)
        data.pop("_id", None)
        return data


# ---------- Users ----------
class User(BaseDocument):
    username: str
    email: Optional[str] = None
    password_hash: str
    role: str = "admin"
    created_at: str = Field(default_factory=now_iso)


class LoginRequest(BaseModel):
    username: str
    password: str
    remember: bool = False


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ---------- Projects ----------
class EnvVar(BaseModel):
    key: str
    value: str


class ProjectBase(BaseModel):
    name: str
    repo_url: str
    branch: str = "main"
    environment: Optional[str] = None  # free-form tag: production | staging | demo | ...
    github_token: Optional[str] = None  # plaintext on input; encrypted at rest
    domain: Optional[str] = None
    ssl_mode: str = "none"  # none | letsencrypt | custom
    ssl_cert_path: Optional[str] = None
    ssl_key_path: Optional[str] = None
    ssl_email: Optional[str] = None  # for letsencrypt
    db_name: Optional[str] = None
    backend_port: Optional[int] = None
    frontend_port: Optional[int] = None
    env_vars: List[EnvVar] = Field(default_factory=list)


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    repo_url: Optional[str] = None
    branch: Optional[str] = None
    environment: Optional[str] = None
    github_token: Optional[str] = None
    domain: Optional[str] = None
    ssl_mode: Optional[str] = None
    ssl_cert_path: Optional[str] = None
    ssl_key_path: Optional[str] = None
    ssl_email: Optional[str] = None
    db_name: Optional[str] = None
    backend_port: Optional[int] = None
    frontend_port: Optional[int] = None
    env_vars: Optional[List[EnvVar]] = None
    auto_deploy_enabled: Optional[bool] = None


class Project(BaseDocument):
    name: str
    slug: str
    repo_url: str
    branch: str = "main"
    environment: Optional[str] = None
    github_token_enc: Optional[str] = None
    domain: Optional[str] = None
    ssl_mode: str = "none"
    ssl_cert_path: Optional[str] = None
    ssl_key_path: Optional[str] = None
    ssl_email: Optional[str] = None
    db_name: Optional[str] = None
    backend_port: Optional[int] = None
    frontend_port: Optional[int] = None
    env_vars: List[EnvVar] = Field(default_factory=list)
    status: str = "created"  # created | cloning | building | running | stopped | error
    last_deploy_at: Optional[str] = None
    last_message: Optional[str] = None
    env_missing_required: List[str] = Field(default_factory=list)
    env_scanned_at: Optional[str] = None
    env_required: Optional[List[Dict[str, Any]]] = None
    updates_behind: int = 0
    updates_checked_at: Optional[str] = None
    current_commit: Optional[Dict[str, Any]] = None
    remote_commit: Optional[Dict[str, Any]] = None
    updates_alerted_commit: Optional[str] = None
    auto_deploy_enabled: bool = False
    webhook_id: Optional[str] = None
    webhook_secret: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)

    @classmethod
    def from_mongo(cls, doc: dict):
        obj = super().from_mongo(doc)
        if obj and obj.env_vars:
            from secrets_crypto import decrypt_value
            for e in obj.env_vars:
                e.value = decrypt_value(e.value)
        return obj

    def to_mongo(self) -> dict:
        data = super().to_mongo()
        if data.get("env_vars"):
            from secrets_crypto import encrypt_env_list
            data["env_vars"] = encrypt_env_list(data["env_vars"])
        return data


def project_public(p: Project) -> dict:
    """Serialize a project for API response, hiding secrets."""
    data = p.model_dump()
    data.pop("github_token_enc", None)
    data.pop("webhook_secret", None)
    data["has_github_token"] = bool(p.github_token_enc)
    data["has_webhook"] = bool(p.webhook_id)
    return data# ---------- Branding / panel identity ----------
class BrandingUpdate(BaseModel):
    system_name: Optional[str] = None
    tagline: Optional[str] = None
    logo: Optional[str] = None
    favicon: Optional[str] = None
    primary_color: Optional[str] = None


# ---------- Users ----------
class CreateUserRequest(BaseModel):
    username: str
    email: Optional[str] = None
    password: str


# ---------- Deploy logs ----------
class DeployLogLine(BaseModel):
    ts: str = Field(default_factory=now_iso)
    stream: str = "stdout"  # stdout | stderr | info | error | success
    text: str


class DeployLog(BaseDocument):
    project_id: str
    action: str  # deploy | start | stop | restart | ssl
    status: str = "running"  # running | success | error
    lines: List[DeployLogLine] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)
    finished_at: Optional[str] = None


# ---------- Terminal ----------
class TerminalServer(BaseDocument):
    name: str
    host: str
    port: int = 22
    username: str = "root"
    auth_type: str = "password"  # password | key
    password_enc: Optional[str] = None
    private_key_enc: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class TerminalServerCreate(BaseModel):
    name: str
    host: str
    port: int = 22
    username: str = "root"
    auth_type: str = "password"
    password: Optional[str] = None
    private_key: Optional[str] = None


class TerminalServerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    auth_type: Optional[str] = None
    password: Optional[str] = None
    private_key: Optional[str] = None


def terminal_server_public(s: TerminalServer) -> dict:
    data = s.model_dump()
    data.pop("password_enc", None)
    data.pop("private_key_enc", None)
    data["has_password"] = bool(s.password_enc)
    data["has_private_key"] = bool(s.private_key_enc)
    return data


class TerminalCommand(BaseDocument):
    name: str
    command: str
    system: bool = False
    created_at: str = Field(default_factory=now_iso)


class TerminalCommandCreate(BaseModel):
    name: str
    command: str


class TerminalCommandUpdate(BaseModel):
    name: Optional[str] = None
    command: Optional[str] = None
