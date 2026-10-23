/* ===========================================================================
 * Zen Flow — Advanced History
 * ---------------------------------------------------------------------------
 * A standalone History view loaded by Sine into the browser chrome
 * (`chrome://browser/content/browser.xhtml`). It deliberately does not modify
 * Zen's Library: it reads Places and SessionStore directly and draws its own
 * modal panel.
 *
 * Entry points
 *   - A toolbar button appended to the nav bar, controlled by
 *     `zen-flow.history-enabled`.
 *   - Ctrl+Alt+H, which is always available while the mod is loaded.
 *
 * Design notes
 *   - The panel is built lazily on the first open. Until then the only DOM we
 *     add is the toolbar button and the key.
 *   - One debounced timeout handles typing. There is no polling, no
 *     IntersectionObserver, and no observer on the history database.
 *   - Places queries are synchronous and bounded by `limit`; "Load more"
 *     raises the limit. Date, text and domain filters are applied inside the
 *     query, with a label-aware host post-check, so there is no full-history
 *     scan in JS.
 *   - User text is only ever rendered with `textContent`; this file never
 *     parses user input as markup.
 *   - `destroy()` removes every element, listener, observer and timer. Row
 *     listeners live and die with their rows.
 *   - The pure helpers at the top are exported so the offline validator can
 *     test normalisation, host matching and date boundaries without a browser.
 * =========================================================================== */

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

const ROOT_ID = "zen-flow-history";
const BUTTON_ID = "zen-flow-history-button";
const KEYSET_ID = "zen-flow-history-keyset";
const KEY_ID = "zen-flow-history-key";
const PANEL_ID = "zfh-panel";

const PREF_ENABLED = "zen-flow.history-enabled";
const PREF_DEBUG = "zen-flow.debug";

const PAGE_SIZE = 100;
const DEBOUNCE_MS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_DATALIST = 50;

const ICON_HISTORY = "chrome://browser/skin/zen-icons/history.svg";
const ICON_SEARCH = "chrome://browser/skin/zen-icons/search-glass.svg";
const ICON_TRASH = "chrome://browser/skin/zen-icons/trash.svg";
const ICON_REOPEN = "chrome://browser/skin/zen-icons/u-turn-to-left.svg";
const ICON_FAVICON = "chrome://global/skin/icons/defaultFavicon.svg";

const SORT_VALUES = new Set(["date", "site", "mostvisited", "lastvisited"]);
const PRESET_VALUES = new Set(["today", "week", "month", "all"]);

const SORTS = [
  ["date", "Date"],
  ["site", "Site"],
  ["mostvisited", "Most visited"],
  ["lastvisited", "Last visited"],
];

const PRESETS = [
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["all", "All time"],
];

/* ======================================================================
 * Pure helpers (also used by the offline validator)
 * ==================================================================== */

export function startOfLocalDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(value, days) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateInputValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function isDateRangeValid(start, end) {
  return !start || !end || start.getTime() <= end.getTime();
}

/**
 * Inclusive preset ranges, expressed as local midnights. `end` is the day the
 * user sees as the last day; the query layer converts it to an exclusive
 * boundary.
 */
export function presetRangeFor(preset, now = new Date()) {
  const today = startOfLocalDay(now);
  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "week":
      return { start: addLocalDays(today, -6), end: today };
    case "month":
      return { start: addLocalDays(today, -29), end: today };
    default:
      return { start: null, end: null };
  }
}

export function normalizeHost(host) {
  return String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
}

export function hostnameOf(url) {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch (error) {
    return "";
  }
}

/**
 * True for `github.com` itself or any subdomain, and false for lookalikes
 * such as `notgithub.com` and `github.com.example.org`. Both sides are
 * normalised, and a leading `www.` is ignored on either side.
 */
export function hostMatches(host, domain) {
  const normalizedHost = normalizeHost(host);
  let normalizedDomain = normalizeHost(domain).replace(/^www\./, "");
  if (!normalizedHost || !normalizedDomain) {
    return false;
  }
  return (
    normalizedHost === normalizedDomain ||
    normalizedHost.endsWith(`.${normalizedDomain}`)
  );
}

/**
 * Turns whatever the user typed into a filter instruction:
 *
 *   none    empty, or a bare scheme such as `https://`
 *   domain  a hostname, optionally with a scheme, www, port, path, query or
 *           fragment: `https://www.github.com/issues?q=1`
 *   term    a single word without a dot: `github`
 *   text    anything that is not a URL and not a single word: `the verge`
 *
 * Domain matching is label-aware (see `hostMatches`); term matching is a
 * substring of the hostname; text is passed to Places' normal search, because
 * it may be a page title rather than a site.
 */
export function normalizeSiteInput(input) {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return { kind: "none", value: "" };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\/$/i.test(raw)) {
    return { kind: "none", value: "" };
  }
  if (/^www\.$/i.test(raw) || /^\.+$/.test(raw)) {
    return { kind: "none", value: "" };
  }

  let host = "";
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? raw
      : raw.startsWith("//")
        ? `https:${raw}`
        : `https://${raw}`;
    host = new URL(candidate).hostname;
  } catch (error) {
    return { kind: "text", value: raw };
  }

  host = normalizeHost(host).replace(/^www\./, "");
  if (!host || host === "www" || /\s/.test(host)) {
    return host ? { kind: "text", value: raw } : { kind: "none", value: "" };
  }

  return host.includes(".")
    ? { kind: "domain", value: host }
    : { kind: "term", value: host };
}

export function matchesAllTokens(text, query) {
  const haystack = String(text ?? "").toLowerCase();
  return String(query ?? "")
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

/**
 * One row per URL per local day, keeping the newest visit (the input is
 * already sorted newest first by Places). This mirrors Zen's date grouping
 * while retaining each individual visit's timestamp.
 */
export function dedupeVisitsByDay(visits) {
  const groups = new Map();
  const seen = new Set();

  for (const visit of visits) {
    const day = startOfLocalDay(visit.time).getTime();
    if (Number.isNaN(day)) {
      continue;
    }
    const key = `${day}\u0000${visit.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    let rows = groups.get(day);
    if (!rows) {
      groups.set(day, (rows = []));
    }
    rows.push(visit);
  }

  return groups;
}

/** Groups rows alphabetically by the string returned from `siteOf`. */
export function groupBySite(rows, siteOf) {
  const groups = new Map();
  for (const row of rows) {
    const site = siteOf(row) || "";
    let list = groups.get(site);
    if (!list) {
      groups.set(site, (list = []));
    }
    list.push(row);
  }

  return new Map(
    [...groups].sort(([a], [b]) => {
      if (!a || !b) {
        return a ? -1 : b ? 1 : 0;
      }
      return a.localeCompare(b);
    }),
  );
}

/**
 * Matches a SessionStore closed-tab record. Closed tabs are filtered by
 * `closedAt` (not `lastAccessed`), as the timestamps the user sees are the
 * times the tabs were closed.
 */
export function matchesClosedTab(
  tab,
  entry,
  {
    search = "",
    site = { kind: "none", value: "" },
    start = null,
    endExclusive = null,
  } = {},
) {
  const closedAt = Number(tab?.closedAt);
  if (!Number.isFinite(closedAt)) {
    return false;
  }
  if (start && closedAt < start.getTime()) {
    return false;
  }
  if (endExclusive && closedAt >= endExclusive.getTime()) {
    return false;
  }

  const url = entry?.url || "";
  const title = tab?.title || entry?.title || url;
  const text = `${title} ${entry?.title || ""} ${url}`;

  if (search && !matchesAllTokens(text, search)) {
    return false;
  }

  const host = hostnameOf(url);
  if (site.kind === "domain" && !hostMatches(host, site.value)) {
    return false;
  }
  if (site.kind === "term" && !host.includes(site.value)) {
    return false;
  }
  if (
    site.kind === "text" &&
    !matchesAllTokens(text, site.value)
  ) {
    return false;
  }

  return true;
}

export function filterClosedTabRows(tabs, filters) {
  const rows = [];
  for (const tab of tabs) {
    const entry = tab?.state?.entries?.[tab.state.index - 1];
    if (!entry?.url) {
      continue;
    }
    if (!matchesClosedTab(tab, entry, filters)) {
      continue;
    }
    rows.push({
      url: entry.url,
      title: tab.title || entry.title || entry.url,
      time: new Date(Number(tab.closedAt)),
      lastAccessed:
        Number(tab.state?.lastAccessed) || Number(tab.closedAt) || 0,
      closedId: tab.closedId,
      closed: true,
      image: tab.image || "",
    });
  }
  return rows;
}

/* ======================================================================
 * Browser-side helpers
 * ==================================================================== */

let lazy = {};

const prefBool = (name, fallback) => {
  try {
    return Services.prefs.getBoolPref(name, fallback);
  } catch (error) {
    return fallback;
  }
};

function moduleExport(namespace, name) {
  if (namespace?.[name]) {
    return namespace[name];
  }
  if (namespace?.default?.[name]) {
    return namespace.default[name];
  }
  return namespace?.default ?? namespace;
}

function loadModule(name, url, property) {
  if (!lazy[name]) {
    const namespace = ChromeUtils.importESModule(url);
    lazy[name] = moduleExport(namespace, property);
  }
  return lazy[name];
}

function getPlacesUtils() {
  return loadModule(
    "PlacesUtils",
    "resource://gre/modules/PlacesUtils.sys.mjs",
    "PlacesUtils",
  );
}

function getBrowserUtils() {
  return loadModule(
    "BrowserUtils",
    "resource://gre/modules/BrowserUtils.sys.mjs",
    "BrowserUtils",
  );
}

function getSessionStore() {
  if (!lazy.SessionStore) {
    try {
      lazy.SessionStore = moduleExport(
        ChromeUtils.importESModule(
          "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
        ),
        "SessionStore",
      );
    } catch (error) {
      lazy.SessionStore = moduleExport(
        ChromeUtils.importESModule(
          "resource:///modules/sessionstore/SessionStore.sys.mjs",
        ),
        "SessionStore",
      );
    }
  }
  return lazy.SessionStore;
}

function getPlacesUIUtils() {
  try {
    return loadModule(
      "PlacesUIUtils",
      "moz-src:///browser/components/places/PlacesUIUtils.sys.mjs",
      "PlacesUIUtils",
    );
  } catch (error) {
    return null;
  }
}

function isBlockedUrl(url) {
  return /^(?:javascript|data|vbscript|blob):/i.test(String(url ?? "").trim());
}

function formatUrl(url) {
  return String(url ?? "")
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/$/, "");
}

function createElement(tag, attributes = {}, ...children) {
  const node = document.createElementNS(XHTML_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key === "value") {
      node.value = value;
    } else if (key === "checked" || key === "disabled") {
      node[key] = Boolean(value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
}

/* ======================================================================
 * ZenFlowHistory
 * ==================================================================== */

class ZenFlowHistory {
  constructor() {
    this.destroyed = false;
    this.initialised = false;
    this.isOpen = false;

    this.document = null;
    this.documentElement = null;
    this.root = null;
    this.panel = null;
    this.refs = null;

    this.toolbarButton = null;
    this.keyset = null;

    this.listeners = [];
    this.prefObserver = null;
    this.escapeHandler = null;
    this.debounceTimer = null;

    this.prefs = null;
    this.formatters = null;
    this.previouslyFocused = null;

    this.state = {
      source: "history",
      search: "",
      site: "",
      start: null,
      end: null,
      preset: "all",
      sort: "date",
      limit: PAGE_SIZE,
    };

    this.siteFilter = { kind: "none", value: "" };
    this.rows = [];
    this.hasMore = false;
    this.refreshToken = 0;
    this.lastDomainSignature = "";
  }

  /* ---- lifecycle ------------------------------------------------------- */

  init() {
    if (this.destroyed || this.initialised) {
      return;
    }

    this.document = window.document;
    this.documentElement = this.document.documentElement;
    if (!this.documentElement) {
      this.warn("browser window is not ready");
      return;
    }

    this.formatters = {
      visit: new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      day: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }),
      relativeDay: new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }),
    };

    this.readPrefs();
    this.createKeyset();
    this.syncEntryPoints();
    this.watchPrefs();
    this.initialised = true;
    this.log("ready");
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.isOpen = false;

    this.removeEscapeHandler();
    this.cancelDebounce();

    for (const entry of this.listeners) {
      try {
        entry.target.removeEventListener(entry.type, entry.fn, entry.options);
      } catch (error) {
        /* target may be gone */
      }
    }
    this.listeners = [];

    if (this.prefObserver) {
      try {
        Services.prefs.removeObserver(PREF_ENABLED, this.prefObserver);
      } catch (error) {
        /* observer was never registered */
      }
      this.prefObserver = null;
    }

    this.toolbarButton?.remove();
    this.toolbarButton = null;

    this.keyset?.remove();
    this.keyset = null;

    this.root?.remove();
    this.root = null;
    this.panel = null;
    this.refs = null;
    this.previouslyFocused = null;

    if (window.__zenFlowHistory === this) {
      delete window.__zenFlowHistory;
    }

    this.log("destroyed");
  }

  /* ---- preferences and logging ---------------------------------------- */

  readPrefs() {
    this.prefs = {
      enabled: prefBool(PREF_ENABLED, true),
      debug: prefBool(PREF_DEBUG, false),
    };
  }

  watchPrefs() {
    this.prefObserver = {
      observe: (subject, topic, data) => {
        if (topic !== "nsPref:changed" || data !== PREF_ENABLED) {
          return;
        }
        this.readPrefs();
        this.syncEntryPoints();
      },
    };
    Services.prefs.addObserver(PREF_ENABLED, this.prefObserver);
  }

  log(message, ...args) {
    if (!prefBool(PREF_DEBUG, false)) {
      return;
    }
    console.log(`[Zen Flow] history: ${message}`, ...args);
  }

  warn(message, ...args) {
    console.warn(`[Zen Flow] history: ${message}`, ...args);
  }

  /* ---- entry points ---------------------------------------------------- */

  syncEntryPoints() {
    if (this.prefs?.enabled) {
      this.createToolbarButton();
    } else {
      this.removeToolbarButton();
    }
  }

  createToolbarButton() {
    if (this.toolbarButton?.isConnected) {
      return;
    }

    const target =
      this.document.getElementById("nav-bar-customization-target") ??
      this.document.getElementById("nav-bar");
    if (!target) {
      this.warn("nav bar not found; use Ctrl+Alt+H");
      return;
    }

    /* A previous instance that did not get a chance to clean up. */
    this.document.getElementById(BUTTON_ID)?.remove();

    const button = this.document.createElementNS(XUL_NS, "toolbarbutton");
    button.id = BUTTON_ID;
    button.className = "toolbarbutton-1 chromeclass-toolbar-additional";
    button.setAttribute("label", "Advanced History");
    button.setAttribute("tooltiptext", "Advanced History (Ctrl+Alt+H)");
    button.setAttribute("image", ICON_HISTORY);
    button.setAttribute("aria-label", "Advanced History");
    button.setAttribute("aria-keyshortcuts", "Control+Alt+H");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", ROOT_ID);
    button.setAttribute("aria-expanded", String(this.isOpen));

    this.listen(button, "command", () => this.open());
    target.appendChild(button);
    this.toolbarButton = button;
    this.log("toolbar button added");
  }

  removeToolbarButton() {
    this.toolbarButton?.remove();
    this.toolbarButton = null;
  }

  createKeyset() {
    this.document.getElementById(KEYSET_ID)?.remove();

    const keyset = this.document.createElementNS(XUL_NS, "keyset");
    keyset.id = KEYSET_ID;

    const key = this.document.createElementNS(XUL_NS, "key");
    key.id = KEY_ID;
    key.setAttribute("key", "h");
    key.setAttribute("modifiers", "control,alt");
    this.listen(key, "command", () => this.open());

    keyset.appendChild(key);
    this.documentElement.appendChild(keyset);
    this.keyset = keyset;
  }

  /* ---- panel construction --------------------------------------------- */

  buildPanel() {
    if (this.root?.isConnected) {
      return;
    }

    this.document.getElementById(ROOT_ID)?.remove();
    this.lastDomainSignature = "";

    const sourceTabs = createElement("div", {
      class: "zfh-source",
      role: "tablist",
      "aria-label": "History source",
    });

    const historyTab = createElement("button", {
      id: "zfh-source-history",
      class: "zfh-source-tab",
      type: "button",
      role: "tab",
      "aria-selected": "true",
      "aria-controls": "zfh-results",
      tabindex: "0",
      text: "History",
    });

    const closedTab = createElement("button", {
      id: "zfh-source-closed",
      class: "zfh-source-tab",
      type: "button",
      role: "tab",
      "aria-selected": "false",
      "aria-controls": "zfh-results",
      tabindex: "-1",
      text: "Closed tabs",
    });

    sourceTabs.append(historyTab, closedTab);

    const closeButton = createElement("button", {
      id: "zfh-close",
      class: "zfh-icon-button zfh-close",
      type: "button",
      "aria-label": "Close Advanced History",
      text: "\u00d7",
    });

    const header = createElement(
      "header",
      { class: "zfh-header" },
      createElement(
        "div",
        { class: "zfh-title-wrap" },
        createElement("h1", {
          id: "zfh-title",
          class: "zfh-title",
          text: "History",
        }),
      ),
      sourceTabs,
      closeButton,
    );

    const search = createElement("input", {
      id: "zfh-search",
      class: "zfh-input zfh-search-input",
      type: "search",
      placeholder: "Search titles and URLs",
      "aria-label": "Search history",
      autocomplete: "off",
      spellcheck: "false",
    });

    const searchClear = createElement("button", {
      id: "zfh-search-clear",
      class: "zfh-search-clear",
      type: "button",
      "aria-label": "Clear search",
      hidden: true,
      text: "\u00d7",
    });

    const searchWrap = createElement(
      "div",
      { class: "zfh-search" },
      createElement("img", {
        class: "zfh-search-icon",
        src: ICON_SEARCH,
        alt: "",
      }),
      search,
      searchClear,
    );

    const start = createElement("input", {
      id: "zfh-start",
      class: "zfh-input",
      type: "date",
      "aria-label": "Start date",
    });

    const end = createElement("input", {
      id: "zfh-end",
      class: "zfh-input",
      type: "date",
      "aria-label": "End date",
    });

    const site = createElement("input", {
      id: "zfh-site",
      class: "zfh-input",
      type: "text",
      placeholder: "example.com",
      "aria-label": "Filter by website",
      autocomplete: "off",
      spellcheck: "false",
      list: "zfh-domains",
    });

    const clearDates = createElement("button", {
      id: "zfh-clear-dates",
      class: "zfh-ghost",
      type: "button",
      text: "Clear dates",
    });

    const filterGrid = createElement(
      "div",
      { class: "zfh-filter-grid" },
      createElement(
        "label",
        { class: "zfh-field", for: "zfh-start" },
        createElement("span", { class: "zfh-field-label", text: "From" }),
        start,
      ),
      createElement(
        "label",
        { class: "zfh-field", for: "zfh-end" },
        createElement("span", { class: "zfh-field-label", text: "To" }),
        end,
      ),
      createElement(
        "label",
        { class: "zfh-field zfh-field-site", for: "zfh-site" },
        createElement("span", {
          class: "zfh-field-label",
          text: "Website",
        }),
        site,
      ),
      createElement(
        "div",
        { class: "zfh-clear-dates-wrap" },
        clearDates,
      ),
    );

    const dateError = createElement("p", {
      id: "zfh-date-error",
      class: "zfh-error",
      role: "alert",
      hidden: true,
      text: "The start date must be on or before the end date.",
    });

    const presetButtons = {};
    const presets = createElement(
      "div",
      {
        class: "zfh-presets",
        role: "group",
        "aria-label": "Quick date range",
      },
      ...PRESETS.map(([id, label]) => {
        const button = createElement("button", {
          id: `zfh-preset-${id}`,
          class: "zfh-preset",
          type: "button",
          "data-preset": id,
          "aria-pressed": "false",
          text: label,
        });
        presetButtons[id] = button;
        return button;
      }),
    );

    const clearFilters = createElement("button", {
      id: "zfh-clear",
      class: "zfh-ghost",
      type: "button",
      text: "Clear filters",
    });

    const filters = createElement(
      "div",
      { class: "zfh-filters" },
      searchWrap,
      filterGrid,
      dateError,
      createElement("div", { class: "zfh-preset-row" }, presets, clearFilters),
    );

    const status = createElement("span", {
      id: "zfh-status",
      class: "zfh-status",
      role: "status",
      "aria-live": "polite",
      text: "Loading\u2026",
    });

    const sort = createElement(
      "select",
      {
        id: "zfh-sort",
        class: "zfh-select",
        "aria-label": "Sort history by",
      },
      ...SORTS.map(([value, label]) =>
        createElement("option", { value, text: label }),
      ),
    );

    const resultsHeader = createElement(
      "div",
      { class: "zfh-results-header" },
      status,
      createElement(
        "label",
        { class: "zfh-sort", for: "zfh-sort" },
        createElement("span", { text: "Sort" }),
        sort,
      ),
    );

    const results = createElement("div", {
      id: "zfh-results",
      class: "zfh-results",
      role: "tabpanel",
      "aria-labelledby": "zfh-source-history",
      tabindex: "-1",
    });

    const more = createElement("button", {
      id: "zfh-more",
      class: "zfh-secondary",
      type: "button",
      hidden: true,
      text: "Load more",
    });

    const done = createElement("button", {
      id: "zfh-done",
      class: "zfh-primary",
      type: "button",
      text: "Done",
    });

    const footer = createElement(
      "footer",
      { class: "zfh-footer" },
      createElement("span", {
        class: "zfh-hint",
        text: "Ctrl+Alt+H opens this panel.",
      }),
      createElement(
        "div",
        { class: "zfh-footer-actions" },
        more,
        done,
      ),
    );

    const domains = createElement("datalist", { id: "zfh-domains" });

    const panel = createElement(
      "section",
      {
        id: PANEL_ID,
        class: "zfh-panel",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "zfh-title",
        tabindex: "-1",
      },
      header,
      filters,
      resultsHeader,
      results,
      footer,
      domains,
    );

    const root = createElement("div", {
      id: ROOT_ID,
      role: "presentation",
      hidden: true,
    });
    root.append(panel);

    this.document.documentElement.appendChild(root);

    this.root = root;
    this.panel = panel;
    this.refs = {
      historyTab,
      closedTab,
      closeButton,
      search,
      searchClear,
      start,
      end,
      site,
      clearDates,
      clearFilters,
      presets: presetButtons,
      dateError,
      status,
      sort,
      results,
      more,
      done,
      domains,
    };

    this.bindPanelEvents(sourceTabs);
    this.syncControls();
  }

  bindPanelEvents(sourceTabs) {
    const refs = this.refs;

    this.listen(refs.closeButton, "click", () => this.close());
    this.listen(refs.done, "click", () => this.close());

    this.listen(this.root, "click", (event) => {
      if (event.target === this.root) {
        this.close();
      }
    });

    this.listen(refs.historyTab, "click", () => this.setSource("history"));
    this.listen(refs.closedTab, "click", () => this.setSource("closed"));
    this.listen(sourceTabs, "keydown", (event) =>
      this.onSourceKeyDown(event),
    );

    this.listen(refs.search, "input", () => {
      this.state.search = refs.search.value;
      refs.searchClear.hidden = !refs.search.value;
      this.resetLimit();
      this.scheduleRefresh();
    });
    this.listen(refs.search, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.refreshNow();
      }
    });
    this.listen(refs.searchClear, "click", () => {
      refs.search.value = "";
      this.state.search = "";
      refs.searchClear.hidden = true;
      this.resetLimit();
      this.refreshNow();
      refs.search.focus({ preventScroll: true });
    });

    this.listen(refs.site, "input", () => {
      this.state.site = refs.site.value;
      this.resetLimit();
      this.scheduleRefresh();
    });
    this.listen(refs.site, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.refreshNow();
      }
    });

    this.listen(refs.start, "change", () => this.onDateInputChanged());
    this.listen(refs.end, "change", () => this.onDateInputChanged());

    for (const [id, button] of Object.entries(refs.presets)) {
      this.listen(button, "click", () => this.applyPreset(id));
    }
    this.listen(refs.clearDates, "click", () => this.applyPreset("all"));
    this.listen(refs.clearFilters, "click", () => this.clearFilters());

    this.listen(refs.sort, "change", () => {
      this.state.sort = SORT_VALUES.has(refs.sort.value)
        ? refs.sort.value
        : "date";
      this.resetLimit();
      this.refreshNow();
    });

    this.listen(refs.more, "click", () => {
      this.state.limit += PAGE_SIZE;
      this.refreshNow({ keepScroll: true });
    });

    this.listen(this.panel, "keydown", (event) => this.onPanelKeyDown(event));
  }

  /* ---- open / close ---------------------------------------------------- */

  open() {
    if (this.destroyed) {
      return;
    }

    this.buildPanel();
    if (!this.root) {
      return;
    }

    if (this.isOpen) {
      this.refs.search.focus({ preventScroll: true });
      return;
    }

    /* Rolling presets must mean the same thing on every open: "Today" after
       midnight is the new day, not the day the panel was last used. */
    if (this.state.preset && this.state.preset !== "all") {
      const range = presetRangeFor(this.state.preset);
      this.state.start = range.start;
      this.state.end = range.end;
    }

    try {
      if (window.gURLBar?.view?.isOpen) {
        window.gURLBar.view.close();
      }
    } catch (error) {
      /* URL bar is not ready */
    }

    this.previouslyFocused = this.document.activeElement;
    this.isOpen = true;
    this.root.hidden = false;
    this.toolbarButton?.setAttribute("aria-expanded", "true");

    this.removeEscapeHandler();
    this.escapeHandler = (event) => {
      if (event.key !== "Escape" || !this.isOpen) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.close();
    };
    this.document.addEventListener("keydown", this.escapeHandler, true);

    this.refs.results.scrollTop = 0;
    this.syncControls();
    this.refreshNow();
    this.refs.search.focus({ preventScroll: true });
    this.log("opened");
  }

  close({ restoreFocus = true } = {}) {
    this.removeEscapeHandler();
    if (!this.isOpen) {
      return;
    }

    this.isOpen = false;
    this.cancelDebounce();
    this.refreshToken++;
    this.root.hidden = true;
    this.toolbarButton?.setAttribute("aria-expanded", "false");

    if (restoreFocus) {
      const target = this.previouslyFocused;
      this.previouslyFocused = null;
      try {
        if (target?.isConnected && typeof target.focus === "function") {
          target.focus({ preventScroll: true });
        }
      } catch (error) {
        /* target may belong to content that is going away */
      }
    } else {
      this.previouslyFocused = null;
    }

    this.log("closed");
  }

  removeEscapeHandler() {
    if (!this.escapeHandler) {
      return;
    }
    try {
      this.document.removeEventListener("keydown", this.escapeHandler, true);
    } catch (error) {
      /* document is going away */
    }
    this.escapeHandler = null;
  }

  /* ---- state and controls --------------------------------------------- */

  resetLimit() {
    this.state.limit = PAGE_SIZE;
  }

  syncControls() {
    if (!this.refs) {
      return;
    }

    this.syncSource();

    this.refs.search.value = this.state.search;
    this.refs.searchClear.hidden = !this.state.search;
    this.refs.site.value = this.state.site;

    this.refs.start.value =
      this.state.preset === "all" ? "" : toDateInputValue(this.state.start);
    this.refs.end.value =
      this.state.preset === "all" ? "" : toDateInputValue(this.state.end);

    this.refs.sort.value = this.state.sort;
    this.syncPresetButtons();
    this.syncDateLimits();
    this.setDateError(false);
  }

  syncSource() {
    if (!this.refs) {
      return;
    }
    const isHistory = this.state.source === "history";

    this.refs.historyTab.setAttribute("aria-selected", String(isHistory));
    this.refs.historyTab.tabIndex = isHistory ? 0 : -1;
    this.refs.closedTab.setAttribute("aria-selected", String(!isHistory));
    this.refs.closedTab.tabIndex = isHistory ? -1 : 0;
    this.refs.results.setAttribute(
      "aria-labelledby",
      isHistory ? "zfh-source-history" : "zfh-source-closed",
    );

    const mostVisited = this.refs.sort.querySelector(
      'option[value="mostvisited"]',
    );
    if (mostVisited) {
      mostVisited.disabled = !isHistory;
    }
    if (!isHistory && this.state.sort === "mostvisited") {
      this.state.sort = "date";
    }
    this.refs.sort.value = this.state.sort;
    this.refs.sort.setAttribute(
      "aria-label",
      isHistory ? "Sort history by" : "Sort closed tabs by",
    );

    this.refs.search.placeholder = isHistory
      ? "Search titles and URLs"
      : "Search closed tabs";
    this.refs.search.setAttribute(
      "aria-label",
      isHistory ? "Search history" : "Search closed tabs",
    );
  }

  syncPresetButtons() {
    if (!this.refs) {
      return;
    }
    for (const [id, button] of Object.entries(this.refs.presets)) {
      const active = this.state.preset === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  syncDateLimits() {
    const start = this.refs.start.value;
    const end = this.refs.end.value;
    this.refs.start.max = end || "";
    this.refs.end.min = start || "";
  }

  setDateError(visible) {
    if (!this.refs) {
      return;
    }
    this.refs.dateError.hidden = !visible;
    if (visible) {
      this.refs.start.setAttribute("aria-invalid", "true");
      this.refs.end.setAttribute("aria-invalid", "true");
    } else {
      this.refs.start.removeAttribute("aria-invalid");
      this.refs.end.removeAttribute("aria-invalid");
    }
  }

  setSource(source) {
    if (source !== "history" && source !== "closed") {
      return;
    }
    if (this.state.source === source) {
      this.syncSource();
      return;
    }

    this.state.source = source;
    if (source === "closed" && this.state.sort === "mostvisited") {
      this.state.sort = "date";
    }
    this.resetLimit();
    this.syncSource();
    this.refreshNow();
  }

  onSourceKeyDown(event) {
    if (!this.refs) {
      return;
    }
    const tabs = [this.refs.historyTab, this.refs.closedTab];
    const current = tabs.findIndex(
      (tab) => tab.getAttribute("aria-selected") === "true",
    );

    let index;
    switch (event.key) {
      case "ArrowLeft":
        index = (current + tabs.length - 1) % tabs.length;
        break;
      case "ArrowRight":
        index = (current + 1) % tabs.length;
        break;
      case "Home":
        index = 0;
        break;
      case "End":
        index = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.setSource(index === 0 ? "history" : "closed");
    tabs[index].focus();
  }

  onDateInputChanged() {
    const start = parseDateInputValue(this.refs.start.value);
    const end = parseDateInputValue(this.refs.end.value);

    this.state.start = start;
    this.state.end = end;
    this.state.preset = !start && !end ? "all" : null;

    this.syncPresetButtons();
    this.syncDateLimits();
    this.resetLimit();
    this.refreshNow();
  }

  applyPreset(id) {
    if (!PRESET_VALUES.has(id)) {
      return;
    }
    const range = presetRangeFor(id);
    this.state.start = range.start;
    this.state.end = range.end;
    this.state.preset = id;

    this.refs.start.value = range.start ? toDateInputValue(range.start) : "";
    this.refs.end.value = range.end ? toDateInputValue(range.end) : "";
    this.syncDateLimits();
    this.setDateError(false);
    this.syncPresetButtons();
    this.resetLimit();
    this.refreshNow();
  }

  clearFilters() {
    this.state.search = "";
    this.state.site = "";
    this.state.start = null;
    this.state.end = null;
    this.state.preset = "all";
    this.state.sort = "date";
    this.resetLimit();
    this.cancelDebounce();
    this.syncControls();
    this.refreshNow();
  }

  hasActiveFilters() {
    return Boolean(
      this.state.search.trim() ||
        this.state.site.trim() ||
        this.state.start ||
        this.state.end,
    );
  }

  /* ---- scheduling ------------------------------------------------------ */

  scheduleRefresh() {
    this.cancelDebounce();
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.refresh();
    }, DEBOUNCE_MS);
  }

  cancelDebounce() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  refreshNow(options) {
    this.cancelDebounce();
    this.refresh(options);
  }

  /* ---- querying -------------------------------------------------------- */

  effectiveRange() {
    const start = this.state.start ? startOfLocalDay(this.state.start) : null;
    const end = this.state.end ? startOfLocalDay(this.state.end) : null;

    if (!isDateRangeValid(start, end)) {
      return { invalid: true };
    }

    return {
      start,
      endExclusive: end ? addLocalDays(end, 1) : null,
    };
  }

  refresh({ keepScroll = false } = {}) {
    if (!this.isOpen || this.destroyed || !this.refs) {
      return;
    }

    const range = this.effectiveRange();
    if (range.invalid) {
      this.setDateError(true);
      this.rows = [];
      this.hasMore = false;
      this.renderEmpty("Choose a valid date range to see history.");
      this.setStatus("Choose a valid date range");
      this.setMoreVisible(false);
      return;
    }

    this.setDateError(false);
    this.siteFilter = normalizeSiteInput(this.state.site);

    const token = ++this.refreshToken;
    this.refs.results.setAttribute("aria-busy", "true");

    let result;
    try {
      result =
        this.state.source === "history"
          ? this.queryHistory(range)
          : this.queryClosedTabs(range);
    } catch (error) {
      console.error("[Zen Flow] history query failed", error);
      this.rows = [];
      this.hasMore = false;
      if (token === this.refreshToken && !this.destroyed) {
        this.renderEmpty(
          "History could not be read. Open the Browser Console for details.",
        );
        this.setStatus("History unavailable");
        this.setMoreVisible(false);
      }
      this.refs.results.removeAttribute("aria-busy");
      return;
    }

    if (token !== this.refreshToken || this.destroyed) {
      this.refs.results.removeAttribute("aria-busy");
      return;
    }

    this.rows = result.rows;
    this.hasMore = result.hasMore;
    this.render(result, { keepScroll });
    this.refs.results.removeAttribute("aria-busy");
  }

  queryHistory(range) {
    const PlacesUtils = getPlacesUtils();
    const query = PlacesUtils.history.getNewQuery();
    const options = PlacesUtils.history.getNewQueryOptions();
    const sort = this.state.sort;
    const site = this.siteFilter;

    if (range.start) {
      query.beginTime = PlacesUtils.toPRTime(range.start);
    }
    if (range.endExclusive) {
      /* Places' endTime is inclusive. Stop one microsecond before the
         midnight that starts the day *after* the selected end date. */
      query.endTime = PlacesUtils.toPRTime(range.endExclusive) - 1;
    }

    const terms = [this.state.search.trim()];
    if (site.kind === "term" || site.kind === "text") {
      if (
        site.value &&
        !terms.some((term) =>
          term.toLowerCase().includes(site.value.toLowerCase()),
        )
      ) {
        terms.push(site.value);
      }
    }
    const searchTerms = terms.filter(Boolean).join(" ");
    if (searchTerms) {
      query.searchTerms = searchTerms;
    }

    if (site.kind === "domain") {
      /* `domainIsHost=false` includes subdomains. The exact label check below
         guarantees that `notgithub.com` and `github.com.example.org` are still
         rejected even if a future Places change loosens the SQL range. */
      query.domain = site.value;
      query.domainIsHost = false;
    }

    options.resultType =
      sort === "date"
        ? Ci.nsINavHistoryQueryOptions.RESULTS_AS_VISIT
        : Ci.nsINavHistoryQueryOptions.RESULTS_AS_URI;
    options.sortingMode =
      sort === "mostvisited"
        ? Ci.nsINavHistoryQueryOptions.SORT_BY_VISITCOUNT_DESCENDING
        : Ci.nsINavHistoryQueryOptions.SORT_BY_DATE_DESCENDING;
    options.maxResults = this.state.limit;
    options.excludeQueries = true;

    const result = PlacesUtils.history.executeQuery(query, options);
    const root = result.root;
    const visits = [];
    let rawCount = 0;

    root.containerOpen = true;
    try {
      rawCount = root.childCount;
      for (let index = 0; index < rawCount; index++) {
        const node = root.getChild(index);
        const url = node.uri;
        if (!url) {
          continue;
        }

        if (site.kind !== "none") {
          const host = hostnameOf(url);
          if (site.kind === "domain" && !hostMatches(host, site.value)) {
            continue;
          }
          if (site.kind === "term" && !host.includes(site.value)) {
            continue;
          }
        }

        visits.push({
          url,
          title: node.title || url,
          time: PlacesUtils.toDate(node.time),
          visitCount: node.accessCount || 0,
          closed: false,
        });
      }
    } finally {
      root.containerOpen = false;
    }

    const hasMore = rawCount >= this.state.limit;

    if (sort === "date") {
      const byDay = dedupeVisitsByDay(visits);
      const groups = [...byDay].map(([key, rows]) => ({ key, rows }));
      return {
        mode: "date",
        groups,
        rows: groups.flatMap((group) => group.rows),
        hasMore,
      };
    }

    if (sort === "site") {
      const bySite = groupBySite(visits, (row) => this.formatSite(row.url));
      const groups = [...bySite].map(([key, rows]) => ({ key, rows }));
      return {
        mode: "site",
        groups,
        rows: groups.flatMap((group) => group.rows),
        hasMore,
      };
    }

    return {
      mode: "flat",
      groups: [{ key: null, rows: visits }],
      rows: visits,
      hasMore,
    };
  }

  queryClosedTabs(range) {
    const SessionStore = getSessionStore();
    const tabs = SessionStore.getClosedTabData(window);
    const filtered = filterClosedTabRows(tabs, {
      search: this.state.search,
      site: this.siteFilter,
      start: range.start,
      endExclusive: range.endExclusive,
    });

    const byDate = [...filtered].sort((a, b) => b.time - a.time);
    const sorted =
      this.state.sort === "lastvisited"
        ? [...filtered].sort((a, b) => b.lastAccessed - a.lastAccessed)
        : byDate;

    const limited = sorted.slice(0, this.state.limit);
    let groups;

    if (this.state.sort === "site") {
      const bySite = groupBySite(limited, (row) => this.formatSite(row.url));
      groups = [...bySite].map(([key, rows]) => ({ key, rows }));
    } else if (this.state.sort === "lastvisited") {
      groups = [{ key: null, rows: limited }];
    } else {
      const byDay = new Map();
      for (const row of limited) {
        const key = startOfLocalDay(row.time).getTime();
        let rows = byDay.get(key);
        if (!rows) {
          byDay.set(key, (rows = []));
        }
        rows.push(row);
      }
      groups = [...byDay].map(([key, rows]) => ({ key, rows }));
    }

    return {
      mode:
        this.state.sort === "site"
          ? "site"
          : this.state.sort === "lastvisited"
            ? "flat"
            : "date",
      groups,
      rows: groups.flatMap((group) => group.rows),
      hasMore: filtered.length > this.state.limit,
    };
  }

  /* ---- rendering ------------------------------------------------------- */

  render(result, { keepScroll = false } = {}) {
    if (!this.isOpen || this.destroyed || !this.refs) {
      return;
    }

    const scrollTop = keepScroll ? this.refs.results.scrollTop : 0;
    const fragment = this.document.createDocumentFragment();
    let count = 0;

    for (const group of result.groups) {
      if (group.key !== null && result.mode !== "flat") {
        const label =
          result.mode === "date"
            ? this.formatDay(group.key)
            : group.key || "Other";
        fragment.append(
          createElement("h2", { class: "zfh-group-title", text: label }),
        );
      }
      for (const row of group.rows) {
        fragment.append(this.buildRow(row));
        count++;
      }
    }

    if (!count) {
      const historySource = this.state.source === "history";
      const hasFilters = this.hasActiveFilters();
      let message;
      if (historySource) {
        message = hasFilters
          ? "No history matches these filters."
          : "No history found.";
      } else {
        message = hasFilters
          ? "No closed tabs match these filters."
          : "No closed tabs found.";
      }
      this.renderEmpty(message);
    } else {
      this.refs.results.replaceChildren(fragment);
      this.refs.results.scrollTop = scrollTop;
    }

    this.updateDatalist(result.rows);
    this.updateStatus(result.rows.length, result.hasMore);
    this.setMoreVisible(result.hasMore);
  }

  renderEmpty(message) {
    if (!this.refs) {
      return;
    }
    this.refs.results.replaceChildren(
      createElement("div", { class: "zfh-empty", text: message }),
    );
  }

  buildRow(row) {
    const closed = row.closed === true;
    const unsafe = isBlockedUrl(row.url);

    const icon = createElement("img", {
      class: "zfh-row-icon",
      src: this.faviconFor(row),
      alt: "",
      decoding: "async",
    });
    let iconFailed = false;
    icon.addEventListener("error", () => {
      if (iconFailed) {
        return;
      }
      iconFailed = true;
      icon.src = ICON_FAVICON;
    });

    const main = createElement(
      "a",
      {
        class: "zfh-row-main",
        href: unsafe ? "#" : row.url,
        title: row.url,
        draggable: "true",
      },
      icon,
      createElement(
        "span",
        { class: "zfh-row-text" },
        createElement("span", {
          class: "zfh-row-title",
          text: row.title || row.url,
        }),
        createElement(
          "span",
          { class: "zfh-row-subtitle" },
          createElement("span", {
            class: "zfh-row-url",
            text: formatUrl(row.url),
          }),
          createElement("span", {
            class: "zfh-row-time",
            text: this.formatters.visit.format(row.time),
          }),
        ),
      ),
    );

    main.addEventListener("click", (event) => {
      event.preventDefault();
      this.openRow(row, event);
    });
    main.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        this.openRow(row, event);
      }
    });
    main.addEventListener("dragstart", (event) =>
      this.onRowDragStart(event, row),
    );

    const forget = createElement(
      "button",
      {
        class: "zfh-row-action",
        type: "button",
        "aria-label": closed ? "Forget closed tab" : "Remove from history",
        title: closed ? "Forget closed tab" : "Remove from history",
      },
      createElement("img", { src: ICON_TRASH, alt: "" }),
    );
    forget.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.forgetRow(row);
    });

    const reopen = createElement(
      "button",
      {
        class: "zfh-row-action",
        type: "button",
        "aria-label": closed ? "Restore closed tab" : "Open in a new tab",
        title: closed ? "Restore closed tab" : "Open in a new tab",
      },
      createElement("img", { src: ICON_REOPEN, alt: "" }),
    );
    reopen.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openRow(row, event);
    });

    return createElement(
      "div",
      { class: "zfh-row" },
      main,
      createElement("div", { class: "zfh-row-actions" }, forget, reopen),
    );
  }

  updateStatus(count, hasMore) {
    if (!this.refs) {
      return;
    }
    if (!count) {
      this.setStatus("No results");
      return;
    }
    const noun =
      this.state.source === "history"
        ? count === 1
          ? "entry"
          : "entries"
        : count === 1
          ? "tab"
          : "tabs";
    this.setStatus(`${count}${hasMore ? "+" : ""} ${noun}`);
  }

  setStatus(text) {
    if (this.refs && this.refs.status.textContent !== text) {
      this.refs.status.textContent = text;
    }
  }

  setMoreVisible(visible) {
    if (!this.refs) {
      return;
    }
    const hadFocus = this.document.activeElement === this.refs.more;
    this.refs.more.hidden = !visible;
    if (hadFocus && !visible) {
      this.focusResults();
    }
  }

  focusResults() {
    try {
      this.refs?.results.focus({ preventScroll: true });
    } catch (error) {
      /* panel may have closed */
    }
  }

  updateDatalist(rows) {
    if (!this.refs) {
      return;
    }
    const hosts = new Set();
    for (const row of rows) {
      const host = hostnameOf(row.url).replace(/^www\./, "");
      if (host && !host.startsWith("[")) {
        hosts.add(host);
      }
    }

    const sorted = [...hosts]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_DATALIST);
    const signature = sorted.join("\u0000");
    if (signature === this.lastDomainSignature) {
      return;
    }
    this.lastDomainSignature = signature;
    this.refs.domains.replaceChildren(
      ...sorted.map((value) => createElement("option", { value })),
    );
  }

  /* ---- row actions ----------------------------------------------------- */

  openRow(row, event) {
    const inBackground = Boolean(
      event?.getModifierState?.("Accel") || event?.button === 1,
    );

    if (row.closed) {
      this.restoreClosedTab(row, inBackground);
      return;
    }

    if (isBlockedUrl(row.url)) {
      this.setStatus("This link cannot be opened.");
      return;
    }

    try {
      window.openTrustedLinkIn(row.url, "tab", { inBackground });
    } catch (error) {
      this.warn("could not open history entry", error);
      this.setStatus("This link could not be opened.");
      return;
    }

    if (!inBackground) {
      this.close({ restoreFocus: false });
    }
  }

  restoreClosedTab(row, inBackground) {
    try {
      const SessionStore = getSessionStore();
      const selected = window.gBrowser?.selectedTab ?? null;
      SessionStore.undoCloseById(row.closedId, true, window);
      if (
        inBackground &&
        selected &&
        window.gBrowser?.selectedTab !== selected
      ) {
        window.gBrowser.selectedTab = selected;
      }
    } catch (error) {
      this.warn("could not restore closed tab", error);
      this.setStatus("This tab could not be restored.");
      return;
    }

    if (!inBackground) {
      this.close({ restoreFocus: false });
    }
  }

  forgetRow(row) {
    if (row.closed) {
      this.forgetClosedTab(row);
      return;
    }
    this.forgetHistory(row.url);
  }

  forgetClosedTab(row) {
    if (!Number.isFinite(Number(row.closedId))) {
      this.setStatus("This tab is no longer available.");
      return;
    }

    try {
      const SessionStore = getSessionStore();
      const result = SessionStore.forgetClosedTabById(row.closedId);
      Promise.resolve(result)
        .then(() => {
          if (!this.destroyed && this.isOpen) {
            this.refreshNow();
            this.focusResults();
          }
        })
        .catch((error) => {
          this.warn("could not forget closed tab", error);
          if (!this.destroyed) {
            this.setStatus("This tab could not be forgotten.");
          }
        });
    } catch (error) {
      this.warn("could not forget closed tab", error);
      this.setStatus("This tab could not be forgotten.");
    }
  }

  async forgetHistory(url) {
    try {
      await getPlacesUtils().history.remove(url);
    } catch (error) {
      this.warn("could not remove history entry", error);
      this.setStatus("This entry could not be removed.");
      return;
    }

    if (this.destroyed || !this.isOpen) {
      return;
    }
    this.refreshNow();
    this.focusResults();
  }

  onRowDragStart(event, row) {
    const data = event.dataTransfer;
    if (!data) {
      return;
    }
    const title = row.title || row.url;
    data.setData("text/x-moz-url", `${row.url}\n${title}`);
    data.setData("text/uri-list", row.url);
    data.setData("text/plain", row.url);
    data.effectAllowed = "copyLink";
    data.addElement(event.currentTarget);
  }

  /* ---- formatting ------------------------------------------------------ */

  formatSite(url) {
    const host = hostnameOf(url);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      return getBrowserUtils().formatURIStringForDisplay(url) || host;
    } catch (error) {
      return host;
    }
  }

  formatDay(timestamp) {
    const day = new Date(timestamp);
    const today = startOfLocalDay(new Date());
    const daysAgo = Math.round(
      (today.getTime() - day.getTime()) / MS_PER_DAY,
    );
    const text =
      daysAgo <= 6
        ? this.formatters.relativeDay.format(-daysAgo, "day")
        : this.formatters.day.format(day);
    return text.charAt(0).toLocaleUpperCase() + text.slice(1);
  }

  faviconFor(row) {
    if (row.image) {
      try {
        const PlacesUIUtils = getPlacesUIUtils();
        if (PlacesUIUtils?.getImageURL) {
          const iconUrl = PlacesUIUtils.getImageURL(row.image);
          if (iconUrl) {
            return iconUrl;
          }
        }
      } catch (error) {
        /* fall through to page-icon */
      }
    }
    return `page-icon:${row.url}`;
  }

  /* ---- keyboard -------------------------------------------------------- */

  focusableElements() {
    if (!this.panel) {
      return [];
    }
    return [
      ...this.panel.querySelectorAll(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    ].filter(
      (element) =>
        !element.hidden &&
        element.tabIndex >= 0 &&
        element.getClientRects().length > 0,
    );
  }

  onPanelKeyDown(event) {
    if (event.key !== "Tab") {
      return;
    }
    const focusables = this.focusableElements();
    if (!focusables.length) {
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.document.activeElement;
    const inside = this.panel?.contains(active);

    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ---- misc ------------------------------------------------------------ */

  listen(target, type, fn, options) {
    if (!target) {
      return;
    }
    target.addEventListener(type, fn, options);
    this.listeners.push({ target, type, fn, options });
  }
}

/* ======================================================================
 * Bootstrap
 * ==================================================================== */

const IS_BROWSER =
  typeof window !== "undefined" && typeof document !== "undefined";

if (IS_BROWSER) {
  try {
    window.__zenFlowHistory?.destroy?.();
  } catch (error) {
    /* a previous instance is already gone */
  }

  const history = new ZenFlowHistory();
  window.__zenFlowHistory = history;

  const start = () => {
    if (history.destroyed) {
      return;
    }
    try {
      if (typeof window.addUnloadListener === "function") {
        window.addUnloadListener(() => history.destroy());
      } else {
        history.listen(window, "unload", () => history.destroy(), {
          once: true,
        });
      }
    } catch (error) {
      console.warn("[Zen Flow] history: could not register unload hook", error);
    }

    try {
      history.init();
    } catch (error) {
      console.error("[Zen Flow] history: failed to start", error);
      history.destroy();
    }
  };

  if (document.readyState === "complete") {
    start();
  } else {
    /* Tracked so an unload before `load` cannot leave a callback behind. */
    history.listen(window, "load", start, { once: true });
  }
}
