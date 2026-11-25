import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { api } from "../src/services/api";
import { getAuthToken } from "../src/services/auth";

type Appointment = { id: number; patient_id: number; patient_name: string; doctor_id: number; doctor_name: string; scheduled_at: string; reason: string; status: string };
type Person = { id: number; full_name?: string; name?: string; email?: string; specialization?: string };
const statusNames: Record<string, string> = { SCHEDULED: "Scheduled", WAITING_FOR_DOCTOR: "Arrived", IN_PROGRESS: "In consultation", ROUTED_TO_LAB: "Lab", COMPLETED: "Completed" };
const nextStatus: Record<string, string> = { SCHEDULED: "WAITING_FOR_DOCTOR", WAITING_FOR_DOCTOR: "IN_PROGRESS", IN_PROGRESS: "COMPLETED", ROUTED_TO_LAB: "COMPLETED" };
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const localTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const apiError = (error: any, fallback: string) => {
  const detail = error?.response?.data?.detail;
  return typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((item) => item?.msg).filter(Boolean).join("; ") || fallback : fallback;
};

export default function AppointmentsPage() {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Person[]>([]);
  const [doctors, setDoctors] = useState<Person[]>([]);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("TODAY");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [patientId, setPatientId] = useState<number | null>(null);
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [patientSearch, setPatientSearch] = useState("");
  const [doctorSearch, setDoctorSearch] = useState("");
  const [patientMode, setPatientMode] = useState<"REGISTERED" | "MANUAL">("MANUAL");
  const [manualPatientName, setManualPatientName] = useState("");
  const [scheduledDate, setScheduledDate] = useState(today());
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const token = await getAuthToken();
      if (!token) { router.replace("/"); return; }
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      const [list, patientList, doctorList, me] = await Promise.all([
        api.get("/api/v1/appointments/manage"), api.get("/api/v1/patients"), api.get("/api/v1/doctors"), api.get("/api/v1/auth/me")
      ]);
      setAppointments(list.data); setPatients(patientList.data); setDoctors(doctorList.data); setRole(me.data.role);
    } catch (e: any) {
      if (e?.response?.status === 401) router.replace("/");
      else setError(apiError(e, "Unable to load appointments. Admin or receptionist access is required."));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => appointments.filter((item) => {
    const matchesSearch = `${item.patient_name} ${item.doctor_name} ${item.reason}`.toLowerCase().includes(search.toLowerCase());
    const matchesDate = dateFilter === "ALL" || (dateFilter === "TODAY" ? item.scheduled_at.slice(0, 10) === today() : item.scheduled_at.slice(0, 10) >= today());
    return matchesSearch && matchesDate && (statusFilter === "ALL" || item.status === statusFilter);
  }), [appointments, dateFilter, search, statusFilter]);

  const matchingPatients = useMemo(() => patients.filter((person) => `${person.full_name || person.name || ""} ${person.email || ""}`.toLowerCase().includes(patientSearch.toLowerCase())), [patients, patientSearch]);
  const matchingDoctors = useMemo(() => doctors.filter((person) => `${person.name || person.full_name || ""} ${person.specialization || ""}`.toLowerCase().includes(doctorSearch.toLowerCase())), [doctors, doctorSearch]);

  const counts = useMemo(() => ({ today: appointments.filter((a) => a.scheduled_at.slice(0, 10) === today()).length,
    waiting: appointments.filter((a) => a.status === "WAITING_FOR_DOCTOR").length,
    upcoming: appointments.filter((a) => ["SCHEDULED", "WAITING_FOR_DOCTOR"].includes(a.status)).length,
    completed: appointments.filter((a) => a.status === "COMPLETED").length }), [appointments]);

  async function createAppointment() {
    if ((!patientId && patientMode === "REGISTERED") || (patientMode === "MANUAL" && !manualPatientName.trim()) || !doctorId) { setError("Enter or select a patient name and select a doctor before booking."); return; }
    const requestedDate = new Date(`${scheduledDate}T${scheduledTime}`);
    if (Number.isNaN(requestedDate.getTime()) || requestedDate <= new Date()) { setError("Choose a time later today or a future date."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await api.post("/api/v1/appointments/manage", { patient_id: patientMode === "REGISTERED" ? patientId : null, patient_name: patientMode === "MANUAL" ? manualPatientName.trim() : null, doctor_id: doctorId, scheduled_at: requestedDate.toISOString(), reason: reason.trim() });
      setShowForm(false); setPatientId(null); setDoctorId(null); setPatientSearch(""); setDoctorSearch(""); setManualPatientName(""); setPatientMode("MANUAL"); setReason(""); setNotice("Appointment booked successfully."); await load();
    } catch (e: any) { setError(apiError(e, "Could not book the appointment.")); }
    finally { setSaving(false); }
  }

  async function advance(item: Appointment, requestedStatus?: string) {
    const status = requestedStatus || nextStatus[item.status];
    if (!status) return;
    setError(""); setNotice("");
    try {
      await api.post(`/api/v1/appointments/${item.id}/transition`, { status });
      setNotice(`Appointment #${item.id} updated to ${statusNames[status]}.`); await load();
    } catch (e: any) { setError(apiError(e, "Could not update this appointment.")); }
  }

  return <View style={s.page}><View style={[s.shell, compact && s.shellCompact]}>
    {!compact && <View style={s.sidebar}>
      <View style={s.brandMark}><Text style={s.brandGlyph}>+</Text></View><Text style={s.brand}>MEDICAL{`\n`}<Text style={s.brandLight}>WORKSPACE</Text></Text>
      <Text style={s.navCaption}>WORKSPACE</Text>
      <Pressable style={s.navItem} onPress={() => router.replace(role === "CLINIC_ADMIN" || role === "SUPER_ADMIN" ? "/admin" : role === "RECEPTIONIST" ? "/reception" : "/dashboard")}><Text style={s.navIcon}>▦</Text><Text style={s.navText}>Overview</Text></Pressable>
      {(role === "CLINIC_ADMIN" || role === "SUPER_ADMIN") && <Pressable style={s.navItem} onPress={() => router.replace("/admin")}><Text style={s.navIcon}>♙</Text><Text style={s.navText}>Team & access</Text></Pressable>}
      <Pressable style={[s.navItem, s.navActive]}><Text style={s.navIcon}>▤</Text><Text style={s.navActiveText}>Appointments</Text></Pressable>
      <View style={s.sidebarBottom}><View style={s.avatar}><Text style={s.avatarText}>CL</Text></View><View><Text style={s.profileName}>Clinic workspace</Text><Text style={s.profileRole}>Appointment desk</Text></View></View>
    </View>}
    <ScrollView contentContainerStyle={s.content}>
      <View style={[s.topbar, compact && s.topbarCompact]}><View><Text style={s.eyebrow}>CLINIC OPERATIONS</Text><Text style={s.title}>Appointments</Text><Text style={s.subtitle}>Schedule, search, and manage today’s patient visits.</Text></View><View style={s.topActions}>{compact && <Text style={s.brandCompact}>MEDICAL WORKSPACE</Text>}<Pressable onPress={() => router.replace(role === "RECEPTIONIST" ? "/reception" : role === "CLINIC_ADMIN" || role === "SUPER_ADMIN" ? "/admin" : "/dashboard")} style={s.secondaryButton}><Text style={s.secondaryText}>{role === "RECEPTIONIST" ? "← Reception" : "← Back"}</Text></Pressable><Pressable onPress={() => { setShowForm(!showForm); setError(""); }} style={s.addButton}><Text style={s.addText}>{showForm ? "Close" : "+  Book appointment"}</Text></Pressable></View></View>
      {error ? <Banner message={error} tone="error" onClose={() => setError("")} /> : null}{notice ? <Banner message={notice} tone="success" onClose={() => setNotice("")} /> : null}
      <View style={s.metrics}>
        <Metric label="Today" value={counts.today} note="Visits on today’s schedule" color="#E3F3EE" icon="▣" />
        <Metric label="Waiting" value={counts.waiting} note="Patients ready for care" color="#FFF1D9" icon="◷" />
        <Metric label="Open visits" value={counts.upcoming} note="Scheduled or arrived" color="#E9EEFC" icon="♡" />
        <Metric label="Completed" value={counts.completed} note="Visits finished" color="#F0EAFE" icon="✓" />
      </View>
      {showForm && <View style={s.formCard}><View style={s.formHeading}><View><Text style={s.cardTitle}>Book a new appointment</Text><Text style={s.cardSub}>Search for a patient, select a doctor, and choose a visit time.</Text></View><Text style={s.stepBadge}>NEW VISIT</Text></View>
        <View style={[s.formColumns, compact && s.formColumnsCompact]}>
          <View style={s.formField}><Text style={s.fieldLabel}>PATIENT NAME</Text><View style={s.modeTabs}><Pressable onPress={() => { setPatientMode("REGISTERED"); setManualPatientName(""); }} style={[s.modeTab, patientMode === "REGISTERED" && s.modeTabActive]}><Text style={[s.modeText, patientMode === "REGISTERED" && s.modeTextActive]}>Registered</Text></Pressable><Pressable onPress={() => { setPatientMode("MANUAL"); setPatientId(null); setPatientSearch(""); }} style={[s.modeTab, patientMode === "MANUAL" && s.modeTabActive]}><Text style={[s.modeText, patientMode === "MANUAL" && s.modeTextActive]}>Type name manually</Text></Pressable></View>{patientMode === "MANUAL" ? <><TextInput style={s.pickerSearch} value={manualPatientName} onChangeText={setManualPatientName} placeholder="Type any patient name" placeholderTextColor="#95A4A4" autoCapitalize="words" /><Text style={s.selectionHint}>This books a walk-in appointment without creating a patient login.</Text></> : <><TextInput style={s.pickerSearch} value={patientSearch} onChangeText={(value) => { setPatientSearch(value); setPatientId(null); }} placeholder="Type a name to search registered patients" placeholderTextColor="#95A4A4" autoCapitalize="words" />{patientId ? <Text style={s.selectionHint}>Selected: {patients.find((item) => item.id === patientId)?.full_name || "Patient"}</Text> : null}<ScrollView style={s.options} nestedScrollEnabled keyboardShouldPersistTaps="handled">{matchingPatients.map((patient) => { const id = patient.id; const selected = patientId === id; return <Pressable key={id} onPress={() => { setPatientId(id); setPatientSearch(patient.full_name || patient.name || ""); }} style={[s.option, selected && s.optionSelected]}><Text style={[s.optionName, selected && s.optionNameSelected]}>{patient.full_name || patient.name}</Text><Text style={s.optionMeta}>{patient.email || "Patient"}</Text></Pressable>; })}{matchingPatients.length === 0 && <Text style={s.emptyOptions}>{patients.length ? "No matching patients." : "No patients found."}</Text>}</ScrollView></>}</View>
          <View style={s.formField}><Text style={s.fieldLabel}>DOCTOR</Text><TextInput style={s.pickerSearch} value={doctorSearch} onChangeText={(value) => { setDoctorSearch(value); setDoctorId(null); }} placeholder="Search doctors or specialties" placeholderTextColor="#95A4A4" />{doctorId ? <Text style={s.selectionHint}>Doctor selected</Text> : null}<ScrollView style={s.options} nestedScrollEnabled keyboardShouldPersistTaps="handled">{matchingDoctors.map((doctor) => { const id = doctor.id; const selected = doctorId === id; return <Pressable key={id} onPress={() => { setDoctorId(id); setDoctorSearch(doctor.name || doctor.full_name || ""); }} style={[s.option, selected && s.optionSelected]}><Text style={[s.optionName, selected && s.optionNameSelected]}>{doctor.name || doctor.full_name}</Text><Text style={s.optionMeta}>{doctor.specialization || "Care provider"}</Text></Pressable>; })}{matchingDoctors.length === 0 && <Text style={s.emptyOptions}>{doctors.length ? "No matching doctors." : "No doctors available."}</Text>}</ScrollView></View>
          <View style={s.formField}><Text style={s.fieldLabel}>DATE & TIME</Text><View style={s.dateTimeRow}><TextInput style={[s.input, s.dateInput]} value={scheduledDate} onChangeText={setScheduledDate} placeholder="YYYY-MM-DD" /><TextInput style={[s.input, s.timeInput]} value={scheduledTime} onChangeText={setScheduledTime} placeholder="09:00" /></View><Text style={s.fieldHint}>Use YYYY-MM-DD and 24-hour time.</Text><Text style={[s.fieldLabel, s.reasonLabel]}>REASON FOR VISIT</Text><TextInput style={[s.input, s.reasonInput]} value={reason} onChangeText={setReason} placeholder="Brief reason for appointment" multiline /></View>
        </View><View style={s.formFooter}><Text style={s.formNote}>Booking creates a scheduled visit. The patient can see it in their account.</Text><Pressable onPress={() => void createAppointment()} disabled={saving} style={[s.addButton, saving && s.disabled]}><Text style={s.addText}>{saving ? "Booking…" : "Confirm appointment"}</Text></Pressable></View>
      </View>}
      <View style={s.listCard}><View style={[s.listHeading, compact && s.listHeadingCompact]}><View><Text style={s.cardTitle}>Visit schedule</Text><Text style={s.cardSub}>{visible.length} {visible.length === 1 ? "appointment" : "appointments"} match your filters</Text></View><Pressable disabled={loading} onPress={() => void load()} style={[s.refresh, loading && { opacity: 0.55 }]}><Text style={s.refreshText}>{loading ? "Refreshing…" : "↻ Refresh"}</Text></Pressable></View>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search patient, doctor, or reason" placeholderTextColor="#95A4A4" style={s.search} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>{[["TODAY", "Today"], ["UPCOMING", "Upcoming"], ["ALL", "All dates"]].map(([key, label]) => <Chip key={key} label={label} selected={dateFilter === key} onPress={() => setDateFilter(key)} />)}<View style={s.chipDivider} />{[["ALL", "All status"], ["SCHEDULED", "Scheduled"], ["WAITING_FOR_DOCTOR", "Arrived"], ["IN_PROGRESS", "In consultation"], ["COMPLETED", "Completed"]].map(([key, label]) => <Chip key={`status-${key}`} label={label} selected={statusFilter === key} onPress={() => setStatusFilter(key)} />)}</ScrollView>
        {loading && appointments.length === 0 ? <View style={s.loading}><ActivityIndicator color="#147D72" /><Text style={s.cardSub}>Loading schedule…</Text></View> : visible.length ? visible.map((item) => <AppointmentCard key={item.id} item={item} compact={compact} role={role} onAdvance={() => void advance(item)} onSendToLab={() => void advance(item, "ROUTED_TO_LAB")} />) : <View style={s.empty}><Text style={s.emptyIcon}>▤</Text><Text style={s.emptyTitle}>No appointments found</Text><Text style={s.cardSub}>Adjust your filters or book a new visit.</Text><Pressable onPress={() => { setDateFilter("ALL"); setStatusFilter("ALL"); setSearch(""); }}><Text style={s.clearFilters}>Clear filters</Text></Pressable></View>}
      </View>
      <Text style={s.footer}>MEDICAL MANAGEMENT SYSTEM · APPOINTMENT DESK</Text>
    </ScrollView>
  </View></View>;
}

function Metric({ label, value, note, color, icon }: { label: string; value: number; note: string; color: string; icon: string }) {
  return <View style={s.metric}><View style={s.metricTop}><Text style={s.metricLabel}>{label}</Text><View style={[s.metricIcon, { backgroundColor: color }]}><Text style={s.metricIconText}>{icon}</Text></View></View><Text style={s.metricValue}>{value}</Text><Text style={s.metricNote}>{note}</Text></View>;
}
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[s.chip, selected && s.chipSelected]}><Text style={[s.chipText, selected && s.chipTextSelected]}>{label}</Text></Pressable>;
}
function Banner({ message, tone, onClose }: { message: string; tone: "error" | "success"; onClose: () => void }) {
  return <View style={[s.banner, tone === "error" ? s.errorBanner : s.successBanner]}><Text style={[s.bannerText, tone === "error" ? s.errorText : s.successText]}>{message}</Text><Pressable onPress={onClose}><Text style={s.close}>×</Text></Pressable></View>;
}
function AppointmentCard({ item, compact, role, onAdvance, onSendToLab }: { item: Appointment; compact: boolean; role: string; onAdvance: () => void; onSendToLab: () => void }) {
  const next = nextStatus[item.status];
  const canAdvance = !!next && (item.status === "SCHEDULED" || role === "DOCTOR" || role === "CLINIC_ADMIN" || role === "SUPER_ADMIN");
  const statusColor = item.status === "COMPLETED" ? s.statusDone : item.status === "IN_PROGRESS" ? s.statusProgress : item.status === "WAITING_FOR_DOCTOR" ? s.statusWaiting : s.statusScheduled;
  return <View style={[s.appointmentRow, compact && s.appointmentRowCompact]}>
    <View style={s.timeBlock}><Text style={s.time}>{localTime(item.scheduled_at)}</Text><Text style={s.date}>{new Date(item.scheduled_at).toLocaleDateString([], { month: "short", day: "numeric" })}</Text></View>
    <View style={s.patientInfo}><View style={s.patientAvatar}><Text style={s.patientAvatarText}>{item.patient_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</Text></View><View style={s.patientCopy}><Pressable onPress={() => router.push(`/patient/${item.patient_id}` as any)}><Text style={[s.patientName, { textDecorationLine: "underline" }]}>{item.patient_name}</Text></Pressable><Text style={s.reason}>{item.reason || "General consultation"}</Text></View></View>
    <View style={s.doctorInfo}><Text style={s.doctorLabel}>DOCTOR</Text><Text style={s.doctorName}>{item.doctor_name}</Text></View>
    <View style={[s.statusPill, statusColor]}><Text style={s.statusPillText}>{statusNames[item.status] || item.status}</Text></View>
    {canAdvance ? <View style={s.actionGroup}>{item.status === "IN_PROGRESS" && <Pressable onPress={onSendToLab} style={s.labAction}><Text style={s.labActionText}>Send to lab</Text></Pressable>}<Pressable onPress={onAdvance} style={s.rowAction}><Text style={s.rowActionText}>{item.status === "SCHEDULED" ? "Mark arrived" : item.status === "WAITING_FOR_DOCTOR" ? "Start visit" : "Complete"}</Text></Pressable></View> : <Text style={s.idLabel}>#{item.id}</Text>}
  </View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F5F7F8" }, shell: { flex: 1, flexDirection: "row", width: "100%", maxWidth: 1600, alignSelf: "center" }, shellCompact: { maxWidth: 760 },
  sidebar: { width: 238, backgroundColor: "#102C35", padding: 24, paddingTop: 30 }, brandMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#D3F0E6", alignItems: "center", justifyContent: "center", marginBottom: 15 }, brandGlyph: { fontSize: 25, color: "#147D72", fontWeight: "700", lineHeight: 30 }, brand: { color: "white", fontWeight: "900", fontSize: 13, letterSpacing: 1.3, lineHeight: 19 }, brandLight: { color: "#90B4B2", fontSize: 11, letterSpacing: 2 }, navCaption: { marginTop: 55, marginBottom: 14, color: "#759397", fontSize: 10, letterSpacing: 1.5, fontWeight: "800" }, navItem: { height: 45, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, marginBottom: 5, borderRadius: 10 }, navActive: { backgroundColor: "#1D444A" }, navIcon: { color: "#96B4B5", fontSize: 17, width: 18 }, navText: { color: "#A9C0C0", fontWeight: "600", fontSize: 13 }, navActiveText: { color: "white", fontWeight: "700", fontSize: 13 }, sidebarBottom: { marginTop: "auto", paddingTop: 22, borderTopWidth: 1, borderColor: "#315056", flexDirection: "row", alignItems: "center", gap: 11 }, avatar: { width: 35, height: 35, borderRadius: 20, backgroundColor: "#D6EEE6", alignItems: "center", justifyContent: "center" }, avatarText: { color: "#176C64", fontWeight: "800", fontSize: 11 }, profileName: { color: "white", fontSize: 12, fontWeight: "700" }, profileRole: { color: "#9AB3B5", fontSize: 10, marginTop: 3 },
  content: { paddingHorizontal: 32, paddingTop: 28, paddingBottom: 36, gap: 19, flexGrow: 1 }, topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 }, topbarCompact: { flexWrap: "wrap" }, eyebrow: { fontSize: 9, color: "#789094", fontWeight: "800", letterSpacing: 1.4 }, title: { fontSize: 27, color: "#17343B", fontWeight: "800", marginTop: 5 }, subtitle: { color: "#819294", fontSize: 11, marginTop: 5 }, topActions: { flexDirection: "row", alignItems: "center", gap: 9 }, brandCompact: { width: "100%", color: "#147D72", fontSize: 10, fontWeight: "900", letterSpacing: 1 }, secondaryButton: { borderWidth: 1, borderColor: "#D8E1E1", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, backgroundColor: "white" }, secondaryText: { color: "#4B6268", fontWeight: "700", fontSize: 10 }, addButton: { borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: "#147D72" }, addText: { color: "white", fontSize: 10, fontWeight: "800" }, disabled: { opacity: 0.6 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 11 }, metric: { backgroundColor: "white", borderRadius: 13, borderWidth: 1, borderColor: "#E7ECEB", padding: 15, flexGrow: 1, flexBasis: 160, minWidth: 145 }, metricTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, metricLabel: { color: "#6E8183", fontSize: 11, fontWeight: "700" }, metricIcon: { height: 29, width: 29, borderRadius: 9, alignItems: "center", justifyContent: "center" }, metricIconText: { color: "#477B72", fontSize: 14, fontWeight: "800" }, metricValue: { color: "#19363D", fontSize: 26, fontWeight: "800", marginTop: 12 }, metricNote: { color: "#93A0A1", fontSize: 9, marginTop: 3 },
  formCard: { padding: 18, backgroundColor: "white", borderRadius: 14, borderWidth: 1, borderColor: "#DDE8E5", gap: 17 }, formHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, cardTitle: { color: "#19363D", fontSize: 14, fontWeight: "800" }, cardSub: { color: "#89999A", fontSize: 10, marginTop: 4 }, stepBadge: { borderRadius: 14, backgroundColor: "#E1F3EC", color: "#277D6A", paddingHorizontal: 9, paddingVertical: 5, overflow: "hidden", fontWeight: "800", fontSize: 8 }, formColumns: { flexDirection: "row", gap: 15 }, formColumnsCompact: { flexDirection: "column" }, formField: { flex: 1, gap: 7 }, fieldLabel: { color: "#62787A", fontSize: 9, fontWeight: "800", letterSpacing: 0.8 }, pickerSearch: { borderWidth: 1, borderColor: "#DCE5E3", backgroundColor: "white", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontSize: 10, color: "#1C3439" }, selectionHint: { color: "#277D6A", fontSize: 9, fontWeight: "700" }, options: { maxHeight: 145, borderWidth: 1, borderColor: "#E4EBE9", borderRadius: 9, backgroundColor: "#FBFCFC" }, option: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: "#EEF2F1" }, optionSelected: { backgroundColor: "#E3F4ED" }, optionName: { color: "#455B5D", fontSize: 10, fontWeight: "700" }, optionNameSelected: { color: "#176F64" }, optionMeta: { color: "#91A0A0", fontSize: 9, marginTop: 2 }, emptyOptions: { padding: 12, color: "#96A2A2", fontSize: 10 }, dateTimeRow: { flexDirection: "row", gap: 7 }, input: { borderWidth: 1, borderColor: "#DCE5E3", backgroundColor: "white", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontSize: 11, color: "#1C3439" }, dateInput: { flex: 1.2 }, timeInput: { flex: 0.8 }, fieldHint: { color: "#96A3A3", fontSize: 9 }, reasonLabel: { marginTop: 11 }, reasonInput: { minHeight: 72, textAlignVertical: "top" }, formFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, formNote: { color: "#859595", fontSize: 9, flex: 1 },
  listCard: { backgroundColor: "white", borderRadius: 14, borderWidth: 1, borderColor: "#E7ECEB", padding: 18 }, listHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }, listHeadingCompact: { alignItems: "flex-start" }, refresh: { borderWidth: 1, borderColor: "#E1E8E7", paddingHorizontal: 11, paddingVertical: 8, borderRadius: 8 }, refreshText: { color: "#3C6463", fontWeight: "700", fontSize: 10 }, search: { borderWidth: 1, borderColor: "#E1E8E7", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 10, color: "#1F383D", fontSize: 11 }, chips: { gap: 6, alignItems: "center", paddingVertical: 12 }, chip: { backgroundColor: "#F2F6F5", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 }, chipSelected: { backgroundColor: "#DDF0EA" }, chipText: { color: "#718385", fontSize: 9, fontWeight: "700" }, chipTextSelected: { color: "#176D64" }, chipDivider: { width: 1, height: 20, backgroundColor: "#E5EBEA", marginHorizontal: 4 },
  appointmentRow: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderColor: "#EEF2F1", paddingVertical: 13 }, appointmentRowCompact: { flexWrap: "wrap" }, timeBlock: { width: 58 }, time: { color: "#29464A", fontSize: 12, fontWeight: "800" }, date: { color: "#95A2A2", fontSize: 9, marginTop: 3 }, patientInfo: { flex: 1, minWidth: 150, flexDirection: "row", alignItems: "center", gap: 9 }, patientAvatar: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#E1F1EC", alignItems: "center", justifyContent: "center" }, patientAvatarText: { color: "#34766A", fontSize: 9, fontWeight: "900" }, patientCopy: { flex: 1 }, patientName: { color: "#29464A", fontSize: 11, fontWeight: "800" }, reason: { color: "#8A999A", fontSize: 9, marginTop: 3 }, doctorInfo: { width: 115 }, doctorLabel: { color: "#A0ACAC", fontSize: 8, fontWeight: "800", letterSpacing: 0.6 }, doctorName: { color: "#556D6F", fontSize: 10, fontWeight: "700", marginTop: 4 }, statusPill: { borderRadius: 13, paddingHorizontal: 9, paddingVertical: 6 }, statusScheduled: { backgroundColor: "#E9EEFC" }, statusWaiting: { backgroundColor: "#FFF2DC" }, statusProgress: { backgroundColor: "#E1F3EC" }, statusDone: { backgroundColor: "#F0EAFE" }, statusPillText: { color: "#5E7576", fontSize: 8, fontWeight: "800" }, actionGroup: { flexDirection: "row", alignItems: "center", gap: 5 }, labAction: { minWidth: 68, alignItems: "center", backgroundColor: "#F3EEFC", borderRadius: 7, paddingVertical: 8, paddingHorizontal: 7 }, labActionText: { color: "#7654A5", fontSize: 8, fontWeight: "800" }, rowAction: { minWidth: 83, alignItems: "center", backgroundColor: "#F0F7F4", borderRadius: 7, paddingVertical: 8, paddingHorizontal: 8 }, rowActionText: { color: "#267666", fontSize: 9, fontWeight: "800" }, idLabel: { color: "#A1AEAE", fontSize: 9, width: 83, textAlign: "center" },
  modeTabs: { flexDirection: "row", gap: 6 }, modeTab: { borderRadius: 7, borderWidth: 1, borderColor: "#E1E8E7", paddingVertical: 7, paddingHorizontal: 9, backgroundColor: "white" }, modeTabActive: { backgroundColor: "#DDF0EA", borderColor: "#9DCFC1" }, modeText: { color: "#718385", fontWeight: "700", fontSize: 9 }, modeTextActive: { color: "#176D64" },
  empty: { alignItems: "center", paddingVertical: 40 }, emptyIcon: { color: "#9BBDB2", fontSize: 24, marginBottom: 7 }, emptyTitle: { color: "#314C50", fontSize: 12, fontWeight: "800", marginBottom: 5 }, clearFilters: { color: "#147D72", fontSize: 10, fontWeight: "800", marginTop: 12 }, loading: { alignItems: "center", padding: 30, gap: 9 }, banner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 11, borderRadius: 9 }, errorBanner: { backgroundColor: "#FCE9E7" }, successBanner: { backgroundColor: "#E1F4EB" }, bannerText: { flex: 1, fontSize: 10 }, errorText: { color: "#9C3530" }, successText: { color: "#28704C" }, close: { fontSize: 18, color: "#657B7D", paddingHorizontal: 7 }, footer: { color: "#A1ADAE", fontSize: 8, letterSpacing: 1.2, textAlign: "center", marginTop: 2 }
});
