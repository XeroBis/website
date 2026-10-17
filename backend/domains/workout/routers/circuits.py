"""Saved circuits: per user, private."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import User
from domains.workout import entries
from domains.workout import models as m
from domains.workout import schemas as s
from domains.workout.access import owned, workout_user

router = APIRouter(tags=["workout"])

NAME_TAKEN = "You already have a circuit with this name"


def user_circuits(user_id: int):
    return (
        select(m.SavedCircuit)
        .where(m.SavedCircuit.user_id == user_id)
        .order_by(func.lower(m.SavedCircuit.name))
    )


@router.get("/circuits", response_model=list[s.SavedCircuitOut])
def list_circuits(user: User = Depends(workout_user), db: Session = Depends(get_db)):
    return [entries.saved_circuit_out(c) for c in db.scalars(user_circuits(user.id))]


@router.get("/circuits/{circuit_id}", response_model=s.SavedCircuitOut)
def get_circuit(
    circuit_id: int, user: User = Depends(workout_user), db: Session = Depends(get_db)
):
    circuit = owned(db, m.SavedCircuit, circuit_id, user.id, "Circuit")
    return entries.saved_circuit_out(circuit)


def _save(db: Session, user: User, circuit: m.SavedCircuit, body: s.SavedCircuitIn):
    if entries.name_taken(db, m.SavedCircuit, user.id, body.name, circuit.id):
        raise HTTPException(status.HTTP_409_CONFLICT, NAME_TAKEN)
    entries.check_exercises_exist(db, {e.exercise_id for e in body.exercises})
    circuit.name = body.name
    circuit.duration_minutes = body.duration_minutes
    circuit.rounds = body.rounds
    entries.build_members(circuit, entries.SAVED_CIRCUIT, body.exercises)
    db.add(circuit)
    db.commit()
    db.refresh(circuit)
    return entries.saved_circuit_out(circuit)


@router.post(
    "/circuits", response_model=s.SavedCircuitOut, status_code=status.HTTP_201_CREATED
)
def create_circuit(
    body: s.SavedCircuitIn,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    return _save(db, user, m.SavedCircuit(user_id=user.id), body)


@router.put("/circuits/{circuit_id}", response_model=s.SavedCircuitOut)
def update_circuit(
    circuit_id: int,
    body: s.SavedCircuitIn,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    circuit = owned(db, m.SavedCircuit, circuit_id, user.id, "Circuit")
    return _save(db, user, circuit, body)


@router.delete("/circuits/{circuit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_circuit(
    circuit_id: int, user: User = Depends(workout_user), db: Session = Depends(get_db)
):
    db.delete(owned(db, m.SavedCircuit, circuit_id, user.id, "Circuit"))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
