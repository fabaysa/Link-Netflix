export async function kickBridgeWorker() {
  const base = String(process.env.BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const secret = String(process.env.BRIDGE_WORKER_SECRET || "").trim();

  if (!base.startsWith("https://")) {
    throw new Error("BASE_URL belum benar.");
  }
  if (!secret) {
    throw new Error("BRIDGE_WORKER_SECRET belum diisi.");
  }

  const response = await fetch(`${base}/api/bridge-worker`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ source: "kick" })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Worker HTTP ${response.status}`);
  }
  return data;
}
