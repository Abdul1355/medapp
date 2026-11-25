from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user
from app.models import Appointment, AppointmentStatus, User, Role
from app.realtime import hub

router = APIRouter(tags=["Queue"])

@router.get("/queue/{clinic_id}")
def queue(clinic_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.clinic_id != clinic_id and user.role != Role.SUPER_ADMIN:
        raise HTTPException(403, "Clinic access denied")
    rows = db.query(Appointment).filter(
        Appointment.clinic_id == clinic_id,
        Appointment.status.in_([AppointmentStatus.WAITING_FOR_DOCTOR, AppointmentStatus.IN_PROGRESS])
    ).order_by(Appointment.scheduled_at).all()
    return [{"appointment_id": a.id, "patient_id": a.patient_id, "doctor_id": a.doctor_id,
             "scheduled_at": a.scheduled_at, "status": a.status.value} for a in rows]

@router.websocket("/ws/queue/{clinic_id}")
async def queue_socket(websocket: WebSocket, clinic_id: int):
    # Production: authenticate this WebSocket with a short-lived token and verify clinic membership.
    await hub.connect(clinic_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(clinic_id, websocket)
