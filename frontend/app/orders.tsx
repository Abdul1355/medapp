import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Location from "expo-location";
import { api } from "../src/services/api";
import { getAuthToken } from "../src/services/auth";

type Product = { id: string; name: string; category: string; price: number };
type OrderItem = { product_id: string; name: string; unit_price: number; quantity: number; line_total: number };
type Order = { id: number; status: string; delivery_address: string; subtotal: number; delivery_charge: number; total_amount: number; created_at: string; items: OrderItem[] };

const money = (amount: number) => `₹${amount.toFixed(2)}`;
const DELIVERY_CHARGE = 70;
const ORDER_STAGES = ["PLACED", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];
const statusLabel = (status: string) => status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function OrdersPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshingOrders, setRefreshingOrders] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const token = await getAuthToken();
      if (!token) { router.replace("/"); return; }
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      const [catalog, history] = await Promise.all([
        api.get<Product[]>("/api/v1/orders/catalog"), api.get<Order[]>("/api/v1/orders")
      ]);
      setProducts(catalog.data); setOrders(history.data);
      setLastUpdated(new Date());
    } catch (e: any) {
      if (e?.response?.status === 401) router.replace("/");
      else setError(e?.response?.data?.detail || "Could not load the order catalog.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refreshOrders = useCallback(async (showLoading = false) => {
    if (showLoading) setRefreshingOrders(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      const response = await api.get<Order[]>("/api/v1/orders");
      setOrders(response.data); setLastUpdated(new Date());
    } catch {
      // Keep the last known order status visible if a background refresh fails.
    } finally {
      if (showLoading) setRefreshingOrders(false);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => { void refreshOrders(); }, 15000);
    return () => clearInterval(timer);
  }, [refreshOrders]);

  const selected = useMemo(() => products.filter((item) => (quantities[item.id] || 0) > 0), [products, quantities]);
  const subtotal = selected.reduce((sum, item) => sum + item.price * quantities[item.id], 0);
  const deliveryCharge = selected.length ? DELIVERY_CHARGE : 0;
  const total = subtotal + deliveryCharge;

  function changeQuantity(id: string, amount: number) {
    setQuantities((current) => {
      const next = Math.max(0, Math.min(99, (current[id] || 0) + amount));
      return { ...current, [id]: next };
    });
  }

  async function captureLocation() {
    setError(""); setNotice(""); setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setError("Location permission was not granted. You can still enter your address manually.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setNotice("Current location captured. Add your street address and nearby landmark too.");
    } catch {
      setError("Could not get your current location. Check location services or enter your address manually.");
    } finally { setLocating(false); }
  }

  async function placeOrder() {
    setError(""); setNotice("");
    if (!selected.length) { setError("Choose at least one item."); return; }
    if (address.trim().length < 10) { setError("Enter a complete delivery address."); return; }
    setSubmitting(true);
    try {
      const response = await api.post<Order>("/api/v1/orders", {
        items: selected.map((item) => ({ product_id: item.id, quantity: quantities[item.id] })),
        delivery_address: address.trim(),
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
      });
      setOrders((current) => [response.data, ...current]); setLastUpdated(new Date());
      setQuantities({});
      setNotice(`Order #${response.data.id} placed. Total: ${money(response.data.total_amount)}.`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not place your order.");
    } finally { setSubmitting(false); }
  }

  return <View style={s.page}>
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.top}><Pressable onPress={() => router.back()} style={s.back}><Text style={s.backText}>‹  Dashboard</Text></Pressable><View style={s.heading}><Text style={s.kicker}>PATIENT STORE</Text><Text style={s.title}>Medicines & care items</Text><Text style={s.sub}>Select items and quantities, then add your delivery address.</Text></View></View>
      {error ? <Text style={s.error}>{String(error)}</Text> : null}
      {notice ? <Text style={s.success}>{notice}</Text> : null}
      {loading ? <View style={s.loading}><ActivityIndicator color="#147D72" /><Text style={s.sub}>Loading products…</Text></View> : <>
        <View style={s.panel}>
          <View style={s.panelHeader}><View><Text style={s.panelTitle}>Available items</Text><Text style={s.sub}>Prices shown in Indian rupees · sample catalog</Text></View><Text style={s.count}>{selected.reduce((sum, item) => sum + quantities[item.id], 0)} selected</Text></View>
          {products.map((item) => <View key={item.id} style={s.productRow}>
            <View style={s.productInfo}><Text style={s.category}>{item.category.toUpperCase()}</Text><Text style={s.productName}>{item.name}</Text><Text style={s.price}>{money(item.price)} <Text style={s.each}>each</Text></Text></View>
            <View style={s.quantity}><Pressable accessibilityLabel={`Remove one ${item.name}`} onPress={() => changeQuantity(item.id, -1)} style={s.quantityButton}><Text style={s.quantityButtonText}>−</Text></Pressable><Text style={s.quantityValue}>{quantities[item.id] || 0}</Text><Pressable accessibilityLabel={`Add one ${item.name}`} onPress={() => changeQuantity(item.id, 1)} style={[s.quantityButton, s.addButton]}><Text style={[s.quantityButtonText, s.addText]}>＋</Text></Pressable></View>
          </View>)}
          <Text style={s.catalogNote}>Medicines are for general retail only. Follow the product label and consult a clinician or pharmacist if you are unsure whether an item is suitable.</Text>
        </View>

        <View style={s.panel}>
          <Text style={s.panelTitle}>Delivery address</Text>
          <Text style={s.sub}>Enter house or building, street, area, city, state, and PIN code.</Text>
          <Pressable onPress={() => void captureLocation()} disabled={locating} style={[s.locationButton, locating && s.disabled]}><Text style={s.locationButtonText}>{locating ? "Finding current location…" : location ? "↻ Update current location" : "◎ Use current location"}</Text></Pressable>
          {location ? <Text style={s.locationText}>Location captured: {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</Text> : null}
          <TextInput value={address} onChangeText={setAddress} multiline numberOfLines={4} textAlignVertical="top" placeholder="Flat / house, street, area, city, state, PIN code" placeholderTextColor="#91A2A1" style={s.address} />
          <View style={s.costBreakdown}><View style={s.costRow}><Text style={s.costLabel}>Items subtotal</Text><Text style={s.costAmount}>{money(subtotal)}</Text></View><View style={s.costRow}><Text style={s.costLabel}>Delivery charge</Text><Text style={s.costAmount}>{money(deliveryCharge)}</Text></View><View style={[s.costRow, s.grandTotal]}><Text style={s.totalLabel}>Order total</Text><Text style={s.total}>{money(total)}</Text></View></View>
          <View style={s.totalRow}><View><Text style={s.sub}>Delivery charge is ₹70 per order.</Text></View><Pressable onPress={() => void placeOrder()} disabled={submitting || loading} style={[s.placeButton, (submitting || loading) && s.disabled]}><Text style={s.placeText}>{submitting ? "Placing order…" : "Place order"}</Text></Pressable></View>
        </View>

        <View style={s.panel}><View style={s.orderHistoryHeader}><View><Text style={s.panelTitle}>Your orders</Text><Text style={s.sub}>Status refreshes automatically every 15 seconds.</Text></View><Pressable disabled={refreshingOrders} onPress={() => void refreshOrders(true)} style={[s.refreshButton, refreshingOrders && s.disabled]}><Text style={s.refreshText}>{refreshingOrders ? "Refreshing…" : "↻ Refresh"}</Text></Pressable></View>{lastUpdated ? <Text style={s.updatedText}>Updated {lastUpdated.toLocaleTimeString()}</Text> : null}{orders.length ? orders.map((order) => <View key={order.id} style={s.orderCard}><View style={s.orderTop}><Text style={s.orderTitle}>Order #{order.id}</Text><Text style={[s.orderStatus, order.status === "CANCELLED" && s.cancelledStatus]}>{statusLabel(order.status)}</Text></View><Text style={s.orderDate}>{new Date(order.created_at).toLocaleString()}</Text>{order.status === "CANCELLED" ? <Text style={s.cancelledMessage}>This order was cancelled.</Text> : <View style={s.tracking}>{ORDER_STAGES.map((stage, index) => { const current = ORDER_STAGES.indexOf(order.status); const done = current >= index; return <View key={stage} style={s.trackStep}><View style={[s.trackDot, done && s.trackDotDone]}><Text style={[s.trackCheck, done && s.trackCheckDone]}>{current > index ? "✓" : index + 1}</Text></View><Text style={[s.trackLabel, index === current && s.trackLabelCurrent]}>{statusLabel(stage)}</Text></View>; })}</View>}{order.items.map((item, index) => <Text key={`${order.id}-${index}`} style={s.orderLine}>{item.name} × {item.quantity} · {money(item.line_total)}</Text>)}<Text style={s.orderAddress}>Deliver to: {order.delivery_address}</Text><Text style={s.orderTotal}>Total {money(order.total_amount)}</Text></View>) : <Text style={s.sub}>Your placed orders will appear here.</Text>}</View>
      </>}
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F4F7F8" }, content: { width: "100%", maxWidth: 900, alignSelf: "center", padding: 20, gap: 14 }, top: { gap: 16 }, back: { alignSelf: "flex-start", paddingVertical: 7, paddingHorizontal: 11, backgroundColor: "white", borderRadius: 8, borderWidth: 1, borderColor: "#DDE8E5" }, backText: { color: "#35615D", fontWeight: "700" }, heading: { gap: 4 }, kicker: { color: "#147D72", fontSize: 10, fontWeight: "900", letterSpacing: 1.4 }, title: { color: "#19363D", fontSize: 27, fontWeight: "900" }, sub: { color: "#748688", fontSize: 12, marginTop: 4 }, panel: { padding: 17, backgroundColor: "white", borderWidth: 1, borderColor: "#E5ECEA", borderRadius: 14 }, panelHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }, panelTitle: { color: "#1D3B40", fontSize: 16, fontWeight: "900" }, count: { color: "#147D72", fontSize: 11, fontWeight: "800" }, productRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 13, borderTopWidth: 1, borderColor: "#EEF2F1" }, productInfo: { flex: 1 }, category: { color: "#819391", fontSize: 9, fontWeight: "900", letterSpacing: 1 }, productName: { color: "#29464A", fontWeight: "800", fontSize: 13, marginTop: 4 }, price: { color: "#147D72", fontSize: 13, fontWeight: "900", marginTop: 5 }, each: { color: "#82918F", fontSize: 10, fontWeight: "500" }, quantity: { flexDirection: "row", alignItems: "center", gap: 9 }, quantityButton: { width: 32, height: 32, borderRadius: 9, borderWidth: 1, borderColor: "#DCE6E3", alignItems: "center", justifyContent: "center" }, addButton: { backgroundColor: "#147D72", borderColor: "#147D72" }, quantityButtonText: { color: "#42615E", fontSize: 20, lineHeight: 23 }, addText: { color: "white", fontSize: 16 }, quantityValue: { minWidth: 16, textAlign: "center", color: "#29464A", fontWeight: "800" }, catalogNote: { color: "#879593", fontSize: 10, lineHeight: 15, marginTop: 8 }, locationButton: { alignSelf: "flex-start", backgroundColor: "#E6F4EF", borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12, marginTop: 12 }, locationButtonText: { color: "#147D72", fontSize: 11, fontWeight: "800" }, locationText: { color: "#376D66", fontSize: 11, marginTop: 8 }, address: { minHeight: 100, borderWidth: 1, borderColor: "#DCE5E3", borderRadius: 9, padding: 12, color: "#19363D", marginTop: 13, fontSize: 13 }, costBreakdown: { paddingTop: 12, gap: 7 }, costRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, costLabel: { color: "#748688", fontSize: 12 }, costAmount: { color: "#46615E", fontSize: 12, fontWeight: "700" }, grandTotal: { borderTopWidth: 1, borderColor: "#E7EEEB", paddingTop: 9, marginTop: 3 }, totalLabel: { color: "#19363D", fontSize: 15, fontWeight: "900" }, totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 11 }, total: { color: "#147D72", fontSize: 24, fontWeight: "900", marginTop: 2 }, placeButton: { backgroundColor: "#147D72", borderRadius: 9, paddingVertical: 12, paddingHorizontal: 17 }, placeText: { color: "white", fontWeight: "800", fontSize: 12 }, disabled: { opacity: 0.6 }, orderHistoryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }, refreshButton: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "#DDE8E5" }, refreshText: { color: "#35615D", fontSize: 10, fontWeight: "800" }, updatedText: { color: "#879593", fontSize: 9, marginTop: 7 }, tracking: { flexDirection: "row", justifyContent: "space-between", gap: 3, marginTop: 12, marginBottom: 3 }, trackStep: { flex: 1, alignItems: "center", gap: 5 }, trackDot: { width: 23, height: 23, borderRadius: 12, borderWidth: 1, borderColor: "#C9D5D2", backgroundColor: "white", alignItems: "center", justifyContent: "center" }, trackDotDone: { borderColor: "#147D72", backgroundColor: "#147D72" }, trackCheck: { color: "#849391", fontSize: 9, fontWeight: "800" }, trackCheckDone: { color: "white" }, trackLabel: { color: "#97A3A1", fontSize: 7, textAlign: "center" }, trackLabelCurrent: { color: "#147D72", fontWeight: "900" }, cancelledStatus: { color: "#9C3530", backgroundColor: "#FCE9E7" }, cancelledMessage: { color: "#9C3530", fontSize: 11, marginTop: 12 }, orderCard: { borderTopWidth: 1, borderColor: "#EEF2F1", marginTop: 12, paddingTop: 12 }, orderTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, orderTitle: { color: "#29464A", fontSize: 13, fontWeight: "900" }, orderStatus: { color: "#147D72", backgroundColor: "#E6F4EF", borderRadius: 12, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 4, fontSize: 10, fontWeight: "800" }, orderDate: { color: "#849391", fontSize: 10, marginTop: 5 }, orderLine: { color: "#4A6360", fontSize: 11, marginTop: 6 }, orderAddress: { color: "#788A88", fontSize: 10, marginTop: 8 }, orderTotal: { color: "#147D72", fontSize: 12, fontWeight: "900", marginTop: 8 }, error: { color: "#A43932", backgroundColor: "#FCE9E7", padding: 10, borderRadius: 8, fontSize: 12 }, success: { color: "#28704C", backgroundColor: "#E1F4EB", padding: 10, borderRadius: 8, fontSize: 12 }, loading: { minHeight: 130, alignItems: "center", justifyContent: "center", gap: 8 },
});
