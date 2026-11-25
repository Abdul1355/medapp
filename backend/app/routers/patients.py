from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models import User, PatientProfile, Role, Appointment, Visit, Vital, Consultation, Prescription, Investigation, Invoice
from app.schemas import PatientCreate
from app.security import hash_password

router = APIRouter(prefix="/patients", tags=["Patients"])

@router.post("")
def create_patient(data: PatientCreate, db: Session = Depends(get_db),
                   actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST))):
    if db.query(User).filter(User.email == data.email.lower()).first():
        raise HTTPException(409, "Email already registered")
    user = User(full_name=data.full_name, email=data.email.lower(),
                password_hash=hash_password(data.password), role=Role.PATIENT,
                clinic_id=actor.clinic_id)
    db.add(user); db.flush()
    profile = PatientProfile(user_id=user.id, mobile=data.mobile, age=data.age,
        blood_group=data.blood_group, height_cm=data.height_cm, weight_kg=data.weight_kg,
        systolic_bp=data.systolic_bp, diastolic_bp=data.diastolic_bp)
    db.add(profile); db.commit(); db.refresh(user)
    return {"id": user.id, "full_name": user.full_name, "email": user.email}

@router.get("/directory")
def patient_directory(db: Session = Depends(get_db),
                      actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR))):
    query = db.query(User).filter(User.role == Role.PATIENT, User.clinic_id == actor.clinic_id)
    if actor.role == Role.DOCTOR:
        assigned_patient_ids = db.query(Appointment.patient_id).filter_by(
            clinic_id=actor.clinic_id, doctor_id=actor.id).distinct()
        query = query.filter(User.id.in_(assigned_patient_ids))
    rows = query.order_by(User.full_name).all()
    profiles = {profile.user_id: profile for profile in db.query(PatientProfile).filter(
        PatientProfile.user_id.in_([user.id for user in rows])).all()} if rows else {}
    return [{"id": user.id, "name": user.full_name,
             "email": "" if user.email.endswith("@guest.invalid") else user.email,
             "role": Role.PATIENT.value, "active": user.is_active,
             "mobile": profiles.get(user.id).mobile if profiles.get(user.id) else "",
             "age": profiles.get(user.id).age if profiles.get(user.id) else None,
             "blood_group": profiles.get(user.id).blood_group if profiles.get(user.id) else None,
             "systolic_bp": profiles.get(user.id).systolic_bp if profiles.get(user.id) else None,
             "diastolic_bp": profiles.get(user.id).diastolic_bp if profiles.get(user.id) else None,
             "created_at": user.created_at.isoformat(), "walk_in": user.email.endswith("@guest.invalid")}
            for user in rows]

@router.get("")
def list_patients(db: Session = Depends(get_db),
                  actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR))):
    query = db.query(User).filter(User.role == Role.PATIENT, User.clinic_id == actor.clinic_id,
                                  User.is_active.is_(True), ~User.email.like("%@guest.invalid"))
    if actor.role == Role.DOCTOR:
        assigned_patient_ids = db.query(Appointment.patient_id).filter_by(
            clinic_id=actor.clinic_id, doctor_id=actor.id).distinct()
        query = query.filter(User.id.in_(assigned_patient_ids))
    rows = query.order_by(User.full_name).all()
    return [{"id": u.id, "full_name": u.full_name, "email": u.email} for u in rows]

@router.get("/{patient_id:int}")
def patient_detail(patient_id: int, db: Session = Depends(get_db),
                   actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR))):
    patient = db.query(User).filter_by(id=patient_id, clinic_id=actor.clinic_id, role=Role.PATIENT).first()
    if not patient:
        raise HTTPException(404, "Patient not found")
    if actor.role == Role.DOCTOR and not db.query(Appointment.id).filter_by(
            patient_id=patient.id, doctor_id=actor.id, clinic_id=actor.clinic_id).first():
        raise HTTPException(404, "Patient not found")
    profile = db.query(PatientProfile).filter_by(user_id=patient.id).first()
    appointments = db.query(Appointment).filter_by(patient_id=patient.id, clinic_id=actor.clinic_id).order_by(Appointment.scheduled_at.desc()).all()
    visits = db.query(Visit).filter_by(patient_id=patient.id).order_by(Visit.created_at.desc()).all()
    visit_rows = []
    for visit in visits:
        consultation = db.query(Consultation).filter_by(visit_id=visit.id).first()
        visit_rows.append({"id": visit.id, "appointment_id": visit.appointment_id, "visit_number": visit.visit_number,
            "created_at": visit.created_at.isoformat(), "notes": visit.notes,
            "vitals": [{"weight_kg": v.weight_kg, "height_cm": v.height_cm, "systolic_bp": v.systolic_bp,
                        "diastolic_bp": v.diastolic_bp, "sugar_mg_dl": v.sugar_mg_dl} for v in db.query(Vital).filter_by(visit_id=visit.id).all()],
            "consultation": None if not consultation else {"symptoms": consultation.symptoms, "diagnosis": consultation.diagnosis,
                "clinical_notes": consultation.clinical_notes, "treatment_details": consultation.treatment_details,
                "doctor_advice": consultation.doctor_advice,
                "follow_up_date": consultation.follow_up_date.isoformat() if consultation.follow_up_date else None},
            "prescriptions": [{"instructions": p.instructions, "medicine_name": p.medicine_name, "dosage": p.dosage,
                "frequency": p.frequency, "duration": p.duration, "timing": p.timing}
                for p in db.query(Prescription).filter_by(visit_id=visit.id).all()],
            "investigations": [{"id": i.id, "test_name": i.test_name, "department": i.department, "status": i.status,
                "result": i.result or "", "report_filename": i.report_filename or ""}
                for i in db.query(Investigation).filter_by(visit_id=visit.id).all()],
            "invoices": [{"id": i.id, "description": i.description, "amount": i.amount, "status": i.status, "created_at": i.created_at.isoformat()} for i in db.query(Invoice).filter_by(patient_id=patient.id, clinic_id=actor.clinic_id, appointment_id=visit.appointment_id).order_by(Invoice.created_at.desc()).all()]})
    bmi = round(profile.weight_kg / ((profile.height_cm / 100) ** 2), 2) if profile and profile.height_cm and profile.weight_kg and profile.height_cm > 0 else None
    return {"id": patient.id, "full_name": patient.full_name, "email": patient.email,
        "mobile": profile.mobile if profile else "", "age": profile.age if profile else None,
        "blood_group": profile.blood_group if profile else None, "height_cm": profile.height_cm if profile else None,
        "weight_kg": profile.weight_kg if profile else None, "bmi": bmi,
        "systolic_bp": profile.systolic_bp if profile else None,
        "diastolic_bp": profile.diastolic_bp if profile else None,
        "appointments": [{"id": a.id, "doctor_id": a.doctor_id,
            "doctor": db.query(User.full_name).filter(User.id == a.doctor_id).scalar(),
            "scheduled_at": a.scheduled_at.isoformat() + "Z", "reason": a.reason, "status": a.status.value} for a in appointments],
        "visits": visit_rows,
        "invoices": [{"id": i.id, "appointment_id": i.appointment_id, "description": i.description,
            "amount": i.amount, "status": i.status, "created_at": i.created_at.isoformat()} for i in db.query(Invoice).filter_by(patient_id=patient.id, clinic_id=actor.clinic_id).order_by(Invoice.created_at.desc()).all()]}

@router.post("/{patient_id:int}/invoices")
def create_invoice(patient_id: int, data: dict, db: Session = Depends(get_db),
                   actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST))):
    patient = db.query(User).filter_by(id=patient_id, clinic_id=actor.clinic_id, role=Role.PATIENT).first()
    try:
        amount = float(data.get("amount", 0))
    except (TypeError, ValueError):
        amount = 0
    if not patient or amount <= 0:
        raise HTTPException(422, "A valid patient and positive invoice amount are required")
    appointment_id = data.get("appointment_id")
    visit_id = data.get("visit_id")
    visit = None
    if visit_id is not None:
        visit = db.query(Visit).join(Appointment, Appointment.id == Visit.appointment_id).filter(
            Visit.id == visit_id, Visit.patient_id == patient_id, Appointment.clinic_id == actor.clinic_id).first()
        if not visit:
            raise HTTPException(404, "Treatment visit not found")
        if appointment_id is not None and appointment_id != visit.appointment_id:
            raise HTTPException(422, "Invoice appointment must match the selected treatment")
        appointment_id = visit.appointment_id
    if appointment_id is not None and not db.query(Appointment).filter_by(id=appointment_id, patient_id=patient_id, clinic_id=actor.clinic_id).first():
        raise HTTPException(404, "Appointment not found")
    invoice = Invoice(clinic_id=actor.clinic_id, patient_id=patient_id, appointment_id=appointment_id,
        description=(str(data.get("description") or "Consultation")[:300]), amount=amount)
    db.add(invoice); db.commit(); db.refresh(invoice)
    return {"id": invoice.id, "appointment_id": invoice.appointment_id, "description": invoice.description,
        "amount": invoice.amount, "status": invoice.status, "created_at": invoice.created_at.isoformat()}

@router.get("/me")
def my_patient_profile(db: Session = Depends(get_db), actor=Depends(get_current_user)):
    if actor.role != Role.PATIENT:
        raise HTTPException(403, "Patient account required")
    profile = db.query(PatientProfile).filter_by(user_id=actor.id).first()
    if not profile:
        raise HTTPException(404, "Patient profile not found")
    bmi = None
    if profile.height_cm and profile.weight_kg and profile.height_cm > 0:
        bmi = round(profile.weight_kg / ((profile.height_cm / 100) ** 2), 2)
    appointments = db.query(Appointment).filter_by(patient_id=actor.id).order_by(Appointment.scheduled_at.desc()).all()
    visits = db.query(Visit).filter_by(patient_id=actor.id).order_by(Visit.created_at.desc()).all()
    visit_rows = []
    for visit in visits:
        consultation = db.query(Consultation).filter_by(visit_id=visit.id).first()
        visit_rows.append({"id": visit.id, "appointment_id": visit.appointment_id, "visit_number": visit.visit_number,
            "created_at": visit.created_at.isoformat(), "notes": visit.notes,
            "diagnosis": consultation.diagnosis if consultation else "",
            "symptoms": consultation.symptoms if consultation else "",
            "clinical_notes": consultation.clinical_notes if consultation else "",
            "treatment_details": consultation.treatment_details if consultation else "",
            "doctor_advice": consultation.doctor_advice if consultation else "",
            "follow_up_date": consultation.follow_up_date.isoformat() if consultation and consultation.follow_up_date else None,
            "prescriptions": [{"instructions": p.instructions, "medicine_name": p.medicine_name, "dosage": p.dosage,
                "frequency": p.frequency, "duration": p.duration, "timing": p.timing}
                for p in db.query(Prescription).filter_by(visit_id=visit.id).all()],
            "investigations": [{"id": i.id, "name": i.test_name, "department": i.department, "status": i.status,
                "result": i.result or "", "report_filename": i.report_filename or ""}
                for i in db.query(Investigation).filter_by(visit_id=visit.id).all()],
            "invoices": [{"id": i.id, "description": i.description, "amount": i.amount, "status": i.status,
                "created_at": i.created_at.isoformat()} for i in db.query(Invoice).filter_by(
                    patient_id=actor.id, clinic_id=actor.clinic_id, appointment_id=visit.appointment_id).order_by(Invoice.created_at.desc()).all()]})
    return {"id": actor.id, "full_name": actor.full_name, "email": actor.email,
            "mobile": profile.mobile, "age": profile.age, "blood_group": profile.blood_group,
            "height_cm": profile.height_cm, "weight_kg": profile.weight_kg, "bmi": bmi,
            "systolic_bp": profile.systolic_bp, "diastolic_bp": profile.diastolic_bp,
            "appointments": [{"id": a.id, "doctor_id": a.doctor_id,
                "doctor": db.query(User.full_name).filter(User.id == a.doctor_id).scalar(),
                "scheduled_at": a.scheduled_at.isoformat() + "Z", "reason": a.reason, "status": a.status.value}
                for a in appointments],
            "visits": visit_rows,
            "invoices": [{"id": i.id, "appointment_id": i.appointment_id, "description": i.description,
                "amount": i.amount, "status": i.status, "created_at": i.created_at.isoformat()}
                for i in db.query(Invoice).filter_by(patient_id=actor.id, clinic_id=actor.clinic_id).order_by(Invoice.created_at.desc()).all()]}
