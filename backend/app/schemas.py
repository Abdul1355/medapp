from datetime import datetime
import re
from typing import Annotated
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field
from app.models import Role, AppointmentStatus


def validate_app_email(value):
    """Accept normal email addresses and development .local addresses."""
    address = str(value).strip().lower()
    if len(address) > 254 or address.count("@") != 1:
        raise ValueError("Enter a valid email address")
    local, domain = address.rsplit("@", 1)
    if not local or len(local) > 64 or local.startswith(".") or local.endswith(".") or ".." in local:
        raise ValueError("Enter a valid email address")
    if not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+", local):
        raise ValueError("Enter a valid email address")
    if not domain or len(domain) > 253 or any(character.isspace() for character in domain):
        raise ValueError("Enter a valid email address")
    labels = domain.split(".")
    if domain.lower().endswith(".local"):
        valid_domain = len(labels) >= 2
    else:
        valid_domain = len(labels) >= 2
    if not valid_domain:
        raise ValueError("Enter a valid email address")
    if any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels):
        raise ValueError("Enter a valid email address")
    if not re.fullmatch(r"[a-z]{2,63}|xn--[a-z0-9-]+", labels[-1]):
        raise ValueError("Enter a valid email address")
    return address


AppEmail = Annotated[str, BeforeValidator(validate_app_email)]

class LoginIn(BaseModel):
    email: AppEmail
    password: str

class UserOut(BaseModel):
    id: int
    full_name: str
    email: AppEmail
    role: Role
    model_config = ConfigDict(from_attributes=True)

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

class PatientCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    email: AppEmail
    password: str = Field(min_length=10)
    mobile: str = ""
    age: int | None = None
    blood_group: str | None = None
    systolic_bp: int | None = None
    diastolic_bp: int | None = None
    height_cm: float | None = None
    weight_kg: float | None = None

class AppointmentCreate(BaseModel):
    clinic_id: int | None = None
    doctor_id: int
    scheduled_at: datetime
    reason: str = ""

class ManagedAppointmentCreate(BaseModel):
    patient_id: int | None = None
    patient_name: str | None = Field(default=None, max_length=160)
    doctor_id: int
    scheduled_at: datetime
    reason: str = Field(default="", max_length=500)

class AppointmentOut(BaseModel):
    id: int
    patient_id: int
    doctor_id: int
    scheduled_at: datetime
    reason: str
    status: AppointmentStatus
    visit_id: int | None = None
    model_config = ConfigDict(from_attributes=True)

class TransitionIn(BaseModel):
    status: AppointmentStatus

class VitalsIn(BaseModel):
    weight_kg: float | None = None
    height_cm: float | None = None
    systolic_bp: int | None = None
    diastolic_bp: int | None = None
    sugar_mg_dl: float | None = None

class ConsultationIn(BaseModel):
    visit_id: int
    symptoms: str = ""
    diagnosis: str = ""
    clinical_notes: str = ""
    treatment_details: str = ""
    doctor_advice: str = ""
    follow_up_date: datetime | None = None
    medicine_name: str = ""
    medicine_dosage: str = ""
    medicine_frequency: str = ""
    medicine_duration: str = ""
    medicine_timing: str = ""

class PrescriptionIn(BaseModel):
    visit_id: int
    instructions: str = ""

class InvestigationIn(BaseModel):
    visit_id: int
    test_name: str
    department: str = "Laboratory"

class InvestigationStatusIn(BaseModel):
    status: str
    result: str = ""
    result: str = ""
