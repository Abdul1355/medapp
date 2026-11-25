import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

export function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Text style={styles.brand}>MEDICAL MANAGEMENT</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
      {children}
    </ScrollView>
  );
}

export function InfoCard({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>{title}</Text>
    <Text style={styles.value}>{value}</Text>
    {detail ? <Text style={styles.detail}>{detail}</Text> : null}
  </View>;
}

export const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 22, backgroundColor: "#F5F7FB", gap: 16, width: "100%", maxWidth: 1100, alignSelf: "center" },
  header: { paddingVertical: 12, gap: 6 },
  brand: { color: "#1677C8", fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  title: { color: "#14243A", fontSize: 28, fontWeight: "800" },
  card: { backgroundColor: "#FFFFFF", padding: 18, borderRadius: 14, borderWidth: 1, borderColor: "#E3EAF2", gap: 8, minWidth: 220, flexGrow: 1 },
  cardTitle: { color: "#64748B", fontSize: 14, fontWeight: "600" },
  value: { color: "#14243A", fontSize: 24, fontWeight: "800" },
  detail: { color: "#64748B", fontSize: 12 }
});
