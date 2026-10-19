# SPDX-License-Identifier: MIT
"""Projects: a user's own boards, kept on the website (the board in the browser has no folder to save to). Private to the account;
publishing one for others is a preset (presets.py)."""
import json

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_library_user
from ..models import Project, User
from .presets import MAX_BYTES, _depth, MAX_DEPTH, clean_media

router = APIRouter(prefix="/api/projects", tags=["projects"])

MAX_PROJECTS = 200


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    preset: dict       # the board: nodes, cables, panels, and description, tags, tempo, needs next to them


def _meta(p: Project) -> dict:
    return {"id": p.id, "name": p.name, "description": p.description, "tags": p.tags, "bytes": p.bytes, "updated_at": p.updated_at}


@router.get("")
def list_projects(db: Session = Depends(get_db), user: User = Depends(get_library_user)):
    rows = db.scalars(select(Project).where(Project.user_id == user.id).order_by(func.lower(Project.name))).all()
    return {"items": [_meta(p) for p in rows]}


@router.get("/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_library_user)):
    p = db.get(Project, project_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such project")
    return Response(p.data, media_type="application/json")


@router.post("")
def save_project(body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(get_library_user)):
    """Saves a project under its name; a project of that name is replaced."""
    name = " ".join(body.name.split())
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A project needs a name")
    pre = body.preset
    if not isinstance(pre.get("nodes"), list) or not isinstance(pre.get("cables", []), list) or _depth(pre) > MAX_DEPTH:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That is not a project")
    media = pre.get("media")
    if media is not None:   # the audio of the board's modules, with the same limits as a preset's
        pre["media"], _ = clean_media(media)
    data = json.dumps(pre, separators=(",", ":"))
    audio = sum(len(f["data"]) for f in pre.get("media", {}).values())
    if len(data.encode()) - audio > MAX_BYTES * 4:   # the limit is for the board itself; the audio has its own (clean_media)
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"A project may be up to {MAX_BYTES * 4 // 1024} KB, not counting its audio")
    tags = [str(t)[:30] for t in pre.get("tags", []) if isinstance(t, str)][:10]
    description = str(pre.get("description", ""))[:280]
    p = db.scalar(select(Project).where(Project.user_id == user.id, Project.name == name))
    if p is None:
        if db.scalar(select(func.count()).select_from(Project).where(Project.user_id == user.id)) >= MAX_PROJECTS:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Up to {MAX_PROJECTS} projects; delete one first")
        p = Project(user_id=user.id, name=name)
        db.add(p)
    p.description, p.tags, p.data, p.bytes = description, tags, data, len(data.encode())
    db.commit()
    db.refresh(p)
    return _meta(p)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_library_user)):
    p = db.get(Project, project_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such project")
    db.delete(p)
    db.commit()
