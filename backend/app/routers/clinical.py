from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from pathlib import PurePath
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func
from app.database import get_db
from app.dependencies import get_current_user
from app.models import Role, User, PatientProfile, Visit, Vital, Consultation, Prescription, Investigation, Appointment
from app.schemas import VitalsIn, ConsultationIn, PrescriptionIn, InvestigationIn, InvestigationStatusIn

router = APIRouter(tags=["Clinical Records"])

def require_visit(db, visit_id, clinic_id):
    visit = (db.query(Visit)
             .join(Appointment, Appointment.id == Visit.appointment_id)
             .filter(Visit.id == visit_id, Appointment.clinic_id == clinic_id)
             .first())
    if not visit:
        raise HTTPException(404, "Visit not found")
    return visit

@router.post("/visits/{visit_id}/vitals")
def add_vitals(visit_id: int, data: VitalsIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role not in (Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN):
        raise HTTPException(403, "Receptionist or admin required")
    visit = require_visit(db, visit_id, user.clinic_id)
    row = Vital(visit_id=visit.id, recorded_by=user.id, **data.model_dump())
    db.add(row); db.commit(); db.refresh(row)
    return {"id": row.id, "visit_id": row.visit_id}

@router.post("/consultations")
def create_consultation(data: ConsultationIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role not in (Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN):
        raise HTTPException(403, "Doctor or admin required")
    visit = require_visit(db, data.visit_id, user.clinic_id)
    appointment = db.query(Appointment).filter_by(id=visit.appointment_id, clinic_id=user.clinic_id).first()
    if user.role == Role.DOCTOR and (not appointment or appointment.doctor_id != user.id):
        raise HTTPException(403, "You can only save treatments for your assigned patients")
    values = data.model_dump()
    medicine_name = values.pop("medicine_name", "").strip()
    medicine_dosage = values.pop("medicine_dosage", "").strip()
    medicine_frequency = values.pop("medicine_frequency", "").strip()
    medicine_duration = values.pop("medicine_duration", "").strip()
    medicine_timing = values.pop("medicine_timing", "").strip()
    follow_up = values.pop("follow_up_date", None)
    values["follow_up_date"] = follow_up.date() if hasattr(follow_up, "date") else follow_up
    row = db.query(Consultation).filter_by(visit_id=visit.id).first()
    if row:
        for key, value in values.items():
            setattr(row, key, value)
        row.doctor_id = user.id
    else:
        row = Consultation(doctor_id=user.id, visit_id=visit.id, **values)
        db.add(row)

    existing_prescriptions = db.query(Prescription).filter_by(visit_id=visit.id).all()
    for prescription in existing_prescriptions:
        db.delete(prescription)
    if medicine_name:
        instruction_parts = [
            medicine_dosage and f"Dosage: {medicine_dosage}",
            medicine_frequency and f"Frequency: {medicine_frequency}",
            medicine_duration and f"Duration: {medicine_duration}",
            medicine_timing and f"{medicine_timing} food",
        ]
        instructions = " · ".join(part for part in instruction_parts if part)
        db.add(Prescription(
            visit_id=visit.id, doctor_id=user.id, medicine_name=medicine_name,
            dosage=medicine_dosage, frequency=medicine_frequency,
            duration=medicine_duration, timing=medicine_timing,
            instructions=instructions or medicine_name,
        ))
    db.commit(); db.refresh(row)
    return {"id": row.id, "visit_id": row.visit_id}

@router.post("/prescriptions")
def create_prescription(data: PrescriptionIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role not in (Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN):
        raise HTTPException(403, "Doctor or admin required")
    require_visit(db, data.visit_id, user.clinic_id)
    row = Prescription(doctor_id=user.id, **data.model_dump())
    db.add(row); db.commit(); db.refresh(row)
    return {"id": row.id, "visit_id": row.visit_id}

@router.post("/investigations")
def create_investigation(data: InvestigationIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role not in (Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN):
        raise HTTPException(403, "Doctor or admin required")
    visit = require_visit(db, data.visit_id, user.clinic_id)
    if user.role == Role.DOCTOR:
        appointment = db.query(Appointment).filter_by(id=visit.appointment_id, clinic_id=user.clinic_id).first()
        if not appointment or appointment.doctor_id != user.id:
            raise HTTPException(403, "You can only request tests for your assigned patients")
    row = Investigation(doctor_id=user.id, **data.model_dump())
    db.add(row); db.commit(); db.refresh(row)
    return {"id": row.id, "visit_id": row.visit_id, "status": row.status}


@router.get("/investigations/worklist")
def investigation_worklist(db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role not in (Role.SCANNING, Role.LABORATORY):
        raise HTTPException(403, "Scanning or laboratory staff required")
    doctor = aliased(User)
    query = (db.query(Investigation, Visit, Appointment, User, PatientProfile.age,
                      PatientProfile.mobile, Consultation.diagnosis, Consultation.symptoms,
                      doctor.full_name)
             .join(Visit, Visit.id == Investigation.visit_id)
             .join(Appointment, Appointment.id == Visit.appointment_id)
             .join(User, User.id == Visit.patient_id)
             .outerjoin(PatientProfile, PatientProfile.user_id == User.id)
             .outerjoin(Consultation, Consultation.visit_id == Visit.id)
             .join(doctor, doctor.id == Investigation.doctor_id)
             .filter(Appointment.clinic_id == user.clinic_id))
    department = func.lower(Investigation.department)
    if user.role == Role.SCANNING:
        query = query.filter((department.like("%scan%")) | (department.like("%radiolog%")) | (department.like("%imag%")))
    else:
        query = query.filter((department.like("%lab%")) | (department.like("%patholog%")))
    rows = query.order_by(Investigation.created_at.desc()).limit(500).all()
    return [{"id": investigation.id, "visit_id": visit.id, "appointment_id": appointment.id,
             "patient_id": patient.id, "patient_number": f"P{patient.id:05d}",
             "patient_name": patient.full_name, "patient_age": age, "patient_mobile": mobile or "",
             "diagnosis": diagnosis or "", "symptoms": symptoms or "", "requested_by": doctor_name,
             "test_name": investigation.test_name,
             "department": investigation.department, "status": investigation.status,
             "result": investigation.result or "",
             "report_filename": investigation.report_filename or "",
             "created_at": investigation.created_at.isoformat()}
            for investigation, visit, appointment, patient, age, mobile, diagnosis, symptoms, doctor_name in rows]


@router.patch("/investigations/{investigation_id}/status")
def update_investigation_status(investigation_id: int, data: InvestigationStatusIn, db: Session = Depends(get_db),
                                user=Depends(get_current_user)):
    if user.role not in (Role.SCANNING, Role.LABORATORY):
        raise HTTPException(403, "Scanning or laboratory staff required")
    row = (db.query(Investigation).join(Visit, Visit.id == Investigation.visit_id)
           .join(Appointment, Appointment.id == Visit.appointment_id)
           .filter(Investigation.id == investigation_id, Appointment.clinic_id == user.clinic_id).first())
    if not row:
        raise HTTPException(404, "Investigation not found")
    department = row.department.lower()
    matches_role = ((user.role == Role.SCANNING and any(term in department for term in ("scan", "radiolog", "imag")))
                    or (user.role == Role.LABORATORY and any(term in department for term in ("lab", "patholog"))))
    if not matches_role:
        raise HTTPException(403, "This investigation is assigned to another department")
    transitions = {"ORDERED": "IN_PROGRESS", "IN_PROGRESS": "COMPLETED"}
    next_status = transitions.get(row.status)
    if not next_status or data.status != next_status:
        raise HTTPException(409, f"Investigation cannot move from {row.status} to {transitions.get(row.status, 'a new status')}")
    if next_status == "COMPLETED" and not data.result.strip():
        raise HTTPException(422, "Enter the scan or laboratory findings before completing this request")
    row.status = next_status
    if data.result.strip():
        row.result = data.result.strip()
    db.commit()
    return {"id": row.id, "status": row.status}


def get_investigation_for_clinic(db, investigation_id, clinic_id):
    row = (db.query(Investigation).join(Visit, Visit.id == Investigation.visit_id)
           .join(Appointment, Appointment.id == Visit.appointment_id)
           .filter(Investigation.id == investigation_id, Appointment.clinic_id == clinic_id).first())
    if not row:
        raise HTTPException(404, "Investigation not found")
    return row


def ensure_report_access(row, db, user):
    department = row.department.lower()
    if user.role in (Role.SCANNING, Role.LABORATORY):
        matches_role = ((user.role == Role.SCANNING and any(term in department for term in ("scan", "radiolog", "imag")))
                        or (user.role == Role.LABORATORY and any(term in department for term in ("lab", "patholog"))))
        if not matches_role:
            raise HTTPException(403, "This investigation is assigned to another department")
        return
    visit = db.query(Visit).filter_by(id=row.visit_id).first()
    appointment = db.query(Appointment).filter_by(id=visit.appointment_id).first() if visit else None
    if user.role == Role.PATIENT and visit and visit.patient_id == user.id:
        return
    if user.role == Role.DOCTOR and appointment and appointment.doctor_id == user.id:
        return
    if user.role in (Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.RECEPTIONIST):
        return
    raise HTTPException(403, "You cannot access this investigation report")


@router.post("/investigations/{investigation_id}/report")
async def upload_investigation_report(investigation_id: int, file: UploadFile = File(...),
                                      db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role not in (Role.SCANNING, Role.LABORATORY):
        raise HTTPException(403, "Scanning or laboratory staff required")
    row = get_investigation_for_clinic(db, investigation_id, user.clinic_id)
    ensure_report_access(row, db, user)
    filename = PurePath(file.filename or "report.pdf").name
    if not filename.lower().endswith(".pdf") or (file.content_type and file.content_type not in ("application/pdf", "application/octet-stream")):
        raise HTTPException(415, "Upload a PDF file")
    contents = await file.read(15 * 1024 * 1024 + 1)
    if len(contents) > 15 * 1024 * 1024:
        raise HTTPException(413, "PDF must be 15 MB or smaller")
    if not contents.startswith(b"%PDF-"):
        raise HTTPException(415, "The selected file is not a valid PDF")
    row.report_pdf = contents
    row.report_filename = filename[:255]
    db.commit()
    return {"id": row.id, "report_filename": row.report_filename}


@router.get("/investigations/{investigation_id}/report")
def get_investigation_report(investigation_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = get_investigation_for_clinic(db, investigation_id, user.clinic_id)
    ensure_report_access(row, db, user)
    if not row.report_pdf:
        raise HTTPException(404, "No PDF report has been uploaded")
    filename = (row.report_filename or "report.pdf").replace('"', "")
    return Response(content=row.report_pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{filename}"', "X-Content-Type-Options": "nosniff"})
