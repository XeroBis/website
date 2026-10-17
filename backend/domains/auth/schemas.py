from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, StringConstraints

Email = Annotated[EmailStr, AfterValidator(str.lower)]
Pseudo = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
]
Language = Literal["en", "fr"]

PASSWORD_MIN_LENGTH = 12


class RegisterIn(BaseModel):
    email: Email
    password: Annotated[str, StringConstraints(min_length=PASSWORD_MIN_LENGTH)]
    pseudo: Pseudo


class LoginIn(BaseModel):
    # Not EmailStr: a malformed email is just a failed login (401), not a 422.
    email: Annotated[str, AfterValidator(str.lower)]
    password: str


class PseudoUpdate(BaseModel):
    pseudo: Pseudo


class LanguageUpdate(BaseModel):
    language: Language


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    pseudo: str
    language: Language
    is_admin: bool
