import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { api } from "../src/services/api";
import { clearAuthToken, getAuthToken } from "../src/services/auth";
import InvestigationReportButton from "../src/components/InvestigationReportButton";

type VisitAppointment = { id: number; patient_id: number; patient_name: string; scheduled_at: string; reason: string; status: string; visit_id: number | null; consultation_saved: boolean };
type Doctor = { id: number; full_name: string; role: string };
type Draft = { symptoms: string; diagnosis: string; clinical_notes: string; treatment_details: string; doctor_advice: string; follow_up_date: string; medicine_name: string; medicine_dosage: string; medicine_frequency: string; medicine_duration: string; medicine_timing: string };
type PatientDirectoryItem = { id: number; name: string; email: string; active: boolean; mobile?: string; age?: number; blood_group?: string; systolic_bp?: number; diastolic_bp?: number };
const statusLabels: Record<string, string> = { SCHEDULED: "Scheduled", WAITING_FOR_DOCTOR: "Waiting", IN_PROGRESS: "In consultation", ROUTED_TO_LAB: "At laboratory", COMPLETED: "Completed" };
const statusNext: Record<string, string> = { WAITING_FOR_DOCTOR: "IN_PROGRESS", IN_PROGRESS: "COMPLETED", ROUTED_TO_LAB: "COMPLETED" };
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const formatTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const formatDay = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
function errorMessage(error: any, fallback: string) {
  const detail = error?.response?.data?.detail;
  return typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((item) => item?.msg).filter(Boolean).join("; ") || fallback : fallback;
}

export default function DoctorDashboard() {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [appointments, setAppointments] = useState<VisitAppointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [patients, setPatients] = useState<PatientDirectoryItem[]>([]);
  const [showPatientList, setShowPatientList] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [treatmentPatient, setTreatmentPatient] = useState<{ id: number; name: string; age?: number } | null>(null);
  const [treatmentAppointment, setTreatmentAppointment] = useState<VisitAppointment | null>(null);
  const [treatmentHistory, setTreatmentHistory] = useState<any[]>([]);
  const [investigationPanel, setInvestigationPanel] = useState<"Scanning" | "Laboratory" | null>(null);
  const [investigationItems, setInvestigationItems] = useState<any[]>([]);
  const [loadingInvestigations, setLoadingInvestigations] = useState(false);
  const [investigationName, setInvestigationName] = useState("");
  const [investigationDepartment, setInvestigationDepartment] = useState<"Scanning" | "Laboratory">("Laboratory");
  const [savingInvestigation, setSavingInvestigation] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const token = await getAuthToken();
      if (!token) { router.replace("/"); return; }
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      const [me, schedule, patientList] = await Promise.all([
        api.get("/api/v1/auth/me"),
        api.get(`/api/v1/appointments/doctor/dashboard?day=${selectedDate}`),
        api.get("/api/v1/patients/directory"),
      ]);
      if (me.data.role !== "DOCTOR") { router.replace("/dashboard"); return; }
      setDoctor(me.data); setAppointments(schedule.data); setPatients(patientList.data);
    } catch (e: any) {
      if (e?.response?.status === 401) router.replace("/");
      else setError(errorMessage(e, "We couldn’t load your schedule."));
    } finally { setLoading(false); }
  }, [selectedDate]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    total: appointments.length,
    waiting: appointments.filter((item) => item.status === "WAITING_FOR_DOCTOR").length,
    inConsultation: appointments.filter((item) => item.status === "IN_PROGRESS").length,
    completed: appointments.filter((item) => item.status === "COMPLETED").length,
  }), [appointments]);
  const queue = appointments.filter((item) => item.status === "WAITING_FOR_DOCTOR");
  const nextPatient = appointments.find((item) => ["WAITING_FOR_DOCTOR", "SCHEDULED"].includes(item.status));
  const activeTreatmentAppointment = treatmentAppointment
    ? appointments.find((item) => item.id === treatmentAppointment.id) || treatmentAppointment
    : null;
  const modalDraft = activeTreatmentAppointment
    ? drafts[activeTreatmentAppointment.id] || { symptoms: "", diagnosis: "", clinical_notes: "", treatment_details: "", doctor_advice: "", follow_up_date: "", medicine_name: "", medicine_dosage: "", medicine_frequency: "", medicine_duration: "", medicine_timing: "" }
    : null;

  async function openTreatmentPopup(patient: { id: number; name: string; age?: number }, appointment?: VisitAppointment) {
    setTreatmentPatient(patient);
    setTreatmentAppointment(appointment || null);
    setTreatmentHistory([]);
    setInvestigationName("");
    setError("");
    try {
      const response = await api.get(`/api/v1/patients/${patient.id}`);
      const records = response.data;
      setTreatmentHistory(records.visits || []);
      if (appointment) {
        const visit = records.visits.find((item: any) => item.appointment_id === appointment.id);
        if (visit) prefillTreatmentDraft(appointment.id, visit);
        return;
      }
      const assigned = records.appointments.filter((item: any) => item.doctor_id === doctor?.id
        && records.visits.some((visit: any) => visit.appointment_id === item.id));
      const active = assigned.find((item: any) => item.status === "IN_PROGRESS") || assigned[0];
      if (active) {
        const visit = records.visits.find((item: any) => item.appointment_id === active.id);
        setTreatmentAppointment({ id: active.id, patient_id: patient.id, patient_name: patient.name,
          scheduled_at: active.scheduled_at, reason: active.reason, status: active.status,
          visit_id: visit?.id ?? null, consultation_saved: Boolean(visit?.consultation) });
        if (visit) prefillTreatmentDraft(active.id, visit);
      }
    } catch (e: any) {
      setError(errorMessage(e, "Could not load this patient’s assigned visits."));
    }
  }

  function prefillTreatmentDraft(appointmentId: number, visit: any) {
    const consultation = visit.consultation;
    const medicine = visit.prescriptions?.[0];
    setDrafts((current) => ({
      ...current,
      [appointmentId]: {
        symptoms: consultation?.symptoms || "",
        diagnosis: consultation?.diagnosis || "",
        clinical_notes: consultation?.clinical_notes || "",
        treatment_details: consultation?.treatment_details || "",
        doctor_advice: consultation?.doctor_advice || "",
        follow_up_date: consultation?.follow_up_date || "",
        medicine_name: medicine?.medicine_name || "",
        medicine_dosage: medicine?.dosage || "",
        medicine_frequency: medicine?.frequency || "",
        medicine_duration: medicine?.duration || "",
        medicine_timing: medicine?.timing || "",
      },
    }));
  }

  async function openInvestigationPanel(patientId: number, department: "Scanning" | "Laboratory") {
    setInvestigationPanel(department); setInvestigationItems([]); setLoadingInvestigations(true); setError("");
    try {
      const response = await api.get(`/api/v1/patients/${patientId}`);
      const investigations = (response.data.visits || []).flatMap((visit: any) => (visit.investigations || []).map((item: any) => ({ ...item, visit_number: visit.visit_number, visit_date: visit.created_at })));
      const terms = department === "Scanning" ? ["scan", "radiolog", "imag"] : ["lab", "patholog"];
      setInvestigationItems(investigations.filter((item: any) => terms.some((term) => String(item.department || "").toLowerCase().includes(term))));
    } catch (e: any) {
      setError(errorMessage(e, `Could not load ${department.toLowerCase()} details.`));
    } finally { setLoadingInvestigations(false); }
  }

  async function changeStatus(item: VisitAppointment, status: string) {
    setBusyId(item.id); setError(""); setNotice("");
    try {
      await api.post(`/api/v1/appointments/${item.id}/transition`, { status });
      setNotice(`${item.patient_name} · ${statusLabels[status]}`); await load();
    } catch (e: any) { setError(errorMessage(e, "Could not update this visit.")); }
    finally { setBusyId(null); }
  }

  async function saveConsultation(item: VisitAppointment) {
    const draft = drafts[item.id] || { symptoms: "", diagnosis: "", clinical_notes: "", treatment_details: "", doctor_advice: "", follow_up_date: "", medicine_name: "", medicine_dosage: "", medicine_frequency: "", medicine_duration: "", medicine_timing: "" };
    if (!draft.diagnosis.trim() && !draft.symptoms.trim()) { setError("Enter at least symptoms or a diagnosis before saving treatment."); return; }
    if (draft.follow_up_date && Number.isNaN(new Date(`${draft.follow_up_date}T12:00:00`).getTime())) { setError("Enter the follow-up date in YYYY-MM-DD format."); return; }
    setBusyId(item.id); setError(""); setNotice("");
    try {
      let visitId = item.visit_id;
      if (["SCHEDULED", "WAITING_FOR_DOCTOR"].includes(item.status)) {
        const started = await api.post(`/api/v1/appointments/${item.id}/transition`, { status: "IN_PROGRESS" });
        visitId = started.data.visit_id || visitId;
      }
      if (!visitId) { await load(); setError("The visit started, but its record could not be loaded. Refresh and try again."); return; }
      await api.post("/api/v1/consultations", {
        visit_id: visitId, symptoms: draft.symptoms, diagnosis: draft.diagnosis,
        clinical_notes: draft.clinical_notes, treatment_details: draft.treatment_details,
        doctor_advice: draft.doctor_advice,
        follow_up_date: draft.follow_up_date ? new Date(`${draft.follow_up_date}T12:00:00`).toISOString() : null,
        medicine_name: draft.medicine_name, medicine_dosage: draft.medicine_dosage,
        medicine_frequency: draft.medicine_frequency, medicine_duration: draft.medicine_duration,
        medicine_timing: draft.medicine_timing,
      });
      setNotice(`Treatment updated for ${item.patient_name}.`); await load();
    } catch (e: any) {
      const message = errorMessage(e, "Could not save consultation notes.");
      await load();
      setError(message);
    }
    finally { setBusyId(null); }
  }

  async function requestInvestigation() {
    if (!activeTreatmentAppointment) { setError("Open an assigned patient visit before requesting a scan or laboratory test."); return; }
    if (!investigationName.trim()) { setError("Enter the scan or laboratory test name."); return; }
    setSavingInvestigation(true); setError(""); setNotice("");
    try {
      let visitId = activeTreatmentAppointment.visit_id;
      if (["SCHEDULED", "WAITING_FOR_DOCTOR"].includes(activeTreatmentAppointment.status)) {
        const started = await api.post(`/api/v1/appointments/${activeTreatmentAppointment.id}/transition`, { status: "IN_PROGRESS" });
        visitId = started.data.visit_id || visitId;
      }
      if (!visitId) { await load(); setError("Could not create the patient visit for this request."); return; }
      await api.post("/api/v1/investigations", {
        visit_id: visitId,
        test_name: investigationName.trim(), department: investigationDepartment,
      });
      setNotice(`${investigationDepartment} request added for ${treatmentPatient?.name || "patient"}.`);
      setInvestigationName("");
      if (treatmentPatient) {
        const response = await api.get(`/api/v1/patients/${treatmentPatient.id}`);
        setTreatmentHistory(response.data.visits || []);
      }
    } catch (e: any) { setError(errorMessage(e, "Could not add the scan or laboratory request.")); }
    finally { setSavingInvestigation(false); }
  }

  function editDraft(id: number, key: keyof Draft, value: string) {
    const empty = { symptoms: "", diagnosis: "", clinical_notes: "", treatment_details: "", doctor_advice: "", follow_up_date: "", medicine_name: "", medicine_dosage: "", medicine_frequency: "", medicine_duration: "", medicine_timing: "" };
    setDrafts((current) => ({ ...current, [id]: { ...empty, ...current[id], [key]: value } }));
  }

  function dateChoice(offset: number) {
    const date = new Date(); date.setDate(date.getDate() + offset); return dateKey(date);
  }

  return <View style={s.page}><View style={[s.shell, compact && s.shellCompact]}>
    {!compact && <View style={s.sidebar}><View style={s.brandMark}><Text style={s.brandGlyph}>+</Text></View><Text style={s.brand}>MEDICAL{`\n`}<Text style={s.brandLight}>WORKSPACE</Text></Text><Text style={s.navCaption}>DOCTOR</Text><Pressable style={[s.navItem, !showPatientList && s.navActive]} onPress={() => setShowPatientList(false)}><Text style={s.navIcon}>▦</Text><Text style={!showPatientList ? s.navActiveText : s.navText}>My schedule</Text></Pressable><Pressable style={[s.navItem, showPatientList && s.navActive]} onPress={() => setShowPatientList(true)}><Text style={s.navIcon}>♡</Text><Text style={showPatientList ? s.navActiveText : s.navText}>Patient list</Text></Pressable><Pressable style={s.navItem} onPress={() => { setShowPatientList(false); setSelectedDate(dateKey(new Date())); }}><Text style={s.navIcon}>◷</Text><Text style={s.navText}>Today’s queue</Text></Pressable><View style={s.sidebarBottom}><View style={s.avatar}><Text style={s.avatarText}>{(doctor?.full_name || "DR").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</Text></View><View><Text style={s.profileName}>{doctor?.full_name || "Doctor"}</Text><Text style={s.profileRole}>Care team</Text></View></View></View>}
    <ScrollView contentContainerStyle={s.content}>
      <View style={[s.topbar, compact && s.topbarCompact]}><View><Text style={s.eyebrow}>DOCTOR WORKSPACE · {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }).toUpperCase()}</Text><Text style={s.title}>Good day{doctor?.full_name ? `, Dr. ${doctor.full_name.split(" ").slice(-1)[0]}` : ""}</Text><Text style={s.subtitle}>Here’s your clinic schedule and patient queue.</Text></View><View style={s.topActions}>{compact && <Text style={s.brandCompact}>MEDICAL WORKSPACE</Text>}<Pressable style={s.secondaryButton} onPress={() => setShowPatientList((value) => !value)}><Text style={s.secondaryText}>♡ Patient list</Text></Pressable><Pressable disabled={loading} style={[s.secondaryButton, loading && s.disabled]} onPress={() => void load()}><Text style={s.secondaryText}>{loading ? "Refreshing…" : "↻ Refresh"}</Text></Pressable><Pressable style={s.logout} onPress={async () => { await clearAuthToken(); router.replace("/"); }}><Text style={s.logoutText}>Sign out</Text></Pressable></View></View>
      {error ? <Banner message={error} tone="error" onClose={() => setError("")} /> : null}{notice ? <Banner message={notice} tone="success" onClose={() => setNotice("")} /> : null}
      <View style={s.hero}><View style={s.heroCopy}><Text style={s.heroKicker}>YOUR CLINICAL DAY</Text><Text style={s.heroTitle}>{formatDay(selectedDate)}</Text><Text style={s.heroSub}>{nextPatient ? `Next up: ${nextPatient.patient_name} at ${formatTime(nextPatient.scheduled_at)}` : "Your schedule is clear. You’re all caught up."}</Text></View><View style={s.heroArt}><View style={s.heroCircle}><Text style={s.heroCross}>＋</Text></View><View style={s.heroTag}><Text style={s.heroTagText}>Patient first</Text></View></View></View>
      <View style={s.dateRow}>{[0, 1, 2].map((offset) => { const key = dateChoice(offset); const chosen = selectedDate === key; const label = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : new Date(`${key}T12:00:00`).toLocaleDateString([], { weekday: "short" }); return <Pressable key={key} onPress={() => setSelectedDate(key)} style={[s.dateTab, chosen && s.dateTabSelected]}><Text style={[s.dateTabDay, chosen && s.dateTabDaySelected]}>{label}</Text><Text style={[s.dateTabDate, chosen && s.dateTabDateSelected]}>{new Date(`${key}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}</Text></Pressable>; })}</View>
      {showPatientList && <View style={s.patientListCard}>
        <View style={s.panelHeading}><View><Text style={s.panelTitle}>Patient list</Text><Text style={s.panelSub}>Open a patient to view profile and previous medical history.</Text></View><Pressable style={s.closeListButton} onPress={() => setShowPatientList(false)}><Text style={s.closeListText}>Close</Text></Pressable></View>
        <TextInput value={patientSearch} onChangeText={setPatientSearch} placeholder="Search patients" placeholderTextColor="#91A0A0" style={s.patientSearch} />
        {patients.filter((patient) => `${patient.name} ${patient.email} ${patient.mobile || ""}`.toLowerCase().includes(patientSearch.toLowerCase())).map((patient) => <Pressable key={patient.id} onPress={() => { const assignedVisit = appointments.find((item) => item.patient_id === patient.id && item.status === "IN_PROGRESS") || appointments.find((item) => item.patient_id === patient.id); openTreatmentPopup({ id: patient.id, name: patient.name, age: patient.age }, assignedVisit); }} style={s.patientListRow}>
          <View style={s.patientAvatar}><Text style={s.avatarInitial}>{patient.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</Text></View>
          <View style={s.patientCopy}><Text style={s.patientName}>{patient.name}</Text><Text style={s.patientMeta}>{patient.email || "No email"} · Age {patient.age ?? "—"} · Blood group {patient.blood_group || "—"} · BP {patient.systolic_bp && patient.diastolic_bp ? `${patient.systolic_bp}/${patient.diastolic_bp}` : "—"}</Text></View>
          <Text style={s.openPatientText}>Open ›</Text>
        </Pressable>)}
      </View>}
      <View style={s.metrics}><Metric label="Appointments" value={counts.total} note="On your schedule" color="#E8F0FE" icon="▣" /><Metric label="Waiting for you" value={counts.waiting} note="Ready for consultation" color="#FFF1D9" icon="◷" /><Metric label="In consultation" value={counts.inConsultation} note="Currently in progress" color="#E2F4EE" icon="♡" /><Metric label="Completed" value={counts.completed} note="Finished today" color="#F0EAFE" icon="✓" /></View>
      <View style={[s.columns, compact && s.columnsCompact]}><View style={s.schedulePanel}><View style={s.panelHeading}><View><Text style={s.panelTitle}>Patient queue</Text><Text style={s.panelSub}>{queue.length ? `${queue.length} patient${queue.length === 1 ? "" : "s"} waiting` : "Arrived patients appear here"}</Text></View><View style={s.liveBadge}><View style={s.liveDot} /><Text style={s.liveText}>LIVE QUEUE</Text></View></View>
        {loading && appointments.length === 0 ? <View style={s.loading}><ActivityIndicator color="#147D72" /><Text style={s.panelSub}>Loading your schedule…</Text></View> : queue.length ? queue.map((item, index) => <View key={`queue-${item.id}`} style={s.queueRow}><View style={s.queueNumber}><Text style={s.queueNumberText}>{index + 1}</Text></View><View style={s.queuePatient}><Pressable onPress={() => openTreatmentPopup({ id: item.patient_id, name: item.patient_name, age: patients.find((patient) => patient.id === item.patient_id)?.age }, item)}><Text style={[s.patientName, { textDecorationLine: "underline" }]}>{item.patient_name}</Text></Pressable><Text style={s.patientMeta}>{item.reason || "General consultation"} · Arrived {formatTime(item.scheduled_at)}</Text></View><Pressable disabled={busyId === item.id} onPress={() => void changeStatus(item, "IN_PROGRESS")} style={[s.startButton, busyId === item.id && s.disabled]}><Text style={s.startText}>{busyId === item.id ? "Working…" : "Start visit"}</Text></Pressable></View>) : <View style={s.emptyQueue}><Text style={s.emptyIcon}>✓</Text><Text style={s.emptyTitle}>No patients waiting</Text><Text style={s.panelSub}>Take a moment before your next visit.</Text></View>}
      </View><View style={s.sideColumn}><View style={s.tipCard}><Text style={s.tipIcon}>✦</Text><Text style={s.tipTitle}>Care begins with listening</Text><Text style={s.tipText}>Review each patient’s reason for visit and capture clear notes during consultation.</Text></View><View style={s.statusCard}><Text style={s.panelTitle}>Visit status guide</Text>{[["Scheduled", "Waiting for reception to check in", "#647FBD"], ["Waiting", "Patient has arrived", "#C38B37"], ["In consultation", "Visit is in progress", "#328B73"], ["At laboratory", "Patient has been routed to lab", "#8B70BC"]].map(([name, description, color]) => <View key={name} style={s.guideRow}><View style={[s.guideDot, { backgroundColor: color }]} /><View><Text style={s.guideName}>{name}</Text><Text style={s.guideText}>{description}</Text></View></View>)}</View></View></View>
      <View style={s.scheduleCard}><View style={s.panelHeading}><View><Text style={s.panelTitle}>Today’s schedule</Text><Text style={s.panelSub}>Visits assigned to you for this date</Text></View><Text style={s.totalPill}>{appointments.length} visits</Text></View>
        {!appointments.length && !loading ? <View style={s.emptySchedule}><Text style={s.emptyTitle}>No appointments scheduled</Text><Text style={s.panelSub}>There are no visits assigned to you on this date.</Text></View> : appointments.map((item) => <View key={item.id} style={[s.appointmentCard, compact && s.appointmentCardCompact]}>
          <View style={s.appointmentTime}><Text style={s.timeText}>{formatTime(item.scheduled_at)}</Text><Text style={s.timeLine}>•</Text></View><View style={s.appointmentInfo}><View style={s.patientLine}><View style={s.patientAvatar}><Text style={s.avatarInitial}>{item.patient_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</Text></View><View style={s.patientCopy}><Pressable onPress={() => openTreatmentPopup({ id: item.patient_id, name: item.patient_name, age: patients.find((patient) => patient.id === item.patient_id)?.age }, item)}><Text style={[s.patientName, { textDecorationLine: "underline" }]}>{item.patient_name}</Text></Pressable><Text style={s.patientMeta}>{item.reason || "General consultation"}</Text></View></View><View style={s.appointmentStatusActions}><View style={s.appointmentMeta}><View style={[s.statusPill, statusStyle(item.status)]}><Text style={s.statusText}>{statusLabels[item.status] || item.status}</Text></View>{item.consultation_saved ? <Text style={s.savedNote}>Treatment saved · can update</Text> : null}</View>
            <Pressable onPress={() => openTreatmentPopup({ id: item.patient_id, name: item.patient_name, age: patients.find((patient) => patient.id === item.patient_id)?.age }, item)} style={s.noteButton}><Text style={s.noteButtonText}>{item.consultation_saved ? "Update treatment" : "+ Add treatment"}</Text></Pressable>
            <View style={[s.actions, { flexWrap: "wrap" }]}><Pressable onPress={() => void openInvestigationPanel(item.patient_id, "Scanning")} style={s.labButton}><Text style={s.labText}>Scanning</Text></Pressable><Pressable onPress={() => void openInvestigationPanel(item.patient_id, "Laboratory")} style={s.labButton}><Text style={s.labText}>Laboratory</Text></Pressable>{statusNext[item.status] && <Pressable disabled={busyId === item.id} onPress={() => void changeStatus(item, statusNext[item.status])} style={s.completeButton}><Text style={s.completeText}>{item.status === "WAITING_FOR_DOCTOR" ? "Start visit" : "Complete"}</Text></Pressable>}</View>
          </View></View>
          {expandedId === item.id && item.status === "IN_PROGRESS" && !item.consultation_saved && <View style={s.consultationForm}>
            <Text style={s.formTitle}>Diagnosis and treatment</Text>
            <TextInput value={drafts[item.id]?.symptoms || ""} onChangeText={(value) => editDraft(item.id, "symptoms", value)} placeholder="Symptoms" placeholderTextColor="#91A0A0" style={s.input} />
            <TextInput value={drafts[item.id]?.diagnosis || ""} onChangeText={(value) => editDraft(item.id, "diagnosis", value)} placeholder="Diagnosis / health problem" placeholderTextColor="#91A0A0" style={s.input} />
            <TextInput value={drafts[item.id]?.treatment_details || ""} onChangeText={(value) => editDraft(item.id, "treatment_details", value)} placeholder="Treatment details" placeholderTextColor="#91A0A0" multiline style={[s.input, s.notesInput]} />
            <Text style={s.formTitle}>Medicine</Text>
            <View style={s.formGrid}>
              <TextInput value={drafts[item.id]?.medicine_name || ""} onChangeText={(value) => editDraft(item.id, "medicine_name", value)} placeholder="Medicine name" placeholderTextColor="#91A0A0" style={[s.input, s.gridInput]} />
              <TextInput value={drafts[item.id]?.medicine_dosage || ""} onChangeText={(value) => editDraft(item.id, "medicine_dosage", value)} placeholder="Dosage" placeholderTextColor="#91A0A0" style={[s.input, s.gridInput]} />
              <TextInput value={drafts[item.id]?.medicine_frequency || ""} onChangeText={(value) => editDraft(item.id, "medicine_frequency", value)} placeholder="Frequency, e.g. 1-0-1" placeholderTextColor="#91A0A0" style={[s.input, s.gridInput]} />
              <TextInput value={drafts[item.id]?.medicine_duration || ""} onChangeText={(value) => editDraft(item.id, "medicine_duration", value)} placeholder="Duration, e.g. 5 days" placeholderTextColor="#91A0A0" style={[s.input, s.gridInput]} />
              <TextInput value={drafts[item.id]?.medicine_timing || ""} onChangeText={(value) => editDraft(item.id, "medicine_timing", value)} placeholder="Before / after food" placeholderTextColor="#91A0A0" style={[s.input, s.gridInput]} />
              <TextInput value={drafts[item.id]?.follow_up_date || ""} onChangeText={(value) => editDraft(item.id, "follow_up_date", value)} placeholder="Follow-up YYYY-MM-DD" placeholderTextColor="#91A0A0" style={[s.input, s.gridInput]} />
            </View>
            <TextInput value={drafts[item.id]?.doctor_advice || ""} onChangeText={(value) => editDraft(item.id, "doctor_advice", value)} placeholder="Doctor’s advice" placeholderTextColor="#91A0A0" multiline style={[s.input, s.notesInput]} />
            <TextInput value={drafts[item.id]?.clinical_notes || ""} onChangeText={(value) => editDraft(item.id, "clinical_notes", value)} placeholder="Additional clinical notes" placeholderTextColor="#91A0A0" multiline style={[s.input, s.notesInput]} />
            <Pressable disabled={busyId === item.id} onPress={() => void saveConsultation(item)} style={s.saveButton}><Text style={s.saveText}>{busyId === item.id ? "Saving…" : "Save treatment"}</Text></Pressable>
          </View>}
        </View>)}
      </View>
      <Text style={s.footer}>MEDICAL MANAGEMENT SYSTEM · DOCTOR WORKSPACE</Text>
    </ScrollView>
  </View>
    <Modal visible={Boolean(treatmentPatient)} transparent animationType="fade" onRequestClose={() => { setTreatmentPatient(null); setTreatmentAppointment(null); }}>
      <View style={s.modalShade}><View style={[s.modalCard, compact && s.modalCardCompact]}>
        <View style={s.modalHeader}><View><Text style={s.modalTitle}>Patient Treatment Details</Text><Text style={s.modalSubtitle}>Doctor Panel</Text></View><Pressable onPress={() => { setTreatmentPatient(null); setTreatmentAppointment(null); }}><Text style={s.modalClose}>×</Text></Pressable></View>
        {treatmentPatient && <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.modalContent}>
          {error ? <Text style={s.modalError}>{error}</Text> : null}
          <Text style={s.modalSectionTitle}>Patient Information</Text>
          <Text style={s.modalInfo}>Patient ID: P{String(treatmentPatient.id).padStart(5, "0")}</Text>
          <Text style={s.modalInfo}>Patient Name: {treatmentPatient.name}</Text>
          <Text style={s.modalInfo}>Age: {treatmentPatient.age ?? "—"} · Gender: —</Text>
          <Text style={s.modalSectionTitle}>Previous Treatment History</Text>
          {treatmentHistory.length ? treatmentHistory.map((visit) => <View key={visit.id} style={s.modalHistoryRow}>
            <Text style={s.modalInfo}>Visit {visit.visit_number} · {new Date(visit.created_at).toLocaleDateString()}</Text>
            {visit.consultation?.diagnosis ? <Text style={s.modalHistoryText}>Diagnosis: {visit.consultation.diagnosis}</Text> : null}
            {visit.consultation?.symptoms ? <Text style={s.modalHistoryText}>Symptoms: {visit.consultation.symptoms}</Text> : null}
            {visit.consultation?.treatment_details ? <Text style={s.modalHistoryText}>Treatment: {visit.consultation.treatment_details}</Text> : null}
            {visit.consultation?.clinical_notes ? <Text style={s.modalHistoryText}>Clinical notes: {visit.consultation.clinical_notes}</Text> : null}
            {visit.prescriptions?.map((medicine: any, index: number) => <Text key={index} style={s.modalHistoryText}>Medicine: {medicine.medicine_name || medicine.instructions}{medicine.dosage ? ` · ${medicine.dosage}` : ""}{medicine.frequency ? ` · ${medicine.frequency}` : ""}{medicine.duration ? ` · ${medicine.duration}` : ""}{medicine.timing ? ` · ${medicine.timing} food` : ""}</Text>)}
            {visit.consultation?.doctor_advice ? <Text style={s.modalHistoryText}>Doctor’s advice: {visit.consultation.doctor_advice}</Text> : null}
            {visit.consultation?.follow_up_date ? <Text style={s.modalHistoryText}>Next follow-up: {visit.consultation.follow_up_date}</Text> : null}
            {visit.investigations?.map((item: any, index: number) => <View key={`test-${index}`}><Text style={s.modalHistoryText}>Investigation: {item.test_name} · {item.department} · {item.status}{item.result ? ` · Findings: ${item.result}` : ""}</Text><InvestigationReportButton id={item.id} filename={item.report_filename} /></View>)}
          </View>) : <Text style={s.modalNotice}>No previous treatment is recorded.</Text>}
          {activeTreatmentAppointment ? <>
            <Text style={s.modalSectionTitle}>Diagnosis &amp; Treatment</Text>
            <TextInput value={modalDraft?.diagnosis || ""} onChangeText={(value) => editDraft(activeTreatmentAppointment.id, "diagnosis", value)} placeholder="Diagnosis" style={s.modalInput} />
            <TextInput value={modalDraft?.symptoms || ""} onChangeText={(value) => editDraft(activeTreatmentAppointment.id, "symptoms", value)} placeholder="Symptoms" style={s.modalInput} />
            <TextInput value={modalDraft?.treatment_details || ""} onChangeText={(value) => editDraft(activeTreatmentAppointment.id, "treatment_details", value)} placeholder="Treatment details" multiline style={[s.modalInput, s.modalMultiline]} />
            <Text style={s.modalSectionTitle}>Medicine Details</Text>
            <TextInput value={modalDraft?.medicine_name || ""} onChangeText={(value) => editDraft(activeTreatmentAppointment.id, "medicine_name", value)} placeholder="Medicine name" style={s.modalInput} />
            <TextInput value={modalDraft?.medicine_dosage || ""} onChangeText={(value) => editDraft(activeTreatmentAppointment.id, "medicine_dosage", value)} placeholder="Dosage" style={s.modalInput} />
            <TextInput value={modalDraft?.medicine_frequency || ""} onChangeText={(value) => editDraft(activeTreatmentAppointment.id, "medicine_frequency", value)} placeholder="Frequency" style={s.modalInput} />
            <TextInput value={modalDraft?.medicine_duration || ""} onChangeText={(value) => editDraft(activeTreatmentAppointment.id, "medicine_duration", value)} placeholder="Duration" style={s.modalInput} />
            <Text style={s.modalFieldLabel}>Food timing</Text>
            <View style={s.foodTimingChoices}>{["Before food", "After food", "With food"].map((choice) => <Pressable key={choice} onPress={() => editDraft(activeTreatmentAppointment.id, "medicine_timing", choice.replace(" food", ""))} style={[s.foodTimingChoice, modalDraft?.medicine_timing === choice.replace(" food", "") && s.foodTimingChoiceSelected]}><Text style={s.foodTimingText}>{choice}</Text></Pressable>)}</View>
            <TextInput value={modalDraft?.doctor_advice || ""} onChangeText={(value) => editDraft(activeTreatmentAppointment.id, "doctor_advice", value)} placeholder="Doctor’s advice" multiline style={[s.modalInput, s.modalMultiline]} />
            <TextInput value={modalDraft?.follow_up_date || ""} onChangeText={(value) => editDraft(activeTreatmentAppointment.id, "follow_up_date", value)} placeholder="Next follow-up date (YYYY-MM-DD)" style={s.modalInput} />
            <TextInput value={modalDraft?.clinical_notes || ""} onChangeText={(value) => editDraft(activeTreatmentAppointment.id, "clinical_notes", value)} placeholder="Additional clinical notes" multiline style={[s.modalInput, s.modalMultiline]} />
            <Text style={s.modalSectionTitle}>Request a scan or laboratory test</Text>
            <TextInput value={investigationName} onChangeText={setInvestigationName} placeholder="Scan or test name" style={s.modalInput} />
            <View style={s.foodTimingChoices}>{(["Scanning", "Laboratory"] as const).map((department) => <Pressable key={department} onPress={() => setInvestigationDepartment(department)} style={[s.foodTimingChoice, investigationDepartment === department && s.foodTimingChoiceSelected]}><Text style={s.foodTimingText}>{department}</Text></Pressable>)}</View>
            <Pressable disabled={savingInvestigation || !investigationName.trim()} onPress={() => void requestInvestigation()} style={[s.modalSave, (savingInvestigation || !investigationName.trim()) && s.disabled]}><Text style={s.modalSaveText}>{savingInvestigation ? "Submitting…" : `Submit ${investigationDepartment} Request`}</Text></Pressable>
            <Pressable disabled={busyId === activeTreatmentAppointment.id} onPress={() => void saveConsultation(activeTreatmentAppointment)} style={[s.modalSave, busyId === activeTreatmentAppointment.id && s.disabled]}><Text style={s.modalSaveText}>{busyId === activeTreatmentAppointment.id ? "Saving…" : ["SCHEDULED", "WAITING_FOR_DOCTOR"].includes(activeTreatmentAppointment.status) ? "Start visit & submit treatment" : "Submit / Update Treatment Details"}</Text></Pressable>
          </> : <Text style={s.modalNotice}>No appointment is assigned to this patient for the selected day. Open an assigned visit from your schedule to add treatment.</Text>}
        </ScrollView>}
      </View></View>
    </Modal>
    <Modal visible={Boolean(investigationPanel)} transparent animationType="fade" onRequestClose={() => setInvestigationPanel(null)}>
      <View style={s.modalShade}><View style={[s.modalCard, compact && s.modalCardCompact]}>
        <View style={s.modalHeader}><View><Text style={s.modalTitle}>{investigationPanel} details</Text><Text style={s.modalSubtitle}>Patient scan and laboratory records</Text></View><Pressable onPress={() => setInvestigationPanel(null)}><Text style={s.modalClose}>×</Text></Pressable></View>
        <ScrollView contentContainerStyle={s.modalContent}>
          {loadingInvestigations ? <View style={s.loading}><ActivityIndicator color="#147D72" /><Text style={s.panelSub}>Loading {investigationPanel?.toLowerCase()} records…</Text></View> : investigationItems.length ? investigationItems.map((item, index) => <View key={item.id || index} style={s.modalHistoryRow}>
            <Text style={s.modalInfo}>{item.test_name} · {item.department} · {item.status}</Text>
            <Text style={s.modalHistoryText}>Visit {item.visit_number} · {new Date(item.visit_date).toLocaleDateString()}</Text>
            {item.result ? <Text style={s.modalHistoryText}>Findings: {item.result}</Text> : <Text style={s.modalNotice}>No findings have been submitted yet.</Text>}
            {item.report_filename ? <InvestigationReportButton id={item.id} filename={item.report_filename} /> : <Text style={s.modalNotice}>No PDF report uploaded yet.</Text>}
          </View>) : <Text style={s.modalNotice}>No {investigationPanel?.toLowerCase()} requests or reports for this patient.</Text>}
        </ScrollView>
      </View></View>
    </Modal>
  </View>;
}

function Metric({ label, value, note, color, icon }: { label: string; value: number; note: string; color: string; icon: string }) { return <View style={s.metric}><View style={s.metricTop}><Text style={s.metricLabel}>{label}</Text><View style={[s.metricIcon, { backgroundColor: color }]}><Text style={s.metricIconText}>{icon}</Text></View></View><Text style={s.metricValue}>{value}</Text><Text style={s.metricNote}>{note}</Text></View>; }
function Banner({ message, tone, onClose }: { message: string; tone: "error" | "success"; onClose: () => void }) { return <View style={[s.banner, tone === "error" ? s.errorBanner : s.successBanner]}><Text style={[s.bannerText, tone === "error" ? s.errorText : s.successText]}>{message}</Text><Pressable onPress={onClose}><Text style={s.close}>×</Text></Pressable></View>; }
function statusStyle(status: string) { return status === "COMPLETED" ? s.statusDone : status === "IN_PROGRESS" ? s.statusProgress : status === "WAITING_FOR_DOCTOR" ? s.statusWaiting : status === "ROUTED_TO_LAB" ? s.statusLab : s.statusScheduled; }

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F5F7F8" }, shell: { flex: 1, flexDirection: "row", width: "100%", maxWidth: 1600, alignSelf: "center" }, shellCompact: { maxWidth: 760 },
  sidebar: { width: 238, backgroundColor: "#102C35", padding: 24, paddingTop: 30 }, brandMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#D3F0E6", alignItems: "center", justifyContent: "center", marginBottom: 15 }, brandGlyph: { fontSize: 25, color: "#147D72", fontWeight: "700", lineHeight: 30 }, brand: { color: "white", fontWeight: "900", fontSize: 13, letterSpacing: 1.3, lineHeight: 19 }, brandLight: { color: "#90B4B2", fontSize: 11, letterSpacing: 2 }, navCaption: { marginTop: 55, marginBottom: 14, color: "#759397", fontSize: 10, letterSpacing: 1.5, fontWeight: "800" }, navItem: { height: 45, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, marginBottom: 5, borderRadius: 10 }, navActive: { backgroundColor: "#1D444A" }, navIcon: { color: "#96B4B5", fontSize: 17, width: 18 }, navText: { color: "#A9C0C0", fontWeight: "600", fontSize: 13 }, navActiveText: { color: "white", fontWeight: "700", fontSize: 13 }, sidebarBottom: { marginTop: "auto", paddingTop: 22, borderTopWidth: 1, borderColor: "#315056", flexDirection: "row", alignItems: "center", gap: 11 }, avatar: { width: 35, height: 35, borderRadius: 20, backgroundColor: "#D6EEE6", alignItems: "center", justifyContent: "center" }, avatarText: { color: "#176C64", fontWeight: "800", fontSize: 11 }, profileName: { color: "white", fontSize: 12, fontWeight: "700" }, profileRole: { color: "#9AB3B5", fontSize: 10, marginTop: 3 },
  content: { paddingHorizontal: 32, paddingTop: 28, paddingBottom: 35, gap: 18, flexGrow: 1 }, topbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, topbarCompact: { flexWrap: "wrap" }, eyebrow: { color: "#7C9293", fontSize: 9, letterSpacing: 1.2, fontWeight: "800" }, title: { color: "#18363C", fontSize: 27, fontWeight: "800", marginTop: 5 }, subtitle: { color: "#829496", fontSize: 11, marginTop: 4 }, topActions: { flexDirection: "row", alignItems: "center", gap: 8 }, brandCompact: { width: "100%", color: "#147D72", fontSize: 10, fontWeight: "900", letterSpacing: 1 }, secondaryButton: { borderWidth: 1, borderColor: "#D8E1E1", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: "white" }, secondaryText: { color: "#4B6268", fontWeight: "700", fontSize: 10 }, logout: { paddingHorizontal: 10, paddingVertical: 9 }, logoutText: { color: "#647A7C", fontWeight: "700", fontSize: 10 },
  hero: { borderRadius: 16, backgroundColor: "#DDF0EA", padding: 23, minHeight: 152, flexDirection: "row", justifyContent: "space-between", alignItems: "center", overflow: "hidden" }, heroCopy: { maxWidth: 530 }, heroKicker: { color: "#398277", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 }, heroTitle: { color: "#173D40", fontSize: 22, fontWeight: "800", marginTop: 8 }, heroSub: { color: "#547774", fontSize: 11, marginTop: 8 }, heroArt: { width: 150, height: 110, alignItems: "center", justifyContent: "center" }, heroCircle: { width: 88, height: 88, borderRadius: 45, backgroundColor: "#C5E7DC", alignItems: "center", justifyContent: "center", transform: [{ rotate: "-12deg" }] }, heroCross: { color: "#389587", fontSize: 45, fontWeight: "300" }, heroTag: { position: "absolute", right: 0, bottom: 3, backgroundColor: "white", borderRadius: 15, paddingHorizontal: 11, paddingVertical: 7, transform: [{ rotate: "-5deg" }] }, heroTagText: { color: "#328378", fontWeight: "800", fontSize: 9 },
  dateRow: { flexDirection: "row", gap: 8 }, dateTab: { minWidth: 94, borderRadius: 10, borderWidth: 1, borderColor: "#E2E9E7", paddingVertical: 9, paddingHorizontal: 12, backgroundColor: "white" }, dateTabSelected: { backgroundColor: "#147D72", borderColor: "#147D72" }, dateTabDay: { color: "#779092", fontSize: 9, fontWeight: "700" }, dateTabDaySelected: { color: "#BEE8D9" }, dateTabDate: { color: "#29464A", fontSize: 11, fontWeight: "800", marginTop: 3 }, dateTabDateSelected: { color: "white" }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, metric: { backgroundColor: "white", borderRadius: 12, borderWidth: 1, borderColor: "#E7ECEB", padding: 14, flexGrow: 1, flexBasis: 155, minWidth: 145 }, metricTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, metricLabel: { color: "#6E8183", fontSize: 10, fontWeight: "700" }, metricIcon: { height: 28, width: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" }, metricIconText: { color: "#477B72", fontSize: 13, fontWeight: "800" }, metricValue: { color: "#19363D", fontSize: 25, fontWeight: "800", marginTop: 11 }, metricNote: { color: "#93A0A1", fontSize: 9, marginTop: 3 },
  patientListCard: { backgroundColor: "white", borderWidth: 1, borderColor: "#E5ECEA", borderRadius: 14, padding: 16 }, closeListButton: { backgroundColor: "#EFF5F3", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 }, closeListText: { color: "#557173", fontSize: 10, fontWeight: "800" }, patientSearch: { borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9, marginVertical: 10, fontSize: 11, color: "#1C3439" }, patientListRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderColor: "#EEF2F1", paddingVertical: 11 }, openPatientText: { color: "#147D72", fontSize: 11, fontWeight: "800" },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: 14 }, columnsCompact: { flexDirection: "column" }, schedulePanel: { flex: 1, minWidth: 0, backgroundColor: "white", borderRadius: 14, borderWidth: 1, borderColor: "#E7ECEB", padding: 17 }, sideColumn: { width: 260, gap: 12 }, panelHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, panelTitle: { color: "#19363D", fontSize: 14, fontWeight: "800" }, panelSub: { color: "#89999A", fontSize: 10, marginTop: 4 }, liveBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#EFF8F4", paddingHorizontal: 9, paddingVertical: 6, borderRadius: 14 }, liveDot: { width: 6, height: 6, borderRadius: 4, backgroundColor: "#42AB81" }, liveText: { color: "#498374", fontSize: 8, fontWeight: "900", letterSpacing: 0.5 }, queueRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderColor: "#EEF2F1", paddingVertical: 12 }, queueNumber: { width: 27, height: 27, borderRadius: 9, backgroundColor: "#E6F3EE", alignItems: "center", justifyContent: "center" }, queueNumberText: { color: "#287C6B", fontSize: 10, fontWeight: "900" }, queuePatient: { flex: 1 }, patientName: { color: "#29464A", fontSize: 11, fontWeight: "800" }, patientMeta: { color: "#879798", fontSize: 9, marginTop: 3 }, startButton: { backgroundColor: "#147D72", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 7 }, startText: { color: "white", fontSize: 9, fontWeight: "800" }, disabled: { opacity: 0.6 }, emptyQueue: { alignItems: "center", paddingVertical: 22 }, emptyIcon: { color: "#5FA98B", fontSize: 21, marginBottom: 6 }, emptyTitle: { color: "#314C50", fontSize: 11, fontWeight: "800", marginBottom: 4 },
  tipCard: { borderRadius: 13, backgroundColor: "#183F45", padding: 16 }, tipIcon: { color: "#8BD0B8", fontSize: 17 }, tipTitle: { color: "white", fontSize: 12, fontWeight: "800", marginTop: 7 }, tipText: { color: "#BAD0CE", fontSize: 9, lineHeight: 14, marginTop: 5 }, statusCard: { borderRadius: 13, backgroundColor: "white", borderWidth: 1, borderColor: "#E7ECEB", padding: 15 }, guideRow: { flexDirection: "row", gap: 8, marginTop: 12 }, guideDot: { width: 7, height: 7, borderRadius: 5, marginTop: 3 }, guideName: { color: "#526B6D", fontSize: 9, fontWeight: "800" }, guideText: { color: "#98A5A5", fontSize: 8, marginTop: 3 },
  scheduleCard: { backgroundColor: "white", borderRadius: 14, borderWidth: 1, borderColor: "#E7ECEB", padding: 17 }, totalPill: { backgroundColor: "#EFF5F3", color: "#5B7776", fontSize: 9, fontWeight: "800", paddingHorizontal: 9, paddingVertical: 6, borderRadius: 13, overflow: "hidden" }, appointmentCard: { borderTopWidth: 1, borderColor: "#EEF2F1", paddingTop: 14, marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 12 }, appointmentCardCompact: { gap: 8 }, appointmentTime: { width: 60, alignItems: "center" }, timeText: { color: "#315256", fontSize: 11, fontWeight: "800" }, timeLine: { color: "#B5CFCA", fontSize: 17, marginTop: 5 }, appointmentInfo: { flex: 1, minWidth: 190, flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }, patientLine: { flex: 1, minWidth: 180, flexDirection: "row", alignItems: "center", gap: 9 }, appointmentStatusActions: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }, patientAvatar: { width: 33, height: 33, borderRadius: 10, backgroundColor: "#E1F1EC", alignItems: "center", justifyContent: "center" }, avatarInitial: { color: "#34766A", fontSize: 9, fontWeight: "900" }, patientCopy: { flex: 1 }, appointmentMeta: { flexDirection: "row", alignItems: "center", gap: 7 }, statusPill: { borderRadius: 13, paddingHorizontal: 9, paddingVertical: 6 }, statusScheduled: { backgroundColor: "#E9EEFC" }, statusWaiting: { backgroundColor: "#FFF2DC" }, statusProgress: { backgroundColor: "#E1F3EC" }, statusLab: { backgroundColor: "#F0EAFE" }, statusDone: { backgroundColor: "#EFF3F2" }, statusText: { color: "#5E7576", fontSize: 8, fontWeight: "800" }, savedNote: { color: "#378266", fontSize: 8, fontWeight: "700" }, noteButton: { alignSelf: "flex-start", backgroundColor: "#F2F6F5", borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7 }, noteButtonText: { color: "#557171", fontSize: 8, fontWeight: "800" }, actions: { flexDirection: "row", gap: 6, alignItems: "center" }, labButton: { backgroundColor: "#F3EEFC", borderRadius: 7, paddingHorizontal: 9, paddingVertical: 8 }, labText: { color: "#7654A5", fontSize: 8, fontWeight: "800" }, completeButton: { backgroundColor: "#F0F7F4", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }, completeText: { color: "#267666", fontSize: 8, fontWeight: "800" },
  consultationForm: { width: "100%", marginTop: 5, padding: 13, backgroundColor: "#F7FAF9", borderWidth: 1, borderColor: "#E2EBE8", borderRadius: 10, gap: 8 }, formTitle: { color: "#27464A", fontSize: 11, fontWeight: "800" }, formGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, gridInput: { flexBasis: 180, flexGrow: 1 }, input: { borderWidth: 1, borderColor: "#DCE5E3", backgroundColor: "white", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 10, color: "#1C3439" }, notesInput: { minHeight: 68, textAlignVertical: "top" }, saveButton: { alignSelf: "flex-start", backgroundColor: "#147D72", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 7 }, saveText: { color: "white", fontSize: 9, fontWeight: "800" }, modalShade: { flex: 1, backgroundColor: "rgba(10, 30, 33, 0.5)", justifyContent: "center", alignItems: "center", padding: 18 }, modalCard: { width: "100%", maxWidth: 680, maxHeight: "92%", backgroundColor: "#F8FAF9", borderRadius: 16, overflow: "hidden" }, modalCardCompact: { maxWidth: 520 }, modalHeader: { backgroundColor: "white", paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderColor: "#E2EAE7", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, modalTitle: { color: "#19363D", fontSize: 18, fontWeight: "900" }, modalSubtitle: { color: "#147D72", fontSize: 10, fontWeight: "800", marginTop: 3 }, modalClose: { color: "#647A7C", fontSize: 27, paddingHorizontal: 5 }, modalContent: { padding: 18, gap: 9 }, modalError: { color: "#9C3530", backgroundColor: "#FCE9E7", padding: 10, borderRadius: 8, fontSize: 11 }, modalSectionTitle: { color: "#19363D", fontSize: 13, fontWeight: "900", marginTop: 7 }, modalInfo: { color: "#526B6D", fontSize: 12 }, modalHistoryRow: { borderTopWidth: 1, borderColor: "#E5ECEA", paddingTop: 8, gap: 3 }, modalHistoryText: { color: "#647A7C", fontSize: 11 }, modalFieldLabel: { color: "#526B6D", fontSize: 11, fontWeight: "800", marginTop: 4 }, modalInput: { width: "100%", borderWidth: 1, borderColor: "#DCE5E3", backgroundColor: "white", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 10, fontSize: 12, color: "#1C3439" }, modalMultiline: { minHeight: 68, textAlignVertical: "top" }, foodTimingChoices: { flexDirection: "row", gap: 7, flexWrap: "wrap" }, foodTimingChoice: { borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "white" }, foodTimingChoiceSelected: { borderColor: "#147D72", backgroundColor: "#E1F3EC" }, foodTimingText: { color: "#526B6D", fontSize: 11, fontWeight: "700" }, modalSave: { alignSelf: "flex-start", backgroundColor: "#147D72", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, marginTop: 8 }, modalSaveText: { color: "white", fontSize: 12, fontWeight: "900" }, modalStart: { alignSelf: "flex-start", backgroundColor: "#EBF4F1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8 }, modalStartText: { color: "#147D72", fontSize: 11, fontWeight: "800" }, modalNotice: { color: "#7B6960", fontSize: 11, lineHeight: 17, backgroundColor: "#FFF3E4", padding: 12, borderRadius: 8, marginTop: 6 }, emptySchedule: { alignItems: "center", padding: 24 }, loading: { alignItems: "center", padding: 25, gap: 8 }, banner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 11, borderRadius: 9 }, errorBanner: { backgroundColor: "#FCE9E7" }, successBanner: { backgroundColor: "#E1F4EB" }, bannerText: { flex: 1, fontSize: 10 }, errorText: { color: "#9C3530" }, successText: { color: "#28704C" }, close: { fontSize: 18, color: "#657B7D", paddingHorizontal: 7 }, footer: { color: "#A1ADAE", fontSize: 8, letterSpacing: 1.2, textAlign: "center", marginTop: 2 }
});
