import test from "node:test";
import assert from "node:assert/strict";
import "../extension/i18n.js";

const i18n = globalThis.UmbralI18n;

test("provides English and Spanish UI copy", () => {
  assert.equal(i18n.t("costsTitle", "es"), "Gasto e historial");
  assert.equal(i18n.t("costsTitle", "en"), "Spend & history");
});

test("interpolates language-specific card and status labels", () => {
  assert.equal(i18n.t("blockedCards", "es", { count: 1 }), "1 tarjeta difuminada · clics desactivados");
  assert.equal(i18n.t("blockedCardsPlural", "es", { count: 2 }), "2 tarjetas difuminadas · clics desactivados");
  assert.equal(i18n.t("waitScan", "en", { seconds: 3 }), "Waiting 3s to analyze");
});

test("includes every live indicator and popup message key", () => {
  const keys = [
    "subtitle", "liveLabel", "liveNote", "textLabel", "textPlaceholder", "analyzePage", "analyzeText", "ready",
    "costsTitle", "rate", "thisRequest", "lifetimeTotal", "clearHistory", "historySummary", "historyOne",
    "historyEmpty", "recentRequests", "footer", "verdictTitle", "allow", "review", "block", "sexual",
    "profanity", "hate", "violence", "selfHarm", "drugs", "spam", "emptyText", "noPageText",
    "readingPage", "analyzingPage", "analyzingText", "backendOffline", "analysisSavedError", "requestDone",
    "requestError", "pageAccessError", "unknownPageError", "screenDisabled", "noPageBlocks", "monitoringNoBlocks",
    "activeMonitoring", "pausedMonitoring", "waitScan", "preparingChange", "consulting", "classifyingBlocks",
    "analysisError", "backendUnavailable", "startBackendHint", "blockedCards", "blockedCardsPlural", "cardsToReview",
    "cardsToReviewPlural", "noRisk", "blockedState", "analyzedBlocks", "blockCount", "blockedCard", "coverCaption",
    "riskyContent", "cardDetected", "revealCard", "cardRevealed", "pausedHint", "blockPageTitle",
    "blockPageDescription", "revealAnyway", "liveSource", "manualSource", "dateUnavailable", "tokens", "requestCost",
    "languageLabel"
  ];
  for (const language of ["es", "en"]) {
    for (const key of keys) assert.notEqual(i18n.t(key, language), key, `${language} is missing ${key}`);
  }
});
