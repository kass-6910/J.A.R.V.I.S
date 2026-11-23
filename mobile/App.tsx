import * as Haptics from "expo-haptics";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  api,
  askStream,
  type Connection,
  type DayPlan,
  DEFAULT_URL,
  loadConnection,
  type PendingAction,
  saveConnection,
  UnauthorizedError,
  type UsageSummary,
} from "./src/api";
import { createSpeaker, pickVoice, stopSpeaking } from "./src/speaker";

/** Palette du cahier des charges (§15), la même que la web app. */
const C = {
  bg: "#121417",
  card: "#1c1f24",
  border: "#2a2e35",
  text: "#f2f4f7",
  muted: "#8b929c",
  accent: "#4c8dff",
  success: "#4fbf8b",
  warning: "#e0a43a",
  critical: "#e5484d",
  prayer: "#9a86e8",
};

export default function App() {
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);

  useEffect(() => {
    loadConnection().then(setConnection, () => setConnection(null));
    void pickVoice();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        {connection === undefined ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 80 }} />
        ) : connection === null ? (
          <Login onConnected={setConnection} />
        ) : (
          <Home
            connection={connection}
            onLogout={async () => {
              await saveConnection(null);
              setConnection(null);
            }}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Login({ onConnected }: { onConnected: (c: Connection) => void }) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    const c = { url: url.trim().replace(/\/+$/, ""), token: token.trim() };
    setBusy(true);
    setError(null);
    try {
      await api.check(c);
      await saveConnection(c);
      onConnected(c);
    } catch (err) {
      setError(err instanceof UnauthorizedError ? "Jeton refusé : vérifie JARVIS_TOKEN." : "Serveur injoignable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.login}>
      <Text style={styles.title}>Jarvis</Text>
      <Text style={styles.muted}>Connecte cet iPhone à ton serveur.</Text>
      <Text style={styles.label}>Adresse</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.label}>Jeton</Text>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder="JARVIS_TOKEN"
        placeholderTextColor={C.muted}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.primary, (!token.trim() || busy) && styles.disabled]} disabled={!token.trim() || busy} onPress={connect}>
        <Text style={styles.primaryText}>{busy ? "Connexion…" : "Connecter"}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

const KIND_COLOR = { task: C.accent, prayer: C.prayer, sport: C.success, meal: C.warning, event: C.text } as const;

const dollars = (n: number) =>
  `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 })} $`;

function Home({ connection, onLogout }: { connection: Connection; onLogout: () => void }) {
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const transcript = useRef("");
  const sendOnEnd = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [p, a, u] = await Promise.all([
        api.planning(connection),
        api.pendingActions(connection),
        api.usage(connection).catch(() => null),
      ]);
      setPlan(p);
      setPending(a);
      setUsage(u);
    } catch (err) {
      if (err instanceof UnauthorizedError) onLogout();
    }
  }, [connection, onLogout]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function ask(text: string) {
    if (!text || busy) return;
    setBusy(true);
    setReply("");
    const speaker = createSpeaker();
    try {
      let shown = "";
      const full = await askStream(connection, text, (delta) => {
        shown += delta;
        setReply(shown);
        speaker.push(delta);
      });
      setReply(full);
      speaker.end();
    } catch (err) {
      if (err instanceof UnauthorizedError) return onLogout();
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setReply(msg);
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  useSpeechRecognitionEvent("result", (e) => {
    transcript.current = e.results[0]?.transcript ?? "";
    setHeard(transcript.current);
  });
  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    if (sendOnEnd.current) {
      sendOnEnd.current = false;
      void ask(transcript.current.trim());
    }
  });
  useSpeechRecognitionEvent("error", (e) => {
    setListening(false);
    sendOnEnd.current = false;
    if (e.error !== "no-speech" && e.error !== "aborted") setReply(`Dictée interrompue (${e.message || e.error}).`);
  });

  /** Appui long : Jarvis écoute tant que le bouton est maintenu, puis répond dès qu'on le lâche. */
  async function startListening() {
    if (busy) return;
    stopSpeaking();
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setReply("Autorise le micro et la reconnaissance vocale dans Réglages > Jarvis.");
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    transcript.current = "";
    setHeard("");
    setReply("");
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: "fr-FR",
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      // Sans le mode « measurement » par défaut, la voix de Jarvis garde son volume normal.
      iosCategory: { category: "playAndRecord", categoryOptions: ["defaultToSpeaker", "allowBluetooth"], mode: "default" },
    });
  }

  function stopListening() {
    if (!listening) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendOnEnd.current = true;
    ExpoSpeechRecognitionModule.stop();
  }

  const agenda = plan
    ? [
        ...plan.events.map((e) => ({
          key: `e-${e.id}`,
          at: e.start,
          label: e.allDay ? "Journée" : `${time(e.start)} – ${time(e.end)}`,
          title: e.title,
          kind: "event" as const,
        })),
        ...plan.blocks.map((b) => ({
          key: `b-${b.id}`,
          at: b.startsAt,
          label: `${time(b.startsAt)} – ${time(b.endsAt)}`,
          title: b.title,
          kind: b.kind,
        })),
      ].sort((a, b) => a.at.localeCompare(b.at))
    : [];

  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            tintColor={C.muted}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }
      >
        <Text style={styles.title}>Jarvis</Text>
        <Text style={[styles.muted, { textTransform: "capitalize" }]}>{today}</Text>

        <View style={styles.micZone}>
          <Pressable
            onPressIn={startListening}
            onPressOut={stopListening}
            disabled={busy}
            style={({ pressed }) => [styles.mic, (listening || pressed) && styles.micOn, busy && styles.disabled]}
            accessibilityLabel="Maintenir pour parler à Jarvis"
          >
            {busy ? <ActivityIndicator color={C.text} /> : <Text style={styles.micIcon}>{listening ? "●" : "🎙"}</Text>}
          </Pressable>
          <Text style={styles.muted}>{listening ? "Je t'écoute… lâche pour envoyer" : busy ? "Jarvis réfléchit…" : "Maintiens pour parler"}</Text>
        </View>

        {heard !== "" && <Text style={styles.heard}>« {heard} »</Text>}
        {reply !== "" && (
          <View style={styles.card}>
            <Text style={styles.reply}>{reply}</Text>
          </View>
        )}

        <View style={styles.askRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            value={typed}
            onChangeText={setTyped}
            placeholder="Ou écris à Jarvis…"
            placeholderTextColor={C.muted}
            returnKeyType="send"
            onSubmitEditing={() => {
              const t = typed.trim();
              setTyped("");
              setHeard(t);
              void ask(t);
            }}
          />
        </View>

        {pending.length > 0 && (
          <>
            <Text style={styles.h2}>À valider</Text>
            {pending.map((a) => (
              <View key={a.id} style={styles.card}>
                <Text style={styles.text}>{a.summary}</Text>
                <View style={styles.actions}>
                  <Pressable
                    style={[styles.small, { borderColor: C.border }]}
                    onPress={async () => {
                      await api.resolveAction(connection, a.id, "reject");
                      void refresh();
                    }}
                  >
                    <Text style={styles.muted}>Refuser</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.small, { backgroundColor: C.accent, borderColor: C.accent }]}
                    onPress={async () => {
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      await api.resolveAction(connection, a.id, "confirm");
                      void refresh();
                    }}
                  >
                    <Text style={styles.primaryText}>Valider</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}

        <Text style={styles.h2}>Aujourd'hui</Text>
        {plan?.calendar === "error" && <Text style={styles.error}>Google Agenda est injoignable.</Text>}
        {agenda.length === 0 ? (
          <Text style={styles.muted}>Rien de prévu.</Text>
        ) : (
          agenda.map((item) => (
            <View key={item.key} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: KIND_COLOR[item.kind] }]} />
              <Text style={styles.rowTime}>{item.label}</Text>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
          ))
        )}

        {usage && (
          <>
            <Text style={styles.h2}>Crédits Claude</Text>
            <View style={styles.card}>
              <Text style={styles.text}>
                Aujourd'hui {dollars(usage.today)} · ce mois {dollars(usage.month)}
              </Text>
              <Text style={styles.muted}>
                Fin de mois ≈ {dollars(usage.projection)}
                {usage.budget > 0 ? ` · plafond ${dollars(usage.budget)}` : ""}
              </Text>
            </View>
          </>
        )}

        <Pressable onPress={onLogout} style={{ marginTop: 32, alignSelf: "center" }}>
          <Text style={styles.muted}>Déconnecter cet iPhone</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  login: { flex: 1, padding: 24, justifyContent: "center" },
  content: { padding: 16, paddingBottom: 48 },
  title: { color: C.text, fontSize: 30, fontWeight: "700" },
  h2: { color: C.text, fontSize: 17, fontWeight: "600", marginTop: 28, marginBottom: 10 },
  text: { color: C.text, fontSize: 15, lineHeight: 21 },
  muted: { color: C.muted, fontSize: 14 },
  label: { color: C.muted, fontSize: 13, marginTop: 20, marginBottom: 6 },
  error: { color: C.critical, marginTop: 12 },
  input: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    color: C.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primary: { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 24 },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  micZone: { alignItems: "center", marginVertical: 28, gap: 12 },
  mic: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: C.card,
    borderColor: C.accent,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  micOn: { backgroundColor: C.accent, transform: [{ scale: 1.06 }] },
  micIcon: { fontSize: 40, color: C.text },
  heard: { color: C.muted, fontStyle: "italic", marginBottom: 10 },
  card: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  reply: { color: C.text, fontSize: 17, lineHeight: 24 },
  askRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  small: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomColor: C.border, borderBottomWidth: 1, gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowTime: { color: C.muted, fontSize: 13, width: 108, fontVariant: ["tabular-nums"] },
  rowTitle: { color: C.text, fontSize: 15, flex: 1 },
});
