import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { api } from "../services/api";
import { clearAuthToken, getAuthToken } from "../services/auth";

type StaffRole = "SCANNING" | "LABORATORY" | "DELIVERY";
type WorkItem = Record<string, any>;

const roleConfig = {
  SCANNING: { title: "Scanning dashboard", subtitle: "Review and process imaging and scanning requests.", endpoint: "/api/v1/investigations/worklist", section: "Scanning requests" },
  LABORATORY: { title: "Laboratory dashboard", subtitle: "Review and process laboratory test requests.", endpoint: "/api/v1/investigations/worklist", section: "Laboratory requests" },
  DELIVERY: { title: "Delivery dashboard", subtitle: "Manage clinic medicine deliveries and update delivery progress.", endpoint: "/api/v1/orders/delivery", section: "Clinic deliveries" },
} as const;

export default function StaffWorkflowDashboard({ role }: { role: StaffRole }) {
  const config = roleConfig[role];
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [resultDrafts, setResultDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedPatientRequest, setSelectedPatientRequest] = useState<WorkItem | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const token = await getAuthToken();
      if (!token) { router.replace("/"); return; }
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      const response = await api.get(config.endpoint);
      setItems(response.data);
    } catch (e: any) {
      if (e?.response?.status === 401) router.replace("/");
      else setError(e?.response?.data?.detail || `Could not load ${config.section.toLowerCase()}.`);
    } finally { setLoading(false); }
  }, [config.endpoint, config.section]);

  useEffect(() => {
    void load();
    const refreshTimer = setInterval(() => {
      void load(false);
    }, 5000);
    return () => clearInterval(refreshTimer);
  }, [load]);

  async function advance(item: WorkItem, status: string) {
    setBusyId(item.id); setError(""); setNotice("");
    try {
      const endpoint = role === "DELIVERY"
        ? `/api/v1/orders/delivery/${item.id}/status`
        : `/api/v1/investigations/${item.id}/status`;
      await api.patch(endpoint, { status, result: resultDrafts[item.id] || "" });
      setNotice(role === "DELIVERY" ? `Order #${item.id} updated.` : `${item.test_name} updated.`);
      if (role !== "DELIVERY" && status === "COMPLETED") setResultDrafts((current) => ({ ...current, [item.id]: "" }));
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not update this item.");
    } finally { setBusyId(null); }
  }

  async function uploadReport(item: WorkItem, file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a PDF report."); return;
    }
    const form = new FormData(); form.append("file", file, file.name);
    setBusyId(item.id); setError(""); setNotice("");
    try {
      const response = await api.post(`/api/v1/investigations/${item.id}/report`, form, { headers: { "Content-Type": "multipart/form-data" } });
      setNotice(`PDF report uploaded for ${item.test_name}.`);
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, report_filename: response.data.report_filename } : entry));
      setSelectedPatientRequest((current) => current?.id === item.id ? { ...current, report_filename: response.data.report_filename } : current);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not upload this PDF report.");
    } finally { setBusyId(null); }
  }

  async function viewReport(item: WorkItem) {
    const reportWindow = Platform.OS === "web" && typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    try {
      const response = await api.get(`/api/v1/investigations/${item.id}/report`, { responseType: "blob" });
      if (reportWindow) {
        const url = URL.createObjectURL(response.data);
        reportWindow.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else Alert.alert("PDF report", "Open the report from the web dashboard.");
    } catch (e: any) { reportWindow?.close(); setError(e?.response?.data?.detail || "Could not open this report."); }
  }

  function chooseReport(item: WorkItem) {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      Alert.alert("Upload PDF", "PDF upload is available from the web dashboard."); return;
    }
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/pdf,.pdf";
    input.onchange = () => { const file = input.files?.[0]; if (file) void uploadReport(item, file); };
    input.click();
  }

  function actionFor(item: WorkItem) {
    if (role === "DELIVERY") {
      if (item.status === "PREPARING") return { status: "OUT_FOR_DELIVERY", label: "Dispatch order" };
      if (item.status === "OUT_FOR_DELIVERY") return { status: "DELIVERED", label: "Mark delivered" };
      return null;
    }
    if (item.status === "ORDERED") return { status: "IN_PROGRESS", label: "Start work" };
    if (item.status === "IN_PROGRESS") return { status: "COMPLETED", label: "Mark complete" };
    return null;
  }

  return <View style={s.page}><ScrollView contentContainerStyle={s.content}>
    <View style={s.header}>
      <View><Text style={s.kicker}>MEDICAL WORKSPACE · {role}</Text><Text style={s.title}>{config.title}</Text><Text style={s.subtitle}>{config.subtitle}</Text></View>
      <View style={s.headerActions}><Pressable disabled={loading} onPress={() => void load()} style={[s.secondaryButton, loading && s.disabled]}><Text style={s.secondaryText}>{loading ? "Refreshing…" : "↻ Refresh"}</Text></Pressable><Pressable onPress={async () => { await clearAuthToken(); router.replace("/"); }} style={s.secondaryButton}><Text style={s.secondaryText}>Sign out</Text></Pressable></View>
    </View>
    {error ? <Text style={s.error}>{error}</Text> : null}{notice ? <Text style={s.notice}>{notice}</Text> : null}
    <View style={s.panel}><View style={s.panelHeading}><View><Text style={s.panelTitle}>{config.section}</Text><Text style={s.muted}>{items.length} {role === "DELIVERY" ? "orders" : "requests"}</Text></View></View>
      {loading ? <View style={s.loading}><ActivityIndicator color="#147D72" /><Text style={s.muted}>Loading your work…</Text></View> : items.length ? items.map((item) => {
        const action = actionFor(item);
        return <View key={item.id} style={s.item}>
          <View style={s.itemTop}><View style={s.itemMain}><Text style={s.itemTitle}>{role === "DELIVERY" ? `Order #${item.id} · ${item.patient_name}` : item.test_name}</Text><Text style={s.muted}>{role === "DELIVERY" ? item.patient_email : `${item.patient_name} · ${item.department}`}</Text></View><Text style={[s.status, item.status === "COMPLETED" || item.status === "DELIVERED" ? s.statusDone : s.statusActive]}>{item.status.replaceAll("_", " ")}</Text></View>
          {role === "DELIVERY" ? <>
            <Text style={s.detail}>{(item.items || []).map((line: any) => `${line.name} × ${line.quantity}`).join(" · ")}</Text>
            <Text style={s.detail}>Deliver to: {item.delivery_address}</Text>
            <Text style={s.detail}>Total: ₹{Number(item.total_amount || 0).toFixed(2)}</Text>
          </> : <>
            <Pressable onPress={() => setSelectedPatientRequest(item)} style={s.reportButton}><Text style={s.reportButtonText}>View patient details · {item.patient_name} · {item.patient_number} ›</Text></Pressable>
            <Text style={s.detail}>Age: {item.patient_age ?? "—"} · Phone: {item.patient_mobile || "Not recorded"}</Text>
            <Text style={s.detail}>Diagnosis: {item.diagnosis || "Not recorded"}</Text>
            <Text style={s.detail}>Symptoms: {item.symptoms || "Not recorded"}</Text>
            <Text style={s.detail}>Requested by: {item.requested_by} · Visit #{item.appointment_id}</Text>
            <Text style={s.detail}>Requested {new Date(item.created_at).toLocaleString()}</Text>
            {item.result ? <Text style={s.result}>Findings: {item.result}</Text> : null}
            {item.report_filename ? <Pressable onPress={() => void viewReport(item)} style={s.reportButton}><Text style={s.reportButtonText}>View PDF · {item.report_filename}</Text></Pressable> : null}
          </>}
          {role !== "DELIVERY" && <Pressable disabled={busyId === item.id} onPress={() => chooseReport(item)} style={[s.reportButton, busyId === item.id && s.disabled]}><Text style={s.reportButtonText}>{busyId === item.id ? "Uploading PDF…" : item.report_filename ? "Replace PDF report" : "Upload PDF report"}</Text></Pressable>}
          {role !== "DELIVERY" && item.status === "IN_PROGRESS" && <TextInput value={resultDrafts[item.id] || ""} onChangeText={(value) => setResultDrafts((current) => ({ ...current, [item.id]: value }))} placeholder="Enter scan or laboratory findings before completing" multiline style={s.resultInput} />}
          {action ? <Pressable disabled={busyId === item.id || (action.status === "COMPLETED" && !(resultDrafts[item.id] || "").trim())} onPress={() => void advance(item, action.status)} style={[s.action, (busyId === item.id || (action.status === "COMPLETED" && !(resultDrafts[item.id] || "").trim())) && s.disabled]}><Text style={s.actionText}>{busyId === item.id ? "Saving…" : action.label}</Text></Pressable> : <Text style={s.noAction}>{role === "DELIVERY" ? "Order status is managed by the clinic until it is ready for dispatch." : "This request is complete."}</Text>}
        </View>;
      }) : <View style={s.empty}><Text style={s.emptyTitle}>No open work items</Text><Text style={s.muted}>New requests will appear here when they are assigned to your department.</Text></View>}
    </View>
  </ScrollView>
    <Modal visible={Boolean(selectedPatientRequest)} transparent animationType="fade" onRequestClose={() => setSelectedPatientRequest(null)}>
      <View style={s.modalShade}><View style={s.modalCard}>
        <View style={s.modalHeader}><View><Text style={s.modalTitle}>Patient request details</Text><Text style={s.muted}>{role === "SCANNING" ? "Scanning request" : "Laboratory request"}</Text></View><Pressable onPress={() => setSelectedPatientRequest(null)}><Text style={s.modalClose}>×</Text></Pressable></View>
        {selectedPatientRequest && <ScrollView contentContainerStyle={s.modalContent}>
          <Text style={s.patientHeading}>{selectedPatientRequest.patient_name} · {selectedPatientRequest.patient_number}</Text>
          <Text style={s.detail}>Age: {selectedPatientRequest.patient_age ?? "—"} · Phone: {selectedPatientRequest.patient_mobile || "Not recorded"}</Text>
          <Text style={s.detail}>Requested {role === "SCANNING" ? "scan" : "test"}: {selectedPatientRequest.test_name}</Text>
          <Text style={s.detail}>Status: {selectedPatientRequest.status.replaceAll("_", " ")} · Requested by: {selectedPatientRequest.requested_by}</Text>
          <Text style={s.detail}>Diagnosis: {selectedPatientRequest.diagnosis || "Not recorded"}</Text>
          <Text style={s.detail}>Symptoms: {selectedPatientRequest.symptoms || "Not recorded"}</Text>
          {selectedPatientRequest.result ? <Text style={s.result}>Findings: {selectedPatientRequest.result}</Text> : null}
          {selectedPatientRequest.report_filename ? <Pressable onPress={() => void viewReport(selectedPatientRequest)} style={s.reportButton}><Text style={s.reportButtonText}>View PDF · {selectedPatientRequest.report_filename}</Text></Pressable> : <Text style={s.muted}>No PDF report uploaded yet.</Text>}
          <Pressable disabled={busyId === selectedPatientRequest.id} onPress={() => chooseReport(selectedPatientRequest)} style={[s.reportButton, busyId === selectedPatientRequest.id && s.disabled]}><Text style={s.reportButtonText}>{busyId === selectedPatientRequest.id ? "Uploading PDF…" : selectedPatientRequest.report_filename ? "Replace PDF report" : "Upload PDF report"}</Text></Pressable>
        </ScrollView>}
      </View></View>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F4F7F8" }, content: { width: "100%", maxWidth: 980, alignSelf: "center", padding: 22, gap: 16 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }, headerActions: { flexDirection: "row", gap: 8 }, kicker: { color: "#147D72", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 }, title: { color: "#19363D", fontSize: 27, fontWeight: "900", marginTop: 5 }, subtitle: { color: "#748688", fontSize: 12, marginTop: 4 }, secondaryButton: { backgroundColor: "white", borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 }, secondaryText: { color: "#436461", fontSize: 10, fontWeight: "800" }, disabled: { opacity: 0.55 }, panel: { backgroundColor: "white", borderRadius: 14, borderWidth: 1, borderColor: "#E5ECEA", padding: 18 }, panelHeading: { flexDirection: "row", justifyContent: "space-between", marginBottom: 9 }, panelTitle: { color: "#19363D", fontSize: 16, fontWeight: "900" }, muted: { color: "#819190", fontSize: 11, marginTop: 4 }, loading: { minHeight: 130, alignItems: "center", justifyContent: "center", gap: 8 }, item: { borderTopWidth: 1, borderColor: "#EDF1F0", paddingVertical: 14, gap: 5 }, itemTop: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }, itemMain: { flex: 1 }, itemTitle: { color: "#29464A", fontSize: 13, fontWeight: "900" }, patientHeading: { color: "#29464A", fontSize: 12, fontWeight: "800", marginTop: 2 }, status: { overflow: "hidden", borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5, fontSize: 9, fontWeight: "900" }, statusActive: { color: "#8A6427", backgroundColor: "#FFF2DC" }, statusDone: { color: "#28704C", backgroundColor: "#E1F4EB" }, detail: { color: "#5F7576", fontSize: 11, lineHeight: 17 }, result: { color: "#29464A", backgroundColor: "#EAF4F1", padding: 10, borderRadius: 8, fontSize: 11, lineHeight: 17 }, resultInput: { minHeight: 76, borderWidth: 1, borderColor: "#DCE5E3", backgroundColor: "white", borderRadius: 8, padding: 10, color: "#19363D", fontSize: 11, textAlignVertical: "top" }, reportButton: { alignSelf: "flex-start", backgroundColor: "#EAF4F1", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8, marginTop: 4 }, reportButtonText: { color: "#147D72", fontSize: 10, fontWeight: "900" }, modalShade: { flex: 1, backgroundColor: "rgba(16,35,38,0.45)", alignItems: "center", justifyContent: "center", padding: 18 }, modalCard: { width: "100%", maxWidth: 600, maxHeight: "90%", backgroundColor: "white", borderRadius: 14, padding: 18 }, modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1, borderColor: "#EDF1F0", paddingBottom: 12 }, modalTitle: { color: "#19363D", fontSize: 18, fontWeight: "900" }, modalClose: { color: "#597172", fontSize: 24, lineHeight: 26 }, modalContent: { paddingTop: 13, gap: 9 }, action: { alignSelf: "flex-start", backgroundColor: "#147D72", borderRadius: 8, paddingHorizontal: 13, paddingVertical: 9, marginTop: 4 }, actionText: { color: "white", fontSize: 10, fontWeight: "900" }, noAction: { color: "#89999A", fontSize: 10, marginTop: 3 }, empty: { alignItems: "center", padding: 26, borderTopWidth: 1, borderColor: "#EDF1F0", gap: 5 }, emptyTitle: { color: "#29464A", fontSize: 13, fontWeight: "800" }, error: { color: "#9C3530", backgroundColor: "#FCE9E7", padding: 11, borderRadius: 8, fontSize: 11 }, notice: { color: "#28704C", backgroundColor: "#E1F4EB", padding: 11, borderRadius: 8, fontSize: 11 },
});
