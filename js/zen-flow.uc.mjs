/* ===========================================================================
 * Zen Flow — core userscript
 * ---------------------------------------------------------------------------
 * Loaded by Sine into the browser chrome window
 * (`chrome://browser/content/browser.xhtml`).
 *
 * Responsibilities
 *   Feature 1  Drive the slim top loading bar (`#zen-flow-top-bar`).
 *   Feature 2  Tag loading tabs with `.zen-flow-loading` (animation is CSS).
 *   Feature 3  Publish `:root[zen-flow-blur]` and
 *              `:root[zen-flow-popup-open]` so CSS can blur the page behind
 *              the URL bar popup.
 *   Feature 4  Inject the date / clock / message either into the real
 *              new-tab page, or into a chrome overlay above Zen's URL-bar
 *              new-tab popup.
 *   Feature 5  Publish the selected tab's loading state as a `data-` attribute
 *              on the content container, so CSS can run a very small
 *              scale-down / ease-back while a page loads.
 *
 * Design notes
 *   - Loading state is read from the tab's own `busy` / `progress`
 *     attributes. That is exactly what Zen's built-in indicator uses, so
 *     redirects, failed loads and rapid navigation can never leave the mod
 *     showing a stale "loading" state.
 *   - Only one clock timer exists, it is armed on the next minute boundary
 *     and it is stopped entirely while no clock is on screen.
 *   - Nothing polls. The tab observer is limited to three attributes and does
 *     not watch structural changes, so Zen's own tab animations and tab-group
 *     churn never wake this script.
 *   - Everything this file creates is removed by `destroy()`, which is
 *     registered with Sine's unload hook.
 * =========================================================================== */

(() => {
  "use strict";

  const XHTML_NS = "http://www.w3.org/1999/xhtml";

  /* --- Identifiers ------------------------------------------------------ */
  const ID_TOP_BAR = "zen-flow-top-bar";
  const ID_PAGE_CLOCK = "zen-flow-clock";
  const ID_OVERLAY_CLOCK = "zen-flow-clock-overlay";
  const CLASS_LOADING = "zen-flow-loading";
  const ATTR_HIDE_NATIVE = "zen-flow-hide-native";
  const ATTR_BLUR = "zen-flow-blur";
  const ATTR_POPUP = "zen-flow-popup-open";
  const ATTR_TAB_ANIMATION = "zen-flow-tab-animation";
  const ATTR_REDUCE_MOTION = "zen-flow-reduce-motion";
  const ATTR_PAGE_ZOOM = "zen-flow-page-zoom";

  /* --- Preferences ------------------------------------------------------ */
  const PREF_MESSAGE = "zen-flow.message";
  const PREF_SHOW_CLOCK = "zen-flow.show-clock";
  const PREF_CLOCK_COLOR = "zen-flow.clock-color";
  const PREF_TOP_BAR = "zen-flow.show-top-bar";
  const PREF_BAR_OFFSET = "zen-flow.bar-offset";
  const PREF_BAR_COLOR_A = "zen-flow.bar-color-a";
  const PREF_BAR_COLOR_B = "zen-flow.bar-color-b";
  const PREF_BAR_COLOR_C = "zen-flow.bar-color-c";
  const PREF_BAR_GLOW = "zen-flow.bar-glow";
  const PREF_ANIMATE_TABS = "zen-flow.animate-loading-tabs";
  const PREF_TAB_ANIMATION = "zen-flow.tab-animation";
  const PREF_TAB_COLOR_A = "zen-flow.tab-color-a";
  const PREF_TAB_COLOR_B = "zen-flow.tab-color-b";
  const PREF_HIDE_NATIVE = "zen-flow.hide-native-loading-bar";
  const PREF_BLUR = "zen-flow.blur-behind-popup";
  const PREF_PAGE_ZOOM = "zen-flow.page-zoom";
  const PREF_PAGE_ZOOM_AMOUNT = "zen-flow.page-zoom-amount";
  const PREF_DEBUG = "zen-flow.debug";

  const DEFAULT_MESSAGE = "Make today count.";

  /* Must match the fallbacks in userChrome.css and preferences.json. */
  const DEFAULT_BAR_OFFSET = 3;
  const MAX_BAR_OFFSET = 48;
  const TAB_ANIMATIONS = new Set(["pulse", "rotate", "static"]);

  /* Page-load zoom. The scale is expressed as a multiplier and the transition
     is entirely in CSS; this side only owns the state machine. The fallback is
     deliberately a little longer than the 350 ms transition so a missed
     `transitionend` can never leave the attribute behind. */
  const PAGE_ZOOM_AMOUNTS = new Set(["0.99", "0.98", "0.97"]);
  const DEFAULT_PAGE_ZOOM = "0.98";
  const PAGE_ZOOM_SETTLE_FALLBACK_MS = 500;
  /* A transform event shorter than this can only belong to the shorter
     "start" transition. Without this guard, a queued start-transition event
     that lands just after the state changes to "settle" would remove the
     attribute and snap the content back instead of easing it. */
  const PAGE_ZOOM_SETTLE_MIN_EVENT_MS = 250;

  /* Preference -> custom property. The property names are the public
     customisation surface documented in the README. */
  const COLOR_PREFS = [
    [PREF_BAR_COLOR_A, "--zen-flow-bar-color-a"],
    [PREF_BAR_COLOR_B, "--zen-flow-bar-color-b"],
    [PREF_BAR_COLOR_C, "--zen-flow-bar-color-c"],
    [PREF_BAR_GLOW, "--zen-flow-bar-glow"],
    [PREF_TAB_COLOR_A, "--zen-flow-tab-color-a"],
    [PREF_TAB_COLOR_B, "--zen-flow-tab-color-b"],
  ];

  /* Every custom property this script may write inline on `:root`. Used by
     `destroy()` so unloading leaves the window exactly as it was found. */
  const ROOT_STYLE_PROPERTIES = [
    ...COLOR_PREFS.map(([, property]) => property),
    "--zen-flow-bar-top",
    "--zen-flow-clock-color",
    "--zen-flow-page-zoom-scale",
  ];

  const ALL_PREFS = [
    PREF_MESSAGE,
    PREF_SHOW_CLOCK,
    PREF_CLOCK_COLOR,
    PREF_TOP_BAR,
    PREF_BAR_OFFSET,
    PREF_BAR_COLOR_A,
    PREF_BAR_COLOR_B,
    PREF_BAR_COLOR_C,
    PREF_BAR_GLOW,
    PREF_ANIMATE_TABS,
    PREF_TAB_ANIMATION,
    PREF_TAB_COLOR_A,
    PREF_TAB_COLOR_B,
    PREF_HIDE_NATIVE,
    PREF_BLUR,
    PREF_PAGE_ZOOM,
    PREF_PAGE_ZOOM_AMOUNT,
    PREF_DEBUG,
  ];

  /* Firefox mirrors the operating system's reduced-motion request into this
     preference (0 = never, 1 = follow the OS, 2 = always reduce, 3 = never
     reduce). Watching it lets us honour a user who overrides the OS setting. */
  const PREF_REDUCE_MOTION = "ui.prefersReducedMotion";
  const OBSERVED_PREFS = [...ALL_PREFS, PREF_REDUCE_MOTION];

  /* URIs that count as "the new-tab page". */
  const NEW_TAB_URIS = new Set(["about:newtab", "about:home"]);

  /* Where to look for "the search box" on a new-tab page, best first. If none
     of these exist we fall back to a fraction of the viewport height. */
  const NEW_TAB_ANCHORS = [
    ".search-wrapper",
    "#newtab-search-text",
    "input[type='search']",
    ".outer-wrapper .search-handoff-button",
  ];

  /* ======================================================================
   * Small helpers
   * ==================================================================== */

  const prefBool = (name, fallback) => {
    try {
      return Services.prefs.getBoolPref(name, fallback);
    } catch (error) {
      return fallback;
    }
  };

  const prefString = (name, fallback) => {
    try {
      return Services.prefs.getCharPref(name, fallback);
    } catch (error) {
      return fallback;
    }
  };

  /* ======================================================================
   * ZenFlow
   * ==================================================================== */

  const ZenFlow = {
    destroyed: false,
    initialised: false,

    /* Referenced DOM */
    document: null,
    documentElement: null,
    gBrowser: null,
    topBar: null,
    overlayEl: null,
    overlayRefs: null,
    overlayVisible: false,
    overlayAnchor: "urlbar",
    pageClock: null,
    pendingPageDoc: null,

    /* Feature 5 — content container and its one-shot settle state. */
    tabpanels: null,
    zoomTab: null,
    pageZoomTimer: null,
    reducedMotionQuery: null,

    /* Bookkeeping so `destroy()` can be exhaustive. */
    listeners: [],
    contentListeners: [],
    observers: [],
    timeouts: new Set(),
    tabSyncQueued: false,
    positionQueued: false,
    positionFrame: null,
    tickTimeout: null,
    prefObserver: null,

    /* Last logged clock decision, so debug output does not repeat itself. */
    lastClockLog: null,

    prefs: null,
    clockColor: "",

    /* ====================================================================
     * Lifecycle
     * ================================================================== */

    init() {
      if (this.destroyed) {
        return;
      }

      this.document = window.document;
      this.documentElement = this.document.documentElement;
      this.gBrowser = window.gBrowser ?? null;

      if (!this.gBrowser || !this.documentElement) {
        this.warn("browser window is not ready; Zen Flow did not start");
        return;
      }

      this.formatters = {
        date: new Intl.DateTimeFormat(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
        time: new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      this.readPrefs();
      this.applyPrefAttributes();
      this.applyVisualPrefs();

      if (this.prefs.topBar) {
        this.createTopBar();
      }

      if (this.prefs.pageZoom && !this.ensurePageZoomTarget()) {
        this.warn(
          "could not find #tabbrowser-tabpanels; page-load zoom is disabled",
        );
      }

      this.observeTabs();
      this.watchClockTriggers();
      this.listen(window, "TabSelect", () => this.onTabChanged());
      this.listen(window, "TabClose", () => this.onTabChanged());
      /* `TabOpen` catches tabs that are inserted already loading (session
         restore, "open link in new tab"). There is deliberately no
         `TabAttrModified` listener: the observer above already sees `busy` and
         `progress`, and `TabAttrModified` also fires for every label, icon and
         sound attribute, which would double the work for no benefit. */
      this.listen(window, "TabOpen", () => this.onTabChanged());
      this.listen(window, "resize", () => this.schedulePositionUpdate());
      this.observePrefs();

      this.syncTabs();
      this.resolveClock();
      this.initialised = true;
      this.log("ready");
    },

    /**
     * Fully reverts everything this script changed. Safe to call twice, and
     * registered with Sine's `window.addUnloadListener` hook so it also runs
     * when the mod is disabled, uninstalled or the window closes.
     */
    destroy() {
      if (this.destroyed) {
        return;
      }
      this.destroyed = true;

      for (const observer of this.observers) {
        try {
          observer.disconnect();
        } catch (error) {
          /* already detached */
        }
      }
      this.observers = [];

      for (const entry of this.listeners) {
        try {
          entry.target.removeEventListener(entry.type, entry.fn, entry.options);
        } catch (error) {
          /* target may be gone */
        }
      }
      this.listeners = [];

      this.clearContentListeners();

      for (const name of OBSERVED_PREFS) {
        try {
          Services.prefs.removeObserver(name, this.prefObserver);
        } catch (error) {
          /* observer was never registered */
        }
      }
      this.prefObserver = null;

      for (const id of this.timeouts) {
        clearTimeout(id);
      }
      this.timeouts.clear();

      if (this.tickTimeout) {
        clearTimeout(this.tickTimeout);
        this.tickTimeout = null;
      }

      if (this.positionFrame) {
        window.cancelAnimationFrame(this.positionFrame);
        this.positionFrame = null;
      }
      this.positionQueued = false;

      this.removePageClock();
      this.destroyOverlay();
      this.clearPageZoom();
      this.tabpanels = null;
      this.reducedMotionQuery = null;

      this.topBar?.remove();
      this.topBar = null;

      try {
        for (const tab of this.gBrowser?.tabs ?? []) {
          tab.classList.remove(CLASS_LOADING);
        }
      } catch (error) {
        /* window is tearing down */
      }

      this.documentElement?.removeAttribute(ATTR_HIDE_NATIVE);
      this.documentElement?.removeAttribute(ATTR_BLUR);
      this.documentElement?.removeAttribute(ATTR_POPUP);
      this.documentElement?.removeAttribute(ATTR_TAB_ANIMATION);
      this.documentElement?.removeAttribute(ATTR_REDUCE_MOTION);

      try {
        for (const property of ROOT_STYLE_PROPERTIES) {
          this.documentElement?.style.removeProperty(property);
        }
      } catch (error) {
        /* window is tearing down */
      }

      if (window.__zenFlow === this) {
        delete window.__zenFlow;
      }

      this.log("destroyed");
    },

    /* ====================================================================
     * Logging
     * ================================================================== */

    log(...args) {
      if (prefBool(PREF_DEBUG, false)) {
        console.log("[Zen Flow]", ...args);
      }
    },

    warn(...args) {
      console.warn("[Zen Flow]", ...args);
    },

    /* ====================================================================
     * Preferences
     * ================================================================== */

    readPrefs() {
      this.prefs = {
        message: prefString(PREF_MESSAGE, DEFAULT_MESSAGE) || DEFAULT_MESSAGE,
        showClock: prefBool(PREF_SHOW_CLOCK, true),
        clockColor: prefString(PREF_CLOCK_COLOR, "").trim(),
        topBar: prefBool(PREF_TOP_BAR, true),
        barOffset: prefString(PREF_BAR_OFFSET, String(DEFAULT_BAR_OFFSET)),
        barColorA: prefString(PREF_BAR_COLOR_A, "").trim(),
        barColorB: prefString(PREF_BAR_COLOR_B, "").trim(),
        barColorC: prefString(PREF_BAR_COLOR_C, "").trim(),
        barGlow: prefString(PREF_BAR_GLOW, "").trim(),
        animateTabs: prefBool(PREF_ANIMATE_TABS, true),
        tabAnimation: prefString(PREF_TAB_ANIMATION, "pulse").trim(),
        tabColorA: prefString(PREF_TAB_COLOR_A, "").trim(),
        tabColorB: prefString(PREF_TAB_COLOR_B, "").trim(),
        hideNative: prefBool(PREF_HIDE_NATIVE, true),
        blur: prefBool(PREF_BLUR, true),
        pageZoom: prefBool(PREF_PAGE_ZOOM, true),
        pageZoomAmount: prefString(
          PREF_PAGE_ZOOM_AMOUNT,
          DEFAULT_PAGE_ZOOM,
        ).trim(),
      };
    },

    /**
     * Publishes the purely-CSS features (blur + native-bar suppression) as
     * attributes on `:root`, which is what userChrome.css keys off.
     */
    applyPrefAttributes() {
      const root = this.documentElement;
      if (!root) {
        return;
      }

      /* NOTE: the value must literally be "true" — userChrome.css matches
         `:root[zen-flow-...="true"]`. toggleAttribute() would write "" and the
         selectors would never match. */
      const setFlag = (name, enabled) => {
        if (enabled) {
          root.setAttribute(name, "true");
        } else {
          root.removeAttribute(name);
        }
      };

      setFlag(ATTR_HIDE_NATIVE, this.prefs.hideNative);
      setFlag(ATTR_BLUR, this.prefs.blur);
      /* Zen's own reduced-motion state. Honouring it here means the animations
         stop for someone who asked Zen to reduce motion even if the OS-level
         media query does not fire, and it keeps working when this script is
         not running because the media query is still in the stylesheet. */
      setFlag(ATTR_REDUCE_MOTION, this.wantsReducedMotion());
    },

    /** True when the browser has been asked to reduce motion. */
    wantsReducedMotion() {
      try {
        if (window.gReduceMotion === true) {
          return true;
        }
      } catch (error) {
        /* not a browser window */
      }
      try {
        if (!this.reducedMotionQuery) {
          this.reducedMotionQuery =
            window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
        }
        return this.reducedMotionQuery?.matches === true;
      } catch (error) {
        return false;
      }
    },

    /**
     * Applies the *value* preferences (colours, bar offset, tab animation) as
     * custom properties and attributes on `:root`. The stylesheets keep the
     * defaults; this only overrides what the user actually set, and removing a
     * value silently restores the stylesheet default.
     */
    applyVisualPrefs() {
      const root = this.documentElement;
      if (!root || !this.prefs) {
        return;
      }

      const colors = [
        ["--zen-flow-bar-color-a", this.prefs.barColorA],
        ["--zen-flow-bar-color-b", this.prefs.barColorB],
        ["--zen-flow-bar-color-c", this.prefs.barColorC],
        ["--zen-flow-bar-glow", this.prefs.barGlow],
        ["--zen-flow-tab-color-a", this.prefs.tabColorA],
        ["--zen-flow-tab-color-b", this.prefs.tabColorB],
      ];

      for (const [property, value] of colors) {
        if (!value) {
          root.style.removeProperty(property);
          continue;
        }
        if (this.isColor(value)) {
          root.style.setProperty(property, value);
        } else {
          root.style.removeProperty(property);
          this.warn(`ignoring invalid colour for ${property}: ${value}`);
        }
      }

      const offset = Number.parseInt(this.prefs.barOffset, 10);
      const clamped = Number.isFinite(offset)
        ? Math.min(MAX_BAR_OFFSET, Math.max(0, offset))
        : DEFAULT_BAR_OFFSET;
      root.style.setProperty("--zen-flow-bar-top", `${clamped}px`);

      const animation = TAB_ANIMATIONS.has(this.prefs.tabAnimation)
        ? this.prefs.tabAnimation
        : "pulse";
      if (root.getAttribute(ATTR_TAB_ANIMATION) !== animation) {
        root.setAttribute(ATTR_TAB_ANIMATION, animation);
      }

      const zoomAmount = PAGE_ZOOM_AMOUNTS.has(this.prefs.pageZoomAmount)
        ? this.prefs.pageZoomAmount
        : DEFAULT_PAGE_ZOOM;
      root.style.setProperty("--zen-flow-page-zoom-scale", zoomAmount);

      this.applyClockColor();
    },

    /** True when `value` is something the CSS engine accepts as a colour. */
    isColor(value) {
      try {
        return typeof CSS !== "undefined" && typeof CSS.supports === "function"
          ? CSS.supports("color", value)
          : true;
      } catch (error) {
        return false;
      }
    },

    /**
     * The clock colour lives on `:root` for the chrome overlay, and is copied
     * onto the injected panel for the real new-tab page, where userContent.css
     * reads it from the panel itself (an inline value beats the sheet's
     * `:root` fallback).
     */
    applyClockColor() {
      const root = this.documentElement;
      if (!root) {
        return;
      }

      const value = this.prefs?.clockColor ?? "";
      if (value && this.isColor(value)) {
        this.clockColor = value;
        root.style.setProperty("--zen-flow-clock-color", value);
      } else {
        this.clockColor = "";
        root.style.removeProperty("--zen-flow-clock-color");
        if (value) {
          this.warn(`ignoring invalid clock colour: ${value}`);
        }
      }

      this.applyPageClockColor();
    },

    /** Mirrors the clock colour onto the in-page clock, if it exists. */
    applyPageClockColor() {
      const panel = this.pageClock?.panel;
      if (!panel) {
        return;
      }
      if (this.clockColor) {
        panel.style.setProperty("--zen-flow-clock-color", this.clockColor);
      } else {
        panel.style.removeProperty("--zen-flow-clock-color");
      }
    },

    observePrefs() {
      this.prefObserver = {
        observe: (subject, topic, data) => {
          if (topic === "nsPref:changed") {
            this.onPrefChanged(data);
          }
        },
      };

      for (const name of OBSERVED_PREFS) {
        try {
          Services.prefs.addObserver(name, this.prefObserver);
        } catch (error) {
          this.warn(`could not observe ${name}`, error);
        }
      }
    },

    /**
     * Sine writes preferences straight to `about:config` without reloading our
     * script, so react to changes live instead of requiring a restart.
     */
    onPrefChanged(name) {
      if (this.destroyed) {
        return;
      }

      this.readPrefs();
      this.applyPrefAttributes();
      this.applyVisualPrefs();

      if (this.prefs.topBar) {
        if (!this.topBar) {
          this.createTopBar();
        }
      } else {
        this.topBar?.remove();
        this.topBar = null;
      }

      this.syncTabs();
      this.resolveClock();

      if (!this.prefs.showClock) {
        /* Do not leave an invisible clock element sitting in the window. */
        this.destroyOverlay();
        this.removePageClock();
      }

      if (name === PREF_MESSAGE) {
        this.renderClock();
        /* A different message can mean a different panel height, so re-anchor
           the clocks to whatever they are attached to. */
        this.positionClocks();
      }
    },

    /* ====================================================================
     * Feature 1 — slim top loading bar
     * ================================================================== */

    /**
     * Everything that can change which clock (if any) belongs on screen.
     * All of it is event driven — nothing in this mod polls.
     */
    watchClockTriggers() {
      /* `zen-has-empty-tab` is mirrored onto the window root by Zen's space
         manager whenever the selected tab becomes the empty tab, and
         `zen-welcome-stage` marks Zen's first-run welcome screen, which the
         clock must stay clear of. */
      const rootObserver = new MutationObserver(() => this.resolveClock());
      rootObserver.observe(this.documentElement, {
        attributes: true,
        attributeFilter: ["zen-has-empty-tab", "zen-welcome-stage"],
      });
      this.observers.push(rootObserver);

      /* The URL bar popup opening and closing. A single observer drives both
         the clock anchor and the Feature 3 blur flag. */
      const urlbar = this.document.getElementById("urlbar");
      if (urlbar) {
        const syncUrlbarState = () => {
          /* Mirror the expanded state. Writing the attribute only when it
             changes avoids a needless style invalidation on every open/close
             and on every unrelated attribute we observe. */
          const popupOpen = urlbar.hasAttribute("breakout-extend")
            ? "true"
            : "false";
          if (this.documentElement.getAttribute(ATTR_POPUP) !== popupOpen) {
            this.documentElement.setAttribute(ATTR_POPUP, popupOpen);
          }
          this.resolveClock();
        };

        const urlbarObserver = new MutationObserver(syncUrlbarState);
        urlbarObserver.observe(urlbar, {
          attributes: true,
          attributeFilter: [
            "breakout-extend",
            "open",
            "has-popup-open",
            "zen-newtab",
          ],
        });
        this.observers.push(urlbarObserver);
        syncUrlbarState();
      } else {
        this.warn(
          "#urlbar was not found, so the new-tab clock cannot follow the URL bar popup"
        );
      }

      /* A page finishing its load can turn a still-parsing new-tab document
         into one we are allowed to write into. `pageshow` does not reach the
         chrome window on its own, so it is captured on the tab browser. */
      this.listen(this.gBrowser, "pageshow", () => this.resolveClock(), true);
    },

    createTopBar() {
      if (this.topBar?.isConnected) {
        return;
      }

      const bar = this.document.createElementNS(XHTML_NS, "div");
      bar.id = ID_TOP_BAR;
      bar.setAttribute("aria-hidden", "true");
      bar.dataset.active = "false";

      this.documentElement.appendChild(bar);
      this.topBar = bar;
    },

    setTopBarActive(active) {
      if (!this.topBar) {
        return;
      }
      const next = active ? "true" : "false";
      if (this.topBar.dataset.active !== next) {
        this.topBar.dataset.active = next;
      }
    },

    /* ====================================================================
     * Features 1 + 2 — tab loading state
     * ================================================================== */

    /** True when the given tab is currently navigating or loading. */
    isTabLoading(tab) {
      return (
        !!tab && (tab.hasAttribute("busy") || tab.hasAttribute("progress"))
      );
    },

    observeTabs() {
      const scope =
        this.document.getElementById("tabbrowser-tabs") ?? this.documentElement;

      /* Loading attributes and `zen-empty-tab` share one observer, but only the
         loading ones (which Firefox updates repeatedly while a page loads) are
         coalesced; a change to `zen-empty-tab` re-resolves the clock straight
         away instead, because that is what decides whether the clock shows. */
      /* Only attributes are observed. `childList` on the tab strip meant that
         every DOM change Zen makes (tab groups, drag and drop, labels,
         animations) woke this callback; `TabOpen` / `TabClose` already cover
         structural changes. `attributeFilter` keeps the remaining traffic to
         the three attributes this script actually reads. */
      const observer = new MutationObserver((records) => {
        let loadingChanged = false;
        let emptyTabChanged = false;

        for (const record of records) {
          if (record.attributeName === "zen-empty-tab") {
            emptyTabChanged = true;
          } else {
            loadingChanged = true;
          }
        }

        if (loadingChanged) {
          this.scheduleTabSync();
        }
        if (emptyTabChanged) {
          this.resolveClock();
        }
      });

      observer.observe(scope, {
        subtree: true,
        attributes: true,
        attributeFilter: ["busy", "progress", "zen-empty-tab"],
      });

      this.observers.push(observer);
    },

    /** Coalesces bursts of mutations into one sync per task. */
    scheduleTabSync() {
      if (this.tabSyncQueued || this.destroyed) {
        return;
      }
      this.tabSyncQueued = true;

      const id = window.setTimeout(() => {
        this.timeouts.delete(id);
        this.tabSyncQueued = false;
        if (!this.destroyed) {
          this.syncTabs();
        }
      }, 0);

      this.timeouts.add(id);
    },

    /** The selected tab, or the set of tabs, changed. */
    onTabChanged() {
      this.syncTabs();
      this.resolveClock();
    },

    /**
     * Mirrors the real loading state of every tab onto our own class, and the
     * loading state of the *selected* tab onto the top bar.
     */
    syncTabs() {
      if (this.destroyed) {
        return;
      }

      const animate = this.prefs?.animateTabs ?? true;
      try {
        const tabs = this.gBrowser.tabs ?? [];
        for (let index = 0; index < tabs.length; index++) {
          const tab = tabs[index];
          const loading = animate && this.isTabLoading(tab);
          tab.classList.toggle(CLASS_LOADING, loading);
        }
      } catch (error) {
        /* window is tearing down */
      }

      const selected = this.gBrowser.selectedTab;
      const loading = this.isTabLoading(selected);
      this.setTopBarActive(loading);
      this.updatePageZoom(loading, selected);
    },

    /* ====================================================================
     * Feature 5 — subtle page-load zoom
     * ================================================================== */

    /**
     * Resolves the element that really contains web content. In Zen this is
     * `#tabbrowser-tabpanels`: it excludes the chrome, both sidebars and the
     * Library, and it is a child of the element that carries the URL-bar blur,
     * so the two effects never share the same box.
     *
     * The transition listener is installed once per resolved element and
     * tracked in `listeners`, so `destroy()` removes it with everything else.
     */
    ensurePageZoomTarget() {
      if (this.tabpanels?.isConnected) {
        return this.tabpanels;
      }

      let element = null;
      try {
        element = this.gBrowser?.tabpanels ?? null;
      } catch (error) {
        element = null;
      }
      if (!element) {
        try {
          element =
            this.document?.getElementById("tabbrowser-tabpanels") ?? null;
        } catch (error) {
          element = null;
        }
      }
      if (!element) {
        return null;
      }

      this.tabpanels = element;
      this.listen(element, "transitionend", (event) =>
        this.onPageZoomTransitionEnd(event),
      );
      return element;
    },

    /**
     * The selected tab's real `busy` / `progress` state drives the attribute.
     *
     * `"true"`      while that tab is loading (CSS scales the content down)
     * `"settle"`    for the ~350 ms ease-back after it finishes
     * (no attribute) at rest
     *
     * Only the *selected* tab can drive the zoom: when the selection moves to
     * a tab that is not loading, the old tab's effect is removed immediately
     * instead of animating the newly visible content.
     */
    updatePageZoom(loading, tab) {
      if (this.destroyed) {
        return;
      }
      if (!this.prefs?.pageZoom || this.wantsReducedMotion()) {
        this.clearPageZoom();
        return;
      }

      const element = this.ensurePageZoomTarget();
      if (!element) {
        return;
      }

      const state = element.getAttribute(ATTR_PAGE_ZOOM);

      if (loading) {
        if (this.zoomTab === tab && state === "true") {
          return;
        }
        this.cancelPageZoomSettle();
        this.zoomTab = tab;
        if (state !== "true") {
          element.setAttribute(ATTR_PAGE_ZOOM, "true");
        }
        return;
      }

      /* A later pass for the *same* tab must not cut the settle short by
         removing the attribute, which would snap the transform to 1. */
      if (this.zoomTab === tab) {
        if (state === "true") {
          this.settlePageZoom();
        }
        return;
      }

      /* The selection moved to a non-loading tab (or there is no active
         zoom): drop the previous tab's state at once. */
      this.clearPageZoom();
    },

    /** Starts the ease-back and arms a fallback in case no event arrives. */
    settlePageZoom() {
      const element = this.tabpanels;
      if (!element) {
        this.clearPageZoom();
        return;
      }

      if (element.getAttribute(ATTR_PAGE_ZOOM) === "true") {
        element.setAttribute(ATTR_PAGE_ZOOM, "settle");
      }

      this.cancelPageZoomSettle();
      this.pageZoomTimer = window.setTimeout(() => {
        this.pageZoomTimer = null;
        if (this.destroyed) {
          return;
        }
        try {
          if (this.tabpanels?.getAttribute(ATTR_PAGE_ZOOM) === "settle") {
            this.tabpanels.removeAttribute(ATTR_PAGE_ZOOM);
            this.zoomTab = null;
          }
        } catch (error) {
          /* window is tearing down */
        }
      }, PAGE_ZOOM_SETTLE_FALLBACK_MS);
    },

    cancelPageZoomSettle() {
      if (this.pageZoomTimer) {
        clearTimeout(this.pageZoomTimer);
        this.pageZoomTimer = null;
      }
    },

    clearPageZoom() {
      this.cancelPageZoomSettle();
      this.zoomTab = null;
      try {
        this.tabpanels?.removeAttribute(ATTR_PAGE_ZOOM);
      } catch (error) {
        /* window is tearing down */
      }
    },

    /**
     * The settle transition has a known duration, so its end is the least
     * surprising moment to drop the attribute. The fallback timer above still
     * covers a missed event (for example when the transition never starts
     * because the scale was already 1).
     */
    onPageZoomTransitionEnd(event) {
      if (
        event.target !== this.tabpanels ||
        event.propertyName !== "transform" ||
        this.tabpanels?.getAttribute(ATTR_PAGE_ZOOM) !== "settle"
      ) {
        return;
      }
      /* Ignore a queued event from the 120 ms scale-down transition. */
      if (event.elapsedTime * 1000 < PAGE_ZOOM_SETTLE_MIN_EVENT_MS) {
        return;
      }
      this.cancelPageZoomSettle();
      this.tabpanels.removeAttribute(ATTR_PAGE_ZOOM);
      this.zoomTab = null;
    },

    /* ====================================================================
     * Feature 4 — date / clock / message
     * ================================================================== */

    /* ---- target resolution -------------------------------------------- */

    /** Called whenever something that could change the clock target moved. */
    resolveClock() {
      if (this.destroyed || !this.prefs) {
        return;
      }

      if (!this.prefs.showClock) {
        this.removePageClock();
        this.hideOverlay();
        this.scheduleTick();
        return;
      }

      const tab = this.gBrowser?.selectedTab;
      const browser = tab?.linkedBrowser ?? null;
      const uri = this.browserUri(browser);

      /* Surface A: the real new-tab page. */
      if (uri && NEW_TAB_URIS.has(uri)) {
        const doc = this.contentDocumentFor(browser);
        if (doc) {
          this.showPageClock(browser, doc);
        }

        /* Normally the page clock is connected by now. If the document was
           still parsing, or `contentDocument` pointed at a preloaded document
           that was about to be replaced, fall back to the chrome overlay
           rather than showing nothing at all. */
        if (this.pageClock?.panel?.isConnected) {
          this.log("clock surface: in-page");
          this.hideOverlay();
          this.scheduleTick();
          return;
        }

        this.removePageClock();
        this.log("clock surface: chrome overlay (contentDocument unavailable)");
        this.showOverlay("content");
        this.scheduleTick();
        return;
      }

      this.removePageClock();

      /* Surface B: Zen's new-tab popup. The URL bar is the preferred anchor;
         Zen's persistent empty tab can also be shown centred when the URL bar
         is collapsed. */
      const anchor = this.newTabClockAnchor();
      if (anchor) {
        this.showOverlay(anchor);
      } else {
        this.hideOverlay();
      }

      this.scheduleTick();
    },

    browserUri(browser) {
      try {
        const uri = browser?.currentURI?.spec;
        return uri ? uri.split("#")[0] : "";
      } catch (error) {
        return "";
      }
    },

    contentDocumentFor(browser) {
      try {
        const doc = browser?.contentDocument;
        if (!doc || !doc.documentElement) {
          return null;
        }
        return doc;
      } catch (error) {
        return null;
      }
    },

    /**
     * [INTERNAL] Reads the markers Zen uses for "the URL bar is currently the
     * new-tab page".
     *
     *   `zen-newtab`      set by `ZenUrlbarController.handleNewTab()`, removed
     *                     in `handleUrlbarClose()`.
     *   `breakout-extend` Firefox's own "expanded URL bar panel" flag.
     *   `zen-empty-tab`   Zen's persistent empty tab (the real new-tab page at
     *                     startup), mirrored onto `:root` as
     *                     `zen-has-empty-tab` by `ZenSpaceManager`.
     *
     * `window.gURLBar.view.isOpen` is checked as well: it is the actual state
     * of the results panel, and it catches builds where the panel is open
     * before `breakout-extend` lands.
     */
    readNewTabState() {
      const urlbar = this.document.getElementById("urlbar");
      const selected = this.gBrowser?.selectedTab;
      const root = this.documentElement;

      let viewOpen = false;
      try {
        viewOpen = window.gURLBar?.view?.isOpen === true;
      } catch (error) {
        viewOpen = false;
      }

      return {
        zenNewTab: urlbar?.hasAttribute("zen-newtab") === true,
        expanded:
          viewOpen ||
          urlbar?.hasAttribute("breakout-extend") === true ||
          urlbar?.hasAttribute("open") === true,
        emptyTab:
          selected?.hasAttribute("zen-empty-tab") === true ||
          root?.getAttribute("zen-has-empty-tab") === "true",
        welcome: root?.hasAttribute("zen-welcome-stage") === true,
      };
    },

    /**
     * Where the new-tab clock should sit, or `null` when none should be shown.
     *
     * @returns {"urlbar"|"content"|null} `"urlbar"` anchors the clock just above
     *   the expanded URL bar popup (Zen's normal new-tab layout);
     *   `"content"` floats it over the empty content area, which is what the
     *   empty tab shows when the URL bar is not expanded.
     */
    newTabClockAnchor() {
      const state = this.readNewTabState();
      const anchor = this.resolveNewTabAnchor(state);
      this.logClockState(state, anchor);
      return anchor;
    },

    resolveNewTabAnchor({ welcome, zenNewTab, expanded, emptyTab }) {
      /* Zen draws its first-run welcome screen over everything; stay out of the
         way of it (Zen's own new-tab code does the same check). */
      if (welcome) {
        return null;
      }

      /* A URL-bar new-tab session. The clock belongs above the popup; if the
         popup is not expanded yet there is nothing to anchor it to, and
         Zen's replace-newtab mode is still showing the previous page, so
         showing a clock over that page would be wrong. */
      if (zenNewTab) {
        return expanded ? "urlbar" : null;
      }

      /* Zen's persistent empty tab: this is a real new-tab page, so the clock
         is valid whether or not the URL bar is expanded. */
      if (emptyTab) {
        return expanded ? "urlbar" : "content";
      }

      return null;
    },

    /** One debug line per state change, which is what makes a missing clock
     *  diagnosable without a debugger attached. */
    logClockState(state, anchor) {
      if (!prefBool(PREF_DEBUG, false)) {
        return;
      }
      const summary = JSON.stringify({ ...state, anchor });
      if (summary === this.lastClockLog) {
        return;
      }
      this.lastClockLog = summary;
      this.log("clock", summary);
    },

    /* ---- clock markup -------------------------------------------------- */

    buildClockPanel(ownerDocument) {
      const panel = ownerDocument.createElementNS(XHTML_NS, "div");
      panel.setAttribute("aria-hidden", "true");

      const date = ownerDocument.createElementNS(XHTML_NS, "div");
      date.className = "zen-flow-date";

      const time = ownerDocument.createElementNS(XHTML_NS, "div");
      time.className = "zen-flow-time";

      const message = ownerDocument.createElementNS(XHTML_NS, "div");
      message.className = "zen-flow-message";

      panel.append(date, time, message);

      return { panel, date, time, message };
    },

    /* ---- surface A: injected into about:newtab / about:home ---------- */

    showPageClock(browser, doc) {
      const current = this.pageClock;
      if (
        current &&
        current.doc === doc &&
        current.panel?.isConnected
      ) {
        this.positionPageClock();
        return;
      }

      this.removePageClock();

      if (!doc.body) {
        /* The document is still parsing; try again once it is done. Guarded so
           repeated resolve passes cannot pile up listeners. */
        if (this.pendingPageDoc !== doc) {
          this.pendingPageDoc = doc;
          this.listenContent(
            doc,
            "DOMContentLoaded",
            () => {
              this.pendingPageDoc = null;
              this.resolveClock();
            },
            { once: true }
          );
        }
        return;
      }
      this.pendingPageDoc = null;

      const clock = this.buildClockPanel(doc);
      clock.panel.id = ID_PAGE_CLOCK;

      /* Minimal inline layout, purely as a safety net in case Sine's content
         stylesheet does not reach privileged about: pages. Typography and
         colours still come from userContent.css. */
      Object.assign(clock.panel.style, {
        position: "fixed",
        left: "50%",
        top: "40%",
        transform: "translate(-50%, -100%)",
        zIndex: "5",
        pointerEvents: "none",
        textAlign: "center",
      });

      doc.body.appendChild(clock.panel);

      this.pageClock = { browser, doc, ...clock };
      this.applyPageClockColor();

      /* Keep the clock glued above the search box if the page ever scrolls or
         resizes. Both are coalesced to one layout pass per frame. */
      const view = doc.defaultView;
      if (view) {
        this.listenContent(
          view,
          "resize",
          () => this.schedulePositionUpdate(),
          { passive: true }
        );
        this.listenContent(
          view,
          "scroll",
          () => this.schedulePositionUpdate(),
          { passive: true, capture: true }
        );
      }

      /* Render before measuring: the panel's height is one of the inputs to its
         position, and it has no height until it has content. */
      this.renderClock();
      this.positionPageClock();
    },

    removePageClock() {
      const clock = this.pageClock;
      this.pageClock = null;

      if (clock) {
        try {
          clock.panel?.remove();
        } catch (error) {
          /* document already gone */
        }
      }

      /* The only content listeners this mod ever adds belong to the page
         clock, so clearing them all here is both correct and leak-proof. */
      this.clearContentListeners();
      this.pendingPageDoc = null;
    },

    /**
     * Sits the clock just above the new-tab page's own search box, falling
     * back to a fraction of the viewport if the search box is not found.
     * [INTERNAL] the `NEW_TAB_ANCHORS` selectors are new-tab page internals.
     */
    positionPageClock() {
      const clock = this.pageClock;
      if (!clock?.panel?.isConnected) {
        return;
      }

      const { doc, panel } = clock;
      const view = doc.defaultView;
      if (!view) {
        return;
      }

      let anchor = null;
      for (const selector of NEW_TAB_ANCHORS) {
        try {
          anchor = doc.querySelector(selector);
        } catch (error) {
          anchor = null;
        }
        if (anchor) {
          break;
        }
      }

      let left;
      let bottom;

      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        const gap = 28;
        left = rect.left + rect.width / 2;
        bottom = rect.top - gap;

        /* Not enough room above the search box: drop the clock below it
           instead of clipping it against the top of the window. */
        const height = panel.getBoundingClientRect().height || 120;
        if (bottom - height < 16) {
          bottom = rect.bottom + gap + height;
        }
      } else {
        left = view.innerWidth / 2;
        bottom = Math.round(view.innerHeight * 0.4);
      }

      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(bottom)}px`;
    },

    /* ---- surface B: chrome overlay above the URL-bar popup ------------ */

    ensureOverlay() {
      if (this.overlayEl?.isConnected) {
        return this.overlayEl;
      }

      const clock = this.buildClockPanel(this.document);
      const panel = clock.panel;
      panel.id = ID_OVERLAY_CLOCK;
      panel.dataset.visible = "false";

      this.documentElement.appendChild(panel);

      this.overlayEl = panel;
      this.overlayRefs = clock;
      return panel;
    },

    showOverlay(anchor) {
      const panel = this.ensureOverlay();
      this.overlayAnchor = anchor;
      this.overlayVisible = true;
      panel.dataset.visible = "true";
      /* Render before measuring: the panel's height is one of the inputs to its
         position, and it has no height until it has content. */
      this.renderClock();
      this.positionOverlay();

      if (prefBool(PREF_DEBUG, false)) {
        const rect = panel.getBoundingClientRect();
        this.log(
          "clock overlay",
          JSON.stringify({
            anchor,
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            color: window.getComputedStyle(panel).color,
          })
        );
      }
    },

    hideOverlay() {
      this.overlayVisible = false;
      if (this.overlayEl && this.overlayEl.dataset.visible !== "false") {
        this.overlayEl.dataset.visible = "false";
      }
    },

    destroyOverlay() {
      this.overlayVisible = false;
      this.overlayEl?.remove();
      this.overlayEl = null;
      this.overlayRefs = null;
    },

    /**
     * Coalesces resize / scroll bursts into one layout pass per frame. A raw
     * listener would run several `querySelector` calls and two layout reads for
     * every event while the window is being dragged.
     */
    schedulePositionUpdate() {
      if (this.positionQueued || this.destroyed) {
        return;
      }
      this.positionQueued = true;
      this.positionFrame = window.requestAnimationFrame(() => {
        this.positionFrame = null;
        this.positionQueued = false;
        if (!this.destroyed) {
          this.positionClocks();
        }
      });
    },

    positionClocks() {
      this.positionPageClock();
      if (this.overlayVisible) {
        this.positionOverlay();
      }
    },

    positionOverlay() {
      const panel = this.overlayEl;
      if (!panel?.isConnected || !this.overlayVisible) {
        return;
      }

      const height = panel.getBoundingClientRect().height || 140;

      if (this.overlayAnchor === "urlbar") {
        const urlbar = this.document.getElementById("urlbar");
        const rect = urlbar?.getBoundingClientRect();

        /* Anchor the clock's bottom edge just above the popup. If the popup
           sits too close to the top of the window, fall back to centring the
           clock over the empty content area instead. */
        if (rect && rect.height > 0 && rect.top - height - 14 >= 16) {
          panel.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
          panel.style.top = `${Math.round(rect.top - 14)}px`;
          return;
        }
      }

      const box =
        this.document.getElementById("tabbrowser-tabbox") ??
        this.document.getElementById("tabbrowser-tabpanels");
      const boxRect = box?.getBoundingClientRect();

      if (boxRect && boxRect.height > 0) {
        panel.style.left = `${Math.round(boxRect.left + boxRect.width / 2)}px`;
        panel.style.top = `${Math.round(
          boxRect.top + Math.max(24, boxRect.height * 0.22) + height
        )}px`;
        return;
      }

      panel.style.left = `${Math.round(this.documentElement.clientWidth / 2)}px`;
      panel.style.top = `${Math.round(this.documentElement.clientHeight * 0.3)}px`;
    },

    /* ---- rendering + scheduling ---------------------------------------- */

    renderClock() {
      if (this.destroyed || !this.formatters) {
        return;
      }

      /* Collect the targets first: formatting a date is not free, and there is
         no reason to do it when no clock is on screen. */
      const targets = [];
      if (this.pageClock?.panel?.isConnected) {
        targets.push(this.pageClock);
      }
      if (this.overlayVisible && this.overlayRefs?.panel?.isConnected) {
        targets.push(this.overlayRefs);
      }
      if (!targets.length) {
        return;
      }

      const now = new Date();
      const dateText = this.formatters.date.format(now);
      const timeText = this.formatters.time.format(now);
      const message = this.prefs?.message || DEFAULT_MESSAGE;

      for (const target of targets) {
        if (target.date.textContent !== dateText) {
          target.date.textContent = dateText;
        }
        if (target.time.textContent !== timeText) {
          target.time.textContent = timeText;
        }
        if (target.message.textContent !== message) {
          target.message.textContent = message;
        }
      }
    },

    /**
     * Arms a single timer aimed at the next minute boundary. While no clock is
     * on screen there is no timer at all, so an idle browser costs nothing.
     */
    scheduleTick() {
      if (this.tickTimeout) {
        clearTimeout(this.tickTimeout);
        this.tickTimeout = null;
      }

      if (this.destroyed || !this.prefs?.showClock) {
        return;
      }

      const hasClock =
        this.pageClock?.panel?.isConnected ||
        (this.overlayVisible && this.overlayRefs?.panel?.isConnected);

      if (!hasClock) {
        return;
      }

      this.renderClock();

      const now = new Date();
      const msToNextMinute =
        (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;

      this.tickTimeout = setTimeout(
        () => {
          this.tickTimeout = null;
          this.renderClock();
          this.scheduleTick();
        },
        Math.max(1000, msToNextMinute)
      );
    },

    /* ====================================================================
     * Listener bookkeeping
     * ================================================================== */

    listen(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      this.listeners.push({ target, type, fn, options });
    },

    listenContent(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      this.contentListeners.push({ target, type, fn, options });
    },

    clearContentListeners(doc = null) {
      this.contentListeners = this.contentListeners.filter((entry) => {
        if (doc && entry.target !== doc) {
          return true;
        }
        try {
          entry.target.removeEventListener(entry.type, entry.fn, entry.options);
        } catch (error) {
          /* document already gone */
        }
        return false;
      });
    },
  };

  /* ======================================================================
   * Bootstrap
   * ==================================================================== */

  /* If a previous instance is still alive in this window (Sine re-imports
     scripts with a cache-busting query), tear it down first so we never end up
     with duplicated elements, observers or timers. */
  try {
    window.__zenFlow?.destroy?.();
  } catch (error) {
    /* ignore */
  }

  window.__zenFlow = ZenFlow;

  const start = () => {
    if (ZenFlow.destroyed) {
      return;
    }
    /* One clock timer / DOM tree per window, and one unload hook per script
       load. `addUnloadListener` must be called with a single argument so Sine
       can derive this script's own `chrome://` path from the call site. */
    try {
      if (typeof window.addUnloadListener === "function") {
        window.addUnloadListener(() => ZenFlow.destroy());
      } else {
        window.addEventListener("unload", () => ZenFlow.destroy(), {
          once: true,
        });
      }
    } catch (error) {
      console.warn("[Zen Flow] could not register the unload hook", error);
    }

    ZenFlow.init();
  };

  if (window.document.readyState === "complete") {
    start();
  } else {
    window.addEventListener("load", start, { once: true });
  }
})();
