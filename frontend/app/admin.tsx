import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { api } from "../src/services/api";
import { clearAuthToken, getAuthToken } from "../src/services/auth";

type AdminUser = { id: number; name: string; email: string; role: string; active: boolean; created_at: string; specialization?: string | null; walk_in?: boolean };
type Overview = { patients: number; active_staff: number; appointments_today: number; appointments_total: number; inactive_users: number };
type BillingPeriod = { invoice_count: number; billed_amount: number; paid_amount: number; patient_count: number };
type RevenueSummary = { week: BillingPeriod; month: BillingPeriod; year: BillingPeriod };
type ClinicOrder = { id: number; patient_name: string; patient_email: string; status: string; delivery_address?: string; subtotal?: number; delivery_charge?: number; total_amount?: number; paid_amount?: number; amount_due?: number; payments?: { amount: number; method: string; created_at: string }[]; created_at: string; items?: { name: string; quantity: number; line_total?: number }[] };
type ClinicProduct = { id: string; name: string; category: string; description: string; price: number; active: boolean };
type Activity = { id: number; actor: string; action: string; entity_type: string; entity_id: number; created_at: string };
type CurrentUser = { full_name: string; role: string };
const nextOrderStatuses: Record<string, string[]> = { PLACED: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["PREPARING", "CANCELLED"], PREPARING: ["OUT_FOR_DELIVERY", "CANCELLED"], OUT_FOR_DELIVERY: ["DELIVERED"], DELIVERED: [], CANCELLED: [] };
const roles = ["PATIENT", "CLINIC_ADMIN", "DOCTOR", "RECEPTIONIST", "SCANNING", "LABORATORY", "DELIVERY"];
const roleFilters = ["CLINIC_ADMIN", "DOCTOR", "RECEPTIONIST", "SCANNING", "LABORATORY", "DELIVERY", "PATIENT"];
const specializations = [
  "General Medicine", "Family Medicine", "Internal Medicine", "Emergency Medicine", "Anesthesiology", "Allergy and Immunology",
  "Cardiology", "Cardiothoracic Surgery", "Dermatology", "Dentistry", "Endocrinology", "ENT / Otolaryngology",
  "Gastroenterology", "General Surgery", "Geriatrics", "Gynecology", "Hematology", "Infectious Disease",
  "Nephrology", "Neurology", "Neurosurgery", "Obstetrics and Gynecology", "Oncology", "Ophthalmology",
  "Orthopedics", "Pediatrics", "Pathology", "Physical Medicine and Rehabilitation", "Plastic Surgery",
  "Psychiatry", "Pulmonology", "Radiology", "Rheumatology", "Urology", "Vascular Surgery",
  "Colorectal Surgery", "Medical Genetics", "Medical Oncology", "Nuclear Medicine", "Occupational Medicine",
  "Oral and Maxillofacial Surgery", "Pain Medicine", "Palliative Care", "Preventive Medicine", "Radiation Oncology",
  "Reproductive Medicine", "Sleep Medicine", "Sports Medicine", "Surgical Oncology", "Transplant Surgery",
  "Pediatric Cardiology", "Pediatric Surgery", "Other",
];

function titleCase(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function dateLabel(value: string) { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
function apiError(error: any, fallback: string) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg).filter(Boolean).join("; ") || fallback;
  const message = typeof error?.response?.data?.message === "string" ? error.response.data.message : null;
  if (message) return message;
  if (error?.response?.status) return `${fallback} (server returned ${error.response.status}${error.response.statusText ? ` ${error.response.statusText}` : ""}).`;
  if (error?.request) return `Could not reach the server at ${api.defaults.baseURL}. Check that the backend is running and the API URL is correct.`;
  if (typeof error?.message === "string") return `${fallback} (${error.message}).`;
  return fallback;
}

export default function AdminPage() {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [patientUsers, setPatientUsers] = useState<AdminUser[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [orders, setOrders] = useState<ClinicOrder[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<ClinicProduct[]>([]);
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const orderPageSize = 2;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [userPage, setUserPage] = useState(1);
  const userPageSize = 10;
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);
  const [paymentOrderId, setPaymentOrderId] = useState<number | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [showProductForm, setShowProductForm] = useState(false);
  const [productName, setProductName] = useState("");
  const [productCategory, setProductCategory] = useState("Medicine");
  const [productDescription, setProductDescription] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [savingProduct, setSavingProduct] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState("DOCTOR");
  const [specialization, setSpecialization] = useState("General Medicine");
  const [specializationSearch, setSpecializationSearch] = useState("General Medicine");
  const [showSpecializations, setShowSpecializations] = useState(false);
  const [patientMobile, setPatientMobile] = useState("");
  const [patientAge, setPatientAge] = useState("");
  const [patientBloodGroup, setPatientBloodGroup] = useState("");
  const [patientSystolic, setPatientSystolic] = useState("");
  const [patientDiastolic, setPatientDiastolic] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const token = await getAuthToken();
      if (!token) { router.replace("/"); return; }
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      const me = await api.get("/api/v1/auth/me");
      if (me.data.role !== "CLINIC_ADMIN" && me.data.role !== "SUPER_ADMIN") {
        router.replace(me.data.role === "RECEPTIONIST" ? "/reception" : "/dashboard");
        return;
      }
      const [summary, staff, logs, patients, billing, clinicOrders, products] = await Promise.all([
        api.get("/api/v1/admin/overview"), api.get("/api/v1/admin/users"), api.get("/api/v1/admin/audit-logs"), api.get("/api/v1/patients/directory"), api.get("/api/v1/admin/revenue"), api.get("/api/v1/orders/admin", { params: { page: orderPage, page_size: orderPageSize } }), api.get("/api/v1/orders/admin/products")
      ]);
      setOverview(summary.data); setUsers(staff.data); setPatientUsers(patients.data); setActivity(logs.data); setCurrentUser(me.data); setRevenue(billing.data); setOrders(clinicOrders.data.items); setOrderTotal(clinicOrders.data.total); setCatalogProducts(products.data);
    } catch (e: any) {
      if (e?.response?.status === 401) router.replace("/");
      else setError(apiError(e, "We couldn’t load the admin workspace. Check that you have admin access."));
    } finally { setLoading(false); }
  }, [orderPage, orderPageSize]);

  useEffect(() => { void load(); }, [load]);

  const sourceUsers = roleFilter === "PATIENT" ? patientUsers : users.filter((user) => user.role !== "SUPER_ADMIN");
  const visibleUsers = useMemo(() => sourceUsers.filter((user) => {
    const matchesQuery = `${user.name} ${user.email}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (roleFilter === "ALL" || user.role === roleFilter);
  }), [sourceUsers, query, roleFilter]);
  const userPageCount = Math.max(1, Math.ceil(visibleUsers.length / userPageSize));
  const pagedUsers = visibleUsers.slice((userPage - 1) * userPageSize, userPage * userPageSize);

  useEffect(() => { setUserPage(1); }, [query, roleFilter]);

  async function createStaff() {
    if (!name.trim() || !email.trim() || password.length < 10) { setError("Enter a name, valid email, and password with at least 10 characters."); return; }
    if (newRole === "PATIENT" && patientAge && (!/^\d+$/.test(patientAge) || Number(patientAge) < 1)) { setError("Enter a valid patient age in years."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const account = { full_name: name.trim(), email: email.trim().toLowerCase(), password };
      if (newRole === "PATIENT") {
        await api.post("/api/v1/patients", {
          ...account, mobile: patientMobile.trim(), age: patientAge ? Number(patientAge) : null,
          blood_group: patientBloodGroup.trim().toUpperCase(),
          systolic_bp: patientSystolic ? Number(patientSystolic) : null,
          diastolic_bp: patientDiastolic ? Number(patientDiastolic) : null,
        });
      } else {
        await api.post("/api/v1/admin/staff", { ...account, role: newRole, specialization });
      }
      setName(""); setEmail(""); setPassword(""); setPatientMobile(""); setPatientAge("");
      setSpecialization("General Medicine"); setSpecializationSearch("General Medicine"); setShowSpecializations(false);
      setPatientBloodGroup(""); setPatientSystolic(""); setPatientDiastolic(""); setShowForm(false);
      setNotice(newRole === "PATIENT" ? "Patient account created successfully." : "Team member added successfully."); await load();
    } catch (e: any) { setError(apiError(e, "Could not add this team member.")); }
    finally { setSaving(false); }
  }

  async function toggleUser(user: AdminUser) {
    setError(""); setNotice("");
    try {
      await api.patch(`/api/v1/admin/users/${user.id}/status`, { active: !user.active });
      setNotice(`${user.name}’s account is now ${user.active ? "inactive" : "active"}.`); await load();
    } catch (e: any) { setError(apiError(e, "Could not update this account.")); }
  }

  async function updateOrderStatus(order: ClinicOrder, status: string) {
    setError(""); setNotice(""); setUpdatingOrderId(order.id);
    try {
      const response = await api.patch(`/api/v1/orders/admin/${order.id}/status`, { status });
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, ...response.data } : item));
      setNotice(`Order #${order.id} updated to ${titleCase(status)}.`);
    } catch (e: any) { setError(apiError(e, "Could not update the order status.")); }
    finally { setUpdatingOrderId(null); }
  }

  async function recordOrderPayment(order: ClinicOrder) {
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter a payment amount greater than zero."); return; }
    setError(""); setNotice(""); setUpdatingOrderId(order.id);
    try {
      const response = await api.post(`/api/v1/orders/admin/${order.id}/payments`, { amount, method: paymentMethod });
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, ...response.data } : item));
      setNotice(`Payment recorded for order #${order.id}.`); setPaymentAmount(""); setPaymentOrderId(null);
    } catch (e: any) { setError(apiError(e, "Could not record the payment.")); }
    finally { setUpdatingOrderId(null); }
  }

  async function createProduct() {
    const price = Number(productPrice);
    if (!productName.trim() || !productCategory.trim() || !Number.isFinite(price) || price <= 0) {
      setError("Enter an item name, category, and price greater than zero."); return;
    }
    setSavingProduct(true); setError(""); setNotice("");
    try {
      await api.post("/api/v1/orders/admin/products", {
        name: productName.trim(), category: productCategory.trim(),
        description: productDescription.trim(), price,
      });
      setProductName(""); setProductCategory("Medicine"); setProductDescription(""); setProductPrice(""); setShowProductForm(false);
      setNotice("Item added to the patient store."); await load();
    } catch (e: any) { setError(apiError(e, "Could not add this catalog item.")); }
    finally { setSavingProduct(false); }
  }

  return <View style={s.page}>
    <View style={[s.shell, compact && s.shellCompact]}>
      {!compact && <View style={s.sidebar}>
        <View style={s.brandMark}><Text style={s.brandGlyph}>+</Text></View>
        <Text style={s.brand}>MEDICAL{`\n`}<Text style={s.brandLight}>WORKSPACE</Text></Text>
        <Text style={s.navCaption}>WORKSPACE</Text>
        <Pressable style={[s.navItem, s.navActive]} onPress={() => { setRoleFilter("ALL"); setQuery(""); }}><Text style={s.navIcon}>▦</Text><Text style={s.navActiveText}>Overview</Text></Pressable>
        <Pressable style={s.navItem} onPress={() => { setRoleFilter("ALL"); setShowForm(false); }}><Text style={s.navIcon}>♙</Text><Text style={s.navText}>Team & access</Text></Pressable>
        <Pressable style={s.navItem} onPress={() => setRoleFilter("PATIENT")}><Text style={s.navIcon}>♡</Text><Text style={s.navText}>Patients</Text></Pressable>
        <Pressable style={s.navItem} onPress={() => router.push("/appointments")}><Text style={s.navIcon}>▤</Text><Text style={s.navText}>Appointments</Text></Pressable>
        <View style={s.sidebarBottom}><View style={s.avatar}><Text style={s.avatarText}>{(currentUser?.full_name || "AD").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</Text></View><View><Text style={s.profileName}>{currentUser?.full_name || "Administrator"}</Text><Text style={s.profileRole}>{titleCase(currentUser?.role || "Clinic Admin")}</Text></View></View>
      </View>}
      <ScrollView contentContainerStyle={s.content}>
          <View style={[s.topbar, compact && s.topbarCompact]}>
          <View><Text style={s.eyebrow}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase()}</Text><Text style={s.pageTitle}>Admin overview</Text></View>
          <View style={s.topActions}>{compact && <Text style={s.brandCompact}>MEDICAL WORKSPACE</Text>}<Pressable onPress={() => router.replace("/dashboard")} style={s.ghostButton}><Text style={s.ghostText}>← Dashboard</Text></Pressable><Pressable onPress={async () => { await clearAuthToken(); router.replace("/"); }} style={s.logout}><Text style={s.logoutText}>Sign out</Text></Pressable></View>
        </View>

        {error ? <View style={s.errorBanner}><Text style={s.errorText}>{String(error)}</Text><Pressable onPress={() => setError("")}><Text style={s.dismiss}>×</Text></Pressable></View> : null}
        {notice ? <View style={s.noticeBanner}><Text style={s.noticeText}>{notice}</Text><Pressable onPress={() => setNotice("")}><Text style={s.dismiss}>×</Text></Pressable></View> : null}

        <View style={s.welcomeCard}><View style={s.welcomeCopy}><Text style={s.welcomeKicker}>YOUR CLINIC AT A GLANCE</Text><Text style={s.welcomeTitle}>Welcome back{currentUser?.full_name ? `, ${currentUser.full_name.split(" ")[0]}` : ""}.{`\n`}Let’s care for your clinic.</Text><Text style={s.welcomeSub}>Monitor your team, patients, and daily operations in one place.</Text></View><View style={s.welcomeArt}><View style={s.artCircle}><Text style={s.artPlus}>＋</Text></View><View style={s.artPill}><Text style={s.artPillText}>Care, connected</Text></View></View></View>

        {loading && !overview ? <View style={s.loading}><ActivityIndicator color="#147D72" /><Text style={s.muted}>Loading your clinic data…</Text></View> : <>
          <View style={s.sectionHeading}><View><Text style={s.sectionTitle}>Today’s overview</Text><Text style={s.sectionSub}>A live snapshot of your clinic</Text></View><Pressable disabled={loading} onPress={() => void load()} style={[s.refresh, loading && s.buttonDisabled]}>{loading && <ActivityIndicator size="small" color="#147D72" />}<Text style={s.refreshText}>{loading ? "Refreshing…" : "↻ Refresh"}</Text></Pressable></View>
          <View style={[s.stats, compact && s.statsCompact]}>
            <Metric label="Appointments today" value={overview?.appointments_today ?? 0} note="Scheduled for today" icon="▣" tone="teal" />
            <Metric label="Registered patients" value={overview?.patients ?? 0} note="Across your clinic" icon="♡" tone="blue" />
            <Metric label="Active team" value={overview?.active_staff ?? 0} note="Staff with access" icon="♙" tone="purple" />
            <Metric label="All appointments" value={overview?.appointments_total ?? 0} note={`${overview?.inactive_users ?? 0} inactive accounts`} icon="◷" tone="amber" />
          </View>

          <View style={s.panel}><View style={s.panelHead}><View><Text style={s.panelTitle}>All patient billing</Text><Text style={s.panelSub}>Invoice amounts created in each current period</Text></View><Pressable disabled={loading} onPress={() => void load()} style={[s.refresh, loading && s.buttonDisabled]}>{loading && <ActivityIndicator size="small" color="#147D72" />}<Text style={s.refreshText}>{loading ? "Refreshing…" : "↻ Refresh"}</Text></Pressable></View><View style={[s.stats, compact && s.statsCompact]}><Metric label="This week billed" value={formatAmount(revenue?.week.billed_amount ?? 0)} note={`${revenue?.week.invoice_count ?? 0} invoices · ${revenue?.week.patient_count ?? 0} patients`} icon="◷" tone="teal" /><Metric label="This month billed" value={formatAmount(revenue?.month.billed_amount ?? 0)} note={`${revenue?.month.invoice_count ?? 0} invoices · ${revenue?.month.patient_count ?? 0} patients`} icon="▤" tone="blue" /><Metric label="This year billed" value={formatAmount(revenue?.year.billed_amount ?? 0)} note={`${revenue?.year.invoice_count ?? 0} invoices · ${revenue?.year.patient_count ?? 0} patients`} icon="Σ" tone="purple" /></View></View>

          <View style={s.panel}><View style={[s.panelHead, compact && s.panelHeadCompact]}><View><Text style={s.panelTitle}>Medicine & care item orders</Text><Text style={s.panelSub}>{orderTotal} orders from patients in this clinic</Text></View><Pressable disabled={loading} onPress={() => void load()} style={[s.refresh, loading && s.buttonDisabled]}>{loading && <ActivityIndicator size="small" color="#147D72" />}<Text style={s.refreshText}>{loading ? "Refreshing…" : "↻ Refresh"}</Text></Pressable></View>
            {orders.length ? orders.map((order) => {
              const itemSubtotal = order.subtotal ?? order.items?.reduce((sum, item) => sum + Number(item.line_total || 0), 0) ?? 0;
              const deliveryCharge = order.delivery_charge ?? Math.max(0, Number(order.total_amount || 0) - itemSubtotal);
              const paidAmount = order.paid_amount ?? 0;
              const amountDue = order.amount_due ?? Math.max(0, Number(order.total_amount || 0) - paidAmount);
              return <View key={order.id} style={s.orderAdminRow}><View style={s.orderAdminTop}><View><Text style={s.userName}>Order #{order.id} · {order.patient_name}</Text><Text style={s.userEmail}>{order.patient_email}</Text></View><View style={s.roleBadge}><Text style={s.roleBadgeText}>{titleCase(order.status)}</Text></View></View><Text style={s.panelSub}>{new Date(order.created_at).toLocaleString()}</Text><Text style={s.orderAdminItems}>{(order.items || []).map((item) => `${item.name} × ${item.quantity}`).join("  ·  ")}</Text><Text style={s.orderAdminAddress}>Delivery address: {order.delivery_address || "Not provided"}</Text><Text style={s.orderAdminAddress}>Items {formatAmount(itemSubtotal)} + delivery {formatAmount(deliveryCharge)}</Text><Text style={s.orderAdminTotal}>Order total {formatAmount(order.total_amount)}</Text><View style={s.paymentBreakdown}><Text style={s.paymentPaid}>Paid {formatAmount(paidAmount)}</Text><Text style={s.paymentDue}>Due {formatAmount(amountDue)}</Text></View>{order.payments?.map((payment, index) => <Text key={`${order.id}-payment-${index}`} style={s.orderAdminAddress}>{titleCase(payment.method)} payment · {formatAmount(payment.amount)} · {new Date(payment.created_at).toLocaleString()}</Text>)}{amountDue > 0 && order.status !== "CANCELLED" ? <><Pressable onPress={() => { setPaymentOrderId(paymentOrderId === order.id ? null : order.id); setPaymentAmount(""); setError(""); }} style={s.recordPaymentButton}><Text style={s.orderActionText}>{paymentOrderId === order.id ? "Close payment form" : "＋ Record payment"}</Text></Pressable>{paymentOrderId === order.id ? <View style={s.paymentForm}><TextInput value={paymentAmount} onChangeText={setPaymentAmount} placeholder={`Amount due ${formatAmount(amountDue)}`} keyboardType="decimal-pad" style={s.paymentInput} /><View style={s.paymentMethods}>{["CASH", "UPI", "CARD", "OTHER"].map((method) => <Pressable key={method} onPress={() => setPaymentMethod(method)} style={[s.paymentMethod, paymentMethod === method && s.paymentMethodSelected]}><Text style={[s.paymentMethodText, paymentMethod === method && s.paymentMethodTextSelected]}>{method}</Text></Pressable>)}</View><Pressable disabled={updatingOrderId === order.id} onPress={() => void recordOrderPayment(order)} style={[s.orderAction, updatingOrderId === order.id && s.buttonDisabled]}><Text style={s.orderActionText}>{updatingOrderId === order.id ? "Saving…" : "Save payment"}</Text></Pressable></View> : null}</> : null}{nextOrderStatuses[order.status]?.length ? <View style={s.orderActions}>{nextOrderStatuses[order.status].map((status) => <Pressable key={status} disabled={updatingOrderId === order.id} onPress={() => void updateOrderStatus(order, status)} style={[s.orderAction, status === "CANCELLED" && s.cancelOrderAction, updatingOrderId === order.id && s.buttonDisabled]}><Text style={[s.orderActionText, status === "CANCELLED" && s.cancelOrderText]}>{updatingOrderId === order.id ? "Updating…" : titleCase(status.replaceAll("_", " "))}</Text></Pressable>)}</View> : null}</View>;
            }) : <View style={s.empty}><Text style={s.muted}>Patient orders will appear here.</Text></View>}
            {orderTotal > orderPageSize ? <View style={s.orderPagination}><Pressable disabled={orderPage <= 1} onPress={() => setOrderPage((page) => Math.max(1, page - 1))} style={[s.pageButton, orderPage <= 1 && s.pageButtonDisabled]}><Text style={s.pageButtonText}>‹ Previous</Text></Pressable><Text style={s.pageLabel}>Page {orderPage} of {Math.ceil(orderTotal / orderPageSize)}</Text><Pressable disabled={orderPage >= Math.ceil(orderTotal / orderPageSize)} onPress={() => setOrderPage((page) => page + 1)} style={[s.pageButton, orderPage >= Math.ceil(orderTotal / orderPageSize) && s.pageButtonDisabled]}><Text style={s.pageButtonText}>Next ›</Text></Pressable></View> : null}
          </View>

          <View style={s.panel}><View style={[s.panelHead, compact && s.panelHeadCompact]}><View><Text style={s.panelTitle}>Patient store catalog</Text><Text style={s.panelSub}>Add clinic items with their category, description, and price.</Text></View><Pressable style={s.primaryButton} onPress={() => setShowProductForm((value) => !value)}><Text style={s.primaryButtonText}>{showProductForm ? "Close form" : "+  Add item"}</Text></Pressable></View>
            {showProductForm ? <View style={s.formBox}><View style={[s.formRow, compact && s.formRowCompact]}><Field label="ITEM NAME" value={productName} onChangeText={setProductName} placeholder="e.g. Digital thermometer" /><Field label="CATEGORY" value={productCategory} onChangeText={setProductCategory} placeholder="Medicine or medical supply" /></View><View style={[s.formRow, compact && s.formRowCompact]}><View style={s.formField}><Text style={s.fieldLabel}>PRICE (₹)</Text><TextInput value={productPrice} onChangeText={setProductPrice} placeholder="0.00" placeholderTextColor="#94A3B8" keyboardType="decimal-pad" style={s.input} /></View><View style={s.formField}><Text style={s.fieldLabel}>DESCRIPTION (OPTIONAL)</Text><TextInput value={productDescription} onChangeText={setProductDescription} placeholder="Pack size or item details" placeholderTextColor="#94A3B8" style={s.input} /></View></View><Pressable style={[s.submitButton, savingProduct && s.buttonDisabled]} disabled={savingProduct} onPress={() => void createProduct()}><Text style={s.primaryButtonText}>{savingProduct ? "Adding item…" : "Add to patient store"}</Text></Pressable></View> : null}
            {catalogProducts.length ? catalogProducts.map((product) => <View key={product.id} style={s.catalogProductRow}><View style={s.userInfo}><Text style={s.userName}>{product.name}</Text><Text style={s.userEmail}>{product.category}{product.description ? ` · ${product.description}` : ""}</Text></View><Text style={s.orderAdminTotal}>{formatAmount(product.price)}</Text></View>) : <Text style={s.muted}>No clinic-added items yet. Starter catalog items are also available to patients.</Text>}
          </View>

          <View style={[s.columns, compact && s.columnsCompact]}>
            <View style={s.primaryColumn}>
              <View style={s.panel}>
                <View style={[s.panelHead, compact && s.panelHeadCompact]}><View><Text style={s.panelTitle}>{roleFilter === "PATIENT" ? "Patients" : "Team & access"}</Text><Text style={s.panelSub}>{roleFilter === "PATIENT" ? `${visibleUsers.length} patient accounts · select a name to open treatment history and invoices` : "Manage staff accounts and permissions"}</Text></View><Pressable style={s.primaryButton} onPress={() => setShowForm(!showForm)}><Text style={s.primaryButtonText}>{showForm ? "Close form" : "+  Create user"}</Text></Pressable></View>
                {showForm && <View style={s.formBox}>
                  <Text style={s.formTitle}>{newRole === "PATIENT" ? "Create a patient account" : "Add a team member"}</Text>
                  <View style={[s.formRow, compact && s.formRowCompact]}><Field label="Full name" value={name} onChangeText={setName} placeholder="e.g. Dr. Asha Patel" /><Field label="Email address" value={email} onChangeText={setEmail} placeholder="name@clinic.local" keyboardType="email-address" /></View>
                  <View style={[s.formRow, compact && s.formRowCompact]}><Field label="Temporary password" value={password} onChangeText={setPassword} placeholder="At least 10 characters" secureTextEntry />
                    <View style={s.formField}><Text style={s.fieldLabel}>ROLE</Text><View style={s.roleChoices}>{roles.map((role) => <Pressable key={role} onPress={() => setNewRole(role)} style={[s.choice, newRole === role && s.choiceSelected]}><Text style={[s.choiceText, newRole === role && s.choiceTextSelected]}>{titleCase(role)}</Text></Pressable>)}</View></View>
                  </View>
                  {newRole === "DOCTOR" && <View style={s.formField}><Text style={s.fieldLabel}>SPECIALIZATION</Text><TextInput value={specializationSearch} onFocus={() => setShowSpecializations(true)} onChangeText={(value) => { setSpecializationSearch(value); setSpecialization(value); setShowSpecializations(true); }} placeholder="Search or type a specialization" placeholderTextColor="#94A3B8" style={s.input} />{showSpecializations && <ScrollView style={s.specializationOptions} nestedScrollEnabled keyboardShouldPersistTaps="handled">{specializations.filter((item) => item.toLowerCase().includes(specializationSearch.trim().toLowerCase())).map((item) => <Pressable key={item} onPress={() => { setSpecialization(item); setSpecializationSearch(item); setShowSpecializations(false); }} style={s.specializationOption}><Text style={[s.specializationOptionText, specialization === item && s.specializationOptionSelected]}>{item}</Text></Pressable>)}{specializationSearch.trim() && !specializations.some((item) => item.toLowerCase() === specializationSearch.trim().toLowerCase()) ? <Text style={s.specializationCustomHint}>Custom specialization will be saved: {specializationSearch.trim()}</Text> : null}</ScrollView>}</View>}
                  {newRole === "PATIENT" && <>
                    <View style={[s.formRow, compact && s.formRowCompact]}><Field label="PHONE (OPTIONAL)" value={patientMobile} onChangeText={setPatientMobile} placeholder="Patient phone number" /><Field label="AGE (OPTIONAL)" value={patientAge} onChangeText={setPatientAge} placeholder="Age in years" keyboardType="numeric" /></View>
                    <View style={[s.formRow, compact && s.formRowCompact]}><Field label="BLOOD GROUP (OPTIONAL)" value={patientBloodGroup} onChangeText={setPatientBloodGroup} placeholder="A+, O-, B+" /><Field label="SYSTOLIC BP" value={patientSystolic} onChangeText={setPatientSystolic} placeholder="120" keyboardType="numeric" /><Field label="DIASTOLIC BP" value={patientDiastolic} onChangeText={setPatientDiastolic} placeholder="80" keyboardType="numeric" /></View>
                  </>}
                  <Pressable style={[s.submitButton, saving && s.buttonDisabled]} onPress={() => void createStaff()} disabled={saving}><Text style={s.primaryButtonText}>{saving ? "Creating…" : newRole === "PATIENT" ? "Create patient account" : "Create account"}</Text></Pressable>
                  <Text style={s.formHint}>Share the temporary password securely. Team members should change it after signing in.</Text>
                </View>}
                <View style={[s.filters, compact && s.filtersCompact]}><TextInput value={query} onChangeText={setQuery} placeholder="Search name or email" placeholderTextColor="#94A3B8" style={s.search} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterList}>{["ALL", ...roleFilters].map((role) => <Pressable key={role} onPress={() => setRoleFilter(role)} style={[s.filterChip, roleFilter === role && s.filterSelected]}><Text style={[s.filterText, roleFilter === role && s.filterTextSelected]}>{role === "ALL" ? "All roles" : titleCase(role)}</Text></Pressable>)}</ScrollView></View>
                {visibleUsers.length ? <>{pagedUsers.map((user) => <View key={user.id} style={[s.userRow, compact && s.userRowCompact]}>
                  <View style={s.userIdentity}><View style={[s.smallAvatar, { backgroundColor: user.role === "DOCTOR" ? "#DDF4ED" : user.role === "CLINIC_ADMIN" ? "#E8EAFE" : "#FFF1D9" }]}><Text style={s.smallAvatarText}>{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</Text></View><View style={s.userInfo}><Pressable disabled={user.role !== "PATIENT"} onPress={() => router.push(`/patient/${user.id}` as any)}><Text style={[s.userName, user.role === "PATIENT" && { textDecorationLine: "underline" }]}>{user.name}</Text></Pressable><Text style={s.userEmail}>{user.email}</Text>{user.specialization ? <Text style={s.userMeta}>{user.specialization}</Text> : null}</View></View>
                  <View style={s.userRight}><View style={[s.roleBadge, user.role === "SUPER_ADMIN" && s.superBadge]}><Text style={s.roleBadgeText}>{user.walk_in ? "Walk-in" : titleCase(user.role)}</Text></View><Text style={s.joined}>{user.walk_in ? "Appointment patient" : `Joined ${dateLabel(user.created_at)}`}</Text></View>
                  {!user.walk_in && <Pressable style={[s.statusButton, user.active ? s.activeButton : s.inactiveButton]} onPress={() => void toggleUser(user)}><Text style={[s.statusText, !user.active && s.inactiveText]}>{user.active ? "Active" : "Inactive"} · Change</Text></Pressable>}
                </View>)}{visibleUsers.length > userPageSize ? <View style={s.orderPagination}><Pressable disabled={userPage <= 1} onPress={() => setUserPage((page) => Math.max(1, page - 1))} style={[s.pageButton, userPage <= 1 && s.pageButtonDisabled]}><Text style={s.pageButtonText}>‹ Previous</Text></Pressable><Text style={s.pageLabel}>Page {userPage} of {userPageCount} · {visibleUsers.length} accounts</Text><Pressable disabled={userPage >= userPageCount} onPress={() => setUserPage((page) => Math.min(userPageCount, page + 1))} style={[s.pageButton, userPage >= userPageCount && s.pageButtonDisabled]}><Text style={s.pageButtonText}>Next ›</Text></Pressable></View> : null}</> : <View style={s.empty}><Text style={s.emptyTitle}>{roleFilter === "PATIENT" ? "No patient accounts found" : "No team members found"}</Text><Text style={s.muted}>{roleFilter === "PATIENT" ? "Patient accounts in this clinic will appear here." : "Try another search or add a team member."}</Text></View>}
              </View>
            </View>
            <View style={s.sideColumn}>
              <View style={s.panel}><Text style={s.panelTitle}>Quick actions</Text><Text style={s.panelSub}>Jump into everyday tasks</Text>
                <Pressable style={s.actionRow} onPress={() => setShowForm(true)}><View style={[s.actionIcon, { backgroundColor: "#E2F4EE" }]}><Text style={{ color: "#147D72" }}>＋</Text></View><View style={s.actionCopy}><Text style={s.actionTitle}>Create user</Text><Text style={s.actionSub}>Add a patient or team account</Text></View><Text style={s.actionArrow}>›</Text></Pressable>
                <Pressable style={s.actionRow} onPress={() => router.push("/dashboard")}><View style={[s.actionIcon, { backgroundColor: "#EAF1FF" }]}><Text style={{ color: "#4974C7" }}>▣</Text></View><View style={s.actionCopy}><Text style={s.actionTitle}>Appointments</Text><Text style={s.actionSub}>Open clinic dashboard</Text></View><Text style={s.actionArrow}>›</Text></Pressable>
                <Pressable style={s.actionRow} onPress={() => { setRoleFilter("DOCTOR"); }}><View style={[s.actionIcon, { backgroundColor: "#F1EAFE" }]}><Text style={{ color: "#8055B6" }}>♙</Text></View><View style={s.actionCopy}><Text style={s.actionTitle}>Review doctors</Text><Text style={s.actionSub}>Filter your care team</Text></View><Text style={s.actionArrow}>›</Text></Pressable>
              </View>
              <View style={s.activityPanel}><View style={s.activityHead}><View><Text style={s.panelTitle}>Recent activity</Text><Text style={s.panelSub}>Latest access changes</Text></View><View style={s.liveDot} /></View>
                {activity.length ? activity.slice(0, 6).map((item) => <View key={item.id} style={s.activityRow}><View style={s.timeline}><View style={s.timelineDot} /><View style={s.timelineLine} /></View><View style={s.activityCopy}><Text style={s.activityText}><Text style={s.activityActor}>{item.actor}</Text> {item.action} a {item.entity_type}</Text><Text style={s.activityTime}>{new Date(item.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text></View></View>) : <View style={s.emptyActivity}><Text style={s.emptyTitle}>Nothing to report yet</Text><Text style={s.muted}>Admin changes will appear here.</Text></View>}
              </View>
              <View style={s.helpCard}><Text style={s.helpIcon}>✦</Text><Text style={s.helpTitle}>Need a hand?</Text><Text style={s.helpText}>Keep access up to date by reviewing your team regularly.</Text><Text style={s.helpLink}>Access management guide  ↗</Text></View>
            </View>
          </View>
          <Text style={s.footer}>MEDICAL MANAGEMENT SYSTEM  ·  CLINIC ADMINISTRATION</Text>
        </>}
      </ScrollView>
    </View>
  </View>;
}

function formatAmount(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return (Number.isFinite(amount) ? amount : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function Metric({ label, value, note, icon, tone }: { label: string; value: number | string; note: string; icon: string; tone: string }) {
  return <View style={s.metric}><View style={s.metricTop}><Text style={s.metricLabel}>{label}</Text><View style={[s.metricIcon, tone === "teal" ? s.tealIcon : tone === "blue" ? s.blueIcon : tone === "purple" ? s.purpleIcon : s.amberIcon]}><Text>{icon}</Text></View></View><Text style={s.metricValue}>{value}</Text><Text style={s.metricNote}>{note}</Text></View>;
}

function Field({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: "email-address" | "numeric"; secureTextEntry?: boolean }) {
  return <View style={s.formField}><Text style={s.fieldLabel}>{label.toUpperCase()}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#94A3B8" keyboardType={keyboardType} autoCapitalize={keyboardType ? "none" : "words"} secureTextEntry={secureTextEntry} style={s.input} /></View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F5F7F8" }, shell: { flex: 1, flexDirection: "row", width: "100%", maxWidth: 1600, alignSelf: "center" }, shellCompact: { maxWidth: 760 },
  sidebar: { width: 238, backgroundColor: "#102C35", padding: 24, paddingTop: 30 }, brandMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#D3F0E6", alignItems: "center", justifyContent: "center", marginBottom: 15 }, brandGlyph: { fontSize: 25, color: "#147D72", fontWeight: "700", lineHeight: 30 }, brand: { color: "#FFFFFF", fontWeight: "900", fontSize: 13, letterSpacing: 1.3, lineHeight: 19 }, brandLight: { color: "#90B4B2", fontSize: 11, letterSpacing: 2 }, navCaption: { marginTop: 55, marginBottom: 14, color: "#759397", fontSize: 10, letterSpacing: 1.5, fontWeight: "800" }, navItem: { height: 45, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, marginBottom: 5, borderRadius: 10 }, navActive: { backgroundColor: "#1D444A" }, navIcon: { color: "#96B4B5", fontSize: 17, width: 18 }, navText: { color: "#A9C0C0", fontWeight: "600", fontSize: 13 }, navActiveText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 }, sidebarBottom: { marginTop: "auto", paddingTop: 22, borderTopWidth: 1, borderColor: "#315056", flexDirection: "row", alignItems: "center", gap: 11 }, avatar: { width: 35, height: 35, borderRadius: 20, backgroundColor: "#D6EEE6", alignItems: "center", justifyContent: "center" }, avatarText: { color: "#176C64", fontWeight: "800", fontSize: 11 }, profileName: { color: "white", fontSize: 12, fontWeight: "700" }, profileRole: { color: "#9AB3B5", fontSize: 10, marginTop: 3 },
  content: { paddingHorizontal: 34, paddingTop: 28, paddingBottom: 36, gap: 22, flexGrow: 1 }, topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 }, topbarCompact: { flexWrap: "wrap" }, eyebrow: { fontSize: 9, color: "#789094", fontWeight: "800", letterSpacing: 1.4 }, pageTitle: { fontSize: 27, color: "#17343B", fontWeight: "800", marginTop: 5 }, topActions: { flexDirection: "row", alignItems: "center", gap: 10 }, brandCompact: { width: "100%", color: "#147D72", fontSize: 10, fontWeight: "900", letterSpacing: 1 }, ghostButton: { borderWidth: 1, borderColor: "#D8E1E1", paddingHorizontal: 13, paddingVertical: 10, borderRadius: 9, backgroundColor: "white" }, ghostText: { color: "#4B6268", fontWeight: "700", fontSize: 11 }, logout: { paddingHorizontal: 13, paddingVertical: 10 }, logoutText: { color: "#63777B", fontWeight: "700", fontSize: 11 },
  welcomeCard: { borderRadius: 17, backgroundColor: "#DDF0EA", padding: 25, minHeight: 186, flexDirection: "row", overflow: "hidden", justifyContent: "space-between", alignItems: "center" }, welcomeCopy: { maxWidth: 520 }, welcomeKicker: { color: "#398277", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 }, welcomeTitle: { color: "#163B3E", fontSize: 25, lineHeight: 31, fontWeight: "800", marginTop: 8 }, welcomeSub: { color: "#547774", fontSize: 12, marginTop: 8 }, welcomeArt: { width: 170, height: 130, alignItems: "center", justifyContent: "center" }, artCircle: { width: 108, height: 108, borderRadius: 55, backgroundColor: "#C5E7DC", alignItems: "center", justifyContent: "center", transform: [{ rotate: "-12deg" }] }, artPlus: { fontSize: 55, color: "#389587", fontWeight: "300" }, artPill: { position: "absolute", right: 0, bottom: 9, backgroundColor: "#FFFFFF", borderRadius: 15, paddingHorizontal: 12, paddingVertical: 8, transform: [{ rotate: "-5deg" }] }, artPillText: { color: "#328378", fontWeight: "800", fontSize: 10 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, sectionTitle: { fontSize: 17, color: "#19363D", fontWeight: "800" }, sectionSub: { fontSize: 11, color: "#849598", marginTop: 4 }, refresh: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: "white", borderWidth: 1, borderColor: "#E1E8E7" }, refreshText: { fontSize: 11, color: "#3C6463", fontWeight: "700" }, stats: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, statsCompact: { gap: 9 }, metric: { backgroundColor: "white", borderRadius: 13, borderWidth: 1, borderColor: "#E7ECEB", padding: 16, flexGrow: 1, flexBasis: 175, minWidth: 155 }, metricTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }, metricLabel: { color: "#697E81", fontSize: 11, fontWeight: "600" }, metricIcon: { width: 29, height: 29, borderRadius: 9, alignItems: "center", justifyContent: "center" }, tealIcon: { backgroundColor: "#E2F4EE" }, blueIcon: { backgroundColor: "#E8F0FE" }, purpleIcon: { backgroundColor: "#F0EAFE" }, amberIcon: { backgroundColor: "#FFF3DE" }, metricValue: { color: "#19363D", fontWeight: "800", fontSize: 27, marginTop: 12 }, metricNote: { color: "#90A0A2", fontSize: 10, marginTop: 3 },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: 16 }, columnsCompact: { flexDirection: "column" }, primaryColumn: { flex: 1, minWidth: 0 }, sideColumn: { width: 270, gap: 14 }, panel: { backgroundColor: "white", borderRadius: 14, borderWidth: 1, borderColor: "#E7ECEB", padding: 18, marginBottom: 14 }, panelHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, panelHeadCompact: { alignItems: "flex-start", flexDirection: "column" }, panelTitle: { color: "#19363D", fontSize: 14, fontWeight: "800" }, panelSub: { color: "#8A9A9C", fontSize: 10, marginTop: 4 }, primaryButton: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 13, backgroundColor: "#147D72" }, primaryButtonText: { color: "white", fontSize: 11, fontWeight: "800" }, formBox: { marginTop: 17, padding: 15, borderRadius: 11, backgroundColor: "#F6FAF9", borderWidth: 1, borderColor: "#DFEAE7", gap: 13 }, formTitle: { color: "#1C4044", fontSize: 13, fontWeight: "800" }, formRow: { flexDirection: "row", gap: 12 }, formRowCompact: { flexDirection: "column" }, formField: { flex: 1, gap: 6 }, fieldLabel: { color: "#62787A", fontSize: 9, fontWeight: "800", letterSpacing: 0.8 }, input: { borderWidth: 1, borderColor: "#DCE5E3", backgroundColor: "white", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 10, fontSize: 12, color: "#1C3439" }, roleChoices: { flexDirection: "row", flexWrap: "wrap", gap: 5 }, specializationOptions: { maxHeight: 210, backgroundColor: "white", borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 8 }, specializationOption: { paddingHorizontal: 11, paddingVertical: 9, borderBottomWidth: 1, borderColor: "#EEF2F1" }, specializationOptionText: { color: "#526A6B", fontSize: 11 }, specializationOptionSelected: { color: "#147D72", fontWeight: "800" }, specializationCustomHint: { color: "#657B7D", fontSize: 10, padding: 10 }, choice: { borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: "white" }, choiceSelected: { backgroundColor: "#DDF0EA", borderColor: "#9DCFC1" }, choiceText: { color: "#667A7C", fontSize: 10, fontWeight: "600" }, choiceTextSelected: { color: "#176E65" }, submitButton: { alignSelf: "flex-start", paddingHorizontal: 15, paddingVertical: 11, borderRadius: 8, backgroundColor: "#147D72" }, buttonDisabled: { opacity: 0.6 }, formHint: { color: "#8A999A", fontSize: 10 },
  filters: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 17, marginBottom: 7 }, filtersCompact: { alignItems: "stretch", flexDirection: "column" }, search: { minWidth: 170, flexGrow: 1, borderWidth: 1, borderColor: "#E1E8E7", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: "#1F383D", fontSize: 11 }, filterList: { gap: 5, paddingVertical: 2 }, filterChip: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#F3F6F5" }, filterSelected: { backgroundColor: "#DDF0EA" }, filterText: { fontSize: 9, color: "#758688", fontWeight: "700" }, filterTextSelected: { color: "#176D64" }, userRow: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderColor: "#EEF1F0", paddingVertical: 13 }, userRowCompact: { flexWrap: "wrap" }, userIdentity: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 190 }, smallAvatar: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" }, smallAvatarText: { color: "#375F60", fontSize: 10, fontWeight: "900" }, userInfo: { flexShrink: 1 }, userName: { color: "#263F43", fontSize: 11, fontWeight: "800" }, userEmail: { color: "#869597", fontSize: 10, marginTop: 3 }, userMeta: { color: "#529087", fontSize: 9, marginTop: 3 }, userRight: { width: 95, gap: 4 }, roleBadge: { alignSelf: "flex-start", backgroundColor: "#EFF3F2", borderRadius: 12, paddingVertical: 4, paddingHorizontal: 7 }, superBadge: { backgroundColor: "#F1EAFE" }, roleBadgeText: { color: "#687C7D", fontSize: 8, fontWeight: "800" }, joined: { color: "#9AA7A8", fontSize: 8 }, statusButton: { borderRadius: 7, paddingVertical: 7, paddingHorizontal: 8 }, activeButton: { backgroundColor: "#E7F5EE" }, inactiveButton: { backgroundColor: "#FCEEEE" }, statusText: { color: "#38805E", fontSize: 9, fontWeight: "800" }, inactiveText: { color: "#B55050" }, empty: { alignItems: "center", padding: 25 }, emptyTitle: { color: "#314C50", fontWeight: "800", fontSize: 12, marginBottom: 5 }, muted: { color: "#89999B", fontSize: 10 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderColor: "#F0F3F2" }, actionIcon: { width: 31, height: 31, borderRadius: 9, alignItems: "center", justifyContent: "center" }, actionCopy: { flex: 1 }, actionTitle: { color: "#385155", fontWeight: "700", fontSize: 10 }, actionSub: { color: "#93A1A2", fontSize: 9, marginTop: 3 }, actionArrow: { color: "#A0AEAE", fontSize: 20 }, activityPanel: { backgroundColor: "white", borderRadius: 14, borderWidth: 1, borderColor: "#E7ECEB", padding: 17 }, activityHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }, liveDot: { width: 7, height: 7, borderRadius: 5, backgroundColor: "#42AB81" }, activityRow: { flexDirection: "row", gap: 10, minHeight: 48 }, timeline: { alignItems: "center", width: 8 }, timelineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#7FC3B1", marginTop: 3 }, timelineLine: { flex: 1, width: 1, backgroundColor: "#E6EFEC", marginTop: 4 }, activityCopy: { flex: 1, paddingBottom: 12 }, activityText: { color: "#718386", fontSize: 9, lineHeight: 14 }, activityActor: { color: "#39585A", fontWeight: "800" }, activityTime: { color: "#A0ACAD", fontSize: 8, marginTop: 4 }, emptyActivity: { paddingVertical: 16 }, helpCard: { backgroundColor: "#183F45", borderRadius: 13, padding: 17 }, helpIcon: { color: "#8BD0B8", fontSize: 18 }, helpTitle: { color: "white", fontSize: 12, fontWeight: "800", marginTop: 7 }, helpText: { color: "#BAD0CE", fontSize: 10, lineHeight: 15, marginTop: 5 }, helpLink: { color: "#9DDEC6", fontSize: 9, fontWeight: "800", marginTop: 13 },
  catalogProductRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingVertical: 12, borderTopWidth: 1, borderColor: "#EEF2F1" },
  orderAdminRow: { paddingVertical: 13, borderTopWidth: 1, borderColor: "#EEF2F1" }, orderAdminTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, orderAdminItems: { color: "#526A6B", fontSize: 11, marginTop: 8, lineHeight: 17 }, orderAdminAddress: { color: "#788A88", fontSize: 10, marginTop: 6 }, orderAdminTotal: { color: "#147D72", fontSize: 12, fontWeight: "900", marginTop: 7 }, paymentBreakdown: { flexDirection: "row", gap: 16, marginTop: 8 }, paymentPaid: { color: "#28704C", fontSize: 11, fontWeight: "900" }, paymentDue: { color: "#9A6527", fontSize: 11, fontWeight: "900" }, recordPaymentButton: { alignSelf: "flex-start", backgroundColor: "#E6F4EF", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, marginTop: 9 }, paymentForm: { backgroundColor: "#F7FAF9", borderRadius: 9, padding: 10, gap: 8, marginTop: 8 }, paymentInput: { borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 7, paddingHorizontal: 9, paddingVertical: 8, fontSize: 12, color: "#19363D" }, paymentMethods: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, paymentMethod: { borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 7, paddingVertical: 6, paddingHorizontal: 8 }, paymentMethodSelected: { backgroundColor: "#147D72", borderColor: "#147D72" }, paymentMethodText: { color: "#526A6B", fontSize: 9, fontWeight: "800" }, paymentMethodTextSelected: { color: "white" }, orderActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 }, orderAction: { backgroundColor: "#E6F4EF", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10 }, orderActionText: { color: "#147D72", fontSize: 10, fontWeight: "800" }, cancelOrderAction: { backgroundColor: "#FCE9E7" }, cancelOrderText: { color: "#9C3530" }, orderPagination: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderColor: "#EEF2F1", paddingTop: 12, marginTop: 4 }, pageButton: { backgroundColor: "#E6F4EF", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 11 }, pageButtonDisabled: { opacity: 0.45 }, pageButtonText: { color: "#147D72", fontSize: 10, fontWeight: "800" }, pageLabel: { color: "#748688", fontSize: 10, fontWeight: "700" },
  footer: { color: "#A1ADAE", fontSize: 8, letterSpacing: 1.2, textAlign: "center", marginTop: 4 }, loading: { padding: 40, alignItems: "center", gap: 10 }, errorBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 9, backgroundColor: "#FCE9E7" }, errorText: { color: "#9C3530", fontSize: 11, flex: 1 }, noticeBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 9, backgroundColor: "#E1F4EB" }, noticeText: { color: "#28704C", fontSize: 11, flex: 1 }, dismiss: { color: "#657B7D", fontSize: 19, paddingHorizontal: 8 }
});
