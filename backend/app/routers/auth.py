from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import User, PatientProfile, Role
from app.schemas import AppEmail, LoginIn, TokenOut, UserOut, PatientCreate
from app.security import verify_password, create_access_token, hash_password
from app.dependencies import get_current_user
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["Authentication"])

class AdminSetupIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    email: AppEmail
    password: str = Field(min_length=10)

def authenticate(db, email, password):
    user = db.query(User).filter(User.email == email.lower()).first()
    if not user or not verify_password(password, user.password_hash):
        return None
    return user

@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = authenticate(db, data.email, data.password)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return {"access_token": create_access_token(str(user.id)), "user": user}

@router.post("/register", response_model=TokenOut)
def register_patient(data: PatientCreate, db: Session = Depends(get_db)):
    email = data.email.lower()
    if db.query(User).filter(User.email.ilike(email)).first():
        raise HTTPException(status_code=409, detail="An account already exists for this email")
    user = User(full_name=data.full_name.strip(), email=email,
                password_hash=hash_password(data.password), role=Role.PATIENT,
                clinic_id=settings.clinic_id)
    db.add(user)
    db.flush()
    db.add(PatientProfile(user_id=user.id, mobile=data.mobile, age=data.age,
                          blood_group=data.blood_group, height_cm=data.height_cm,
                          weight_kg=data.weight_kg, systolic_bp=data.systolic_bp,
                          diastolic_bp=data.diastolic_bp))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account already exists for this email") from error
    db.refresh(user)
    return {"access_token": create_access_token(str(user.id)), "user": user}

@router.get("/setup-status")
def setup_status(db: Session = Depends(get_db)):
    admin_exists = db.query(User.id).filter(User.role.in_([Role.SUPER_ADMIN, Role.CLINIC_ADMIN])).first()
    return {"setup_available": admin_exists is None}

@router.post("/setup-admin", response_model=TokenOut)
def setup_admin(data: AdminSetupIn, db: Session = Depends(get_db)):
    """Create the first clinic administrator while the clinic has no admin."""
    admin_exists = db.query(User.id).filter(User.role.in_([Role.SUPER_ADMIN, Role.CLINIC_ADMIN])).first()
    if admin_exists:
        raise HTTPException(status_code=409, detail="Clinic setup is already complete")
    # The first administrator is created through the setup form and can then
    # create staff and patient accounts from the admin workspace.
    user = User(full_name=data.full_name.strip(), email=data.email.lower(),
                password_hash=hash_password(data.password), role=Role.CLINIC_ADMIN,
                clinic_id=settings.clinic_id)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Clinic setup is already complete") from error
    db.refresh(user)
    return {"access_token": create_access_token(str(user.id)), "user": user}

@router.get("/me", response_model=UserOut)
def me(user=Depends(get_current_user)):
    return user
