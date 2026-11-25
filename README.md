# Medical Management System

Single-clinic starter based on the uploaded Medical Application SRS.

## Stack
- Frontend: Expo + React Native + React Native Web + TypeScript
- Backend: FastAPI + SQLAlchemy 2 + Pydantic
- Database: PostgreSQL
- Live queue: WebSockets
- Authentication: JWT access tokens + password hashing
- Roles: SUPER_ADMIN, CLINIC_ADMIN, PATIENT, RECEPTIONIST, DOCTOR

## Included SRS workflows
- Patient profile, BMI, doctor directory, appointment booking, history
- Patient medicine and care-item ordering with current-location capture and a ₹70 delivery charge
- Receptionist roster, walk-ins, vitals and queue
- Doctor queue, consultation notes, prescriptions and investigations
- Appointment states: SCHEDULED, WAITING_FOR_DOCTOR, IN_PROGRESS, ROUTED_TO_LAB, COMPLETED
- Admin user management starter endpoints

This is a development starter, not a production-certified medical system. Before handling real patient data, complete a security review, privacy/legal review, clinical validation, backups, monitoring, and penetration testing. The symptom checker is intentionally not implemented as autonomous diagnosis/triage.

## Requirements
- Python 3.11+
- Node.js 20+
- Docker Desktop (recommended)
- Expo Go for initial mobile testing

## 1. Start PostgreSQL and Redis
From the project root:
```bash
docker compose up -d db redis
```

## 2. Start the backend
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```
API: http://localhost:8000
Swagger: http://localhost:8000/docs

The backend creates starter tables on startup. For production, use Alembic migrations rather than `create_all`.

Open the app and choose **First time? Set up clinic administrator** to create
the first admin account. This setup is available only while the users table is
empty. After signing in, use **Create user** in the admin workspace to add
patients, doctors, clinic admins, or receptionists. Patients can also register
from the sign-in screen.

## 3. Start Expo
```bash
cd frontend
npm install
cp .env.example .env
npx expo start
```
- Web: press `w` or run `npx expo start --web`
- Android/iOS: scan the QR code using Expo Go.
- Physical device: set `EXPO_PUBLIC_API_URL` to your computer's LAN IP, e.g. `http://192.168.1.20:8000`.
- Android emulator commonly uses `http://10.0.2.2:8000`.
- iOS simulator can use `http://localhost:8000`.

## API overview
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/setup-admin` (first account only)
- `GET /api/v1/auth/me`
- `GET/POST /api/v1/patients`
- `GET/POST /api/v1/doctors`
- `GET /api/v1/admin/overview`
- `GET /api/v1/admin/users`
- `POST /api/v1/admin/staff`
- `PATCH /api/v1/admin/users/{id}/status`
- `GET /api/v1/admin/audit-logs`
- `GET/POST /api/v1/appointments/manage` (clinic admins and receptionists)
- `GET /api/v1/appointments/doctor/dashboard?day=YYYY-MM-DD` (doctors)
- `GET/POST /api/v1/appointments`
- `POST /api/v1/appointments/{id}/transition`
- `POST /api/v1/visits/{id}/vitals`
- `POST /api/v1/consultations`
- `POST /api/v1/prescriptions`
- `POST /api/v1/investigations`
- `GET /api/v1/orders/catalog` (patients)
- `GET/POST /api/v1/orders/admin/products` (clinic admins)
- `GET/POST /api/v1/orders` (patients)
- `GET /api/v1/orders/admin?page=1&page_size=2` (clinic admins)
- `PATCH /api/v1/orders/admin/{order_id}/status` (clinic admins)
- `POST /api/v1/orders/admin/{order_id}/payments` (clinic admins; record payment)
- `GET /api/v1/queue/{clinic_id}`
- `WS /ws/queue/{clinic_id}`

## Notes
- This starter uses one clinic ID for a single-clinic deployment. Clinic scoping should still be enforced in every query.
- Payment gateway, SMS, push delivery, file upload malware scanning, e-prescription signing, and external lab integrations are integration points, not live payment/clinical services.
- Never put secrets in source control. Set a unique JWT secret before deployment.
