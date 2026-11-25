# API documentation

Run backend and visit `/docs` for interactive OpenAPI documentation.

All protected endpoints require:
`Authorization: Bearer <access_token>`

Key routes:
- POST `/api/v1/auth/login`
- GET `/api/v1/auth/me`
- POST/GET `/api/v1/patients`
- GET `/api/v1/patients/me`
- GET `/api/v1/doctors`
- POST/GET `/api/v1/appointments`
- POST `/api/v1/appointments/{id}/transition`
- POST `/api/v1/visits/{id}/vitals`
- POST `/api/v1/consultations`
- POST `/api/v1/prescriptions`
- POST `/api/v1/investigations`
- GET `/api/v1/orders/catalog` (patients)
- GET/POST `/api/v1/orders/admin/products` (clinic admins; list or add catalog items)
- POST/GET `/api/v1/orders` (patients; create an order or view own order history)
- GET `/api/v1/orders/admin?page=1&page_size=2` (clinic admins; paginated clinic orders)
- PATCH `/api/v1/orders/admin/{order_id}/status` (clinic admins; advance or cancel an order)
- POST `/api/v1/orders/admin/{order_id}/payments` (clinic admins; record full or partial payment)
- GET `/api/v1/admin/users`
- POST `/api/v1/admin/staff`
- GET `/api/v1/queue/{clinic_id}`
- WS `/ws/queue/{clinic_id}`
