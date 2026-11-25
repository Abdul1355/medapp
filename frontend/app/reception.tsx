import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { api } from "../src/services/api";
import { clearAuthToken, getAuthToken } from "../src/services/auth";

type Patient = { id: number; name: string; email: string; active: boolean; mobile?: string; age?: number; blood_group?: string; systolic_bp?: number; diastolic_bp?: number };
type Appointment = { id: number; patient_name: string; doctor_name: string; scheduled_at: string; status: string };
type Doctor = { id: number; name: string; specialization?: string };

export default function ReceptionPage() {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const [me, setMe] = useState<any>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [age, setAge] = useState("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [doctorSearch, setDoctorSearch] = useState("");
  const [appointmentDate, setAppointmentDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const day = String(tomorrow.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
  const [appointmentTime, setAppointmentTime] = useState("09:00");
  const [visitReason, setVisitReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const token = await getAuthToken();
      if (!token) { router.replace("/"); return; }
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      const [meRes, patientRes, appointmentRes, doctorRes] = await Promise.all([
        api.get("/api/v1/auth/me"),
        api.get("/api/v1/patients/directory"),
        api.get("/api/v1/appointments/manage"),
        api.get("/api/v1/doctors"),
      ]);
      if (meRes.data.role !== "RECEPTIONIST" && meRes.data.role !== "CLINIC_ADMIN" && meRes.data.role !== "SUPER_ADMIN") {
        router.replace("/dashboard"); return;
      }
      setMe(meRes.data); setPatients(patientRes.data); setAppointments(appointmentRes.data); setDoctors(doctorRes.data);
    } catch (e: any) {
      if (e?.response?.status === 401) router.replace("/");
      else setError(e?.response?.data?.detail || "Unable to load the receptionist workspace.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visiblePatients = useMemo(() => patients.filter((patient) =>
    `${patient.name} ${patient.email} ${patient.mobile || ""}`.toLowerCase().includes(search.toLowerCase())
  ), [patients, search]);

  async function createPatient() {
    if (!name.trim() || !email.trim() || password.length < 10) {
      setError("Enter a full name, email, and password of at least 10 characters."); return;
    }
    const ageValue = age ? Number(age) : null;
    const systolicValue = systolic ? Number(systolic) : null;
    const diastolicValue = diastolic ? Number(diastolic) : null;
    if (ageValue !== null && (!Number.isInteger(ageValue) || ageValue < 1 || ageValue > 130)) {
      setError("Enter a valid age."); return;
    }
    if ((systolicValue !== null || diastolicValue !== null) &&
      (systolicValue === null || diastolicValue === null || systolicValue < 50 || systolicValue > 260 ||
       diastolicValue < 30 || diastolicValue > 160)) {
      setError("Enter a valid systolic/diastolic BP, for example 120/80."); return;
    }
    if (doctorId) {
      const appointmentDateTime = new Date(`${appointmentDate}T${appointmentTime}`);
      if (Number.isNaN(appointmentDateTime.getTime()) || appointmentDateTime <= new Date()) {
        setError("Choose a time later today or a future date for the assigned doctor."); return;
      }
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const assignedDoctor = doctorId ? doctors.find((doctor) => doctor.id === doctorId) : null;
      const patientResponse = await api.post("/api/v1/patients", {
        full_name: name.trim(), email: email.trim().toLowerCase(), password,
        mobile: mobile.trim(), age: ageValue, blood_group: bloodGroup.trim().toUpperCase(),
        systolic_bp: systolicValue, diastolic_bp: diastolicValue,
      });
      if (doctorId) {
        const appointmentDateTime = new Date(`${appointmentDate}T${appointmentTime}`);
        await api.post("/api/v1/appointments/manage", {
          patient_id: patientResponse.data.id,
          patient_name: null,
          doctor_id: doctorId,
          scheduled_at: appointmentDateTime.toISOString(),
          reason: visitReason.trim() || "Walk-in consultation",
        });
      }
      setName(""); setEmail(""); setPassword(""); setMobile(""); setAge(""); setBloodGroup("");
      setSystolic(""); setDiastolic(""); setDoctorId(null); setDoctorSearch("");
      setVisitReason(""); setAppointmentTime("09:00");
      const nextDay = new Date();
      nextDay.setDate(nextDay.getDate() + 1);
      setAppointmentDate(`${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}`);
      setShowForm(false);
      setNotice(assignedDoctor ? `Patient created and assigned to Dr. ${assignedDoctor.name}.` : "Patient account created successfully."); await load();
    } catch (e: any) { setError(e?.response?.data?.detail || "Could not create the patient."); }
    finally { setSaving(false); }
  }

  const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = localDateKey(new Date());
  const todayAppointments = appointments.filter((item) => localDateKey(new Date(item.scheduled_at)) === today);
  const waiting = appointments.filter((item) => item.status === "WAITING_FOR_DOCTOR").length;

  return <View style={s.page}>
    <View style={[s.shell, compact && s.shellCompact]}>
      {!compact && <View style={s.sidebar}>
        <View style={s.brandMark}><Text style={s.brandGlyph}>+</Text></View>
        <Text style={s.brand}>MEDICAL{"\n"}<Text style={s.brandLight}>RECEPTION</Text></Text>
        <Text style={s.navCaption}>WORKSPACE</Text>
        <Pressable style={[s.navItem, s.navActive]}><Text style={s.navIcon}>▦</Text><Text style={s.navActiveText}>Reception</Text></Pressable>
        <Pressable style={s.navItem} onPress={() => router.push("/appointments")}><Text style={s.navIcon}>▤</Text><Text style={s.navText}>Appointments</Text></Pressable>
        <View style={s.sidebarBottom}><View style={s.avatar}><Text style={s.avatarText}>{(me?.full_name || "RC").split(/\s+/).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase()}</Text></View><View><Text style={s.profileName}>{me?.full_name || "Receptionist"}</Text><Text style={s.profileRole}>Reception desk</Text></View></View>
      </View>}
      <ScrollView contentContainerStyle={s.content}>
        <View style={[s.topbar, compact && s.topbarCompact]}>
          <View><Text style={s.eyebrow}>PATIENT SERVICES</Text><Text style={s.title}>Reception dashboard</Text><Text style={s.subtitle}>Register patients and manage today’s visits.</Text></View>
          <View style={s.topActions}>
            {compact && <Text style={s.brandCompact}>MEDICAL RECEPTION</Text>}
            <Pressable style={s.secondaryButton} onPress={() => router.replace("/dashboard")}><Text style={s.secondaryText}>← Dashboard</Text></Pressable>
            <Pressable style={s.primaryButton} onPress={() => { setShowForm(!showForm); setError(""); }}><Text style={s.primaryText}>{showForm ? "Close" : "+  Add patient"}</Text></Pressable>
            <Pressable style={s.signOut} onPress={async () => { await clearAuthToken(); router.replace("/"); }}><Text style={s.signOutText}>Sign out</Text></Pressable>
          </View>
        </View>
        {error ? <View style={s.errorBanner}><Text style={s.errorText}>{error}</Text></View> : null}
        {notice ? <View style={s.noticeBanner}><Text style={s.noticeText}>{notice}</Text></View> : null}
        {loading ? <View style={s.loading}><ActivityIndicator color="#147D72" /><Text style={s.muted}>Loading reception…</Text></View> : <>
          <View style={s.metrics}>
            <Metric label="Patients" value={patients.length} note="Registered in this clinic" />
            <Metric label="Today" value={todayAppointments.length} note="Appointments today" />
            <Metric label="Waiting" value={waiting} note="Ready for doctor" />
            <Metric label="Doctors" value={doctors.length} note="Available providers" />
          </View>
          {showForm && <View style={s.formCard}>
            <Text style={s.cardTitle}>Create patient account</Text>
            <Text style={s.cardSub}>Add the basic profile and initial blood pressure reading.</Text>
            <View style={[s.formGrid, compact && s.formGridCompact]}>
              <Field label="FULL NAME" value={name} onChangeText={setName} placeholder="Patient full name" />
              <Field label="EMAIL" value={email} onChangeText={setEmail} placeholder="patient@email.com" keyboardType="email-address" />
              <Field label="PASSWORD" value={password} onChangeText={setPassword} placeholder="Minimum 10 characters" secureTextEntry />
              <Field label="MOBILE" value={mobile} onChangeText={setMobile} placeholder="Phone number" keyboardType="phone-pad" />
              <Field label="AGE" value={age} onChangeText={setAge} placeholder="Years" keyboardType="numeric" />
              <Field label="BLOOD GROUP" value={bloodGroup} onChangeText={setBloodGroup} placeholder="A+, O-, B+" />
              <Field label="SYSTOLIC BP" value={systolic} onChangeText={setSystolic} placeholder="120" keyboardType="numeric" />
              <Field label="DIASTOLIC BP" value={diastolic} onChangeText={setDiastolic} placeholder="80" keyboardType="numeric" />
            </View>
            <View style={s.doctorAssignment}>
              <Text style={s.cardTitle}>Assign doctor</Text>
              <Text style={s.cardSub}>Optional: assign this patient to a doctor and schedule the first visit.</Text>
              <TextInput
                value={doctorSearch}
                onChangeText={(value) => { setDoctorSearch(value); setDoctorId(null); }}
                placeholder="Search doctor or specialization"
                placeholderTextColor="#95A4A4"
                style={s.search}
              />
              <View style={s.doctorOptions}>
                {doctors
                  .filter((doctor) => `${doctor.name} ${doctor.specialization || ""}`.toLowerCase().includes(doctorSearch.toLowerCase()))
                  .map((doctor) => <Pressable
                    key={doctor.id}
                    onPress={() => { setDoctorId(doctor.id); setDoctorSearch(doctor.name); }}
                    style={[s.doctorOption, doctorId === doctor.id && s.doctorOptionSelected]}
                  >
                    <Text style={[s.doctorOptionName, doctorId === doctor.id && s.doctorOptionNameSelected]}>{doctor.name}</Text>
                    <Text style={s.optionMeta}>{doctor.specialization || "Care provider"}</Text>
                  </Pressable>)}
              </View>
              {doctorId ? <>
                <View style={[s.formGrid, compact && s.formGridCompact]}>
                  <Field label="APPOINTMENT DATE" value={appointmentDate} onChangeText={setAppointmentDate} placeholder="YYYY-MM-DD" />
                  <Field label="APPOINTMENT TIME" value={appointmentTime} onChangeText={setAppointmentTime} placeholder="09:00" />
                  <Field label="REASON" value={visitReason} onChangeText={setVisitReason} placeholder="Reason for visit" />
                </View>
                <Text style={s.selectionHint}>Use YYYY-MM-DD and 24-hour time, for example 09:30.</Text>
              </> : null}
            </View>
            <View style={s.formFooter}><Text style={s.selectionHint}>BP format: systolic / diastolic (for example 120 / 80).</Text><Pressable disabled={saving} style={[s.primaryButton, saving && s.disabled]} onPress={() => void createPatient()}><Text style={s.primaryText}>{saving ? "Creating…" : "Create patient"}</Text></Pressable></View>
          </View>}
          <View style={s.listCard}>
            <View style={s.listHeader}><View><Text style={s.cardTitle}>Patient directory</Text><Text style={s.cardSub}>{visiblePatients.length} patients</Text></View><Pressable style={s.refresh} onPress={() => void load()}><Text style={s.refreshText}>↻ Refresh</Text></Pressable></View>
            <TextInput value={search} onChangeText={setSearch} placeholder="Search name, email, or phone" placeholderTextColor="#95A4A4" style={s.search} />
            {visiblePatients.map((patient) => <View key={patient.id} style={s.patientRow}>
              <View style={s.patientAvatar}><Text style={s.patientAvatarText}>{patient.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</Text></View>
              <Pressable style={s.patientIdentity} onPress={() => router.push(`/patient/${patient.id}` as any)}><Text style={s.patientName}>{patient.name}</Text><Text style={s.patientMeta}>{patient.mobile || "No phone"} · {patient.age ? `${patient.age} years` : "Age —"} · {patient.blood_group || "Blood group —"}</Text></Pressable>
              <View style={s.bpBox}><Text style={s.bpLabel}>BP</Text><Text style={s.bpValue}>{patient.systolic_bp && patient.diastolic_bp ? `${patient.systolic_bp}/${patient.diastolic_bp}` : "—"}</Text></View>
              <Pressable style={s.openButton} onPress={() => router.push(`/patient/${patient.id}` as any)}><Text style={s.openText}>Open</Text></Pressable>
            </View>)}
            {!visiblePatients.length && <View style={s.empty}><Text style={s.cardSub}>No matching patients found.</Text></View>}
          </View>
        </>}
      </ScrollView>
    </View>
  </View>;
}

function Field({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: "default" | "numeric" | "email-address" | "phone-pad"; secureTextEntry?: boolean }) {
  return <View style={s.field}><Text style={s.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#95A4A4" keyboardType={keyboardType} secureTextEntry={secureTextEntry} style={s.input} /></View>;
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return <View style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={s.metricValue}>{value}</Text><Text style={s.metricNote}>{note}</Text></View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F5F7F8" }, shell: { flex: 1, flexDirection: "row", width: "100%", maxWidth: 1600, alignSelf: "center" }, shellCompact: { maxWidth: 760 },
  sidebar: { width: 238, backgroundColor: "#102C35", padding: 24, paddingTop: 30 }, brandMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#D3F0E6", alignItems: "center", justifyContent: "center", marginBottom: 15 }, brandGlyph: { fontSize: 25, color: "#147D72", fontWeight: "700", lineHeight: 30 }, brand: { color: "white", fontWeight: "900", fontSize: 13, letterSpacing: 1.3, lineHeight: 19 }, brandLight: { color: "#90B4B2", fontSize: 11, letterSpacing: 2 }, navCaption: { marginTop: 55, marginBottom: 14, color: "#759397", fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  navItem: { height: 45, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, marginBottom: 5, borderRadius: 10 }, navActive: { backgroundColor: "#1D444A" }, navIcon: { color: "#96B4B5", fontSize: 17, width: 18 }, navText: { color: "#A9C0C0", fontWeight: "600", fontSize: 13 }, navActiveText: { color: "white", fontWeight: "700", fontSize: 13 }, sidebarBottom: { marginTop: "auto", paddingTop: 22, borderTopWidth: 1, borderColor: "#315056", flexDirection: "row", alignItems: "center", gap: 11 }, avatar: { width: 35, height: 35, borderRadius: 20, backgroundColor: "#D6EEE6", alignItems: "center", justifyContent: "center" }, avatarText: { color: "#176C64", fontWeight: "800", fontSize: 11 }, profileName: { color: "white", fontSize: 12, fontWeight: "700" }, profileRole: { color: "#9AB3B5", fontSize: 10, marginTop: 3 },
  content: { width: "100%", maxWidth: 1200, alignSelf: "center", padding: 24, gap: 16 }, topbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, topbarCompact: { alignItems: "flex-start" }, eyebrow: { color: "#147D72", fontSize: 10, fontWeight: "900", letterSpacing: 1.4 }, title: { color: "#19363D", fontSize: 28, fontWeight: "900", marginTop: 5 }, subtitle: { color: "#748688", fontSize: 12, marginTop: 5 }, topActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }, brandCompact: { color: "#147D72", fontWeight: "900", fontSize: 11, width: "100%", textAlign: "right" },
  secondaryButton: { borderWidth: 1, borderColor: "#D8E3E0", backgroundColor: "white", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 }, secondaryText: { color: "#486366", fontWeight: "700", fontSize: 12 }, primaryButton: { backgroundColor: "#147D72", borderRadius: 8, paddingHorizontal: 13, paddingVertical: 10 }, primaryText: { color: "white", fontWeight: "800", fontSize: 12 }, signOut: { borderWidth: 1, borderColor: "#D8E3E0", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 }, signOutText: { color: "#486366", fontWeight: "700", fontSize: 12 },
  errorBanner: { backgroundColor: "#FCE9E7", borderRadius: 8, padding: 12 }, errorText: { color: "#A43932", fontWeight: "700" }, noticeBanner: { backgroundColor: "#E1F4EB", borderRadius: 8, padding: 12 }, noticeText: { color: "#28704C", fontWeight: "700" }, loading: { alignItems: "center", padding: 30, gap: 8 }, muted: { color: "#748688" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, metric: { flexGrow: 1, flexBasis: 160, backgroundColor: "white", borderWidth: 1, borderColor: "#E5ECEA", borderRadius: 12, padding: 15 }, metricLabel: { color: "#788B8C", fontSize: 11, fontWeight: "700" }, metricValue: { color: "#147D72", fontSize: 24, fontWeight: "900", marginTop: 6 }, metricNote: { color: "#7F9192", fontSize: 10, marginTop: 4 },
  formCard: { backgroundColor: "white", borderWidth: 1, borderColor: "#E5ECEA", borderRadius: 14, padding: 18 }, cardTitle: { color: "#1D3B40", fontSize: 16, fontWeight: "900" }, cardSub: { color: "#788B8C", fontSize: 11, marginTop: 5 }, formGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 }, formGridCompact: { flexDirection: "column" }, field: { flexGrow: 1, flexBasis: 220 }, fieldLabel: { color: "#718486", fontSize: 9, fontWeight: "900", letterSpacing: 0.8, marginBottom: 6 }, input: { borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 10, color: "#19363D", fontSize: 12 }, formFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 10 }, selectionHint: { color: "#7A8D8E", fontSize: 11, flex: 1 }, disabled: { opacity: 0.6 },
  doctorAssignment: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderColor: "#EEF2F1" }, doctorOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, doctorOption: { minWidth: 170, flexGrow: 1, borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 8, backgroundColor: "#FBFDFC", padding: 10 }, doctorOptionSelected: { backgroundColor: "#E6F4EF", borderColor: "#82BFAE" }, doctorOptionName: { color: "#29464A", fontSize: 12, fontWeight: "800" }, doctorOptionNameSelected: { color: "#147D72" }, optionMeta: { color: "#7A8D8E", fontSize: 10, marginTop: 4 },
  listCard: { backgroundColor: "white", borderWidth: 1, borderColor: "#E5ECEA", borderRadius: 14, padding: 18 }, listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, refresh: { backgroundColor: "#EFF5F3", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 }, refreshText: { color: "#557173", fontWeight: "700", fontSize: 11 }, search: { borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 12, color: "#19363D" },
  patientRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderColor: "#EEF2F1", paddingVertical: 12 }, patientAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E3F3EE", alignItems: "center", justifyContent: "center" }, patientAvatarText: { color: "#147D72", fontWeight: "900", fontSize: 10 }, patientIdentity: { flex: 1 }, patientName: { color: "#29464A", fontSize: 13, fontWeight: "800" }, patientMeta: { color: "#7A8D8E", fontSize: 10, marginTop: 4 }, bpBox: { minWidth: 62, alignItems: "center", borderLeftWidth: 1, borderRightWidth: 1, borderColor: "#EEF2F1" }, bpLabel: { color: "#95A4A4", fontSize: 8, fontWeight: "900" }, bpValue: { color: "#147D72", fontSize: 12, fontWeight: "900", marginTop: 3 }, openButton: { backgroundColor: "#F0F5F3", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }, openText: { color: "#557173", fontWeight: "800", fontSize: 11 }, empty: { alignItems: "center", padding: 18 },
});
