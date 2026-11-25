from datetime import datetime, time, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, case
from app.database import get_db
from app.dependencies import require_roles
from app.models import User, Role, DoctorProfile, Appointment, AuditLog, Invoice, Clinic
from app.security import hash_password
from app.schemas import AppEmail

router = APIRouter(prefix="/admin", tags=["Administration"])
ADMIN_ROLES = (Role.SUPER_ADMIN, Role.CLINIC_ADMIN)

class ClinicCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    address: str = Field(default="", max_length=255)

@router.get("/clinics")
def list_clinics(db: Session = Depends(get_db),
                 actor=Depends(require_roles(*ADMIN_ROLES))):
    return [{"id": c.id, "name": c.name, "address": c.address, "is_active": c.is_active}
            for c in db.query(Clinic).filter(Clinic.is_active == True).order_by(Clinic.name.asc()).all()]

@router.post("/clinics")
def create_clinic(data: ClinicCreate, db: Session = Depends(get_db),
                  actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN))):
    if db.query(Clinic).filter(Clinic.name.ilike(data.name.strip())).first():
        raise HTTPException(409, "Hospital name already exists")
    clinic = Clinic(name=data.name.strip(), address=data.address.strip())
    db.add(clinic); db.commit(); db.refresh(clinic)
    return {"id": clinic.id, "name": clinic.name, "address": clinic.address, "is_active": clinic.is_active}

class StaffCreate(BaseModel):
    full_name: str
    email: AppEmail
    password: str = Field(min_length=10)
    role: str
    specialization: str = "General Medicine"
    clinic_id: int | None = None

class UserStatusUpdate(BaseModel):
    active: bool

@router.get("/users")
def users(db: Session = Depends(get_db), actor=Depends(require_roles(*ADMIN_ROLES))):
    rows = db.query(User).filter(User.clinic_id == actor.clinic_id,
                                 ~User.email.like("%@guest.invalid")).order_by(User.created_at.desc()).all()
    profiles = {p.user_id: p.specialization for p in db.query(DoctorProfile).filter(
        DoctorProfile.user_id.in_([u.id for u in rows])).all()} if rows else {}
    return [{"id": u.id, "name": u.full_name, "email": u.email, "role": u.role.value,
             "active": u.is_active, "created_at": u.created_at.isoformat(),
             "specialization": profiles.get(u.id)} for u in rows]

@router.get("/overview")
def overview(db: Session = Depends(get_db), actor=Depends(require_roles(*ADMIN_ROLES))):
    today = datetime.utcnow().date()
    start, end = datetime.combine(today, time.min), datetime.combine(today + timedelta(days=1), time.min)
    clinic_users = db.query(User).filter(User.clinic_id == actor.clinic_id)
    appointments = db.query(Appointment).filter(Appointment.clinic_id == actor.clinic_id)
    return {
        "patients": clinic_users.filter(User.role == Role.PATIENT, User.is_active.is_(True),
                                        ~User.email.like("%@guest.invalid")).count(),
        "active_staff": clinic_users.filter(User.role.in_([Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST,
            Role.SCANNING, Role.LABORATORY, Role.DELIVERY]), User.is_active.is_(True)).count(),
        "appointments_today": appointments.filter(Appointment.scheduled_at >= start, Appointment.scheduled_at < end).count(),
        "appointments_total": appointments.count(),
        "inactive_users": clinic_users.filter(User.is_active.is_(False),
                                                ~User.email.like("%@guest.invalid")).count(),
    }

@router.get("/revenue")
def revenue_summary(db: Session = Depends(get_db), actor=Depends(require_roles(*ADMIN_ROLES))):
    now = datetime.utcnow()
    week_start = datetime.combine(now.date() - timedelta(days=now.weekday()), time.min)
    month_start = datetime(now.year, now.month, 1)
    year_start = datetime(now.year, 1, 1)

    def totals(start):
        count, amount, paid, patients = (db.query(
            func.count(Invoice.id),
            func.coalesce(func.sum(Invoice.amount), 0),
            func.coalesce(func.sum(case((Invoice.status == "PAID", Invoice.amount), else_=0)), 0),
            func.count(func.distinct(Invoice.patient_id)),
        ).filter(Invoice.clinic_id == actor.clinic_id, Invoice.created_at >= start, Invoice.created_at <= now).one())
        return {"invoice_count": count, "billed_amount": float(amount),
                "paid_amount": float(paid), "patient_count": patients}

    return {"week": totals(week_start), "month": totals(month_start), "year": totals(year_start)}

@router.get("/audit-logs")
def audit_logs(limit: int = 20, db: Session = Depends(get_db), actor=Depends(require_roles(*ADMIN_ROLES))):
    limit = max(1, min(limit, 100))
    rows = (db.query(AuditLog, User.full_name).join(User, AuditLog.actor_id == User.id)
            .filter(User.clinic_id == actor.clinic_id).order_by(AuditLog.created_at.desc()).limit(limit).all())
    return [{"id": log.id, "actor": name, "action": log.action, "entity_type": log.entity_type,
             "entity_id": log.entity_id, "created_at": log.created_at.isoformat()} for log, name in rows]

@router.post("/staff")
def create_staff(data: StaffCreate, db: Session = Depends(get_db),
                 actor=Depends(require_roles(*ADMIN_ROLES))):
    try:
        role = Role(data.role)
    except ValueError:
        role = None
    if role not in (Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST,
                    Role.SCANNING, Role.LABORATORY, Role.DELIVERY):
        raise HTTPException(400, "This endpoint creates clinic staff only")
    clinic_id = actor.clinic_id
    if actor.role == Role.SUPER_ADMIN and data.clinic_id is not None:
        clinic = db.query(Clinic).filter_by(id=data.clinic_id, is_active=True).first()
        if not clinic:
            raise HTTPException(404, "Hospital not found")
        clinic_id = clinic.id
    elif not db.query(Clinic).filter_by(id=clinic_id, is_active=True).first():
        raise HTTPException(404, "Hospital not found")
    if db.query(User).filter(User.email.ilike(data.email.lower())).first():
        raise HTTPException(409, "Email already exists")
    user = User(full_name=data.full_name, email=data.email.lower(), password_hash=hash_password(data.password),
                role=role, clinic_id=clinic_id)
    db.add(user); db.flush()
    if role == Role.DOCTOR:
        db.add(DoctorProfile(user_id=user.id, specialization=data.specialization))
    db.add(AuditLog(actor_id=actor.id, action="created", entity_type="user", entity_id=user.id))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "An account already uses this email address") from error
    db.refresh(user)
    return {"id": user.id, "name": user.full_name, "role": user.role.value}

@router.patch("/users/{user_id}/status")
def update_user_status(user_id: int, data: UserStatusUpdate, db: Session = Depends(get_db),
                       actor=Depends(require_roles(*ADMIN_ROLES))):
    user = db.query(User).filter(User.id == user_id, User.clinic_id == actor.clinic_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if user.id == actor.id and not data.active:
        raise HTTPException(400, "You cannot deactivate your own account")
    user.is_active = data.active
    db.add(AuditLog(actor_id=actor.id, action="activated" if data.active else "deactivated",
                    entity_type="user", entity_id=user.id))
    db.commit()
    return {"id": user.id, "active": user.is_active}

