# Zen Flow

A small [Sine](https://github.com/CosmoCreeper/Sine) mod for [Zen Browser](https://zen-browser.app) that reworks the browser's loading indicators, adds a subtle page-load zoom, gives new tabs a live date, clock and message, and adds a standalone Advanced History panel.

- **Slim loading bar** — a glowing gradient segment that sweeps across the top of the window from left to right while the current tab is navigating, then disappears.
- **Loading-tab outline** — a thin gradient ring around every tab that is actually loading, on any number of tabs at once.
- **Page-load zoom** — the web content starts a fraction smaller while the selected tab loads and eases back to 100% when it finishes.
- **Blurred URL-bar backdrop** — the page behind the open URL-bar popup is blurred, while the popup, its text, icons and input stay sharp.
- **New-tab clock** — weekday, date, a large live clock and a short message on the new-tab page, with the search bar below.
- **Advanced History** — a searchable, filterable History and closed-tab panel, opened from the toolbar or with `Ctrl+Alt+H`.

The loading features are driven by the browser's own loading state, so redirects, failed loads and fast back-to-back navigation cannot leave an indicator stuck on. Nothing polls, and every animation stops when there is nothing to show. The history panel queries Places only when it is open and a filter changes.

## Requirements

- **Zen Browser**, reasonably recent (Firefox 128 or newer).
- **[Sine](https://github.com/CosmoCreeper/Sine)**, installed and working.
- **“Allow external/unsafe JavaScript”** enabled in Sine's settings.

That last point is not optional. Sine only runs scripts from mods outside its marketplace when that toggle is on; without it Zen Flow's styles still load, but the loading bar, tab outline, page zoom, clock and history panel do nothing.

## Installation

1. Open Sine and go to **Mods → Add mod**.
2. Enter this repository as `owner/zen-flow`, where `owner` is the GitHub account hosting this repository. The repository must be public.
   - If the default branch is not `main`, use `owner/zen-flow/tree/<branch>` instead.
3. In **Sine → Settings**, enable **Allow external/unsafe JavaScript**.
4. Restart Zen.

The mod is installed as `<profile>/chrome/sine-mods/zen-flow/`.

### Updating

Sine reads the version from `theme.json` and offers an update when the repository changes. If a newly added setting does not appear in the settings panel, remove the mod and add it again — Sine keeps a copy of `preferences.json` from the installed version.

## Settings

Everything is configurable from **Sine → Mods → Zen Flow → Settings**. The same preferences can be edited directly in `about:config`.

### New tab clock

| Setting | Pref | Default | Notes |
|---|---|---|---|
| Show the clock | `zen-flow.show-clock` | on | Date, clock and message on new tabs. |
| Message | `zen-flow.message` | `Make today count.` | The text under the clock. |
| Clock colour | `zen-flow.clock-color` | automatic | Any CSS colour. Empty follows the browser theme. |

### Top loading bar

| Setting | Pref | Default | Notes |
|---|---|---|---|
| Show the bar | `zen-flow.show-top-bar` | on | |
| Distance from the top | `zen-flow.bar-offset` | `3 px` | `0`–`12 px`, in 2–4 px steps. |
| Gradient stops | `zen-flow.bar-color-a`, `-b`, `-c` | `#4aa8ff`, `#6fe3ff`, `#a8f4ff` | Left, middle and right. |
| Glow | `zen-flow.bar-glow` | `rgba(90, 190, 255, 0.35)` | Any CSS colour, including `transparent`. |

The bar is a track, not a progress bar: it never fills up and it is never a stationary strip. Each pass takes about 1.3 seconds, repeated for as long as the tab is loading. When the load finishes the segment stops immediately and the track fades out. Only `transform` and `opacity` are animated, so the bar stays smooth without repainting.

If the system asks for reduced motion, the moving segment is replaced by a static gradient for as long as the tab loads — the cue stays, the movement does not.

### Loading tab outline

| Setting | Pref | Default | Notes |
|---|---|---|---|
| Outline loading tabs | `zen-flow.animate-loading-tabs` | on | |
| Animation | `zen-flow.tab-animation` | `pulse` | `pulse`, `rotate` or `static`. |
| Outline colours | `zen-flow.tab-color-a`, `-b` | `#4aa8ff`, `#6fe3ff` | Start and end of the gradient arc. |

`pulse` animates opacity only, which Firefox can run on the compositor. `rotate` animates the gradient angle and is noticeably heavier on the main thread, especially with several tabs loading at once. `static` keeps the gradient but stops all motion.

### Page loading

| Setting | Pref | Default | Notes |
|---|---|---|---|
| Zoom the page while it loads | `zen-flow.page-zoom` | on | Content only; the chrome, sidebars and Library never move. |
| Starting zoom | `zen-flow.page-zoom-amount` | `0.98` | `0.99`, `0.98` or `0.97`. |

The page starts at the chosen scale as soon as the selected tab reports that it is loading, and eases back to 100% over about 350 ms when the load finishes. It is a `transform` on the web-content container, so there is no layout shift, scrollbar or reflow. Redirects, rapid navigation, tab switches, reloads and Back/Forward all cancel or restart the effect from the real loading state; a tab that is not loading can never keep the old scale. The feature is skipped entirely when the system asks for reduced motion.

### URL bar

| Setting | Pref | Default | Notes |
|---|---|---|---|
| Blur the page behind the popup | `zen-flow.blur-behind-popup` | on | Disabled automatically when the system asks for reduced transparency. |
| Hide Zen's loading bar | `zen-flow.hide-native-loading-bar` | on | Avoids showing two indicators at once. |

### Advanced History

| Setting | Pref | Default | Notes |
|---|---|---|---|
| Show the toolbar button | `zen-flow.history-enabled` | on | The `Ctrl+Alt+H` shortcut works even when the button is hidden. |

Advanced History is a standalone panel. It reads Places and SessionStore directly and does not modify Zen's Library. Its toolbar entry point is labelled **Enhanced History** and uses a clock-and-magnifier icon, so it is not confused with Zen's own History button.

- **History** lists page visits and can remove individual URLs from history.
- **Closed tabs** lists the tabs closed in the current window and can restore or forget them.

Search matches the title, full URL, host and path fragments, case-insensitively; multiple words must all match. The From and To dates are inclusive local days, with presets for **Today**, **This week** (today plus the previous six days), **This month** (today plus the previous 29 days) and **All time**, plus **Clear dates**. The **Website** field accepts a full URL, a hostname, a bare word or free text:

- `https://www.github.com/issues?q=1` and `gist.github.com` are treated as domains. A domain includes its subdomains (`gist.github.com` matches `github.com`) but never a lookalike (`notgithub.com` and `github.com.example.org` do not).
- A bare word such as `github` matches any hostname containing it.
- Anything with spaces is passed to Places' normal search, because it may be a page title rather than a site.

The other filters combine: dates, website, search text and the active source. **Sort** offers Date, Site, Most visited and Last visited; Most visited is disabled for closed tabs. With a date filter, a page qualifies when it has a visit inside the range; the Site, Most visited and Last visited sorts then order the qualifying pages. **Clear filters** resets search, website, dates and sorting without changing the source. **Load more** adds another 100 rows.

Closed-tab rows display and filter by the time the tab was closed. The Last visited sort uses the page's last-access time instead, the same distinction Zen's Library makes.

Rows show a favicon, title, URL and time. Click a row to open it (or restore a closed tab); `Ctrl`/`Cmd`-click or middle-click opens a history link in the background. The hover actions remove a history entry or forget a closed tab, and open a link or restore a closed tab. **Done** or `Escape` closes the panel. The panel is a modal dialog with a focus trap, roving tabs, labelled controls and visible focus rings.

### Advanced

| Setting | Pref | Default | Notes |
|---|---|---|---|
| Debug logging | `zen-flow.debug` | off | Prints decisions from both scripts to the Browser Console. See [Troubleshooting](#troubleshooting). |

### Colours

Every colour field accepts any value Firefox understands: `#4aa8ff`, `rgb(74 168 255)`, `oklch(0.7 0.15 230)`, `transparent`, and so on. Values are validated with `CSS.supports("color", …)` before use; an invalid value is ignored (with a console warning) and the built-in default stays in place, so a typo cannot break the gradient.

## Customisation

The settings cover colours, position and animation style. Anything else lives in `userChrome.css` under the `Tunable knobs` block:

| Variable | Default | Purpose |
|---|---|---|
| `--zen-flow-bar-width` | `clamp(160px, 36vw, 640px)` | Bar length. |
| `--zen-flow-bar-height` | `3px` | Bar thickness. |
| `--zen-flow-bar-travel-duration` | `1300ms` | Time for one left-to-right pass. |
| `--zen-flow-ring-width` | `1.5px` | Thickness of the tab outline. |
| `--zen-flow-ring-pulse-duration` | `2.2s` | Speed of the pulse. |
| `--zen-flow-ring-duration` | `1.8s` | Speed of the rotating variant. |
| `--zen-flow-blur-radius` | `4px` | Blur behind the URL bar. |
| `--zen-flow-page-zoom-scale` | `0.98` | Starting page scale; the Sine setting writes this inline. |
| `--zen-flow-page-zoom-start-duration` | `120ms` | Time to reach the starting scale. |
| `--zen-flow-page-zoom-settle-duration` | `350ms` | Time to ease back to 100%. |
| `--zen-flow-clock-font` | system UI stack | Font used by both clocks. |

Values set by the settings UI are written as inline custom properties on `:root`, so they take precedence over anything in the stylesheet.

## Troubleshooting

### The styles work but the bar, outline, zoom, clock and history panel do nothing

Sine's **Allow external/unsafe JavaScript** setting is off. Turn it on in **Sine → Settings** and restart Zen.

### The clock does not appear on a new tab

Zen Flow shows the clock when Zen reports one of its new-tab states: a URL-bar new-tab session (`#urlbar[zen-newtab]`) or the persistent empty tab (`tab[zen-empty-tab]` / `:root[zen-has-empty-tab]`). A third-party new-tab extension that replaces these will not get a clock.

To see what the mod decided:

1. Open `about:config` and set `zen-flow.debug` to `true`.
2. Open the Browser Console with `Ctrl+Shift+J`.
3. Open a new tab and look for a line beginning `[Zen Flow] clock`.

The logged object reports `zenNewTab`, `emptyTab`, `expanded`, `welcome` and the chosen `anchor`. If `anchor` is `null`, none of Zen's markers were present on that build; please open an issue with the line.

### The clock is hard to read

Set **Clock colour** to something that contrasts with your wallpaper, or leave it empty to follow the theme. The clock is drawn above the page, so its readability depends on the background image more than on the browser theme.

### The page does not zoom while loading

- Very fast loads can finish before the smaller scale is painted; the effect is deliberately subtle.
- The system's reduced-motion setting skips it. So does **Zoom the page while it loads** being off.
- `0.99` is nearly invisible by design; `0.97` is the strongest option.
- If the Browser Console shows `could not find #tabbrowser-tabpanels`, the running build changed its content container. Turn the feature off and please open an issue with the build number; nothing else is affected.

### Advanced History is empty

- **History** reads the same Places database as Zen's Library, so a page missing from one is missing from both.
- **Closed tabs** only sees tabs closed in the current window during this session. Clearing session data, closing the window or restarting Zen removes them.
- Check the date range and the website field, then use **All time** or **Clear filters**. Both date ends are inclusive.
- The site filter is label-aware: `github.com` also matches `gist.github.com`, but not `notgithub.com` or `github.com.example.org`. A bare word matches hostnames only.

### `Ctrl+Alt+H` does not open Advanced History

Another application or the window manager may own the shortcut. Use the toolbar button instead, and check that **Show the Enhanced History button in the toolbar** is on. In a popup window without a nav bar, the shortcut still works.

### A removed history entry comes back

Removing a URL deletes its Places visits, but a page that is still open can record a new visit when it reloads or navigates. Zen's Library behaves the same way.

### I forgot a closed tab by mistake

Forgetting a closed tab is immediate and cannot be undone. Restoring a closed tab is a different action; it does not remove anything.

### Two loading indicators appear

Turn on **Hide Zen's built-in loading bar**, or disable Zen's own indicator with `zen.view.enable-loading-indicator` in `about:config`.

### The loading bar sits too close to the top (or overlaps a toolbar)

Raise **Distance from the top** to `4`, `6` or `8 px`. The bar never intercepts clicks, so it only affects what you see.

### A colour setting is ignored

The value is not a valid CSS colour. Check the Browser Console for `[Zen Flow] ignoring invalid colour…` and use a format such as `#4aa8ff` or `rgb(74 168 255)`.

### Zen feels slower while pages load

Switch **Outline animation** to `static`, and turn off **Blur the page behind the popup** if the URL bar feels heavy on integrated graphics. The `pulse` animation is already the low-cost option; `rotate` is deliberately marked as heavier.

### Settings changes have no effect

Sine reads `preferences.json` from the installed copy. Update or reinstall the mod, then reopen the settings panel.

## Compatibility

- **Zen Browser** only. Zen Flow is built for Zen's chrome, not plain Firefox, and declares `"fork": ["zen"]` in its manifest.
- **Firefox 128+**, for `light-dark()` and registered custom properties.
- Checked against the Zen `dev` source and the installed 1.23.4b build: the tab `busy`/`progress` attributes, `zen-newtab`, `zen-empty-tab`, `zen-has-empty-tab`, `zen-welcome-stage`, `#zen-loading-progress-bar`, `#tabbrowser-tabbox`, `#tabbrowser-tabpanels` and the live `prefers-reduced-motion` media query. Advanced History uses the public Places query API (`nsINavHistoryQuery` / `nsINavHistoryQueryOptions`), `SessionStore`, and `formatURIStringForDisplay` — the same platform APIs Zen's Library builds on. The exact selectors and where each one comes from are listed under [Zen internals](#zen-internals).

### Known limitations

- On builds where the real `about:newtab` page runs in a separate privileged process, `browser.contentDocument` is not reachable. Zen Flow then draws the clock as a chrome overlay positioned over the content area instead of inside the page. It looks the same, but it is not part of the page's DOM.
- Zen's new-tab implementation has changed between releases. The clock follows the markers available on the running build and falls back to a centred overlay when it can find the empty tab but not the expanded URL bar.
- Sine cannot unload background scripts, so both features ship as window scripts (`js/zen-flow.uc.mjs` and `js/zen-flow-history.uc.mjs`) loaded only into `browser.xhtml`. Each cleans up after itself through `window.addUnloadListener`, which is what makes `"supportsUnload": true` accurate.
- Closed tabs come from `SessionStore.getClosedTabData(window)`: only tabs closed in the current window, during this session. Other windows' closed tabs, synced tabs and tabs from previous sessions are not included. Zen's Library has the same scope.
- Advanced History is not a full Library replacement. It has no bookmarks/tags management, import/export or cross-window live refresh; it queries when it opens, when a filter changes and after an action.
- In Date mode, rows are deduplicated by URL and local day and show the newest visit in each group. Site, Most visited and Last visited use page-level Places rows: a date filter selects pages with at least one visit in the range, while the displayed time is the page's last visit. This matches Zen's Library.
- History dates are local days and both ends are inclusive. Changing the system timezone or clock changes what “today” means.
- The toolbar button is a plain per-window toolbar node rather than a CustomizableUI widget, so it cannot be dragged in the customization palette and it is re-added when a window loads. In single-toolbar mode it lives in Zen's sidebar header next to the other toolbar buttons; in every other layout it uses the nav bar. The shortcut is independent of the button setting.
- Page zoom transforms the content container. Pages with their own fixed-position overlays can shift by a pixel or two during the transition; the browser chrome never moves. A load that finishes before a frame is painted may not show a visible zoom.
- The mod does not modify any browser preferences other than the ones it owns under the `zen-flow.` prefix.

## How it works

- **Loading state** comes from the tab's own `busy` and `progress` attributes, the same test Zen's `ZenProgressBar` uses. A single `MutationObserver` watches those two attributes (plus `zen-empty-tab`) on the tab strip; `TabSelect`, `TabOpen` and `TabClose` cover structural changes. There is no timer and no progress API, which is why a failed load or a redirect cannot leave the bar or the zoom stuck.
- **Visuals** are entirely CSS. The script only publishes state: `zen-flow-loading` on tabs, `data-active` on the bar, `zen-flow-page-zoom` on the content panels, and `zen-flow-*` attributes / custom properties on `:root`.
- **Reduced motion** is read from the live `prefers-reduced-motion` media query and watched for changes. Firefox's `window.gReduceMotion` getter is not used: it is initialised to `true` during startup and only refreshed from the same query by a browser-window idle task, which runs after Sine has imported the mod. Trusting it would pause every animation on a fresh start until the mod was reloaded.
- **Page zoom** follows the selected tab only. While it is loading, the content container gets `zen-flow-page-zoom="true"`; when the load ends, the value becomes `"settle"` and the CSS eases the transform back to `1`. A `transitionend` listener removes the attribute, with a 500 ms fallback timer in case the transition never starts. Switching to a tab that is not loading clears it immediately, and reloading during the settling phase returns to `"true"`. Reduced motion skips the whole state machine.
- **Advanced History** builds its modal on first use. History rows come from bounded, synchronous Places queries: `RESULTS_AS_VISIT` for exact visit timestamps in Date mode, `RESULTS_AS_URI` for the page-level sorts. Domain filters use `domainIsHost = false` and then confirm the host with a label-aware post-check. Closed tabs are read from `SessionStore`. The panel debounces typing, keeps no database observers, and renders every string with `textContent`.
- **The clock** has one timer, armed for the next minute boundary and stopped completely while no clock is on screen. It is injected into the new-tab page when that document is reachable, and rendered as a chrome overlay otherwise.
- **Teardown** removes every element, listener, observer, timer and inline property both scripts created, so disabling the mod restores the window without a restart.

## Development

### Repository layout

The repository root **is** the mod folder. Sine downloads the repository zip and unpacks it directly as the mod directory, so nothing may be nested under an extra folder.

```
.
├── theme.json          # Sine manifest (id, version, script mapping)
├── preferences.json    # Settings shown in Sine
├── userChrome.css      # Browser chrome styles for every feature
├── userContent.css     # New-tab page clock
├── js/
│   ├── zen-flow.uc.mjs          # Core: bar, tab outline, page zoom, blur, clock
│   └── zen-flow-history.uc.mjs  # Advanced History panel
├── README.md
├── LICENSE
├── .gitignore
└── .gitattributes      # Forces LF line endings in the downloaded zip
```

`theme.json` maps both scripts and restricts each to `chrome://browser/content/browser.xhtml`. There is no `.sys.mjs` background module on purpose: Sine cannot unload those, which would make the mod's unload support a lie.

### Checks

```sh
node --check js/zen-flow.uc.mjs
node --check js/zen-flow-history.uc.mjs
node -e "JSON.parse(require('fs').readFileSync('theme.json')); JSON.parse(require('fs').readFileSync('preferences.json'))"
```

### Zen internals

<details>
<summary>Selectors and APIs this mod depends on</summary>

| Internal | Used for | Where it comes from |
|---|---|---|
| `tab[busy]`, `tab[progress]` | “Is this tab loading?” | The same test as `ZenProgressBar.sys.mjs`. |
| `tab[zen-empty-tab]` | Zen's persistent empty tab | `ZenFolders.mjs`, `Tabbrowser.sys.mjs` patch |
| `:root[zen-has-empty-tab="true"]` | Same, mirrored to the window | `ZenSpaceManager.#changeToEmptyTab()` |
| `#urlbar[zen-newtab]` | URL-bar new-tab session | `ZenUrlbarController.handleNewTab()` / `handleUrlbarClose()` |
| `#urlbar[breakout-extend]` | Expanded URL-bar popup | Firefox `UrlbarView` |
| `window.gURLBar.view.isOpen` | Results panel actually open | Firefox `UrlbarView` |
| `:root[zen-welcome-stage]` | Zen's first-run screen | `ZenWelcome.mjs` |
| `#zen-loading-progress-bar` | Zen's own loading bar | `zen-single-components.css` |
| `#tabbrowser-tabbox`, `#tabbrowser-tabpanels` | The web content area; the zoom only touches `#tabbrowser-tabpanels` | Firefox |
| `window.matchMedia("(prefers-reduced-motion: reduce)")` | Reduced-motion state, read live and watched for changes | Firefox media query; the same source as the CSS fallback and `ui.prefersReducedMotion` |
| `.tab-background::after` | Tab outline | Free: Zen only uses `::before` in `vertical-tabs.css`, and Firefox uses neither. |
| `nsINavHistoryQuery`, `nsINavHistoryQueryOptions` | History queries, date bounds, result type, sorting | Places' public query API |
| `RESULTS_AS_VISIT`, `RESULTS_AS_URI` | Exact visit rows vs page-level rows | Places' public query API |
| `SessionStore.getClosedTabData(window)` | Closed tabs for the current window | Firefox session store, the same source Zen's Library uses |
| `SessionStore.undoCloseById`, `SessionStore.forgetClosedTabById` | Restore and forget closed tabs | Firefox session store |
| Closed-tab `closedAt`, `lastAccessed` | Display/filter time and the Last visited sort | Firefox session store |
| `formatURIStringForDisplay` | Site labels in Site sort and the website suggestions | `BrowserUtils.sys.mjs`, the same helper Zen's Library uses |
| `PlacesUtils.history.remove` | Remove a history URL | Places' public API |
| `page-icon:` | Row favicons | Firefox |
| `#nav-bar-customization-target`, `#zen-sidebar-top-buttons-customization-target` | Where the history button is appended | Firefox nav bar, Zen's single-toolbar sidebar header |
| `openTrustedLinkIn` | Open a history row in a new tab | Firefox browser window |

`window.addUnloadListener(fn)` is Sine's unload hook; it must be called with a single argument so Sine can derive the script path from the caller.

</details>

## License

MIT. See [LICENSE](LICENSE).
