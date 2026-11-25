from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text
from app.core.config import settings
from app.database import Base, engine
from app.routers import auth, patients, doctors, appointments, clinical, admin, queue, orders

Base.metadata.create_all(bind=engine)

from sqlalchemy.orm import Session
from app.models import Clinic

with Session(engine) as session:
    if session.query(Clinic).filter_by(id=1).first() is None:
        session.add(Clinic(id=1, name="Main Hospital", address=""))
        session.commit()

# Add staff role values to existing PostgreSQL enum types during upgrades.
if engine.dialect.name == "postgresql":
    with engine.begin() as connection:
        for role_value in ("SCANNING", "LABORATORY", "DELIVERY"):
            connection.execute(text(f'ALTER TYPE "role" ADD VALUE IF NOT EXISTS \'{role_value}\''))

# Lightweight startup migration for existing databases. This adds the profile
# fields without requiring a separate migration step for local installations.
with engine.begin() as connection:
    existing_columns = {column["name"] for column in inspect(connection).get_columns("patient_profiles")}
    if "systolic_bp" not in existing_columns:
        connection.execute(text("ALTER TABLE patient_profiles ADD COLUMN systolic_bp INTEGER"))
    if "diastolic_bp" not in existing_columns:
        connection.execute(text("ALTER TABLE patient_profiles ADD COLUMN diastolic_bp INTEGER"))

with engine.begin() as connection:
    consultation_columns = {column["name"] for column in inspect(connection).get_columns("consultations")}
    consultation_migrations = {
        "treatment_details": "TEXT",
        "doctor_advice": "TEXT",
        "follow_up_date": "DATE",
    }
    for column, column_type in consultation_migrations.items():
        if column not in consultation_columns:
            connection.execute(text(f"ALTER TABLE consultations ADD COLUMN {column} {column_type}"))

    prescription_columns = {column["name"] for column in inspect(connection).get_columns("prescriptions")}
    prescription_migrations = {
        "medicine_name": "VARCHAR(180)",
        "dosage": "VARCHAR(100)",
        "frequency": "VARCHAR(100)",
        "duration": "VARCHAR(100)",
        "timing": "VARCHAR(40)",
    }
    for column, column_type in prescription_migrations.items():
        if column not in prescription_columns:
            connection.execute(text(f"ALTER TABLE prescriptions ADD COLUMN {column} {column_type}"))

    investigation_columns = {column["name"] for column in inspect(connection).get_columns("investigations")}
    if "result" not in investigation_columns:
        connection.execute(text("ALTER TABLE investigations ADD COLUMN result TEXT DEFAULT ''"))
    if "report_pdf" not in investigation_columns:
        binary_type = "BYTEA" if engine.dialect.name == "postgresql" else "BLOB"
        connection.execute(text(f"ALTER TABLE investigations ADD COLUMN report_pdf {binary_type}"))
    if "report_filename" not in investigation_columns:
        connection.execute(text("ALTER TABLE investigations ADD COLUMN report_filename VARCHAR(255) DEFAULT ''"))

app = FastAPI(title="Medical Management System API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins,
                   allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?",
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

for router in (auth.router, patients.router, doctors.router, appointments.router,
               clinical.router, admin.router, queue.router, orders.router):
    app.include_router(router, prefix="/api/v1")

@app.get("/")
def root():
    return {"name": "Medical Management System", "docs": "/docs"}

@app.get("/health")
def health():
    return {"status": "ok"}
