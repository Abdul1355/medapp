from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Literal
from uuid import uuid4

from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models import MedicineOrder, MedicineOrderItem, MedicineOrderPayment, MedicineProduct, Role, User

router = APIRouter(prefix="/orders", tags=["Patient orders"])

# Starter catalog and example INR prices. A clinic should replace these with
# its approved products and current prices before using this for real orders.
PRODUCTS = [
    {"id": "paracetamol-500", "name": "Paracetamol 500 mg · 10 tablets", "category": "OTC medicine", "price": 25.0},
    {"id": "ors-sachets", "name": "Oral rehydration salts · 1 sachet", "category": "OTC medicine", "price": 20.0},
    {"id": "cetirizine-10", "name": "Cetirizine 10 mg · 10 tablets", "category": "OTC medicine", "price": 35.0},
    {"id": "thermometer", "name": "Digital thermometer", "category": "Medical device", "price": 160.0},
    {"id": "surgical-masks", "name": "Surgical masks · pack of 10", "category": "Medical supplies", "price": 45.0},
    {"id": "elastic-bandage", "name": "Elastic bandage", "category": "Medical supplies", "price": 60.0},
    {"id": "antiseptic-liquid", "name": "Antiseptic liquid · 100 ml", "category": "First aid", "price": 75.0},
]
PRODUCT_BY_ID = {product["id"]: product for product in PRODUCTS}
DELIVERY_CHARGE = 70.0


class OrderLineIn(BaseModel):
    product_id: str
    quantity: int = Field(ge=1, le=99)


class OrderCreateIn(BaseModel):
    items: list[OrderLineIn] = Field(min_length=1)
    delivery_address: str = Field(min_length=10, max_length=1000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class OrderStatusUpdateIn(BaseModel):
    status: str


class OrderPaymentIn(BaseModel):
    amount: float = Field(gt=0)
    method: Literal["CASH", "UPI", "CARD", "OTHER"]


class ProductCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    category: str = Field(default="Medicine", min_length=2, max_length=80)
    description: str = Field(default="", max_length=500)
    price: float = Field(ge=0.01)


def require_patient(user):
    if user.role != Role.PATIENT:
        raise HTTPException(status_code=403, detail="Patient account required")
    return user


def serialize_order(order, items, payments=()):
    subtotal = round(sum(item.line_total for item in items), 2)
    paid_amount = round(sum(payment.amount for payment in payments), 2)
    return {
        "id": order.id,
        "status": order.status,
        "delivery_address": order.delivery_address,
        "total_amount": order.total_amount,
        "subtotal": subtotal,
        "delivery_charge": round(max(0, order.total_amount - subtotal), 2),
        "paid_amount": paid_amount,
        "amount_due": round(max(0, order.total_amount - paid_amount), 2),
        "payments": [{"amount": payment.amount, "method": payment.method,
                      "created_at": payment.created_at.isoformat()} for payment in payments],
        "created_at": order.created_at.isoformat(),
        "items": [{
            "product_id": item.product_id,
            "name": item.product_name,
            "unit_price": item.unit_price,
            "quantity": item.quantity,
            "line_total": item.line_total,
        } for item in items],
    }


def serialize_product(product):
    return {"id": product.product_key, "name": product.name,
            "category": product.category, "description": product.description,
            "price": product.unit_price, "active": product.is_active}


def clinic_products(db, clinic_id, active_only=True):
    query = db.query(MedicineProduct).filter_by(clinic_id=clinic_id)
    if active_only:
        query = query.filter(MedicineProduct.is_active.is_(True))
    return query.order_by(MedicineProduct.name).all()


@router.get("/catalog")
def catalog(db: Session = Depends(get_db), actor=Depends(get_current_user)):
    require_patient(actor)
    # Starter items remain available alongside this clinic's admin-managed catalog.
    return PRODUCTS + [serialize_product(product) for product in clinic_products(db, actor.clinic_id)]


@router.get("/admin/products")
def admin_products(db: Session = Depends(get_db),
                   actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN))):
    return [serialize_product(product) for product in clinic_products(
        db, actor.clinic_id, active_only=False)]


@router.post("/admin/products")
def create_product(data: ProductCreateIn, db: Session = Depends(get_db),
                   actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN))):
    if not data.name.strip() or not data.category.strip():
        raise HTTPException(status_code=422, detail="Item name and category are required")
    product = MedicineProduct(product_key=f"clinic-{uuid4().hex}", clinic_id=actor.clinic_id,
        name=data.name.strip(), category=data.category.strip(), description=data.description.strip(),
        unit_price=round(data.price, 2), is_active=True)
    db.add(product)
    db.commit()
    db.refresh(product)
    return serialize_product(product)


@router.get("")
def my_orders(db: Session = Depends(get_db), actor=Depends(get_current_user)):
    require_patient(actor)
    orders = (db.query(MedicineOrder).filter_by(patient_id=actor.id, clinic_id=actor.clinic_id)
              .order_by(MedicineOrder.created_at.desc()).all())
    return [serialize_order(order,
                            db.query(MedicineOrderItem).filter_by(order_id=order.id).all(),
                            db.query(MedicineOrderPayment).filter_by(order_id=order.id).all())
            for order in orders]


@router.get("/admin")
def clinic_orders(page: int = Query(1, ge=1), page_size: int = Query(2, ge=1, le=50),
                  db: Session = Depends(get_db),
                  actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN))):
    base = (db.query(MedicineOrder, User.full_name, User.email)
            .join(User, User.id == MedicineOrder.patient_id)
            .filter(MedicineOrder.clinic_id == actor.clinic_id))
    total = base.count()
    rows = (base.order_by(MedicineOrder.created_at.desc())
            .offset((page - 1) * page_size).limit(page_size).all())
    result = []
    for order, patient_name, patient_email in rows:
        item_rows = db.query(MedicineOrderItem).filter_by(order_id=order.id).all()
        payment_rows = db.query(MedicineOrderPayment).filter_by(order_id=order.id).order_by(MedicineOrderPayment.created_at).all()
        result.append({**serialize_order(order, item_rows, payment_rows),
                       "patient_name": patient_name, "patient_email": patient_email})
    return {"items": result, "total": total, "page": page, "page_size": page_size}


@router.get("/delivery")
def delivery_orders(db: Session = Depends(get_db), actor=Depends(require_roles(Role.DELIVERY))):
    rows = (db.query(MedicineOrder, User.full_name, User.email)
            .join(User, User.id == MedicineOrder.patient_id)
            .filter(MedicineOrder.clinic_id == actor.clinic_id)
            .order_by(MedicineOrder.created_at.desc()).limit(500).all())
    return [{**serialize_order(order, db.query(MedicineOrderItem).filter_by(order_id=order.id).all()),
             "patient_name": patient_name, "patient_email": patient_email}
            for order, patient_name, patient_email in rows]


@router.patch("/delivery/{order_id}/status")
def update_delivery_status(order_id: int, data: OrderStatusUpdateIn, db: Session = Depends(get_db),
                           actor=Depends(require_roles(Role.DELIVERY))):
    order = db.query(MedicineOrder).filter_by(id=order_id, clinic_id=actor.clinic_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    transitions = {"PREPARING": "OUT_FOR_DELIVERY", "OUT_FOR_DELIVERY": "DELIVERED"}
    if transitions.get(order.status) != data.status:
        raise HTTPException(status_code=409, detail=f"Delivery staff cannot move this order from {order.status} to {data.status}")
    order.status = data.status
    db.commit()
    db.refresh(order)
    items = db.query(MedicineOrderItem).filter_by(order_id=order.id).all()
    return {**serialize_order(order, items),
            "patient_name": db.query(User.full_name).filter(User.id == order.patient_id).scalar(),
            "patient_email": db.query(User.email).filter(User.id == order.patient_id).scalar()}


@router.patch("/admin/{order_id}/status")
def update_order_status(order_id: int, data: OrderStatusUpdateIn, db: Session = Depends(get_db),
                        actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN))):
    transitions = {
        "PLACED": {"CONFIRMED", "CANCELLED"},
        "CONFIRMED": {"PREPARING", "CANCELLED"},
        "PREPARING": {"OUT_FOR_DELIVERY", "CANCELLED"},
        "OUT_FOR_DELIVERY": {"DELIVERED"},
        "DELIVERED": set(),
        "CANCELLED": set(),
    }
    order = db.query(MedicineOrder).filter_by(id=order_id, clinic_id=actor.clinic_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if data.status not in transitions.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Order cannot move from {order.status} to {data.status}")
    order.status = data.status
    db.commit()
    db.refresh(order)
    items = db.query(MedicineOrderItem).filter_by(order_id=order.id).all()
    payments = db.query(MedicineOrderPayment).filter_by(order_id=order.id).order_by(MedicineOrderPayment.created_at).all()
    return serialize_order(order, items, payments)


@router.post("/admin/{order_id}/payments")
def record_order_payment(order_id: int, data: OrderPaymentIn, db: Session = Depends(get_db),
                         actor=Depends(require_roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN))):
    order = (db.query(MedicineOrder).filter_by(id=order_id, clinic_id=actor.clinic_id)
             .with_for_update().first())
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == "CANCELLED":
        raise HTTPException(status_code=409, detail="Cannot record a payment for a cancelled order")
    payments = db.query(MedicineOrderPayment).filter_by(order_id=order.id).all()
    paid_amount = round(sum(payment.amount for payment in payments), 2)
    amount_due = round(max(0, order.total_amount - paid_amount), 2)
    amount = round(data.amount, 2)
    if amount > amount_due:
        raise HTTPException(status_code=422, detail=f"Payment exceeds the remaining balance of {amount_due:.2f}")
    db.add(MedicineOrderPayment(order_id=order.id, amount=amount, method=data.method,
                                received_by=actor.id))
    db.commit()
    items = db.query(MedicineOrderItem).filter_by(order_id=order.id).all()
    payments = db.query(MedicineOrderPayment).filter_by(order_id=order.id).order_by(MedicineOrderPayment.created_at).all()
    return serialize_order(order, items, payments)


@router.post("")
def create_order(data: OrderCreateIn, db: Session = Depends(get_db), actor=Depends(get_current_user)):
    require_patient(actor)
    available_products = {product_id: product for product_id, product in PRODUCT_BY_ID.items()}
    available_products.update({product.product_key: {
        "id": product.product_key, "name": product.name, "category": product.category,
        "price": product.unit_price,
    } for product in clinic_products(db, actor.clinic_id)})
    quantities: dict[str, int] = {}
    for line in data.items:
        if line.product_id not in available_products:
            raise HTTPException(status_code=422, detail=f"Unknown product: {line.product_id}")
        quantities[line.product_id] = quantities.get(line.product_id, 0) + line.quantity
        if quantities[line.product_id] > 99:
            raise HTTPException(status_code=422, detail="Maximum quantity per item is 99")

    address = data.delivery_address.strip()
    if len(address) < 10:
        raise HTTPException(status_code=422, detail="Enter a complete delivery address")
    if (data.latitude is None) != (data.longitude is None):
        raise HTTPException(status_code=422, detail="Both current-location coordinates are required")
    if data.latitude is not None:
        address += f"\nGPS location: {data.latitude:.6f}, {data.longitude:.6f}"

    subtotal = round(sum(available_products[product_id]["price"] * quantity
                         for product_id, quantity in quantities.items()), 2)
    total = round(subtotal + DELIVERY_CHARGE, 2)
    order = MedicineOrder(patient_id=actor.id, clinic_id=actor.clinic_id,
                          delivery_address=address, total_amount=total, status="PLACED")
    db.add(order)
    db.flush()
    order_items = []
    for product_id, quantity in quantities.items():
        product = available_products[product_id]
        item = MedicineOrderItem(order_id=order.id, product_id=product_id,
            product_name=product["name"], unit_price=product["price"], quantity=quantity,
            line_total=round(product["price"] * quantity, 2))
        db.add(item)
        order_items.append(item)
    db.commit()
    db.refresh(order)
    return serialize_order(order, order_items, [])
