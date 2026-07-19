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
    password_hash: str
    role: str = "admin"
    created_at: str = Field(default_factory=now_iso)


class LoginRequest(BaseModel):
    username: str
    password: str


# ---------- Projects ----------
class EnvVar(BaseModel):
    key: str
    value: str


class ProjectBase(BaseModel):
    name: str
    repo_url: str
    branch: str = "main"
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


class Project(BaseDocument):
    name: str
    slug: str
    repo_url: str
    branch: str = "main"
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
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


def project_public(p: Project) -> dict:
    """Serialize a project for API response, hiding the encrypted token."""
    data = p.model_dump()
    data.pop("github_token_enc", None)
    data["has_github_token"] = bool(p.github_token_enc)
    return data


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
