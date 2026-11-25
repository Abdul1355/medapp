from datetime import datetime, date
from enum import Enum
from sqlalchemy import String, Integer, Float, DateTime, Date, ForeignKey, Text, Enum as SAEnum, Boolean, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

class Role(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    CLINIC_ADMIN = "CLINIC_ADMIN"
    PATIENT = "PATIENT"
    RECEPTIONIST = "RECEPTIONIST"
    DOCTOR = "DOCTOR"
    SCANNING = "SCANNING"
    LABORATORY = "LABORATORY"
    DELIVERY = "DELIVERY"

class Clinic(Base):
    __tablename__ = "clinics"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(180), unique=True)
    address: Mapped[str] = mapped_column(String(255), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class AppointmentStatus(str, Enum):
    SCHEDULED = "SCHEDULED"
    WAITING_FOR_DOCTOR = "WAITING_FOR_DOCTOR"
    IN_PROGRESS = "IN_PROGRESS"
    ROUTED_TO_LAB = "ROUTED_TO_LAB"
    COMPLETED = "COMPLETED"

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(SAEnum(Role), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    clinic_id: Mapped[int] = mapped_column(Integer, default=1, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class PatientProfile(Base):
    __tablename__ = "patient_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    mobile: Mapped[str] = mapped_column(String(30), default="")
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    blood_group: Mapped[str | None] = mapped_column(String(8), nullable=True)
    systolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diastolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    user: Mapped[User] = relationship()

class DoctorProfile(Base):
    __tablename__ = "doctor_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    specialization: Mapped[str] = mapped_column(String(120), default="General Medicine")
    registration_number: Mapped[str] = mapped_column(String(100), default="")
    consultation_fee: Mapped[float] = mapped_column(Float, default=0)
    user: Mapped[User] = relationship()

class Appointment(Base):
    __tablename__ = "appointments"
    id: Mapped[int] = mapped_column(primary_key=True)
    clinic_id: Mapped[int] = mapped_column(Integer, default=1, index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    reason: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[AppointmentStatus] = mapped_column(SAEnum(AppointmentStatus), default=AppointmentStatus.SCHEDULED)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Visit(Base):
    __tablename__ = "visits"
    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("appointments.id"), index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    visit_number: Mapped[int] = mapped_column(Integer, default=1)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Vital(Base):
    __tablename__ = "vitals"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), index=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    systolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diastolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sugar_mg_dl: Mapped[float | None] = mapped_column(Float, nullable=True)
    recorded_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Consultation(Base):
    __tablename__ = "consultations"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), unique=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    symptoms: Mapped[str] = mapped_column(Text, default="")
    diagnosis: Mapped[str] = mapped_column(Text, default="")
    clinical_notes: Mapped[str] = mapped_column(Text, default="")
    treatment_details: Mapped[str] = mapped_column(Text, default="")
    doctor_advice: Mapped[str] = mapped_column(Text, default="")
    follow_up_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Prescription(Base):
    __tablename__ = "prescriptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    instructions: Mapped[str] = mapped_column(Text, default="")
    medicine_name: Mapped[str] = mapped_column(String(180), default="")
    dosage: Mapped[str] = mapped_column(String(100), default="")
    frequency: Mapped[str] = mapped_column(String(100), default="")
    duration: Mapped[str] = mapped_column(String(100), default="")
    timing: Mapped[str] = mapped_column(String(40), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Investigation(Base):
    __tablename__ = "investigations"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    test_name: Mapped[str] = mapped_column(String(180))
    department: Mapped[str] = mapped_column(String(120), default="Laboratory")
    status: Mapped[str] = mapped_column(String(40), default="ORDERED")
    result: Mapped[str] = mapped_column(Text, default="")
    report_pdf: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    report_filename: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[int] = mapped_column(primary_key=True)
    clinic_id: Mapped[int] = mapped_column(Integer, index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    appointment_id: Mapped[int | None] = mapped_column(ForeignKey("appointments.id"), nullable=True)
    description: Mapped[str] = mapped_column(String(300), default="Consultation")
    amount: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(24), default="UNPAID")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class MedicineOrder(Base):
    __tablename__ = "medicine_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    clinic_id: Mapped[int] = mapped_column(Integer, index=True)
    delivery_address: Mapped[str] = mapped_column(Text)
    total_amount: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(24), default="PLACED")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class MedicineOrderItem(Base):
    __tablename__ = "medicine_order_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("medicine_orders.id"), index=True)
    product_id: Mapped[str] = mapped_column(String(80))
    product_name: Mapped[str] = mapped_column(String(180))
    unit_price: Mapped[float] = mapped_column(Float)
    quantity: Mapped[int] = mapped_column(Integer)
    line_total: Mapped[float] = mapped_column(Float)

class MedicineOrderPayment(Base):
    __tablename__ = "medicine_order_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("medicine_orders.id"), index=True)
    amount: Mapped[float] = mapped_column(Float)
    method: Mapped[str] = mapped_column(String(20))
    received_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class MedicineProduct(Base):
    __tablename__ = "medicine_products"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_key: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    clinic_id: Mapped[int] = mapped_column(Integer, index=True)
    name: Mapped[str] = mapped_column(String(180))
    category: Mapped[str] = mapped_column(String(80), default="Medicine")
    description: Mapped[str] = mapped_column(String(500), default="")
    unit_price: Mapped[float] = mapped_column(Float)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(120))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
