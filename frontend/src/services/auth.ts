import { api } from "./api";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export type Role = "SUPER_ADMIN" | "CLINIC_ADMIN" | "PATIENT" | "RECEPTIONIST" | "DOCTOR" | "SCANNING" | "LABORATORY" | "DELIVERY";
export type User = { id: number; full_name: string; email: string; role: Role };

export async function saveAuthToken(token: string) {
  if (Platform.OS === "web") localStorage.setItem("medical_token", token);
  else await SecureStore.setItemAsync("medical_token", token);
}

export async function getAuthToken() {
  if (Platform.OS === "web") return localStorage.getItem("medical_token");
  return SecureStore.getItemAsync("medical_token");
}

export async function clearAuthToken() {
  if (Platform.OS === "web") localStorage.removeItem("medical_token");
  else await SecureStore.deleteItemAsync("medical_token");
}

export async function login(email: string, password: string) {
  const response = await api.post("/api/v1/auth/login", { email, password });
  return response.data as { access_token: string; token_type: string; user: User };
}
