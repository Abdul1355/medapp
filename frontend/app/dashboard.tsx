import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, TextInput } from "react-native";
import { router } from "expo-router";
import { api } from "../src/services/api";
import InvestigationReportButton from "../src/components/InvestigationReportButton";
import { clearAuthToken, getAuthToken } from "../src/services/auth";
import { Screen, InfoCard } from "../src/components/Screen";

export default function Dashboard() {
  const [me, setMe] = useState<any>(null);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [patientProfile, setPatientProfile] = useState<any>(null);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [hospitals, setHospitals] = useState<any[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
      setError("");
      const token = await getAuthToken();
      if (!token) { router.replace("/"); return; }
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      try {
        const user = await api.get("/api/v1/auth/me");
        setMe(user.data);
        if (user.data.role === "PATIENT") {
          const [profile, list, doctorList, hospitalList] = await Promise.all([
            api.get("/api/v1/patients/me"), api.get("/api/v1/appointments"), api.get("/api/v1/doctors"), api.get("/api/v1/doctors/clinics")
          ]);
          setPatientProfile(profile.data); setAppointments(list.data); setDoctors(doctorList.data); setHospitals(hospitalList.data);
        } else if (["SCANNING", "LABORATORY", "DELIVERY"].includes(user.data.role)) {
          setAppointments([]);
        } else {
          const list = await api.get("/api/v1/appointments");
          setAppointments(list.data);
        }
      } catch (e: any) { setError(e?.response?.data?.detail || "Unable to load dashboard"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!me && !error) return <View style={s.center}><ActivityIndicator /><Text>Loading dashboard...</Text></View>;

  if (me?.role === "PATIENT") return <PatientDashboard profile={patientProfile} appointments={appointments} doctors={doctors} hospitals={hospitals} error={error} onRefresh={load} />;

  const role = me?.role || "USER";
  const modules: Record<string, string[]> = {
    SUPER_ADMIN: ["Clinic overview", "User and staff management", "Clinic configuration", "Audit and access review"],
    CLINIC_ADMIN: ["Staff management", "Patient directory", "Appointments", "Clinic analytics"],
    PATIENT: ["My profile and BMI", "Find doctors", "Book appointments", "Medical history and prescriptions"],
    RECEPTIONIST: ["Today's roster", "Walk-in registration", "Record vitals", "Manage waiting queue"],
    DOCTOR: ["Patient queue", "Clinical history", "Consultations", "Prescriptions and investigations"],
    SCANNING: ["Scanning requests", "Update imaging request progress", "Complete scan requests"],
    LABORATORY: ["Laboratory requests", "Update test request progress", "Complete lab requests"],
    DELIVERY: ["Medicine delivery queue", "Dispatch prepared orders", "Mark deliveries complete"]
  };

  return <Screen title="Dashboard">
    <View style={s.welcome}>
      <Text style={s.name}>Hello, {me?.full_name || "User"}</Text>
      <Text style={s.muted}>{role.replaceAll("_", " ")} · Clinic workspace</Text>
    </View>
    {error ? <Text style={s.error}>{error}</Text> : null}
    <View style={s.cards}>
      <InfoCard title="Appointments visible to you" value={String(appointments.length)} detail="Current account permissions apply" />
      <InfoCard title="Your role" value={role.replaceAll("_", " ")} detail="Access is controlled by the backend" />
    </View>
    <Text style={s.section}>Your modules</Text>
    {(modules[role] || []).map((item) => <View key={item} style={s.item}><Text style={s.itemText}>•  {item}</Text></View>)}
    {role === "SUPER_ADMIN" || role === "CLINIC_ADMIN" ? <Pressable style={s.adminButton} onPress={() => router.push("/admin")}><Text style={s.adminButtonText}>Open admin workspace  →</Text></Pressable> : null}
    {role === "DOCTOR" ? <Pressable style={s.adminButton} onPress={() => router.push("/doctor")}><Text style={s.adminButtonText}>Open doctor workspace  →</Text></Pressable> : null}
    {role === "SCANNING" ? <Pressable style={s.adminButton} onPress={() => router.push("/scanning")}><Text style={s.adminButtonText}>Open scanning dashboard  →</Text></Pressable> : null}
    {role === "LABORATORY" ? <Pressable style={s.adminButton} onPress={() => router.push("/laboratory")}><Text style={s.adminButtonText}>Open laboratory dashboard  →</Text></Pressable> : null}
    {role === "DELIVERY" ? <Pressable style={s.adminButton} onPress={() => router.push("/delivery")}><Text style={s.adminButtonText}>Open delivery dashboard  →</Text></Pressable> : null}
    <Pressable style={s.button} onPress={async () => { await clearAuthToken(); router.replace("/"); }}><Text style={s.buttonText}>Sign out</Text></Pressable>
  </Screen>;
}

function PatientDashboard({ profile, appointments, doctors, hospitals, error, onRefresh }: { profile: any; appointments: any[]; doctors: any[]; hospitals: any[]; error: string; onRefresh: () => Promise<void> }) {
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [hospitalId, setHospitalId] = useState<number | null>(null);
  const [appointmentPeriod, setAppointmentPeriod] = useState<"ALL" | "WEEK" | "MONTH" | "YEAR">("ALL");
  const [date, setDate] = useState(() => { const value = new Date(); value.setDate(value.getDate() + 1); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; });
  const [time, setTime] = useState("09:00");
  const [reason, setReason] = useState("");
  const [booking, setBooking] = useState(false);
  const [message, setMessage] = useState("");
  const [bookingError, setBookingError] = useState("");
  const totalAmount = Number(profile?.invoices?.reduce((sum: number, invoice: any) => sum + Number(invoice.amount || 0), 0) || 0);
  const doctorName = (id: number) => doctors.find((doctor) => doctor.id === id)?.name || "Doctor";
  const visibleAppointments = appointments.filter((appointment) => {
    if (appointmentPeriod === "ALL") return true;
    const scheduled = new Date(appointment.scheduled_at);
    const now = new Date();
    if (appointmentPeriod === "YEAR") return scheduled.getFullYear() === now.getFullYear();
    if (appointmentPeriod === "MONTH") return scheduled.getFullYear() === now.getFullYear() && scheduled.getMonth() === now.getMonth();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const nextWeek = new Date(weekStart); nextWeek.setDate(nextWeek.getDate() + 7);
    return scheduled >= weekStart && scheduled < nextWeek;
  });
  const visibleDoctors = hospitalId ? doctors.filter((doctor) => doctor.clinic_id === hospitalId) : doctors;

  async function bookAppointment() {
    if (!doctorId) { setBookingError("Select a doctor first."); return; }
    const scheduledAt = new Date(`${date}T${time}`);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) { setBookingError("Choose a time later today or a future date."); return; }
    setBooking(true); setBookingError(""); setMessage("");
    try {
      await api.post("/api/v1/appointments", { clinic_id: hospitalId, doctor_id: doctorId, scheduled_at: scheduledAt.toISOString(), reason: reason.trim() });
      setMessage("Appointment booked."); setReason(""); await onRefresh();
    } catch (e: any) { setBookingError(e?.response?.data?.detail || "Could not book the appointment."); }
    finally { setBooking(false); }
  }

  return <ScrollView style={patientStyles.page} contentContainerStyle={patientStyles.content}>
    <View style={patientStyles.top}><View><Text style={patientStyles.kicker}>MY HEALTH</Text><Text style={patientStyles.title}>Hello, {profile?.full_name || "there"}</Text><Text style={patientStyles.muted}>Your care, appointments, and invoices in one place.</Text></View><Pressable onPress={async () => { await clearAuthToken(); router.replace("/"); }} style={patientStyles.signOut}><Text style={patientStyles.signOutText}>Sign out</Text></Pressable></View>
    {error ? <Text style={patientStyles.error}>{error}</Text> : null}
    <View style={patientStyles.metrics}><PatientMetric label="Appointments" value={appointments.length} /><PatientMetric label="Treatments" value={profile?.visits?.length || 0} /><PatientMetric label="Total invoiced" value={totalAmount.toFixed(2)} /></View>
    <Pressable style={patientStyles.orderButton} onPress={() => router.push("/orders")}><View><Text style={patientStyles.orderTitle}>Order medicines & care items</Text><Text style={patientStyles.orderSub}>Choose items, review your total, and add a delivery address.</Text></View><Text style={patientStyles.orderArrow}>›</Text></Pressable>
    <View style={patientStyles.card}><Text style={patientStyles.heading}>My profile</Text><Text style={patientStyles.detail}>{profile?.email || ""}</Text><Text style={patientStyles.detail}>{profile?.mobile || "No phone number"} · Age {profile?.age ?? "—"} · Blood group {profile?.blood_group || "—"}</Text><Text style={patientStyles.detail}>BP {profile?.systolic_bp && profile?.diastolic_bp ? `${profile.systolic_bp}/${profile.diastolic_bp}` : "—"} · Height {profile?.height_cm ? `${profile.height_cm} cm` : "—"} · Weight {profile?.weight_kg ? `${profile.weight_kg} kg` : "—"} · BMI {profile?.bmi ?? "—"}</Text></View>
    {profile?.visits?.length ? <View style={patientStyles.card}><Text style={patientStyles.heading}>Latest treatment</Text>{profile.visits.slice(0, 3).map((visit: any) => <View key={visit.id} style={patientStyles.listRow}><Text style={patientStyles.itemTitle}>Visit {visit.visit_number} · {new Date(visit.created_at).toLocaleDateString()}</Text>{visit.diagnosis ? <Text style={patientStyles.detail}>Diagnosis: {visit.diagnosis}</Text> : null}{visit.symptoms ? <Text style={patientStyles.muted}>Symptoms: {visit.symptoms}</Text> : null}{visit.treatment_details ? <Text style={patientStyles.muted}>Treatment: {visit.treatment_details}</Text> : null}{visit.clinical_notes ? <Text style={patientStyles.muted}>Clinical notes: {visit.clinical_notes}</Text> : null}{visit.doctor_advice ? <Text style={patientStyles.muted}>Doctor’s advice: {visit.doctor_advice}</Text> : null}{visit.follow_up_date ? <Text style={patientStyles.muted}>Next follow-up: {visit.follow_up_date}</Text> : null}{visit.prescriptions?.map((medicine: any, index: number) => <Text key={index} style={patientStyles.muted}>{typeof medicine === "string" ? medicine : `Medicine: ${medicine.medicine_name || "—"}${medicine.dosage ? ` · Dosage ${medicine.dosage}` : ""}${medicine.frequency ? ` · Frequency ${medicine.frequency}` : ""}${medicine.duration ? ` · Duration ${medicine.duration}` : ""}${medicine.timing ? ` · ${medicine.timing} food` : ""}`}</Text>)}{visit.investigations?.map((investigation: any, index: number) => <View key={`investigation-${index}`}><Text style={patientStyles.muted}>Test: {investigation.name} · {investigation.status}{investigation.result ? ` · Findings: ${investigation.result}` : ""}</Text><InvestigationReportButton id={investigation.id} filename={investigation.report_filename} /></View>)}</View>)}</View> : null}
    <PatientInvestigations profile={profile} />
    <View style={patientStyles.card}><Text style={patientStyles.heading}>Book an appointment</Text><Text style={patientStyles.muted}>Choose a hospital, then select a doctor.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={patientStyles.doctorList}>
        <Pressable onPress={() => { setHospitalId(null); setDoctorId(null); }} style={[patientStyles.doctor, hospitalId === null && patientStyles.doctorSelected]}><Text style={[patientStyles.doctorName, hospitalId === null && patientStyles.selectedText]}>All hospitals</Text><Text style={patientStyles.doctorMeta}>Show every available doctor</Text></Pressable>
        {hospitals.map((hospital) => <Pressable key={hospital.id} onPress={() => { setHospitalId(hospital.id); setDoctorId(null); }} style={[patientStyles.doctor, hospitalId === hospital.id && patientStyles.doctorSelected]}><Text style={[patientStyles.doctorName, hospitalId === hospital.id && patientStyles.selectedText]}>{hospital.name}</Text><Text style={patientStyles.doctorMeta}>{hospital.address || "Hospital"} · {hospital.doctor_count} doctor(s)</Text><Text style={patientStyles.doctorMeta}>{hospital.scanning_available ? "Scanning available" : "Scanning not available"} · {hospital.laboratory_available ? "Laboratory available" : "Lab not available"}</Text></Pressable>)}
      </ScrollView>
      <Text style={patientStyles.heading}>Choose a doctor</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={patientStyles.doctorList}>{visibleDoctors.map((doctor) => <Pressable key={doctor.id} onPress={() => setDoctorId(doctor.id)} style={[patientStyles.doctor, doctorId === doctor.id && patientStyles.doctorSelected]}><Text style={[patientStyles.doctorName, doctorId === doctor.id && patientStyles.selectedText]}>{doctor.name}</Text><Text style={patientStyles.doctorMeta}>{doctor.clinic_name} · {doctor.specialization || "Care provider"}{doctor.consultation_fee ? ` · ${doctor.consultation_fee}` : ""}</Text></Pressable>)}</ScrollView>
      <View style={patientStyles.row}><TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" style={[patientStyles.input, patientStyles.dateInput]} /><TextInput value={time} onChangeText={setTime} placeholder="09:00" style={[patientStyles.input, patientStyles.timeInput]} /></View><TextInput value={reason} onChangeText={setReason} placeholder="Reason for visit (optional)" style={patientStyles.input} />{bookingError ? <Text style={patientStyles.error}>{bookingError}</Text> : null}{message ? <Text style={patientStyles.success}>{message}</Text> : null}<Pressable disabled={booking} onPress={() => void bookAppointment()} style={patientStyles.primary}><Text style={patientStyles.primaryText}>{booking ? "Booking…" : "Request appointment"}</Text></Pressable></View>
    <View style={patientStyles.card}><Text style={patientStyles.heading}>My appointments</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={patientStyles.periodList}>{([["ALL", "All"], ["WEEK", "This week"], ["MONTH", "This month"], ["YEAR", "This year"]] as const).map(([key, label]) => <Pressable key={key} onPress={() => setAppointmentPeriod(key)} style={[patientStyles.periodChip, appointmentPeriod === key && patientStyles.periodChipSelected]}><Text style={[patientStyles.periodText, appointmentPeriod === key && patientStyles.periodTextSelected]}>{label}</Text></Pressable>)}</ScrollView>{visibleAppointments.length ? visibleAppointments.map((appointment) => <View key={appointment.id} style={patientStyles.listRow}><Text style={patientStyles.itemTitle}>{new Date(appointment.scheduled_at).toLocaleString()} · {doctorName(appointment.doctor_id)}</Text><Text style={patientStyles.muted}>{appointment.reason || "General consultation"} · {String(appointment.status).replaceAll("_", " ")}</Text></View>) : <Text style={patientStyles.muted}>{appointments.length ? "No appointments in this period." : "No appointments yet."}</Text>}</View>
  </ScrollView>;
}

function PatientMetric({ label, value }: { label: string; value: string | number }) {
  return <View style={patientStyles.metric}><Text style={patientStyles.metricLabel}>{label}</Text><Text style={patientStyles.metricValue}>{value}</Text></View>;
}

function PatientInvestigations({ profile }: { profile: any }) {
  const investigations = (profile?.visits || []).flatMap((visit: any) =>
    (visit.investigations || []).map((investigation: any) => ({ ...investigation, visit_number: visit.visit_number, visit_date: visit.created_at }))
  );
  const scanningRequests = investigations.filter((item: any) => /scan|radiolog|imag/i.test(String(item.department || "")));
  const laboratoryRequests = investigations.filter((item: any) => /lab|patholog/i.test(String(item.department || "")));
  const renderRequests = (requests: any[]) => requests.length ? requests.map((investigation: any, index: number) => {
    const department = String(investigation.department || "Laboratory");
    const status = String(investigation.status || "ORDERED").replaceAll("_", " ");
    return <View key={investigation.id || index} style={patientStyles.investigationRow}>
      <View style={patientStyles.investigationTop}>
        <View style={patientStyles.investigationMain}>
          <Text style={patientStyles.itemTitle}>{investigation.name || investigation.test_name || "Investigation"}</Text>
          <Text style={patientStyles.muted}>{department} · Visit {investigation.visit_number}</Text>
        </View>
        <Text style={[patientStyles.investigationStatus, investigation.status === "COMPLETED" ? patientStyles.investigationComplete : null]}>{status}</Text>
      </View>
      {investigation.result ? <Text style={patientStyles.investigationFinding}>Findings: {investigation.result}</Text> : null}
      <InvestigationReportButton id={investigation.id} filename={investigation.report_filename} />
    </View>;
  }) : <Text style={patientStyles.muted}>No requests assigned yet.</Text>;

  return <View style={patientStyles.card}>
    <View style={patientStyles.investigationHeadingRow}>
      <Text style={patientStyles.heading}>Scanning & laboratory</Text>
      <Text style={patientStyles.investigationCount}>{investigations.length}</Text>
    </View>
    <View style={patientStyles.departmentSection}>
      <Text style={patientStyles.departmentTitle}>Scanning</Text>
      {renderRequests(scanningRequests)}
    </View>
    <View style={patientStyles.departmentSection}>
      <Text style={patientStyles.departmentTitle}>Laboratory</Text>
      {renderRequests(laboratoryRequests)}
    </View>
  </View>;
}

const s=StyleSheet.create({
  center:{flex:1,alignItems:"center",justifyContent:"center",gap:10},
  welcome:{backgroundColor:"#E8F3FC",padding:18,borderRadius:14},
  name:{fontSize:22,fontWeight:"800",color:"#14243A"},
  muted:{color:"#52657A",marginTop:4},
  cards:{flexDirection:"row",flexWrap:"wrap",gap:12},
  section:{fontSize:18,fontWeight:"800",color:"#14243A",marginTop:8},
  item:{backgroundColor:"white",padding:16,borderRadius:12,borderWidth:1,borderColor:"#E3EAF2"},
  itemText:{color:"#24364B",fontWeight:"600"},
  button:{backgroundColor:"#1677C8",padding:14,borderRadius:10,alignItems:"center"},
  buttonText:{color:"white",fontWeight:"700"},
  adminButton:{backgroundColor:"#147D72",padding:14,borderRadius:10,alignItems:"center"},
  adminButtonText:{color:"white",fontWeight:"700"},
  error:{color:"#B91C1C"}
});

const patientStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F4F7F8" }, content: { width: "100%", maxWidth: 1040, alignSelf: "center", padding: 22, gap: 14 }, top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 12 }, kicker: { color: "#147D72", fontSize: 10, fontWeight: "900", letterSpacing: 1.4 }, title: { color: "#19363D", fontSize: 28, fontWeight: "900", marginTop: 6 }, muted: { color: "#748688", fontSize: 12, marginTop: 5 }, signOut: { backgroundColor: "white", borderWidth: 1, borderColor: "#DCE6E3", borderRadius: 9, paddingVertical: 9, paddingHorizontal: 13 }, signOutText: { color: "#486366", fontWeight: "700", fontSize: 12 }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, metric: { flexGrow: 1, flexBasis: 150, backgroundColor: "white", borderWidth: 1, borderColor: "#E5ECEA", borderRadius: 12, padding: 15 }, metricLabel: { color: "#788B8C", fontSize: 11, fontWeight: "700" }, metricValue: { color: "#147D72", fontSize: 22, fontWeight: "900", marginTop: 7 }, orderButton: { backgroundColor: "#147D72", padding: 17, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, orderTitle: { color: "white", fontSize: 15, fontWeight: "900" }, orderSub: { color: "#D8F0E8", fontSize: 11, marginTop: 5 }, orderArrow: { color: "white", fontSize: 28, marginLeft: 12 }, card: { backgroundColor: "white", borderWidth: 1, borderColor: "#E5ECEA", borderRadius: 14, padding: 17 }, heading: { color: "#1D3B40", fontSize: 16, fontWeight: "900" }, detail: { color: "#456164", fontSize: 12, marginTop: 7 }, doctorList: { gap: 8, paddingVertical: 12 }, doctor: { minWidth: 160, borderWidth: 1, borderColor: "#DCE6E3", borderRadius: 10, padding: 11, backgroundColor: "#FBFDFC" }, doctorSelected: { backgroundColor: "#E6F4EF", borderColor: "#82BFAE" }, doctorName: { color: "#29464A", fontSize: 12, fontWeight: "800" }, doctorMeta: { color: "#7B8C8D", fontSize: 10, marginTop: 4 }, selectedText: { color: "#147D72" }, row: { flexDirection: "row", gap: 8 }, input: { borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 10, color: "#19363D", marginTop: 8, fontSize: 12 }, dateInput: { flex: 2 }, timeInput: { flex: 1 }, primary: { backgroundColor: "#147D72", borderRadius: 8, alignSelf: "flex-start", paddingVertical: 11, paddingHorizontal: 15, marginTop: 10 }, primaryText: { color: "white", fontWeight: "800", fontSize: 12 }, periodList: { flexDirection: "row", gap: 7, paddingVertical: 10 }, periodChip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#F0F5F3" }, periodChipSelected: { backgroundColor: "#147D72" }, periodText: { color: "#627879", fontSize: 11, fontWeight: "700" }, periodTextSelected: { color: "white" }, listRow: { borderTopWidth: 1, borderColor: "#EEF2F1", paddingVertical: 12, marginTop: 7 }, itemTitle: { color: "#29464A", fontSize: 12, fontWeight: "800" }, invoice: { color: "#147D72", fontSize: 11, marginTop: 7 }, error: { color: "#A43932", backgroundColor: "#FCE9E7", padding: 10, borderRadius: 8, fontSize: 12 }, success: { color: "#28704C", backgroundColor: "#E1F4EB", padding: 10, borderRadius: 8, fontSize: 12, marginTop: 8 },
  investigationHeadingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, investigationCount: { color: "#147D72", backgroundColor: "#E3F2ED", borderRadius: 12, minWidth: 24, textAlign: "center", paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: "900" }, departmentSection: { borderTopWidth: 1, borderColor: "#EDF2F1", marginTop: 12, paddingTop: 12 }, departmentTitle: { color: "#147D72", fontSize: 13, fontWeight: "900" }, investigationRow: { borderTopWidth: 1, borderColor: "#EDF2F1", paddingTop: 12, marginTop: 10, gap: 5 }, investigationTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }, investigationMain: { flex: 1 }, investigationStatus: { color: "#8A6427", backgroundColor: "#FFF2DC", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: "900", overflow: "hidden" }, investigationComplete: { color: "#28704C", backgroundColor: "#E1F4EB" }, investigationFinding: { color: "#29464A", backgroundColor: "#EDF6F3", borderRadius: 8, padding: 9, fontSize: 11, lineHeight: 16 }
});
