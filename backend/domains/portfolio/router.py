from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.database import get_db
from core.deps import require_app
from domains.portfolio.models import Project, Tag, project_tags
from domains.portfolio.schemas import ProjectIn, ProjectOut

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

# The portfolio is public; its app grant only allows writing to it.
require_editor = require_app("portfolio")

# The public page's order: the admin's manual position, newest first on ties.
PUBLIC_ORDER = (Project.position.asc(), Project.id.desc())


def _get_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return project


def _tags_by_name(db: Session, names: list[str]) -> list[Tag]:
    """Existing tags matched case-insensitively; the others are created."""
    existing = {
        tag.name.lower(): tag
        for tag in db.scalars(
            select(Tag).where(func.lower(Tag.name).in_([n.lower() for n in names]))
        )
    }
    tags = []
    for name in names:
        tag = existing.get(name.lower())
        if tag is None:
            tag = existing[name.lower()] = Tag(name=name)
            db.add(tag)
        tags.append(tag)
    return tags


def _delete_unused_tags(db: Session) -> None:
    used = select(project_tags.c.tag_id)
    for tag in db.scalars(select(Tag).where(Tag.id.not_in(used))):
        db.delete(tag)


def _save(db: Session, project: Project, payload: ProjectIn) -> Project:
    project.name = payload.name
    project.description_fr = payload.description_fr
    project.description_en = payload.description_en
    project.repo_url = payload.repo_url
    project.featured = payload.featured
    project.position = payload.position
    project.tags = _tags_by_name(db, payload.tags)
    db.add(project)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A project with this name already exists"
        ) from None
    _delete_unused_tags(db)
    db.commit()
    db.refresh(project)
    return project


# ── public ───────────────────────────────────────────────────────────────────


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.scalars(select(Project).order_by(*PUBLIC_ORDER)).all()


@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    return _get_or_404(db, project_id)


@router.get("/tags", response_model=list[str])
def list_tags(db: Session = Depends(get_db)):
    """Every tag in use, for suggestions in the admin form."""
    return db.scalars(select(Tag.name).order_by(func.lower(Tag.name))).all()


# ── editors ────────────────────────────────────────────────────────────────


@router.post(
    "/projects",
    response_model=ProjectOut,
    status_code=201,
    dependencies=[Depends(require_editor)],
)
def create_project(payload: ProjectIn, db: Session = Depends(get_db)):
    return _save(db, Project(), payload)


@router.put(
    "/projects/{project_id}",
    response_model=ProjectOut,
    dependencies=[Depends(require_editor)],
)
def update_project(project_id: int, payload: ProjectIn, db: Session = Depends(get_db)):
    return _save(db, _get_or_404(db, project_id), payload)


@router.delete(
    "/projects/{project_id}", status_code=204, dependencies=[Depends(require_editor)]
)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    db.delete(_get_or_404(db, project_id))
    db.flush()
    _delete_unused_tags(db)
    db.commit()
