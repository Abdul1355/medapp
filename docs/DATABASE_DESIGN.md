# Database design

Initial entities:
- users: identity, login and role
- patient_profiles: patient demographic and measurements
- doctor_profiles: specialty and fee
- appointments: scheduled visit and workflow status
- visits: sequential encounter records
- vitals: visit-level observations
- consultations: doctor notes and diagnosis
- prescriptions: prescription header/instructions
- investigations: lab/imaging orders
- audit_logs: security-relevant actions

Production extensions recommended:
- prescription_items (medicine, dose, route, frequency, duration)
- clinic_settings, doctor_availability, appointment_slots
- payment_orders, payment_events, refunds
- notification_outbox, uploaded_documents, consent_records
- role_permissions, refresh_tokens, user_sessions
- structured clinical terminology and signed amendment history
