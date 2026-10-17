import re
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
)

MAX_TAGS = 10

_HTTPS_URL = re.compile(r"^https://[^\s/<>\"']+(/[^\s<>\"']*)?$")


def _blank_to_none(value: object) -> object:
    if isinstance(value, str) and not value.strip():
        return None
    return value.strip() if isinstance(value, str) else value


def _check_https_url(value: str | None) -> str | None:
    if value is not None and not _HTTPS_URL.match(value):
        raise ValueError("must be an https:// URL")
    return value


def _dedupe_case_insensitive(names: list[str]) -> list[str]:
    seen: set[str] = set()
    unique = []
    for name in names:
        if name.lower() not in seen:
            seen.add(name.lower())
            unique.append(name)
    return unique


Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
Description = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)
]
TagName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)
]
RepoUrl = Annotated[
    Annotated[str, StringConstraints(max_length=300)] | None,
    BeforeValidator(_blank_to_none),
    AfterValidator(_check_https_url),
]


class ProjectIn(BaseModel):
    """Create and full update (PUT) body."""

    name: Name
    description_fr: Description
    description_en: Description
    repo_url: RepoUrl = None
    featured: bool = False
    position: int = Field(default=0, ge=0, le=10_000)
    tags: Annotated[
        list[TagName],
        Field(default_factory=list, max_length=MAX_TAGS),
        AfterValidator(_dedupe_case_insensitive),
    ]


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description_fr: str
    description_en: str
    repo_url: str | None
    featured: bool
    position: int
    # Tag rows → their names (already sorted by the relationship).
    tags: Annotated[
        list[str],
        BeforeValidator(lambda tags: [getattr(t, "name", t) for t in tags]),
    ]
