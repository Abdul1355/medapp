import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { api } from "../../src/services/api";
import InvestigationReportButton from "../../src/components/InvestigationReportButton";
import { getAuthToken } from "../../src/services/auth";

type Patient = { id: number; full_name: string; email: string; mobile: string; age?: number; blood_group?: string; systolic_bp?: number; diastolic_bp?: number; height_cm?: number; weight_kg?: number; bmi?: number; appointments: any[]; visits: any[]; invoices: any[] };
const dateText = (value: string) => new Date(value).toLocaleString();

export default function PatientDetailPage() {
  const { id, appointment } = useLocalSearchParams<{ id: string; appointment?: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [invoiceDrafts, setInvoiceDrafts] = useState<Record<number, { amount: string; description: string }>>({});
  const [patientCharge, setPatientCharge] = useState({ amount: "", description: "Patient charge" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const treatmentFormY = useRef(0);
  const [treatmentDraft, setTreatmentDraft] = useState({
    symptoms: "", diagnosis: "", treatment_details: "", medicine_name: "",
    medicine_dosage: "", medicine_frequency: "", medicine_duration: "",
    medicine_timing: "", doctor_advice: "", follow_up_date: "", clinical_notes: "",
  });
  const load = useCallback(async () => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace("/"); return; }
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      const [response, me] = await Promise.all([
        api.get(`/api/v1/patients/${id}`),
        api.get("/api/v1/auth/me"),
      ]);
      setPatient(response.data); setCurrentUser(me.data);
    } catch (e: any) { setError(e?.response?.data?.detail || "Unable to load patient details."); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const treatmentName = (visit: any) => visit.consultation?.diagnosis?.trim() || patient?.appointments.find((appointment) => appointment.id === visit.appointment_id)?.reason?.trim() || "Consultation";
  async function createInvoice(visitId?: number) {
    const draft = visitId ? invoiceDrafts[visitId] : undefined;
    const numericAmount = Number(draft?.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setError("Enter an invoice amount greater than zero."); return; }
    setSaving(true); setError("");
    try { await api.post(`/api/v1/patients/${id}/invoices`, { amount: numericAmount, description: draft?.description || "Consultation", visit_id: visitId }); setInvoiceDrafts((current) => ({ ...current, [visitId!]: { amount: "", description: treatmentName(patient!.visits.find((visit) => visit.id === visitId) || {}) } })); await load(); }
    catch (e: any) { setError(e?.response?.data?.detail || "Unable to create invoice."); }
    finally { setSaving(false); }
  }
  async function addPatientAmount() {
    const numericAmount = Number(patientCharge.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setError("Enter an amount greater than zero."); return; }
    setSaving(true); setError("");
    try {
      await api.post(`/api/v1/patients/${id}/invoices`, { amount: numericAmount, description: patientCharge.description || "Patient charge" });
      setPatientCharge({ amount: "", description: "Patient charge" });
      await load();
    } catch (e: any) { setError(e?.response?.data?.detail || "Unable to add this patient amount."); }
    finally { setSaving(false); }
  }
  async function saveTreatment(visitId: number) {
    if (!treatmentDraft.diagnosis.trim() && !treatmentDraft.symptoms.trim()) {
      setError("Enter symptoms or a diagnosis before saving the treatment."); return;
    }
    if (treatmentDraft.follow_up_date) {
      const followUp = new Date(`${treatmentDraft.follow_up_date}T12:00:00`);
      if (Number.isNaN(followUp.getTime())) {
        setError("Enter the follow-up date in YYYY-MM-DD format."); return;
      }
    }
    setSaving(true); setError("");
    try {
      await api.post("/api/v1/consultations", {
        visit_id: visitId,
        ...treatmentDraft,
        follow_up_date: treatmentDraft.follow_up_date
          ? new Date(`${treatmentDraft.follow_up_date}T12:00:00`).toISOString()
          : null,
      });
      setTreatmentDraft({
        symptoms: "", diagnosis: "", treatment_details: "", medicine_name: "",
        medicine_dosage: "", medicine_frequency: "", medicine_duration: "",
        medicine_timing: "", doctor_advice: "", follow_up_date: "", clinical_notes: "",
      });
      await load();
    } catch (e: any) { setError(e?.response?.data?.detail || "Could not save this treatment."); }
    finally { setSaving(false); }
  }
  async function exportPdf(visitId?: number) {
    if (!patient) return;
    const htmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
    const escapeHtml = (value: unknown) => String(value ?? "—").replace(/[&<>\"]/g, (char) => htmlEntities[char]);
    const selectedVisits = patient.visits.filter((visit) => visitId === undefined || visit.id === visitId);
    const treatments = selectedVisits.map((visit) => `<section><h2>Treatment / Visit ${escapeHtml(visit.visit_number)} · ${escapeHtml(dateText(visit.created_at))}</h2><p><b>Diagnosis:</b> ${escapeHtml(visit.consultation?.diagnosis || "—")}</p><p><b>Symptoms:</b> ${escapeHtml(visit.consultation?.symptoms || "—")}</p><p><b>Treatment details:</b> ${escapeHtml(visit.consultation?.treatment_details || "—")}</p><p><b>Clinical notes:</b> ${escapeHtml(visit.consultation?.clinical_notes || visit.notes || "—")}</p><p><b>Doctor’s advice:</b> ${escapeHtml(visit.consultation?.doctor_advice || "—")}</p><p><b>Follow-up date:</b> ${escapeHtml(visit.consultation?.follow_up_date || "—")}</p><p><b>Prescriptions:</b> ${escapeHtml(visit.prescriptions.map((item: any) => [item.medicine_name || item.instructions, item.dosage && `Dosage ${item.dosage}`, item.frequency && `Frequency ${item.frequency}`, item.duration && `Duration ${item.duration}`, item.timing && `${item.timing} food`].filter(Boolean).join(" · ")).join("; ") || "—")}</p><p><b>Investigations:</b> ${escapeHtml(visit.investigations.map((item: any) => `${item.test_name} · ${item.department} (${item.status})${item.result ? ` — Findings: ${item.result}` : ""}`).join("; ") || "—")}</p><h3>Invoices</h3>${visit.invoices?.length ? `<table><tr><th>Invoice</th><th>Description</th><th>Amount</th><th>Status</th></tr>${visit.invoices.map((invoice: any) => `<tr><td>#${escapeHtml(invoice.id)}</td><td>${escapeHtml(invoice.description)}</td><td>${escapeHtml(invoice.amount.toFixed(2))}</td><td>${escapeHtml(invoice.status)}</td></tr>`).join("")}</table>` : "<p>No invoice recorded for this treatment.</p>"}</section>`).join("");
    const patientCharges = visitId === undefined ? patient.invoices.filter((invoice) => !invoice.appointment_id) : [];
    const patientChargesHtml = patientCharges.length ? `<section><h2>Patient amounts</h2><table><tr><th>Invoice</th><th>Description</th><th>Amount</th><th>Status</th></tr>${patientCharges.map((invoice: any) => `<tr><td>#${escapeHtml(invoice.id)}</td><td>${escapeHtml(invoice.description)}</td><td>${escapeHtml(invoice.amount.toFixed(2))}</td><td>${escapeHtml(invoice.status)}</td></tr>`).join("")}</table></section>` : "";
    const reportTitle = visitId === undefined ? "Patient treatment and invoice history" : "Treatment and invoice details";
    const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:14px Arial,sans-serif;color:#19363d;padding:28px}h1{color:#147d72}section{border-top:1px solid #ccd8d5;padding:12px 0;page-break-inside:avoid}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px;border:1px solid #ccd8d5}th{background:#eaf3f0}.meta{color:#66797b}</style></head><body><h1>${reportTitle}</h1><h2>${escapeHtml(patient.full_name)}</h2><p class="meta">${escapeHtml(patient.email)} · ${escapeHtml(patient.mobile)}</p><p><b>Age:</b> ${escapeHtml(patient.age ?? "—")} · <b>Blood group:</b> ${escapeHtml(patient.blood_group || "—")} · <b>BP:</b> ${escapeHtml(patient.systolic_bp && patient.diastolic_bp ? `${patient.systolic_bp}/${patient.diastolic_bp}` : "—")}</p>${treatments || "<p>No treatments recorded.</p>"}${patientChargesHtml}<footer>Generated ${escapeHtml(new Date().toLocaleString())}</footer></body></html>`;
    setExporting(true); setError("");
    try {
      if (Platform.OS === "web") await Print.printAsync({ html });
      else { const file = await Print.printToFileAsync({ html }); await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: "Share patient history PDF" }); }
    } catch { setError("Could not create the PDF. Please try again."); }
    finally { setExporting(false); }
  }
  if (loading) return <View style={s.center}><ActivityIndicator color="#147D72" /><Text style={s.muted}>Loading patient details…</Text></View>;
  if (!patient) return <View style={s.center}><Text style={s.title}>Patient unavailable</Text><Text style={s.error}>{error}</Text><Pressable onPress={() => router.back()}><Text style={s.link}>Go back</Text></Pressable></View>;
  const totalAmount = patient.invoices.reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const isDoctor = currentUser?.role === "DOCTOR";
  const eligibleAppointments = isDoctor ? patient.appointments.filter((item) => item.doctor_id === currentUser?.id
    && item.status === "IN_PROGRESS" && patient.visits.some((visit) => visit.appointment_id === item.id && !visit.consultation)) : [];
  const selectedAppointment = (appointment
    ? eligibleAppointments.find((item) => String(item.id) === String(appointment))
    : null) || eligibleAppointments[0];
  const selectedVisit = selectedAppointment
    ? patient.visits.find((visit) => visit.appointment_id === selectedAppointment.id)
    : null;
  return <ScrollView ref={scrollRef} style={s.page} contentContainerStyle={s.content}>
    <Pressable onPress={() => router.back()}><Text style={s.link}>← Back</Text></Pressable>
    <Text style={s.kicker}>PATIENT RECORD</Text><Text style={s.title}>{patient.full_name}</Text><Text style={s.muted}>{patient.email} · {patient.mobile || "No phone recorded"}</Text><View style={s.totalCard}><Text style={s.totalLabel}>TOTAL INVOICED</Text><Text style={s.totalValue}>{totalAmount.toFixed(2)}</Text></View><Pressable disabled={exporting} onPress={() => void exportPdf()} style={s.button}><Text style={s.buttonText}>{exporting ? "Preparing PDF…" : "Generate complete patient PDF"}</Text></Pressable>
    {error ? <Text style={s.error}>{error}</Text> : null}
    <View style={s.card}><Text style={s.heading}>Patient details</Text><View style={s.grid}>{[["Age", patient.age ? `${patient.age} years` : "—"], ["Blood group", patient.blood_group || "—"], ["Blood pressure", patient.systolic_bp && patient.diastolic_bp ? `${patient.systolic_bp}/${patient.diastolic_bp}` : "—"], ["Height", patient.height_cm ? `${patient.height_cm} cm` : "—"], ["Weight", patient.weight_kg ? `${patient.weight_kg} kg` : "—"], ["BMI", patient.bmi ?? "—"]].map(([label, value]) => <View key={String(label)} style={s.info}><Text style={s.label}>{label}</Text><Text style={s.value}>{value}</Text></View>)}</View></View>
    {isDoctor && selectedVisit && !selectedVisit.consultation && (!selectedAppointment || selectedAppointment.status === "IN_PROGRESS") && <View onLayout={(event) => { treatmentFormY.current = event.nativeEvent.layout.y; }} style={s.card}>
      <Text style={s.heading}>Save treatment</Text>
      {eligibleAppointments.length > 1 && <View style={s.visitChoices}><Text style={s.muted}>Choose the active visit:</Text>{eligibleAppointments.map((item) => <Pressable key={item.id} onPress={() => router.replace(`/patient/${id}?appointment=${item.id}` as any)} style={[s.visitChoice, String(item.id) === String(selectedAppointment?.id) && s.visitChoiceSelected]}><Text style={s.value}>{dateText(item.scheduled_at)} · {item.reason || "Consultation"}</Text></Pressable>)}</View>}
      <Text style={s.muted}>Add the diagnosis and prescription for {selectedAppointment?.reason || "this active visit"}.</Text>
      <View style={s.grid}>
        <TextInput value={treatmentDraft.symptoms} onChangeText={(symptoms) => setTreatmentDraft((current) => ({ ...current, symptoms }))} placeholder="Symptoms" style={s.input} />
        <TextInput value={treatmentDraft.diagnosis} onChangeText={(diagnosis) => setTreatmentDraft((current) => ({ ...current, diagnosis }))} placeholder="Diagnosis / health problem" style={s.input} />
        <TextInput value={treatmentDraft.treatment_details} onChangeText={(treatment_details) => setTreatmentDraft((current) => ({ ...current, treatment_details }))} placeholder="Treatment details" multiline style={[s.input, s.treatmentNotes]} />
      </View>
      <Text style={s.label}>MEDICINE DETAILS</Text>
      <View style={s.grid}>
        <TextInput value={treatmentDraft.medicine_name} onChangeText={(medicine_name) => setTreatmentDraft((current) => ({ ...current, medicine_name }))} placeholder="Medicine name" style={s.input} />
        <TextInput value={treatmentDraft.medicine_dosage} onChangeText={(medicine_dosage) => setTreatmentDraft((current) => ({ ...current, medicine_dosage }))} placeholder="Medicine dosage" style={s.input} />
        <TextInput value={treatmentDraft.medicine_frequency} onChangeText={(medicine_frequency) => setTreatmentDraft((current) => ({ ...current, medicine_frequency }))} placeholder="Frequency, e.g. 1-0-1" style={s.input} />
        <TextInput value={treatmentDraft.medicine_duration} onChangeText={(medicine_duration) => setTreatmentDraft((current) => ({ ...current, medicine_duration }))} placeholder="Duration, e.g. 5 days" style={s.input} />
        <TextInput value={treatmentDraft.medicine_timing} onChangeText={(medicine_timing) => setTreatmentDraft((current) => ({ ...current, medicine_timing }))} placeholder="Before / after food" style={s.input} />
        <TextInput value={treatmentDraft.follow_up_date} onChangeText={(follow_up_date) => setTreatmentDraft((current) => ({ ...current, follow_up_date }))} placeholder="Next follow-up YYYY-MM-DD" style={s.input} />
      </View>
      <TextInput value={treatmentDraft.doctor_advice} onChangeText={(doctor_advice) => setTreatmentDraft((current) => ({ ...current, doctor_advice }))} placeholder="Doctor’s advice" multiline style={[s.input, s.treatmentNotes]} />
      <TextInput value={treatmentDraft.clinical_notes} onChangeText={(clinical_notes) => setTreatmentDraft((current) => ({ ...current, clinical_notes }))} placeholder="Additional clinical notes" multiline style={[s.input, s.treatmentNotes]} />
      <Pressable disabled={saving} onPress={() => void saveTreatment(selectedVisit.id)} style={s.button}>
        <Text style={s.buttonText}>{saving ? "Saving treatment…" : "Save treatment"}</Text>
      </Pressable>
    </View>}
    {patient.visits.length > 0 && <View style={s.card}><Text style={s.heading}>Latest treatment summary</Text>{patient.visits.slice(0, 3).map((visit: any) => <View key={visit.id} style={s.row}>
      <Text style={s.value}>Visit {visit.visit_number} · {dateText(visit.created_at)}</Text>
      {visit.consultation?.diagnosis ? <Text style={s.muted}>Diagnosis: {visit.consultation.diagnosis}</Text> : null}
      {visit.consultation?.symptoms ? <Text style={s.muted}>Symptoms: {visit.consultation.symptoms}</Text> : null}
      {visit.consultation?.treatment_details ? <Text style={s.muted}>Treatment: {visit.consultation.treatment_details}</Text> : null}
      {visit.consultation?.clinical_notes ? <Text style={s.muted}>Clinical notes: {visit.consultation.clinical_notes}</Text> : null}
      {visit.consultation?.doctor_advice ? <Text style={s.muted}>Doctor’s advice: {visit.consultation.doctor_advice}</Text> : null}
      {visit.consultation?.follow_up_date ? <Text style={s.muted}>Next follow-up: {visit.consultation.follow_up_date}</Text> : null}
      {visit.prescriptions.map((medicine: any, index: number) => <Text key={index} style={s.muted}>Medicine: {medicine.medicine_name || medicine.instructions}{medicine.dosage ? ` · Dosage ${medicine.dosage}` : ""}{medicine.frequency ? ` · Frequency ${medicine.frequency}` : ""}{medicine.duration ? ` · Duration ${medicine.duration}` : ""}{medicine.timing ? ` · ${medicine.timing} food` : ""}</Text>)}
    </View>)}</View>}
    <View style={s.card}><Text style={s.heading}>Appointments · {patient.appointments.length}</Text>{patient.appointments.length ? patient.appointments.map((a) => <View key={a.id} style={s.row}><Text style={s.value}>{dateText(a.scheduled_at)}</Text><Text style={s.muted}>{a.doctor} · {a.status} · {a.reason || "General consultation"}</Text></View>) : <Text style={s.muted}>No appointments recorded.</Text>}</View>
    <View style={s.card}><View style={s.historyHeading}><Text style={s.heading}>Treatment and invoice history · {patient.visits.length}</Text>{isDoctor && selectedVisit && <Pressable onPress={() => scrollRef.current?.scrollTo({ y: treatmentFormY.current, animated: true })} style={s.historyAddButton}><Text style={s.historyAddText}>+ Add treatment</Text></Pressable>}</View>
      {patient.visits.length ? patient.visits.map((visit: any) => {
        const draft = invoiceDrafts[visit.id] || { amount: "", description: treatmentName(visit) };
        return <View key={visit.id} style={s.row}>
          <Text style={s.value}>Treatment / visit {visit.visit_number} · {dateText(visit.created_at)}</Text>
          {visit.consultation ? <Text style={s.muted}>Symptoms: {visit.consultation.symptoms || "—"} · Diagnosis: {visit.consultation.diagnosis || "—"}{visit.consultation.treatment_details ? ` · Treatment: ${visit.consultation.treatment_details}` : ""}{visit.consultation.clinical_notes ? ` · Clinical notes: ${visit.consultation.clinical_notes}` : ""}{visit.consultation.doctor_advice ? ` · Advice: ${visit.consultation.doctor_advice}` : ""}{visit.consultation.follow_up_date ? ` · Follow-up: ${visit.consultation.follow_up_date}` : ""}</Text> : null}
          {visit.vitals.map((vital: any, index: number) => <Text key={index} style={s.muted}>Vitals: BP {vital.systolic_bp && vital.diastolic_bp ? `${vital.systolic_bp}/${vital.diastolic_bp}` : "—"} · {vital.weight_kg ?? "—"} kg · {vital.height_cm ?? "—"} cm · Sugar {vital.sugar_mg_dl ?? "—"}</Text>)}
          {visit.prescriptions.map((medicine: any, index: number) => <Text key={`m${index}`} style={s.muted}>Medicine: {medicine.medicine_name || medicine.instructions}{medicine.dosage ? ` · Dosage ${medicine.dosage}` : ""}{medicine.frequency ? ` · Frequency ${medicine.frequency}` : ""}{medicine.duration ? ` · Duration ${medicine.duration}` : ""}{medicine.timing ? ` · ${medicine.timing} food` : ""}</Text>)}
          {visit.investigations.map((investigation: any, index: number) => <View key={`i${index}`}><Text style={s.muted}>Investigation: {investigation.test_name} · {investigation.department} · {investigation.status}{investigation.result ? ` · Findings: ${investigation.result}` : ""}</Text><InvestigationReportButton id={investigation.id} filename={investigation.report_filename} /></View>)}
          <Text style={s.label}>INVOICES FOR THIS TREATMENT</Text>
          {visit.invoices?.map((invoice: any) => <View key={invoice.id} style={s.invoice}><View><Text style={s.value}>Invoice #{invoice.id} · {invoice.description}</Text><Text style={s.muted}>{dateText(invoice.created_at)} · {invoice.status}</Text></View><Text style={s.money}>{invoice.amount.toFixed(2)}</Text></View>)}
          {!visit.invoices?.length ? <Text style={s.muted}>No invoice for this treatment yet.</Text> : null}
          <TextInput value={draft.description} onChangeText={(value) => setInvoiceDrafts((current) => ({ ...current, [visit.id]: { ...draft, description: value } }))} placeholder="Treatment / charge description" style={s.input} />
          <TextInput value={draft.amount} onChangeText={(value) => setInvoiceDrafts((current) => ({ ...current, [visit.id]: { ...draft, amount: value } }))} placeholder="Amount for this treatment" keyboardType="decimal-pad" style={s.input} />
          <Pressable disabled={saving} onPress={() => void createInvoice(visit.id)} style={s.button}><Text style={s.buttonText}>{saving ? "Adding invoice…" : "Add invoice"}</Text></Pressable>
        </View>;
      }) : <Text style={s.muted}>No treatment visits recorded.</Text>}
    </View>
    <View style={s.card}><Text style={s.heading}>Patient amounts</Text>
      {patient.invoices.filter((invoice) => !invoice.appointment_id).map((invoice: any) => <View key={invoice.id} style={s.invoice}><Text style={s.value}>#{invoice.id} · {invoice.description} · {invoice.status}</Text><Text style={s.money}>{invoice.amount.toFixed(2)}</Text></View>)}
      <View style={s.chargeBox}><Text style={s.label}>ADD AMOUNT TO PATIENT</Text><TextInput value={patientCharge.description} onChangeText={(description) => setPatientCharge((current) => ({ ...current, description }))} placeholder="Description" style={s.input} /><TextInput value={patientCharge.amount} onChangeText={(amount) => setPatientCharge((current) => ({ ...current, amount }))} placeholder="Amount" keyboardType="decimal-pad" style={s.input} /><Pressable disabled={saving} onPress={() => void addPatientAmount()} style={s.button}><Text style={s.buttonText}>{saving ? "Adding…" : "Add amount"}</Text></Pressable></View>
    </View>
  </ScrollView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: "#F5F7F8" }, content: { width: "100%", maxWidth: 960, alignSelf: "center", padding: 22, gap: 14 }, center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }, kicker: { color: "#147D72", fontSize: 11, fontWeight: "800", letterSpacing: 1.4, marginTop: 18 }, title: { color: "#19363D", fontSize: 27, fontWeight: "800" }, heading: { color: "#19363D", fontSize: 16, fontWeight: "800", marginBottom: 12 }, historyHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, historyAddButton: { backgroundColor: "#E7F4EF", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8, marginBottom: 12 }, historyAddText: { color: "#147D72", fontSize: 12, fontWeight: "800" }, muted: { color: "#718486", fontSize: 13, marginTop: 4 }, link: { color: "#147D72", fontSize: 14, fontWeight: "700" }, error: { color: "#A43932", backgroundColor: "#FCE9E7", padding: 12, borderRadius: 8 }, card: { backgroundColor: "white", borderColor: "#E4EBE9", borderWidth: 1, borderRadius: 14, padding: 18 }, totalCard: { backgroundColor: "#E7F4EF", borderRadius: 12, padding: 15, alignSelf: "flex-start", minWidth: 180 }, totalLabel: { color: "#4F7770", fontSize: 10, fontWeight: "800", letterSpacing: 0.8 }, totalValue: { color: "#147D72", fontSize: 24, fontWeight: "900", marginTop: 5 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 14 }, visitChoices: { marginBottom: 8 }, visitChoice: { padding: 10, borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 8, marginTop: 6 }, visitChoiceSelected: { borderColor: "#147D72", backgroundColor: "#E7F4EF" }, info: { flexBasis: 130, flexGrow: 1 }, label: { color: "#89999A", fontSize: 10, textTransform: "uppercase", fontWeight: "800", marginTop: 10, marginBottom: 6 }, value: { color: "#29464A", fontSize: 14, fontWeight: "700" }, row: { borderTopWidth: 1, borderColor: "#EEF2F1", paddingVertical: 11, gap: 3 }, invoice: { borderTopWidth: 1, borderColor: "#EEF2F1", paddingVertical: 12, flexDirection: "row", justifyContent: "space-between", gap: 12 }, money: { fontSize: 16, color: "#147D72", fontWeight: "800" }, input: { borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 8, padding: 11, color: "#19363D", marginTop: 7, minWidth: 180, flexGrow: 1 }, treatmentNotes: { minHeight: 70, textAlignVertical: "top" }, chargeBox: { borderTopWidth: 1, borderColor: "#EEF2F1", marginTop: 14, paddingTop: 8 }, button: { alignSelf: "flex-start", backgroundColor: "#147D72", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, marginTop: 10 }, pdfButton: { backgroundColor: "#29464A" }, buttonText: { color: "white", fontWeight: "800" } });
