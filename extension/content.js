(() => {
  // Legacy whole-page overlay stays disabled; risky cards are covered individually.
  const SHOW_BLOCK_OVERLAY = false;
  const MAX_TEXT_LENGTH = 12000;
  const MAX_BLOCKS = 12;
  const MAX_BLOCK_CHARS = 1800;
  const DEBOUNCE_MS = 100;
  const LABELS = {
    sexual: "sexual",
    profanity: "profanity",
    hate: "hate",
    violence: "violence",
    self_harm: "selfHarm",
    drugs: "drugs",
    spam: "spam"
  };

  let enabled = true;
  let observer;
  let debounce;
  let countdown;
  let previousText = "";
  let latestScanId = 0;
  let nextBlockId = 1;
  let language = "es";
  let currentStatus = { kind: "idle", key: "activeMonitoring", values: {} };
  let currentDetail;
  let lastResult;
  let lastResultNodes;
  let isExpanded = false;
  let userClosedIndicator = false;
  let ui;
  let shadow;
  const idsByNode = new WeakMap();
  const blockedNodes = new Map();
  const revealedBlockTexts = new Map();

  function t(key, values = {}) {
    return UmbralI18n.t(key, language, values);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function ensureUi() {
    if (ui?.host?.isConnected) return;
    const host = document.createElement("div");
    host.id = "umbral-live-indicator";
    shadow = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host { all: initial; color-scheme: dark; }
      * { box-sizing: border-box; }
      .host { position: fixed; z-index: 2147483646; top: 14px; right: 14px; width: 280px; color: #edf4e8; font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; pointer-events: none; }
      .toggle { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 42px; padding: 9px 12px; border: 1px solid #3a4b38; border-radius: 12px; background: rgba(18, 25, 19, .96); box-shadow: 0 8px 32px rgba(0,0,0,.28); color: inherit; text-align: left; cursor: pointer; pointer-events: auto; }
      .toggle:hover { border-color: #83aa6c; }
      .brand { color: #b7e692; font-size: 10px; font-weight: 800; letter-spacing: .8px; }
      .summary { flex: 1; overflow: hidden; color: #d3ddcf; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #9bdb71; box-shadow: 0 0 8px #84d958; }
      .dot.wait, .dot.request { background: #edbd62; box-shadow: 0 0 8px #d89f35; }
      .dot.block { background: #ff8275; box-shadow: 0 0 8px #e34f43; }
      .dot.paused, .dot.error { background: #89928a; box-shadow: none; }
      .spinner { display: none; width: 12px; height: 12px; flex: none; border: 2px solid #617052; border-top-color: #b7e692; border-radius: 50%; animation: spin .8s linear infinite; }
      .spinner.visible { display: block; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .chevron { color: #849182; font-size: 11px; }
      .details { display: none; margin-top: 7px; padding: 12px; border: 1px solid #344134; border-radius: 12px; background: rgba(18, 25, 19, .97); box-shadow: 0 8px 32px rgba(0,0,0,.28); pointer-events: auto; }
      .details.open { display: block; }
      .state { margin-bottom: 8px; color: #b5c0b1; font-size: 11px; }
      .verdict { display: inline-flex; margin: 0 0 8px; padding: 3px 7px; border-radius: 99px; background: #263a25; color: #b7e692; font-size: 9px; font-weight: 800; letter-spacing: .4px; text-transform: uppercase; }
      .verdict.review { background: #41361f; color: #f0ca78; }
      .verdict.block { background: #492a26; color: #ff9a8d; }
       .rows { display: grid; gap: 6px; }
       .blocked-list { display: grid; gap: 5px; margin: 7px 0; }
       .blocked-item { display: flex; justify-content: space-between; gap: 8px; padding: 5px 7px; border: 1px solid #53312c; border-radius: 6px; background: #2b211e; color: #e8b6ad; font-size: 9px; }
      .row { display: grid; grid-template-columns: 1fr 37px; align-items: center; gap: 8px; color: #bec8ba; font-size: 10px; }
      .value { color: #e8efe4; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; }
      .bar { grid-column: 1 / -1; height: 3px; margin-top: -5px; overflow: hidden; border-radius: 4px; background: #303a30; }
      .fill { height: 100%; border-radius: inherit; background: #83bb68; transition: width .25s ease; }
      .fill.medium { background: #e6b957; }
      .fill.high { background: #ef7469; }
      .footer { display: flex; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid #303a30; color: #94a08f; font: 9px ui-monospace, SFMono-Regular, Menlo, monospace; }
      .empty { color: #8d998a; font-size: 10px; }
    `);
    shadow.adoptedStyleSheets = [sheet];
    const container = createElement("div", "host");
    const toggle = createElement("button", "toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    const dot = createElement("i", "dot");
    const brand = createElement("b", "brand", "UMBRAL LIVE");
    const spinner = createElement("i", "spinner");
    const summary = createElement("span", "summary", t("activeMonitoring"));
    const chevron = createElement("span", "chevron", "⌄");
    toggle.append(dot, brand, spinner, summary, chevron);
    const details = createElement("section", "details");
    details.setAttribute("aria-live", "polite");
    toggle.addEventListener("click", () => setExpanded(!isExpanded, true));
    container.append(toggle, details);
    shadow.append(container);
    document.documentElement.append(host);
    ui = { host, toggle, dot, spinner, summary, chevron, details };
  }

  function setExpanded(value, manual = false) {
    ensureUi();
    if (manual) userClosedIndicator = !value;
    else if (value && userClosedIndicator) return;
    isExpanded = value;
    ui.details.classList.toggle("open", value);
    ui.toggle.setAttribute("aria-expanded", String(value));
    ui.chevron.textContent = value ? "⌃" : "⌄";
  }

  function setStatus(kind, key, { values = {}, expand = false } = {}) {
    ensureUi();
    currentStatus = { kind, key, values };
    ui.dot.className = `dot ${kind}`;
    ui.spinner.classList.toggle("visible", kind === "request");
    ui.summary.textContent = t(key, values);
    if (expand) setExpanded(true);
  }

  function setDetail(key, values = {}, className = "state") {
    currentDetail = { key, values, className };
    ui.details.replaceChildren(createElement("p", className, t(key, values)));
  }

  function showWaiting(ms) {
    ensureUi();
    setExpanded(true);
    if (countdown) clearInterval(countdown);
    const startedAt = Date.now();
    const update = () => {
      const remaining = Math.max(0, ms - (Date.now() - startedAt));
      const seconds = Math.ceil(remaining / 1000);
      setStatus("wait", "waitScan", { values: { seconds } });
      setDetail("preparingChange");
      if (!remaining && countdown) {
        clearInterval(countdown);
        countdown = undefined;
      }
    };
    update();
    countdown = setInterval(update, 200);
  }

  function renderResult(response, nodesById) {
    lastResult = response;
    lastResultNodes = nodesById;
    const blocks = response.payload.blocks || [];
    const blocked = blocks.filter((block) => block.action.action === "block");
    const reviewCount = blocks.filter((block) => block.action.action === "review").length;
    const hazards = Object.fromEntries(Object.keys(LABELS).map((category) => [
      category,
      Math.max(0, ...blocks.map((block) => Number(block.action.hazards?.[category]) || 0))
    ]));
    const activeBlocked = blocked.filter((block) => !isBlockRevealed(block.id, nodesById.get(block.id)));
    const activeReviewCount = blocks.filter((block) => block.action.action === "review").length;
    const visibleAction = activeBlocked.length ? "block" : activeReviewCount ? "review" : "allow";
    const actionKey = visibleAction === "block"
      ? activeBlocked.length === 1 ? "blockedCards" : "blockedCardsPlural"
      : visibleAction === "review" ? activeReviewCount === 1 ? "cardsToReview" : "cardsToReviewPlural" : "noRisk";
    const actionCount = visibleAction === "block" ? activeBlocked.length : activeReviewCount;
    const actionValues = visibleAction === "allow" ? {} : { count: actionCount };
    setStatus(visibleAction, actionKey, { values: actionValues, expand: true });
    const actionLabel = t(actionKey, actionValues);
    const details = ui.details;
    currentDetail = undefined;
    details.replaceChildren();
    const message = activeBlocked.length ? t("blockedState") : t("analyzedBlocks", { count: blocks.length });
    const state = createElement("p", "state", message);
    const verdict = createElement("strong", `verdict ${visibleAction}`, actionLabel);
    const rows = createElement("div", "rows");
    for (const [key, label] of Object.entries(LABELS)) {
      const value = Math.max(0, Math.min(1, hazards[key]));
      const row = createElement("div", "row");
      row.append(createElement("span", "", t(label)), createElement("b", "value", `${(value * 100).toFixed(1)}%`));
      const bar = createElement("div", "bar");
      const fill = createElement("div", `fill${value >= 0.7 ? " high" : value >= 0.35 ? " medium" : ""}`);
      fill.style.width = `${(value * 100).toFixed(1)}%`;
      bar.append(fill);
      rows.append(row, bar);
    }
    const blockedList = createElement("div", "blocked-list");
    for (const [index, block] of activeBlocked.entries()) {
      const node = nodesById.get(block.id);
      if (!node) continue;
      const item = createElement("div", "blocked-item");
      const categories = block.action.matched.map(({ category }) => t(LABELS[category] || category)).join(", ");
      item.append(createElement("span", "", t("blockedCard", { number: index + 1, categories: categories || t("riskyContent") })));
      item.append(createElement("b", "", `${(block.action.maxProbability * 100).toFixed(0)}%`));
      blockedList.append(item);
    }
    const cost = response.cost || { inputTokens: 0, usd: 0, ars: 0 };
    const locale = language === "es" ? "es-AR" : "en-US";
    const footer = createElement("div", "footer");
    footer.append(
      createElement("span", "", `${t("tokens", { count: cost.inputTokens.toLocaleString(locale) })} · ${t("blockCount", { count: blocks.length })}`),
      createElement("span", "", t("requestCost", { usd: cost.usd.toFixed(6), ars: cost.ars.toFixed(2) }))
    );
    details.append(state, verdict, rows, blockedList, footer);
    reconcileBlockedNodes(blocks, nodesById);
  }

  function isBlockRevealed(id, target) {
    const revealedText = revealedBlockTexts.get(id);
    if (revealedText === undefined) return false;
    if (target?.isConnected && getBlockText(target) === revealedText) return true;
    revealedBlockTexts.delete(id);
    return false;
  }

  function changedCharacters(before, after) {
    let prefix = 0;
    const sharedLimit = Math.min(before.length, after.length);
    while (prefix < sharedLimit && before[prefix] === after[prefix]) prefix++;
    let suffix = 0;
    while (suffix < sharedLimit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    return before.length + after.length - prefix * 2 - suffix * 2;
  }

  function getBlockText(element) {
    return (element.innerText || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element.isConnected || !element.getClientRects().length) return false;
    if (element.closest("nav, header, footer, aside, #umbral-live-indicator, [data-umbral-shield]")) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
  }

  function getCardTarget(element) {
    const semanticCard = element.closest([
      "article", "[role=article]", "[role=listitem]", "li",
      '[data-testid*="result" i]', '[data-testid*="card" i]', "[data-result-id]",
      ".MjjYud", ".g", ".result", ".search-result", ".card",
      '[class*="result" i]', '[class*="card" i]'
    ].join(", "));
    if (semanticCard) return semanticCard;
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (parent.tagName !== "DIV") continue;
      const text = getBlockText(parent);
      if (text.length < 40 || text.length > MAX_BLOCK_CHARS) continue;
      if (parent.querySelector('a[href], [role="link"]')) return parent;
    }
    return element;
  }

  function getBlockId(element) {
    if (!idsByNode.has(element)) idsByNode.set(element, `card-${nextBlockId++}`);
    return idsByNode.get(element);
  }

  function collectBlocks() {
    const selectors = [
      "article", "[role=article]", "[role=listitem]", "li", "blockquote", "p", "h2", "h3",
      '[data-testid*="result" i]', '[data-testid*="card" i]', "[data-result-id]",
      ".MjjYud", ".g", ".result", ".search-result", ".card", "[class*='result' i]", "[class*='card' i]", "main div", "div"
    ].join(", ");
    const selected = [];
    const selectedTargets = new Set();
    for (const element of document.querySelectorAll(selectors)) {
      if (!isVisible(element)) continue;
      const text = getBlockText(element);
      if (text.length < 40 || text.length > MAX_BLOCK_CHARS) continue;
      if (element.tagName === "DIV") {
        const child = [...element.querySelectorAll("article, li, p, blockquote, h2, h3")]
          .find((candidate) => isVisible(candidate) && getBlockText(candidate).length >= text.length * 0.65);
        if (child) continue;
      }

      const target = getCardTarget(element);
      if (!isVisible(target) || selectedTargets.has(target)) continue;
      if (selected.some((entry) => entry.target.contains(target))) continue;
      const targetText = getBlockText(target);
      const classificationText = targetText.length <= MAX_BLOCK_CHARS ? targetText : text;
      if (classificationText.length < 40) continue;
      for (let index = selected.length - 1; index >= 0; index--) {
        if (target.contains(selected[index].target)) {
          selectedTargets.delete(selected[index].target);
          selected.splice(index, 1);
        }
      }
      selectedTargets.add(target);
      selected.push({ id: getBlockId(target), target, text: classificationText.slice(0, MAX_BLOCK_CHARS) });
      if (selected.length >= MAX_BLOCKS) break;
    }

    let totalChars = 0;
    return selected.filter((block) => {
      if (totalChars + block.text.length > MAX_TEXT_LENGTH) return false;
      totalChars += block.text.length;
      return true;
    });
  }

  function searchContext() {
    return [...document.querySelectorAll([
      'input[type="search"]', 'input[name="q" i]', 'input[name*="search" i]',
      'input[name*="buscar" i]', 'input[role="searchbox"]', '[role="searchbox"]',
      'input[type="text"][aria-label*="search" i]', 'input[type="text"][placeholder*="search" i]',
      'input[type="text"][placeholder*="buscar" i]'
    ].join(", "))]
      .filter(isVisible)
      .map((field) => field.value || "")
      .filter(Boolean)
      .join(" ")
      .slice(0, 500);
  }

  function collectSnapshot() {
    const blocks = collectBlocks();
    const context = searchContext();
    const signature = `${context}\n${blocks.map(({ id, text }) => `${id}:${text}`).join("\n")}`.slice(0, MAX_TEXT_LENGTH * 2);
    return { blocks, context, signature, nodesById: new Map(blocks.map(({ id, target }) => [id, target])) };
  }

  function saveStyle(style, property) {
    return { value: style.getPropertyValue(property), priority: style.getPropertyPriority(property) };
  }

  function restoreStyle(style, property, saved) {
    if (saved.value) style.setProperty(property, saved.value, saved.priority);
    else style.removeProperty(property);
  }

  function positionBlockCover(entry) {
    if (!entry.target.isConnected) return restoreBlock(entry.id);
    const rect = entry.target.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) {
      entry.cover.style.display = "none";
      return;
    }
    Object.assign(entry.cover.style, {
      display: "grid",
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`
    });
  }

  function updateBlockCoverPositions() {
    for (const entry of blockedNodes.values()) positionBlockCover(entry);
  }

  function restoreBlock(id) {
    const entry = blockedNodes.get(id);
    if (!entry) return;
    restoreStyle(entry.target.style, "filter", entry.styles.filter);
    restoreStyle(entry.target.style, "pointer-events", entry.styles.pointerEvents);
    restoreStyle(entry.target.style, "user-select", entry.styles.userSelect);
    entry.target.inert = entry.inert;
    if (entry.ariaHidden === null) entry.target.removeAttribute("aria-hidden");
    else entry.target.setAttribute("aria-hidden", entry.ariaHidden);
    entry.viewportObserver?.disconnect();
    entry.cover.remove();
    blockedNodes.delete(id);
  }

  function coverBlock(block, target) {
    const existing = blockedNodes.get(block.id);
    if (existing?.target === target) {
      positionBlockCover(existing);
      return;
    }
    if (existing) restoreBlock(block.id);

    const cover = createElement("div", "", "");
    cover.dataset.umbralShield = block.id;
    Object.assign(cover.style, {
      position: "fixed", zIndex: "2147483644", display: "grid", placeItems: "center",
      padding: "8px", overflow: "hidden", border: "1px solid rgba(213, 163, 106, .8)",
      borderRadius: "8px", background: "rgba(18, 20, 18, .66)", backdropFilter: "blur(2px)",
      pointerEvents: "auto", boxSizing: "border-box", color: "#fff4e6",
      font: "600 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif"
    });
    const inner = createElement("div", "", "");
    Object.assign(inner.style, { display: "grid", justifyItems: "center", gap: "5px", textAlign: "center" });
    const probability = (block.action.maxProbability * 100).toFixed(0);
    const caption = createElement("span", "", t("coverCaption", { probability }));
    const reveal = createElement("button", "", t("revealCard"));
    Object.assign(reveal.style, {
      padding: "5px 9px", border: "1px solid #829978", borderRadius: "6px",
      background: "#1d281e", color: "#d9efcb", cursor: "pointer", font: "600 10px -apple-system, sans-serif"
    });
    reveal.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      revealedBlockTexts.set(block.id, getBlockText(target));
      restoreBlock(block.id);
      setStatus(blockedNodes.size ? "block" : "review", "cardRevealed", { expand: true });
    });
    inner.append(caption, reveal);
    cover.append(inner);

    const entry = {
      id: block.id,
      target,
      cover,
      caption,
      reveal,
      probability,
      inert: target.inert,
      ariaHidden: target.getAttribute("aria-hidden"),
      styles: {
        filter: saveStyle(target.style, "filter"),
        pointerEvents: saveStyle(target.style, "pointer-events"),
        userSelect: saveStyle(target.style, "user-select")
      }
    };
    target.style.setProperty("filter", "blur(11px)", "important");
    target.style.setProperty("pointer-events", "none", "important");
    target.style.setProperty("user-select", "none", "important");
    target.inert = true;
    target.setAttribute("aria-hidden", "true");
    document.documentElement.append(cover);
    blockedNodes.set(block.id, entry);
    entry.viewportObserver = new IntersectionObserver(([intersection]) => {
      if (!blockedNodes.has(block.id)) return;
      if (!intersection.isIntersecting) entry.cover.style.display = "none";
      else positionBlockCover(entry);
    });
    entry.viewportObserver.observe(target);
    positionBlockCover(entry);
  }

  function updateBlockCoverLanguages() {
    for (const entry of blockedNodes.values()) {
      entry.caption.textContent = t("coverCaption", { probability: entry.probability });
      entry.reveal.textContent = t("revealCard");
    }
  }

  function reconcileBlockedNodes(results, nodesById) {
    const wanted = new Map(results
      .filter((block) => block.action.action === "block" && nodesById.has(block.id) && !isBlockRevealed(block.id, nodesById.get(block.id)))
      .map((block) => [block.id, { block, target: nodesById.get(block.id) }]));
    for (const [id, entry] of blockedNodes) {
      if (!wanted.has(id) || wanted.get(id).target !== entry.target) restoreBlock(id);
    }
    for (const [id, { block, target }] of wanted) coverBlock(block, target);
    updateBlockCoverPositions();
  }

  window.addEventListener("scroll", updateBlockCoverPositions, true);
  window.addEventListener("resize", updateBlockCoverPositions);

  function addBlockOverlay() {
    if (document.getElementById("umbral-live-block")) return;
    const overlay = document.createElement("div");
    overlay.id = "umbral-live-block";
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", zIndex: "2147483645", display: "grid",
      placeItems: "center", padding: "24px", background: "rgba(10, 14, 11, .97)",
      color: "#edf4e8", fontFamily: "system-ui, sans-serif", textAlign: "center"
    });
    const card = document.createElement("div");
    Object.assign(card.style, { maxWidth: "420px", padding: "28px", border: "1px solid #465842", borderRadius: "16px", background: "#182019" });
    const title = document.createElement("h2");
    title.textContent = t("blockPageTitle");
    const description = document.createElement("p");
    description.textContent = t("blockPageDescription");
    const reveal = document.createElement("button");
    reveal.textContent = t("revealAnyway");
    Object.assign(reveal.style, { padding: "10px 14px", border: "0", borderRadius: "8px", background: "#a9de82", color: "#162014", cursor: "pointer", fontWeight: "700" });
    reveal.addEventListener("click", () => overlay.remove());
    card.append(title, description, reveal);
    overlay.append(card);
    document.documentElement.append(overlay);
  }

  async function scan(force = false) {
    if (!enabled || !document.body) return;
    clearInterval(countdown);
    countdown = undefined;
    const snapshot = collectSnapshot();
    if (!force && snapshot.signature === previousText) return;
    if (snapshot.blocks.length === 0) {
      previousText = snapshot.signature;
      reconcileBlockedNodes([], new Map());
      setStatus("idle", "monitoringNoBlocks");
      setDetail("noPageBlocks", {}, "empty");
      return;
    }

    previousText = snapshot.signature;
    const scanId = ++latestScanId;
    setStatus("request", "consulting", { expand: true });
    setDetail("classifyingBlocks", { count: snapshot.blocks.length });
    try {
      const response = await chrome.runtime.sendMessage({
        type: "UMBRAL_LIVE_SCAN",
        blocks: snapshot.blocks.map(({ id, text }) => ({ id, text })),
        context: snapshot.context,
        scanId
      });
      if (scanId !== latestScanId) return;
      if (!response?.ok) throw new Error(response?.error || "No se pudo completar el análisis");
      renderResult(response, snapshot.nodesById);
    } catch (error) {
      if (scanId !== latestScanId) return;
      setStatus("error", "backendUnavailable", { expand: true });
      setDetail("startBackendHint");
    }
  }

  function startObserving() {
    if (observer || !document.body) return;
    ensureUi();
    setStatus("idle", "activeMonitoring");
    observer = new MutationObserver(() => {
      scheduleScan();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    showWaiting(DEBOUNCE_MS);
    debounce = setTimeout(() => scan(true), DEBOUNCE_MS);
  }

  function stopObserving() {
    latestScanId++;
    observer?.disconnect();
    observer = undefined;
    clearTimeout(debounce);
    clearInterval(countdown);
    countdown = undefined;
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onInput, true);
    reconcileBlockedNodes([], new Map());
    setStatus("paused", "pausedMonitoring", { expand: true });
    setDetail("pausedHint", {}, "empty");
  }

  function initialize() {
    ensureUi();
    chrome.storage.local.get(["liveScanEnabled", "uiLanguage"], ({ liveScanEnabled, uiLanguage }) => {
      language = uiLanguage === "en" ? "en" : "es";
      enabled = liveScanEnabled !== false;
      if (enabled) startObserving();
      else stopObserving();
    });
  }

  function onInput() {
    scheduleScan();
  }

  function scheduleScan() {
    clearTimeout(debounce);
    const nextSignature = collectSnapshot().signature;
    if (nextSignature !== previousText && changedCharacters(previousText, nextSignature) > 0) {
      latestScanId++;
      showWaiting(DEBOUNCE_MS);
    }
    debounce = setTimeout(() => scan(false), DEBOUNCE_MS);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.uiLanguage) {
      language = changes.uiLanguage.newValue === "en" ? "en" : "es";
      setStatus(currentStatus.kind, currentStatus.key, { values: currentStatus.values });
      updateBlockCoverLanguages();
      if (lastResult && lastResultNodes) renderResult(lastResult, lastResultNodes);
      else if (currentDetail) setDetail(currentDetail.key, currentDetail.values, currentDetail.className);
    }
    if (changes.liveScanEnabled) {
      enabled = changes.liveScanEnabled.newValue !== false;
      if (enabled) {
        startObserving();
        scan(true);
      } else {
        stopObserving();
      }
    }
  });

  initialize();
})();
