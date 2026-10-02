const API_URL = "http://127.0.0.1:8787/api/moderate";
// Testing mode: retain the overlay implementation but leave it switched off.
const SHOW_BLOCK_OVERLAY = false;
const PRICE_PER_MILLION = 0.042;
const USD_ARS = 1500;

const $ = (id) => document.getElementById(id);
const textInput = $("text");
const checkButton = $("check");
const pageButton = $("check-page");
const liveToggle = $("live-toggle");
const languageToggle = $("language-toggle");
const statusLine = $("status");
let language = "es";
let lastAction = null;
let statusKey = "ready";
let statusValues = {};
let statusClass = "status";

function t(key, values = {}) {
  return UmbralI18n.t(key, language, values);
}

function setStatus(key, values = {}, className = "status") {
  statusKey = key;
  statusValues = values;
  statusClass = className;
  statusLine.textContent = t(key, values);
  statusLine.className = className;
}

function applyLanguage(nextLanguage) {
  language = nextLanguage === "en" ? "en" : "es";
  document.documentElement.lang = language;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  languageToggle.querySelectorAll("[data-language]").forEach((element) => {
    element.classList.toggle("selected", element.dataset.language === language);
  });
  languageToggle.setAttribute("aria-label", t("languageLabel"));
  const maxChars = language === "es" ? "12.000" : "12,000";
  $("char-count").textContent = `${textInput.value.length.toLocaleString(language === "es" ? "es-AR" : "en-US")} / ${maxChars}`;
  setStatus(statusKey, statusValues, statusClass);
  if (lastAction) renderResult(lastAction);
  updateCosts();
}

function formatUsd(value) {
  return `$${value.toFixed(6)}`;
}

function formatArs(value) {
  const locale = language === "es" ? "es-AR" : "en-US";
  return `${locale === "es-AR" ? "$" : "AR$"}${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${locale === "es-AR" ? "ARS" : ""}`.trim();
}

function estimateUsd(tokens) {
  return (Number(tokens) || 0) * PRICE_PER_MILLION / 1_000_000;
}

async function getHistory() {
  const { history = [] } = await chrome.storage.local.get("history");
  return history;
}

async function updateCosts(lastEntry = null) {
  const history = await getHistory();
  const total = history.reduce((sum, item) => sum + (Number(item.usd) || 0), 0);
  const tokens = history.reduce((sum, item) => sum + (Number(item.inputTokens) || 0), 0);
  const lastUsd = lastEntry ? lastEntry.usd : history[0]?.usd || 0;
  $("last-usd").textContent = formatUsd(lastUsd);
  $("last-ars").textContent = formatArs(lastUsd * USD_ARS);
  $("total-usd").textContent = formatUsd(total);
  $("total-ars").textContent = formatArs(total * USD_ARS);
  const locale = language === "es" ? "es-AR" : "en-US";
  $("history-summary").textContent = t(history.length === 1 ? "historyOne" : "historySummary", {
    count: history.length.toLocaleString(locale),
    tokens: tokens.toLocaleString(locale)
  });
  const recent = history.slice(0, 5);
  $("history-list").replaceChildren(...(recent.length ? recent.map((item) => {
    const row = document.createElement("div");
    row.className = "history-entry";
    const meta = document.createElement("div");
    meta.className = "history-meta";
    const date = Number.isFinite(Number(item.at))
      ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.at))
      : t("dateUnavailable");
    const source = item.source === "live" ? t("liveSource") : t("manualSource");
    const label = document.createElement("strong");
    label.textContent = `${date} · ${source} · ${t("tokens", { count: (Number(item.inputTokens) || 0).toLocaleString(locale) })}`;
    meta.append(label);
    const cost = document.createElement("span");
    cost.className = "history-cost";
    const usd = Number(item.usd) || 0;
    cost.textContent = `${formatUsd(usd)}\n${formatArs(usd * USD_ARS)}`;
    row.append(meta, cost);
    return row;
  }) : [Object.assign(document.createElement("p"), { className: "history-empty", textContent: t("historyEmpty") })]));
}

function renderResult(action) {
  lastAction = action;
  const result = $("result");
  const verdict = $("verdict");
  result.classList.remove("hidden");
  verdict.textContent = t(action.action);
  verdict.className = action.action;
  const hazards = Object.entries(action.hazards || {}).sort((a, b) => b[1] - a[1]);
  $("hazards").replaceChildren(...hazards.map(([key, value]) => {
    const item = document.createElement("span");
    item.className = "hazard";
    const label = document.createTextNode(`${t(({ self_harm: "selfHarm" })[key] || key)} `);
    const probability = document.createElement("b");
    probability.textContent = `${(value * 100).toFixed(0)}%`;
    item.append(label, probability);
    return item;
  }));
}

async function coverPage(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (messages) => {
      if (document.getElementById("umbral-block-screen")) return;
      const overlay = document.createElement("div");
      overlay.id = "umbral-block-screen";
      Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "2147483647", display: "grid",
        placeItems: "center", padding: "24px", background: "rgba(10, 14, 11, .96)",
        color: "#edf4e8", fontFamily: "system-ui, sans-serif", textAlign: "center"
      });
      const card = document.createElement("div");
      Object.assign(card.style, { maxWidth: "420px", padding: "28px", border: "1px solid #465842", borderRadius: "16px", background: "#182019" });
      const title = document.createElement("h2");
      title.textContent = messages.title;
      const description = document.createElement("p");
      description.textContent = messages.description;
      const reveal = document.createElement("button");
      reveal.textContent = messages.reveal;
      Object.assign(reveal.style, { padding: "10px 14px", border: "0", borderRadius: "8px", background: "#a9de82", color: "#162014", cursor: "pointer", fontWeight: "700" });
      reveal.addEventListener("click", () => overlay.remove());
      card.append(title, description, reveal);
      overlay.append(card);
      document.documentElement.append(overlay);
    },
    args: [{ title: t("blockPageTitle"), description: t("blockPageDescription"), reveal: t("revealAnyway") }]
  });
}

async function moderate(text, source, tabId = null) {
  text = text.trim();
  if (!text) {
    setStatus(source === "page" ? "noPageText" : "emptyText", {}, "status error");
    return;
  }

  checkButton.disabled = true;
  pageButton.disabled = true;
  checkButton.querySelector("span").textContent = t("analyzingText");
  setStatus(source === "page" ? "analyzingPage" : "analyzingText");
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || `Error HTTP ${response.status}`);

    renderResult(payload.action);
    if (SHOW_BLOCK_OVERLAY && source === "page" && payload.action.action === "block" && tabId !== null) {
      await coverPage(tabId);
    }
    const tokens = payload.usage?.input_tokens || 0;
    const entry = {
      at: Date.now(),
      usd: estimateUsd(tokens),
      inputTokens: tokens,
      model: payload.model || "jev-latest"
    };
    const recorded = await chrome.runtime.sendMessage({ type: "UMBRAL_RECORD_COST", entry });
    if (!recorded?.ok) throw new Error(recorded?.error || "No se pudo guardar el costo en el historial");
    await updateCosts(entry);
    const suffix = payload.action.action === "block" ? ` · ${t("screenDisabled")}` : "";
    setStatus("requestDone", {
      model: payload.model || "jev-latest",
      tokens: tokens.toLocaleString(language === "es" ? "es-AR" : "en-US"),
      action: t(payload.action.action),
      suffix
    }, "status ok");
  } catch (error) {
    if (error.message.includes("Failed to fetch")) setStatus("backendOffline", {}, "status error");
    else setStatus("requestError", { detail: error.message }, "status error");
  } finally {
    checkButton.disabled = false;
    pageButton.disabled = false;
    checkButton.querySelector("span").textContent = t("analyzeText");
  }
}

textInput.addEventListener("input", () => {
  const locale = language === "es" ? "es-AR" : "en-US";
  const maxChars = language === "es" ? "12.000" : "12,000";
  $("char-count").textContent = `${textInput.value.length.toLocaleString(locale)} / ${maxChars}`;
});

chrome.storage.local.get(["liveScanEnabled", "uiLanguage"], ({ liveScanEnabled, uiLanguage }) => {
  liveToggle.checked = liveScanEnabled !== false;
  applyLanguage(uiLanguage || "es");
});

liveToggle.addEventListener("change", () => {
  chrome.storage.local.set({ liveScanEnabled: liveToggle.checked });
});

languageToggle.addEventListener("click", () => {
  chrome.storage.local.set({ uiLanguage: language === "es" ? "en" : "es" });
});

checkButton.addEventListener("click", () => moderate(textInput.value, "text"));

pageButton.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error(t("pageAccessError"));
    pageButton.disabled = true;
    setStatus("readingPage");
    const [{ result = "" } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (limit) => (document.body?.innerText || "").slice(0, limit),
      args: [12000]
    });
    await moderate(result, "page", tab.id);
  } catch (error) {
    setStatus("requestError", { detail: error.message || t("unknownPageError") }, "status error");
    pageButton.disabled = false;
  }
});

$("clear-history").addEventListener("click", async () => {
  await chrome.storage.local.set({ history: [] });
  await updateCosts(null);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.history) updateCosts(null);
  if (changes.uiLanguage) applyLanguage(changes.uiLanguage.newValue || "es");
});

updateCosts();
