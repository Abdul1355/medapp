from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import require_roles
from app.models import User, DoctorProfile, Role, Clinic

router = APIRouter(prefix="/doctors", tags=["Doctors"])

@router.get("")
def list_doctors(db: Session = Depends(get_db),
                 actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR))):
    query = db.query(DoctorProfile).join(User).join(Clinic, Clinic.id == User.clinic_id).filter(
        User.is_active == True, Clinic.is_active == True)
    if actor.role != Role.PATIENT:
        query = query.filter(User.clinic_id == actor.clinic_id)
    rows = query.all()
    return [{"id": r.user_id, "name": r.user.full_name, "specialization": r.specialization,
             "consultation_fee": r.consultation_fee, "clinic_id": r.user.clinic_id,
             "clinic_name": db.query(Clinic.name).filter(Clinic.id == r.user.clinic_id).scalar() or "Hospital"} for r in rows]


@router.get("/clinics")
def list_hospitals(db: Session = Depends(get_db),
                   actor=Depends(require_roles(Role.PATIENT, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST))):
    clinics = db.query(Clinic).filter(Clinic.is_active == True).order_by(Clinic.name.asc()).all()
    result = []
    for clinic in clinics:
        doctor_count = db.query(User.id).filter(User.role == Role.DOCTOR, User.clinic_id == clinic.id, User.is_active == True).count()
        scanning_count = db.query(User.id).filter(User.role == Role.SCANNING, User.clinic_id == clinic.id, User.is_active == True).count()
        laboratory_count = db.query(User.id).filter(User.role == Role.LABORATORY, User.clinic_id == clinic.id, User.is_active == True).count()
        result.append({"id": clinic.id, "name": clinic.name, "address": clinic.address,
                       "doctor_count": doctor_count, "scanning_available": scanning_count > 0,
                       "laboratory_available": laboratory_count > 0})
    return result
