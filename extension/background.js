const API_URL = "http://127.0.0.1:8787/api/moderate";
const BLOCKS_API_URL = `${API_URL}/blocks`;
const PRICE_PER_MILLION = 0.042;
const USD_ARS = 1500;
let historyWrite = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          document.getElementById("umbral-live-block")?.remove();
          document.getElementById("umbral-block-screen")?.remove();
        }
      }).catch(() => {});
    }
  });
});

function appendHistory(entry) {
  historyWrite = historyWrite.then(async () => {
    const { history = [] } = await chrome.storage.local.get("history");
    await chrome.storage.local.set({ history: [entry, ...history].slice(0, 10000) });
  });
  return historyWrite;
}

async function moderateBlocks(blocks, context = "") {
  const response = await fetch(BLOCKS_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ blocks, context }),
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || payload.error || `Backend respondió HTTP ${response.status}`);

  const tokens = Number(payload.usage?.input_tokens) || 0;
  await appendHistory({
    at: Date.now(),
    usd: tokens * PRICE_PER_MILLION / 1_000_000,
    inputTokens: tokens,
    model: payload.model || "jev-latest",
    source: "live"
  });
  return payload;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "UMBRAL_RECORD_COST" && sender.id === chrome.runtime.id) {
    appendHistory(message.entry)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type !== "UMBRAL_LIVE_SCAN" || sender.frameId !== 0 || !sender.tab?.id) return;

  moderateBlocks(Array.isArray(message.blocks) ? message.blocks : [], String(message.context || ""))
    .then((payload) => {
      chrome.action.setBadgeText({ text: "" });
      const inputTokens = Number(payload.usage?.input_tokens) || 0;
      sendResponse({
        ok: true,
        payload,
        cost: {
          inputTokens,
          usd: inputTokens * PRICE_PER_MILLION / 1_000_000,
          ars: inputTokens * PRICE_PER_MILLION / 1_000_000 * USD_ARS
        },
        scanId: message.scanId
      });
    })
    .catch((error) => {
      chrome.action.setBadgeBackgroundColor({ color: "#b84436" });
      chrome.action.setBadgeText({ text: "!" });
      sendResponse({ ok: false, error: error.message, scanId: message.scanId });
    });
  return true;
});
