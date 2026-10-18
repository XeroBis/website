"""`/api/cards/convert`: the decklist converter. Read-only."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import User
from domains.cards import decklists, display
from domains.cards import schemas as s
from domains.cards.access import cards_user

router = APIRouter(prefix="/convert", tags=["cards"])


@router.post("/decklist", response_model=s.DecklistConvertOut)
def convert_decklist(
    body: s.DecklistConvert,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Detect the pasted format, match every line against the catalog and
    render the list in the other format (English; unmatched lines keep their
    parsed name). Text in neither format converts to nothing."""
    detected, lines = decklists.parse(db, body.text)
    if detected is None:
        return s.DecklistConvertOut(detected_format=None, converted_text="", entries=[])
    target = "cardmarket" if detected == "tcgplayer" else "tcgplayer"
    language = user.language
    entries = []
    for line in lines:
        card = line.card
        if card is None:
            entries.append(
                s.DecklistConvertEntry(
                    quantity=line.quantity, matched=False, name=line.name
                )
            )
            continue
        entries.append(
            s.DecklistConvertEntry(
                quantity=line.quantity,
                matched=True,
                name=display.card_name(card, language),
                set_name=display.set_name(card.set_name, card.set_name_fr, language),
                set_code=card.set_code,
                card_number=card.card_number,
                image_path=display.image_path(card, language),
                catalog_id=card.id,
            )
        )
    return s.DecklistConvertOut(
        detected_format=detected,
        converted_text=decklists.render(lines, target, body.include_sets),
        entries=entries,
    )
