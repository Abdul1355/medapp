import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from "react-native";
import { router } from "expo-router";
import { api } from "../src/services/api";
import { saveAuthToken } from "../src/services/auth";

export default function LoginScreen() {
  const [registering, setRegistering] = useState(false);
  const [settingUpAdmin, setSettingUpAdmin] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function switchMode() {
    setRegistering((value) => !value);
    setSettingUpAdmin(false);
    setError(""); setFullName(""); setPhone(""); setConfirmPassword(""); setEmail(""); setPassword("");
  }

  function startAdminSetup() {
    setRegistering(false); setSettingUpAdmin(true);
    setError(""); setFullName(""); setPhone(""); setConfirmPassword(""); setEmail(""); setPassword("");
  }

  async function submit() {
    setError("");
    if (registering || settingUpAdmin) {
      if (!fullName.trim() || !email.trim()) { setError("Enter your name and email address."); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())) { setError("Enter a valid email address, for example name@gmail.com or name@clinic.in."); return; }
      const phoneDigits = phone.replace(/\D/g, "");
      if (registering && (!/^\+?[0-9\s().-]+$/.test(phone.trim()) || phoneDigits.length < 7 || phoneDigits.length > 15)) { setError("Enter a valid phone number with 7 to 15 digits."); return; }
      if (password.length < 10) { setError("Use a password with at least 10 characters."); return; }
      if (password !== confirmPassword) { setError("The passwords do not match."); return; }
    }
    setBusy(true);
    try {
      const { data } = settingUpAdmin
        ? await api.post("/api/v1/auth/setup-admin", { full_name: fullName.trim(), email: email.trim().toLowerCase(), password })
        : registering
          ? await api.post("/api/v1/auth/register", { full_name: fullName.trim(), email: email.trim().toLowerCase(), password, mobile: phone.trim() })
          : await api.post("/api/v1/auth/login", { email: email.trim().toLowerCase(), password });
      await saveAuthToken(data.access_token);
      const role = data.user?.role;
      const isAdmin = role === "SUPER_ADMIN" || role === "CLINIC_ADMIN";
      router.replace(isAdmin ? "/admin" : role === "DOCTOR" ? "/doctor" : role === "RECEPTIONIST" ? "/reception" : role === "SCANNING" ? "/scanning" : role === "LABORATORY" ? "/laboratory" : role === "DELIVERY" ? "/delivery" : "/dashboard");
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((item) => item?.msg).filter(Boolean).join("; ") : e?.request ? `Could not reach the server at ${api.defaults.baseURL}. Check that the backend is running and the API URL is correct.` : "Unable to complete your request. Please try again.");
    } finally { setBusy(false); }
  }

  return <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled"><View style={s.panel}>
    <Text style={s.brand}>MEDICAL MANAGEMENT</Text>
    <Text style={s.title}>{settingUpAdmin ? "Set up your clinic" : registering ? "Create your account" : "Welcome back"}</Text>
    <Text style={s.sub}>{settingUpAdmin ? "Create the first clinic administrator account." : registering ? "Register as a patient to access your health dashboard." : "Sign in to your clinic workspace."}</Text>
    {registering || settingUpAdmin ? <><Text style={s.label}>Full name</Text><TextInput style={s.input} autoCapitalize="words" value={fullName} onChangeText={setFullName} placeholder="Your name" placeholderTextColor="#91A0AE" /></> : null}
    {registering ? <><Text style={s.label}>Phone number</Text><TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={30} placeholder="e.g. +91 98765 43210" placeholderTextColor="#91A0AE" /></> : null}
    <Text style={s.label}>Email / username</Text>
    <TextInput style={s.input} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#91A0AE" />
    <Text style={s.label}>Password</Text>
    <TextInput style={s.input} secureTextEntry value={password} onChangeText={setPassword} placeholder="Enter your password" placeholderTextColor="#91A0AE" />
    {registering || settingUpAdmin ? <><Text style={s.label}>Confirm password</Text><TextInput style={s.input} secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Enter your password again" placeholderTextColor="#91A0AE" /></> : null}
    {error ? <Text style={s.error}>{error}</Text> : null}
    <Pressable style={[s.button, busy && s.disabled]} onPress={() => void submit()} disabled={busy}>
      <Text style={s.buttonText}>{busy ? (registering || settingUpAdmin ? "Creating account…" : "Signing in…") : settingUpAdmin ? "Create clinic admin" : registering ? "Register" : "Sign in"}</Text>
    </Pressable>
    {!settingUpAdmin && <Pressable onPress={switchMode} disabled={busy} style={s.switchButton}><Text style={s.switchText}>{registering ? "Already have an account? Sign in" : "New patient? Create an account"}</Text></Pressable>}
    {!registering && !settingUpAdmin ? <Pressable onPress={startAdminSetup} disabled={busy} style={s.switchButton}><Text style={s.switchText}>First time? Set up clinic administrator</Text></Pressable> : null}
    {!registering && !settingUpAdmin ? <Text style={s.hint}>Sign in with your account, or create a patient account.</Text> : <Text style={s.hint}>{settingUpAdmin ? "Available only before the first clinic user is created. Use a password with at least 10 characters." : "Enter a valid phone number, email, and password with at least 10 characters."}</Text>}
  </View></ScrollView>;
}

const s = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: "#F1F5F9", justifyContent: "center", alignItems: "center", padding: 20 },
  panel: { width: "100%", maxWidth: 440, backgroundColor: "white", padding: 28, borderRadius: 18, gap: 12 },
  brand: { fontSize: 12, fontWeight: "800", color: "#1677C8", letterSpacing: 1 },
  title: { fontSize: 30, fontWeight: "800", color: "#14243A" },
  sub: { color: "#64748B", marginBottom: 8 },
  label: { fontWeight: "700", color: "#334155" },
  input: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 10, padding: 13, color: "#0F172A" },
  button: { backgroundColor: "#1677C8", padding: 15, borderRadius: 10, alignItems: "center", marginTop: 8 },
  disabled: { opacity: 0.65 },
  buttonText: { color: "white", fontWeight: "800" },
  switchButton: { alignItems: "center", paddingVertical: 7 },
  switchText: { color: "#1677C8", fontWeight: "700", textAlign: "center" },
  hint: { fontSize: 12, color: "#64748B", marginTop: 4, textAlign: "center" },
  error: { color: "#B91C1C", backgroundColor: "#FEF2F2", padding: 10, borderRadius: 8, fontSize: 12 }
});
