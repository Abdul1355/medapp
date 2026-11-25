from datetime import datetime, date, time, timedelta, timezone
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, aliased
from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models import Appointment, AppointmentStatus, Role, User, Visit, AuditLog, Consultation, Clinic
from app.schemas import AppointmentCreate, AppointmentOut, ManagedAppointmentCreate, TransitionIn
from app.realtime import hub
from app.security import hash_password

router = APIRouter(prefix="/appointments", tags=["Appointments"])

def normalize_schedule(value: datetime) -> datetime:
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    if value <= datetime.now(timezone.utc).replace(tzinfo=None):
        raise HTTPException(422, "Appointment time must be in the future")
    return value

def ensure_slot_available(db: Session, clinic_id: int, doctor_id: int, scheduled_at: datetime):
    conflict = db.query(Appointment.id).filter(
        Appointment.clinic_id == clinic_id,
        Appointment.doctor_id == doctor_id,
        Appointment.scheduled_at == scheduled_at,
        Appointment.status != AppointmentStatus.COMPLETED,
    ).first()
    if conflict:
        raise HTTPException(409, "This doctor already has an appointment at that time")

@router.get("/manage")
def managed_appointments(day: date | None = None, status: AppointmentStatus | None = None,
                         search: str = Query(default="", max_length=100),
                         db: Session = Depends(get_db), user=Depends(require_roles(
                             Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST))):
    patient = aliased(User)
    doctor = aliased(User)
    q = (db.query(Appointment, patient.full_name, doctor.full_name)
         .join(patient, patient.id == Appointment.patient_id)
         .join(doctor, doctor.id == Appointment.doctor_id)
         .filter(Appointment.clinic_id == user.clinic_id))
    if day:
        start = datetime.combine(day, time.min)
        q = q.filter(Appointment.scheduled_at >= start, Appointment.scheduled_at < start + timedelta(days=1))
    if status:
        q = q.filter(Appointment.status == status)
    if search.strip():
        term = f"%{search.strip()}%"
        q = q.filter((patient.full_name.ilike(term)) | (doctor.full_name.ilike(term)) | (Appointment.reason.ilike(term)))
    rows = q.order_by(Appointment.scheduled_at.asc()).limit(500).all()
    return [{"id": a.id, "patient_id": a.patient_id, "patient_name": patient_name,
             "doctor_id": a.doctor_id, "doctor_name": doctor_name,
             "scheduled_at": a.scheduled_at.isoformat() + "Z", "reason": a.reason,
             "status": a.status.value} for a, patient_name, doctor_name in rows]

@router.post("/manage")
def create_managed_appointment(data: ManagedAppointmentCreate, db: Session = Depends(get_db),
                               user=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST))):
    if data.patient_id is None and not (data.patient_name and data.patient_name.strip()):
        raise HTTPException(422, "Enter a patient name or select a registered patient")
    patient = None
    if data.patient_id is not None:
        patient = db.query(User).filter_by(id=data.patient_id, clinic_id=user.clinic_id, role=Role.PATIENT, is_active=True).first()
    else:
        # Keep walk-ins attached to a patient row for visits, without creating a login account.
        guest_email = f"walkin-{uuid4().hex}@guest.invalid"
        patient = User(full_name=data.patient_name.strip(), email=guest_email,
                       password_hash=hash_password(uuid4().hex + uuid4().hex), role=Role.PATIENT,
                       is_active=False, clinic_id=user.clinic_id)
        db.add(patient); db.flush()
    doctor = db.query(User).filter_by(id=data.doctor_id, clinic_id=user.clinic_id, role=Role.DOCTOR, is_active=True).first()
    if not patient:
        raise HTTPException(404, "Active patient not found in this clinic")
    if not doctor:
        raise HTTPException(404, "Active doctor not found in this clinic")
    scheduled_at = normalize_schedule(data.scheduled_at)
    ensure_slot_available(db, user.clinic_id, doctor.id, scheduled_at)
    appointment = Appointment(clinic_id=user.clinic_id, patient_id=patient.id, doctor_id=doctor.id,
                              scheduled_at=scheduled_at, reason=data.reason.strip())
    db.add(appointment); db.flush()
    db.add(AuditLog(actor_id=user.id, action="scheduled", entity_type="appointment", entity_id=appointment.id))
    db.commit(); db.refresh(appointment)
    return {"id": appointment.id, "patient_id": patient.id, "patient_name": patient.full_name,
            "doctor_id": doctor.id, "doctor_name": doctor.full_name,
            "scheduled_at": appointment.scheduled_at.isoformat() + "Z", "reason": appointment.reason,
            "status": appointment.status.value}

@router.get("/doctor/dashboard")
def doctor_dashboard(day: date | None = None, db: Session = Depends(get_db),
                    user=Depends(require_roles(Role.DOCTOR))):
    selected_day = day or datetime.utcnow().date()
    start = datetime.combine(selected_day, time.min)
    end = start + timedelta(days=1)
    patient = aliased(User)
    rows = (db.query(Appointment, patient.full_name, Visit.id, Consultation.id)
            .join(patient, patient.id == Appointment.patient_id)
            .outerjoin(Visit, Visit.appointment_id == Appointment.id)
            .outerjoin(Consultation, Consultation.visit_id == Visit.id)
            .filter(Appointment.clinic_id == user.clinic_id,
                    Appointment.doctor_id == user.id,
                    Appointment.scheduled_at >= start,
                    Appointment.scheduled_at < end)
            .order_by(Appointment.scheduled_at.asc()).all())
    return [{"id": appointment.id, "patient_id": appointment.patient_id,
             "patient_name": patient_name, "doctor_id": appointment.doctor_id,
             "scheduled_at": appointment.scheduled_at.isoformat() + "Z",
             "reason": appointment.reason, "status": appointment.status.value,
             "visit_id": visit_id, "consultation_saved": consultation_id is not None}
            for appointment, patient_name, visit_id, consultation_id in rows]

@router.post("", response_model=AppointmentOut)
def book(data: AppointmentCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role != Role.PATIENT:
        raise HTTPException(403, "Only patients can self-book")
    doctor = db.query(User).filter_by(id=data.doctor_id, role=Role.DOCTOR, is_active=True).first()
    if not doctor:
        raise HTTPException(404, "Doctor not found")
    if data.clinic_id is not None and doctor.clinic_id != data.clinic_id:
        raise HTTPException(422, "Selected doctor belongs to another hospital")
    clinic = db.query(Clinic).filter_by(id=doctor.clinic_id, is_active=True).first()
    if not clinic:
        raise HTTPException(404, "Hospital not found")
    scheduled_at = normalize_schedule(data.scheduled_at)
    ensure_slot_available(db, doctor.clinic_id, doctor.id, scheduled_at)
    appointment = Appointment(patient_id=user.id, doctor_id=doctor.id,
        scheduled_at=scheduled_at, reason=data.reason, clinic_id=doctor.clinic_id)
    db.add(appointment); db.commit(); db.refresh(appointment)
    return appointment

@router.get("", response_model=list[AppointmentOut])
def list_appointments(db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(Appointment)
    if user.role == Role.PATIENT:
        q = q.filter(Appointment.patient_id == user.id)
    elif user.role == Role.DOCTOR:
        q = q.filter(Appointment.doctor_id == user.id)
    elif user.role in (Role.CLINIC_ADMIN, Role.RECEPTIONIST):
        q = q.filter(Appointment.clinic_id == user.clinic_id)
    elif user.role != Role.SUPER_ADMIN:
        raise HTTPException(403, "Not allowed")
    return q.order_by(Appointment.scheduled_at.desc()).all()

@router.post("/{appointment_id}/transition", response_model=AppointmentOut)
async def transition(appointment_id: int, data: TransitionIn, db: Session = Depends(get_db),
                     user=Depends(get_current_user)):
    appointment = db.query(Appointment).filter_by(id=appointment_id, clinic_id=user.clinic_id).first()
    if not appointment:
        raise HTTPException(404, "Appointment not found")
    if user.role == Role.DOCTOR and appointment.doctor_id != user.id:
        raise HTTPException(403, "You can only start visits assigned to you")
    allowed = {
        AppointmentStatus.SCHEDULED: {AppointmentStatus.WAITING_FOR_DOCTOR, AppointmentStatus.IN_PROGRESS},
        AppointmentStatus.WAITING_FOR_DOCTOR: {AppointmentStatus.IN_PROGRESS},
        AppointmentStatus.IN_PROGRESS: {AppointmentStatus.ROUTED_TO_LAB, AppointmentStatus.COMPLETED},
        AppointmentStatus.ROUTED_TO_LAB: {AppointmentStatus.COMPLETED},
        AppointmentStatus.COMPLETED: set()
    }
    if data.status not in allowed[appointment.status]:
        raise HTTPException(400, f"Invalid transition: {appointment.status} -> {data.status}")
    if data.status == AppointmentStatus.WAITING_FOR_DOCTOR and user.role not in (Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN):
        raise HTTPException(403, "Receptionist or admin required")
    if data.status in (AppointmentStatus.IN_PROGRESS, AppointmentStatus.ROUTED_TO_LAB, AppointmentStatus.COMPLETED) and user.role not in (Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN):
        raise HTTPException(403, "Doctor or admin required")
    appointment.status = data.status
    db.add(AuditLog(actor_id=user.id, action=f"status_changed_to_{data.status.value.lower()}",
                    entity_type="appointment", entity_id=appointment.id))
    visit = db.query(Visit).filter_by(appointment_id=appointment.id).first()
    if data.status in (AppointmentStatus.WAITING_FOR_DOCTOR, AppointmentStatus.IN_PROGRESS) and not visit:
        visit_count = db.query(Visit).filter_by(patient_id=appointment.patient_id).count()
        visit = Visit(appointment_id=appointment.id, patient_id=appointment.patient_id, visit_number=visit_count + 1)
        db.add(visit); db.flush()
    elif visit is None:
        visit = db.query(Visit).filter_by(appointment_id=appointment.id).first()
    db.commit(); db.refresh(appointment)
    await hub.broadcast(user.clinic_id, {"event": "appointment_updated", "appointment_id": appointment.id, "status": appointment.status.value})
    return {"id": appointment.id, "patient_id": appointment.patient_id, "doctor_id": appointment.doctor_id,
            "scheduled_at": appointment.scheduled_at, "reason": appointment.reason,
            "status": appointment.status, "visit_id": visit.id if visit else None}
