import { Alert, Platform, Pressable, Text, StyleSheet, View } from "react-native";
import { api } from "../services/api";

export default function InvestigationReportButton({ id, filename }: { id: number; filename?: string }) {
  if (!filename) return null;
  async function openReport(download = false) {
    const reportWindow = !download && Platform.OS === "web" && typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    try {
      const response = await api.get(`/api/v1/investigations/${id}/report`, { responseType: "blob" });
      if (reportWindow) {
        const url = URL.createObjectURL(response.data);
        reportWindow.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else if (download && Platform.OS === "web" && typeof document !== "undefined") {
        const url = URL.createObjectURL(response.data);
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename || "investigation-report.pdf";
        anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else Alert.alert("PDF report", "Open or download the report from the web dashboard.");
    } catch (e: any) {
      reportWindow?.close();
      Alert.alert("Could not open report", e?.response?.data?.detail || "Try again later.");
    }
  }
  return <View style={s.row}><Pressable onPress={() => void openReport()} style={s.button}><Text style={s.text}>View PDF · {filename}</Text></Pressable><Pressable onPress={() => void openReport(true)} style={s.button}><Text style={s.text}>Download PDF</Text></Pressable></View>;
}

const s = StyleSheet.create({ row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 }, button: { alignSelf: "flex-start", backgroundColor: "#EAF4F1", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }, text: { color: "#147D72", fontSize: 10, fontWeight: "800" } });
