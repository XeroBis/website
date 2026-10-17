"""Templates: per user, readable (and copyable) by other workout users."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import User
from domains.workout import entries
from domains.workout import models as m
from domains.workout import schemas as s
from domains.workout.access import owned, viewed_user_id, workout_user

router = APIRouter(tags=["workout"])

NAME_TAKEN = "You already have a template with this name"


def user_templates(user_id: int):
    return (
        select(m.Template)
        .where(m.Template.user_id == user_id)
        .order_by(func.lower(m.Template.name))
    )


def free_name(db: Session, model, user_id: int, name: str) -> str:
    """`name`, or "name (2)", "name (3)"… if the user already uses it."""
    candidate, n = name, 1
    while entries.name_taken(db, model, user_id, candidate):
        n += 1
        candidate = f"{name} ({n})"
    return candidate


@router.get("/templates", response_model=list[s.TemplateOut])
def list_templates(
    user_id: int | None = None,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    templates = db.scalars(user_templates(viewed_user_id(db, user, user_id))).all()
    return [entries.template_out(t) for t in templates]


def _viewable(db: Session, user: User, template_id: int, user_id: int | None):
    return owned(
        db, m.Template, template_id, viewed_user_id(db, user, user_id), "Template"
    )


@router.get("/templates/{template_id}", response_model=s.TemplateOut)
def get_template(
    template_id: int,
    user_id: int | None = None,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    return entries.template_out(_viewable(db, user, template_id, user_id))


def _save(db: Session, user: User, template: m.Template, body: s.TemplateIn):
    if entries.name_taken(db, m.Template, user.id, body.name, template.id):
        raise HTTPException(status.HTTP_409_CONFLICT, NAME_TAKEN)
    entries.check_exercises_exist(db, entries.exercise_ids(body.exercises))
    template.name = body.name
    entries.build(template, entries.TEMPLATE, body.exercises)
    db.add(template)
    db.commit()
    db.refresh(template)
    return entries.template_out(template)


@router.post(
    "/templates", response_model=s.TemplateOut, status_code=status.HTTP_201_CREATED
)
def create_template(
    body: s.TemplateIn,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    return _save(db, user, m.Template(user_id=user.id), body)


@router.put("/templates/{template_id}", response_model=s.TemplateOut)
def update_template(
    template_id: int,
    body: s.TemplateIn,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    template = owned(db, m.Template, template_id, user.id, "Template")
    return _save(db, user, template, body)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int, user: User = Depends(workout_user), db: Session = Depends(get_db)
):
    db.delete(owned(db, m.Template, template_id, user.id, "Template"))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/templates/{template_id}/copy",
    response_model=s.TemplateOut,
    status_code=status.HTTP_201_CREATED,
)
def copy_template(
    template_id: int,
    user_id: int | None = None,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    """Copy a template (usually another user's) into your own."""
    source = _viewable(db, user, template_id, user_id)
    copy = m.Template(
        user_id=user.id, name=free_name(db, m.Template, user.id, source.name)
    )
    entries.build(copy, entries.TEMPLATE, entries.entries_out(source))
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return entries.template_out(copy)
