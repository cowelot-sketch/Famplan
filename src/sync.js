// ─────────────────────────────────────────────────────────────
// FamPlan – Supabase sync layer
// ─────────────────────────────────────────────────────────────
// This file handles all reads, writes, and real-time subscriptions.
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your own values.
// See README.md → Backend Setup for step-by-step instructions.
// ─────────────────────────────────────────────────────────────

// ── Config ──────────────────────────────────────────────────
// Paste your Supabase project URL and anon key here.
// These are safe to expose in the browser (they're read-only without RLS).
export const SUPABASE_URL  = process.env.REACT_APP_SUPABASE_URL  || "";
export const SUPABASE_KEY  = process.env.REACT_APP_SUPABASE_ANON_KEY || "";

export const FAMILY_ID = process.env.REACT_APP_FAMILY_ID || "my-family";
// Change FAMILY_ID to something unique (e.g. "smith-family-2026")
// so your data doesn't collide with anyone else's.

// ── Are we configured? ───────────────────────────────────────
export function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

// ── Generic fetch helper ─────────────────────────────────────
async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": "return=representation",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Supabase ${opts.method || "GET"} ${path}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Load entire family state ─────────────────────────────────
export async function loadFromCloud() {
  const rows = await sb(
    `/famplan_state?family_id=eq.${encodeURIComponent(FAMILY_ID)}&limit=1`
  );
  if (!rows || rows.length === 0) return null;
  return rows[0].state; // JSON blob
}

// ── Save entire family state (upsert) ───────────────────────
export async function saveToCloud(stateObj) {
  await sb("/famplan_state", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      family_id: FAMILY_ID,
      state: stateObj,
      updated_at: new Date().toISOString(),
    }),
  });
}

// ── Real-time subscription ───────────────────────────────────
// Calls onUpdate(newState) whenever another device saves.
// Returns an unsubscribe function.
export function subscribeToChanges(onUpdate) {
  if (!isConfigured()) return () => {};

  // Supabase real-time uses WebSockets on a different endpoint
  const wsUrl = SUPABASE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const wsBase = `wss://${wsUrl}`;
  let ws;
  let pingInterval;
  let reconnectTimeout;
  let stopped = false;

  function connect() {
    if (stopped) return;
    try {
      ws = new WebSocket(
        `${wsBase}/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`
      );

      ws.onopen = () => {
        // Join the realtime channel for our table + family_id filter
        ws.send(JSON.stringify({
          topic: `realtime:public:famplan_state:family_id=eq.${FAMILY_ID}`,
          event: "phx_join",
          payload: {},
          ref: "1",
        }));
        // Keep-alive
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "hb" }));
          }
        }, 25000);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          const payload = msg?.payload;
          // Postgres INSERT or UPDATE events carry the new record
          if (
            msg.event === "INSERT" || msg.event === "UPDATE" ||
            payload?.type === "INSERT" || payload?.type === "UPDATE"
          ) {
            const record = payload?.record || payload?.new;
            if (record?.state) {
              onUpdate(record.state);
            }
          }
        } catch {}
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        clearInterval(pingInterval);
        if (!stopped) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      };
    } catch {}
  }

  connect();

  return () => {
    stopped = true;
    clearInterval(pingInterval);
    clearTimeout(reconnectTimeout);
    try { ws?.close(); } catch {}
  };
}
