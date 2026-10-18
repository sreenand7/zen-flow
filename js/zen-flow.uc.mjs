/* ===========================================================================
 * Zen Flow — core userscript
 * ---------------------------------------------------------------------------
 * Loaded by Sine into the browser chrome window
 * (`chrome://browser/content/browser.xhtml`).
 *
 * Responsibilities
 *   Feature 1  Drive the slim top loading bar (`#zen-flow-top-bar`).
 *   Feature 2  Tag loading tabs with `.zen-flow-loading` (animation is CSS).
 *   Feature 3  Publish `:root[zen-flow-blur]` so CSS can blur behind the
 *              URL bar popup. No other JS is involved.
 *   Feature 4  Inject the date / clock / message either into the real
 *              new-tab page, or into a chrome overlay above Zen's URL-bar
 *              new-tab popup.
 *
 * Design notes
 *   - Loading state is read from the tab's own `busy` / `progress`
 *     attributes. That is exactly what Zen's built-in indicator uses, so
 *     redirects, failed loads and rapid navigation can never leave the mod
 *     showing a stale "loading" state.
 *   - Only one clock timer exists, it is armed on the next minute boundary
 *     and it is stopped entirely while no clock is on screen.
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
  const ATTR_REDUCE_MOTION = "zen-flow-reduce-motion";

  /* --- Preferences ------------------------------------------------------ */
  const PREF_MESSAGE = "zen-flow.message";
  const PREF_SHOW_CLOCK = "zen-flow.show-clock";
  const PREF_TOP_BAR = "zen-flow.show-top-bar";
  const PREF_ANIMATE_TABS = "zen-flow.animate-loading-tabs";
  const PREF_HIDE_NATIVE = "zen-flow.hide-native-loading-bar";
  const PREF_BLUR = "zen-flow.blur-behind-popup";
  const PREF_DEBUG = "zen-flow.debug";

  const DEFAULT_MESSAGE = "Make today count.";

  const ALL_PREFS = [
    PREF_MESSAGE,
    PREF_SHOW_CLOCK,
    PREF_TOP_BAR,
    PREF_ANIMATE_TABS,
    PREF_HIDE_NATIVE,
    PREF_BLUR,
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

    /* Bookkeeping so `destroy()` can be exhaustive. */
    listeners: [],
    contentListeners: [],
    observers: [],
    timeouts: new Set(),
    tabSyncQueued: false,
    tickTimeout: null,
    prefObserver: null,

    prefs: null,

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

      if (this.prefs.topBar) {
        this.createTopBar();
      }

      this.observeTabs();
      this.watchClockTriggers();
      this.listen(window, "TabSelect", () => this.onTabChanged());
      this.listen(window, "TabClose", () => this.onTabChanged());
      this.listen(window, "TabAttrModified", () => this.scheduleTabSync());
      this.listen(window, "resize", () => this.positionClocks());
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

      this.removePageClock();
      this.destroyOverlay();

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
      this.documentElement?.removeAttribute(ATTR_REDUCE_MOTION);

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
        topBar: prefBool(PREF_TOP_BAR, true),
        animateTabs: prefBool(PREF_ANIMATE_TABS, true),
        hideNative: prefBool(PREF_HIDE_NATIVE, true),
        blur: prefBool(PREF_BLUR, true),
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
        return window.gReduceMotion === true;
      } catch (error) {
        return false;
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

      /* The URL bar popup opening and closing. */
      const urlbar = this.document.getElementById("urlbar");
      if (urlbar) {
        const urlbarObserver = new MutationObserver(() => this.resolveClock());
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
      } else {
        this.warn(
          "#urlbar was not found, so the new-tab clock cannot follow the URL bar popup"
        );
      }

      /* A page finishing its load can turn a still-parsing new-tab document
         into one we are allowed to write into. */
      this.listen(window, "pageshow", () => this.resolveClock());
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
      const observer = new MutationObserver((records) => {
        let loadingChanged = false;
        let emptyTabChanged = false;

        for (const record of records) {
          if (record.type !== "attributes") {
            loadingChanged = true;
          } else if (record.attributeName === "zen-empty-tab") {
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
        childList: true,
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

      let tabs = [];
      try {
        tabs = Array.from(this.gBrowser.tabs ?? []);
      } catch (error) {
        tabs = [];
      }

      const animate = this.prefs?.animateTabs ?? true;
      for (const tab of tabs) {
        const loading = animate && this.isTabLoading(tab);
        tab.classList.toggle(CLASS_LOADING, loading);
      }

      const selected = this.gBrowser.selectedTab;
      this.setTopBarActive(this.isTabLoading(selected));
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
          this.hideOverlay();
        } else {
          /* The new-tab page runs in a separate privileged process in most
             builds, which makes `contentDocument` unavailable. Fall back to a
             chrome overlay positioned over the empty content area. */
          this.removePageClock();
          this.showOverlay("content");
        }
        this.scheduleTick();
        return;
      }

      this.removePageClock();

      /* Surface B: Zen's new-tab popup. Zen's own flow always opens the URL bar
         expanded, so that is the preferred anchor; if it is collapsed we float
         the clock over the content area rather than losing it. */
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
     * [INTERNAL] Is the URL bar currently acting as Zen's new-tab page?
     *
     * Zen's `ZenUrlbarController.handleNewTab()` puts `zen-newtab` on the URL
     * bar, then opens it in breakout mode; `handleUrlbarClose()` removes it
     * again. `breakout-extend` is Firefox's own flag for the expanded URL bar
     * panel. Those two together are the authoritative "the new-tab popup is
     * open" state, and they are checked first.
     *
     * As a fallback we accept Zen's *empty tab* — the persistent placeholder
     * tab that every space and folder keeps, marked `zen-empty-tab` on the tab
     * itself and mirrored onto the window root as `zen-has-empty-tab` by
     * `ZenSpaceManager` — with the URL bar expanded, which is how the empty tab
     * looks on startup.
     */
    isZenNewTabPopup() {
      const urlbar = this.document.getElementById("urlbar");
      if (!urlbar) {
        return false;
      }

      const expanded =
        urlbar.hasAttribute("breakout-extend") ||
        urlbar.hasAttribute("open") ||
        urlbar.getAttribute("open") === "true";
      if (!expanded) {
        return false;
      }

      if (urlbar.hasAttribute("zen-newtab")) {
        return true;
      }

      const selected = this.gBrowser?.selectedTab;
      return (
        selected?.hasAttribute("zen-empty-tab") === true ||
        this.documentElement?.getAttribute("zen-has-empty-tab") === "true"
      );
    },

    /**
     * Where the new-tab clock should sit, or `null` when none should be shown.
     *
     * @returns {"urlbar"|"content"|null} `"urlbar"` anchors the clock just above
     *   the expanded URL bar popup (Zen's normal new-tab layout);
     *   `"content"` floats it over the empty content area, which is what is
     *   left when the empty tab is selected but the URL bar is not expanded.
     */
    newTabClockAnchor() {
      /* Zen draws its first-run welcome screen over everything; stay out of the
         way of it (Zen's own new-tab code does the same check). */
      if (this.documentElement?.hasAttribute("zen-welcome-stage")) {
        return null;
      }

      const selected = this.gBrowser?.selectedTab;
      const emptyTab =
        selected?.hasAttribute("zen-empty-tab") === true ||
        this.documentElement?.getAttribute("zen-has-empty-tab") === "true";

      if (this.isZenNewTabPopup()) {
        return "urlbar";
      }

      return emptyTab ? "content" : null;
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

      /* Keep the clock glued above the search box if the page ever scrolls or
         resizes. */
      const view = doc.defaultView;
      if (view) {
        this.listenContent(view, "resize", () => this.positionPageClock(), {
          passive: true,
        });
        this.listenContent(view, "scroll", () => this.positionPageClock(), {
          passive: true,
          capture: true,
        });
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
    },

    hideOverlay() {
      this.overlayVisible = false;
      if (this.overlayEl) {
        this.overlayEl.dataset.visible = "false";
      }
    },

    destroyOverlay() {
      this.overlayVisible = false;
      this.overlayEl?.remove();
      this.overlayEl = null;
      this.overlayRefs = null;
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

      const now = new Date();
      const dateText = this.formatters.date.format(now);
      const timeText = this.formatters.time.format(now);
      const message = this.prefs?.message || DEFAULT_MESSAGE;

      const targets = [];
      if (this.pageClock?.panel?.isConnected) {
        targets.push(this.pageClock);
      }
      if (this.overlayVisible && this.overlayRefs?.panel?.isConnected) {
        targets.push(this.overlayRefs);
      }

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
