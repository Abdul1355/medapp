import axios from "axios";
import Constants from "expo-constants";
import { Platform } from "react-native";

function getApiBaseUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  const expoHost = Constants.expoConfig?.hostUri?.split(":")[0];
  const configuredIsLoopback = !!configuredUrl && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(configuredUrl);
  const webHost = Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.hostname
    : undefined;
  const loopbackHosts = ["localhost", "127.0.0.1", "::1"];
  const expoHostIsRemote = !!expoHost && !loopbackHosts.includes(expoHost);
  const webHostIsRemote = !!webHost && !loopbackHosts.includes(webHost);

  if (configuredUrl && !configuredIsLoopback) return configuredUrl.replace(/\/$/, "");

  // If an older .env still says localhost, replace it with the machine hosting
  // the Expo app for LAN web/device clients. Keep localhost for desktop web or
  // an iOS simulator when Expo cannot provide a remote host.
  if (Platform.OS === "web") {
    const host = webHostIsRemote ? webHost : expoHostIsRemote ? expoHost : webHost || "localhost";
    if (configuredUrl && !webHostIsRemote && !expoHostIsRemote) return configuredUrl.replace(/\/$/, "");
    return `http://${host}:8000`;
  }

  if (expoHostIsRemote) return `http://${expoHost}:8000`;
  if (Platform.OS === "android") return "http://10.0.2.2:8000";
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const host = expoHost || "localhost";
  return `http://${host}:8000`;
}

export const api = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});
