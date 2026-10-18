# Zen Flow

A small, self-contained [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that adds four subtle quality-of-life
touches.

| # | Feature | Where |
|---|---------|-------|
| 1 | Slim, centred loading bar at the top edge of the window | `userChrome.css` + userscript |
| 2 | Animated outline around each tab that is loading | `userChrome.css` + userscript |
| 3 | Blur behind the URL bar / new-tab search popup | `userChrome.css` only |
| 4 | Date, live clock and a fixed message on new tabs | `userContent.css` + userscript |

The message defaults to **“Make today count.”** and is changeable from Sine's
settings UI (see [Configuration](#configuration)).

---

## 1. Requirements

- **Zen Browser** — a reasonably recent build (Firefox 128 or newer for the
  animatable `@property` angle used by the tab ring; older builds still work but
  the ring does not rotate).
- **[Sine](https://github.com/CosmoCreeper/Sine)** installed
  (`Zen Flow` is a Sine mod; it is not a Zen "native" mod, so Zen's own
  *Settings → Mods* page cannot install it).
- A **public GitHub repository** whose default branch is `main`.
- Sine's **“Allow external/unsafe JavaScript”** setting enabled
  (see step 3 below). This is mandatory: Sine only executes JavaScript from
  non-marketplace mods when that toggle is on.

---

## 2. Repository layout

This repository root **is** the mod folder. Sine downloads the repository zip
and unpacks it directly as the mod directory, so nothing may be nested under an
extra folder:

```
zen-flow/                    <- repository root = mod folder
├── theme.json               <- mod manifest (Sine reads this first)
├── preferences.json         <- settings shown in Sine's UI
├── userChrome.css           <- browser-UI styles  (loaded as a user sheet)
├── userContent.css          <- page styles        (loaded as a user sheet)
├── js/
│   └── zen-flow.uc.mjs      <- the only JavaScript file
├── README.md
├── LICENSE
└── .gitignore
```

The `scripts` key in `theme.json` is the file's **real path relative to this
root** (`js/zen-flow.uc.mjs`). Renaming or moving the file requires updating
that key to match, or Sine will fail to load it.

---

## 3. Installation

### 3.1 With the Sine interface (recommended)

1. Make sure this repository is pushed to GitHub and is **public**.
2. Open Zen, go to Zen's **Settings → Sine** (Sine injects its own section).
3. Open Sine's mod installation field and enter your repository in
   `username/repo` format, for example:

   ```
   yourname/zen-flow
   ```

   To install a branch other than `main`, use `username/repo/tree/branch`.

4. Sine downloads `theme.json`, fetches the repository zip and unpacks it into
   `<profile>/chrome/sine-mods/zen-flow/`.
5. Enable **Zen Flow** in Sine's mod list.
6. Open Sine's settings and turn on **“Allow external/unsafe JavaScript”**
   (`sine.allow-unsafe-js`). Without this, Sine deliberately skips the
   `js/zen-flow.uc.mjs` script and only the CSS features will work.
7. **Restart Zen.** A restart is required after enabling JavaScript mods.

> Why the extra toggle exists: Sine only auto-runs JavaScript from mods it
> considers verified (marketplace origin). Anything installed directly from a
> GitHub repository has to be explicitly trusted by you. That is a security
> feature, not a bug — read the script before enabling it.

### 3.2 Enabling the mod's JavaScript manually (without Sine)

If you would rather not use Sine, this mod also works with the classic
`userChromeJS` layout: copy `userChrome.css` into
`<profile>/chrome/userChrome.css`, `userContent.css` into
`<profile>/chrome/userContent.css`, and `js/zen-flow.uc.mjs` into your
`userChromeJS` script loader's directory. This path is not maintained or tested
by this project — Sine is the supported installation method.

### 3.3 Uninstalling

Remove the mod from Sine (or disable it). `js/zen-flow.uc.mjs` registers a
cleanup hook with Sine, so disabling the mod removes the top bar, the clock, the
loading-tab classes, the observers and the timer **without** a restart. If your
build does not run unload hooks, restart Zen to clear everything.

---

## 4. Configuration

Open **Sine → Zen Flow → settings**. Every option is stored as a normal
`about:config` preference and takes effect immediately — no restart needed.

| Preference | Type | Default | Meaning |
|---|---|---|---|
| `zen-flow.message` | string | `Make today count.` | **The message under the clock. This is the one place to change it.** |
| `zen-flow.show-clock` | boolean | `true` | Show the date / clock / message on new tabs |
| `zen-flow.show-top-bar` | boolean | `true` | Slim top loading bar |
| `zen-flow.animate-loading-tabs` | boolean | `true` | Animated outline on loading tabs |
| `zen-flow.hide-native-loading-bar` | boolean | `true` | Hide Zen's own `#zen-loading-progress-bar` so you never see two indicators |
| `zen-flow.blur-behind-popup` | boolean | `true` | Blur the page behind the URL bar popup |
| `zen-flow.debug` | boolean | `false` | Extra logging to the Browser Console (advanced troubleshooting; not exposed in the settings UI) |

### 4.1 Showing the clock on real new tabs

Zen replaces the classic new-tab page with an expanded URL bar
(`zen.urlbar.replace-newtab`, default `true`). Zen Flow handles both cases:

- **Default Zen behaviour** — the clock is drawn as a chrome overlay directly
  **above the URL bar popup** that Zen shows on a new tab, so the search field
  stays below the text. Nothing else changes.
- **Classic new-tab page** — if you set `zen.urlbar.replace-newtab` to `false`
  in `about:config`, Zen shows the real `about:newtab` page and the clock is
  injected into that page, sitting just above its search box.

Either way the clock only appears on a new tab: it is never injected into
ordinary websites.

### 4.2 Visual tuning

Every colour, size and radius is a CSS custom property at the top of
`userChrome.css` (browser UI) and `userContent.css` (new-tab page). Notable
knobs:

| Variable | Default | File |
|---|---|---|
| `--zen-flow-bar-width` | `clamp(160px, 36vw, 640px)` | `userChrome.css` |
| `--zen-flow-bar-height` | `3px` | `userChrome.css` |
| `--zen-flow-bar-top` | `0px` | `userChrome.css` (raise it if the bar overlaps a top toolbar) |
| `--zen-flow-blur-radius` | `4px` | `userChrome.css` |
| `--zen-flow-ring-width` | `1.5px` | `userChrome.css` |
| `--zen-flow-clock-color` | `currentColor` / new-tab text colour | both |

---

## 5. Troubleshooting

**Nothing happens at all.**
Sine skipped the JavaScript. Open Sine's settings and enable **“Allow
external/unsafe JavaScript”**, then restart Zen. Only CSS features run without
it.

**The top loading bar never appears.**
It deliberately mirrors the *selected* tab's real loading state — the same
`busy` / `progress` attributes Zen's own indicator reads. Very fast loads may
finish before the bar's 170 ms fade-in completes. Check `zen-flow.show-top-bar`
is enabled.

**Two loading indicators.**
Zen's own `#zen-loading-progress-bar` is enabled
(`zen.view.enable-loading-indicator`). Leave
`zen-flow.hide-native-loading-bar` enabled, or turn Zen's own indicator off.

**No clock on new tabs.**
- Confirm `zen-flow.show-clock` is on.
- With Zen's default `zen.urlbar.replace-newtab = true`, the clock appears as an
  overlay above the URL bar popup. On very short windows there may be no room
  above the popup; the clock then re-anchors over the empty content area.
- If you use `about:newtab` and the clock is unstyled, Sine's content
  stylesheet is not reaching `about:newtab` on your build. The layout still
  works (positioning is set from JavaScript); report the Zen version if the
  typography matters to you.

**The clock text is hard to read on a bright wallpaper.**
Override `--zen-flow-clock-color` in `userContent.css`.

**Blur does not appear.**
- Check `zen-flow.blur-behind-popup` is enabled.
- `prefers-reduced-transparency: reduce` disables it on purpose.
- The blur targets `#tabbrowser-tabbox`, a Zen/Firefox internal container. If a
  Zen update renames it, update that selector in `userChrome.css` (it is marked
  `[INTERNAL]`).

**Something is broken and I want to see logs.**
Set `zen-flow.debug` to `true` in `about:config`, then open
`Ctrl` + `Shift` + `J` (Browser Console) and look for `[Zen Flow]`.

**How do I fully reset the mod?**
Disable it in Sine, or delete
`<profile>/chrome/sine-mods/zen-flow/` and remove the entry from
`<profile>/chrome/sine-mods/mods.json` while Zen is closed.

---

## 6. Zen internals this mod depends on

These are not public APIs. Each is used for a specific reason, and each is
isolated so it can be swapped in one place.

| Selector / attribute | Used for | File |
|---|---|---|
| `tab[busy]`, `tab[progress]` | The real loading state of a tab. Zen's own `ZenProgressBar.sys.mjs` tests exactly `tab.hasAttribute("busy") \|\| tab.hasAttribute("progress")`, so redirects, failures and rapid navigation cannot leave us stuck | `js/zen-flow.uc.mjs` |
| `#urlbar[zen-newtab]` | “The URL bar is standing in for a new-tab page.” Set in `ZenUrlbarController.handleNewTab()` and cleared in `handleUrlbarClose()`. This is the primary trigger for the new-tab clock | `js/zen-flow.uc.mjs` |
| `tab[zen-empty-tab]` | “This tab is Zen's persistent empty/new tab.” Read from the selected tab; used as the fallback trigger | `js/zen-flow.uc.mjs` |
| `:root[zen-has-empty-tab="true"]` | Zen's mirror of the above on the window root (set in `ZenSpaceManager` → `#changeToEmptyTab`, refreshed on `TabSelect` and on location change) | `js/zen-flow.uc.mjs` |
| `#urlbar[breakout-extend]` | “The URL bar popup is open” — drives the blur, and anchors the overlay clock | both |
| `#tabbrowser-tabbox` / `#tabbrowser-tabpanels` | The blurred background layer / overlay anchor | both |
| `.tab-background` | The element the loading ring is drawn on | `userChrome.css` |
| `#zen-loading-progress-bar` | Zen's built-in loading indicator, which we optionally hide. Zen already gates it behind `zen.view.enable-loading-indicator` (off by default) | `userChrome.css` |
| `.search-wrapper`, `#newtab-search-text` | Locating the new-tab search box; a 40 %-of-viewport fallback is used if none match | `js/zen-flow.uc.mjs` |

The tab ring is drawn with `.tab-background::after`, deliberately: Zen's tab
stylesheets only ever use `.tab-background::before` (two rules, both scoped to
`[visuallyselected]`), and Firefox's own tab styles use neither, so `::after` is
the one pseudo-element that cannot collide with existing styling.

Accessibility is respected throughout. Reduced motion is honoured through the
standard `prefers-reduced-motion: reduce` media query **and** through Zen's own
`gReduceMotion` state — which also follows Firefox's `ui.prefersReducedMotion`
preference, so a user who overrides the OS setting is still respected. When
motion is reduced, nothing moves: the loading bar keeps its full gradient, the
tab ring keeps its gradient arc, and both keep their cues without animation.
`prefers-reduced-transparency: reduce` disables the blur.

---

## 7. Pushing this to GitHub

From the project directory:

```bash
git init
git add .
git commit -m "feat: initial Zen Flow mod"
git branch -M main

# Create the repository and push in one step (requires the GitHub CLI):
gh repo create yourname/zen-flow --public --source . --push
```

Or manually:

```bash
git remote add origin https://github.com/yourname/zen-flow.git
git push -u origin main
```

Then install it in Sine by entering `yourname/zen-flow` in the install field.

### Updating an installed mod

Sine reads `theme.json` from the **default branch** every time it checks for
updates and re-downloads the repository zip. Bump `"version"` in `theme.json`,
commit and push — then run the update from Sine's mod list.

---

## 8. Verification status

Honesty matters more than a green checklist, so here is exactly what has been
verified and what has not.

### Verified against real source code

Everything below was read from the actual upstream sources, not from memory or
guesswork.

**Sine** (the installer and loader):

- The manifest schema, the `findFile` lookup by filename, the required `scripts`
  key format, the `supportsUnload` field and the valid preference types all come
  from Sine's own `src/core/manager.sys.mjs`, `src/core/utils.sys.mjs` and
  `src/services/module_loader.mjs`.
- `window.addUnloadListener(callback)` must be called with a single argument so
  Sine can derive the script's `chrome://` path from the call site — which is
  what this mod does.

**Zen Browser** (branch `dev`):

- `tab[busy]` / `tab[progress]` is exactly the test `ZenProgressBar.sys.mjs`
  uses to decide whether a tab is loading.
- `#urlbar[zen-newtab]` is set by `ZenUrlbarController.handleNewTab()` and
  cleared by `handleUrlbarClose()` — the authoritative “the URL bar is being
  used as the new-tab page” state.
- `tab[zen-empty-tab]` marks the persistent empty/new tab, and
  `ZenSpaceManager.#changeToEmptyTab()` mirrors it onto the window root as
  `zen-has-empty-tab`, refreshing on `TabSelect` and on location change.
- `#tabbrowser-tabbox` and `#urlbar[breakout-extend]` are both real and used by
  Zen's own stylesheets.
- `zen.urlbar.replace-newtab` really defaults to `true`
  (`ZenVerticalTabsManager` → `_canReplaceNewTab`).
- `#zen-loading-progress-bar` exists and is already hidden by Zen itself unless
  `zen.view.enable-loading-indicator` is enabled.
- `.tab-background` is never styled through `::after` by Zen or by Firefox, so
  the loading ring cannot collide with existing styling — this is the reason
  `::after` was chosen over `::before`.
- Zen's reduced-motion state is exposed as `window.gReduceMotion`, which is what
  the userscript bridges to `:root[zen-flow-reduce-motion="true"]`.

### Verified offline by script

A 90-check validation script was run against this repository. It:

- parses both JSON files and rejects unknown manifest keys;
- simulates Sine's `findFile()` on the exact zip layout Sine produces (the
  repository root renamed to the mod id) and confirms `userChrome.css`,
  `userContent.css` and `preferences.json` each resolve unambiguously;
- simulates Sine's `getScripts()` glob → regex conversion and confirms the
  script's `include` matches `chrome://browser/content/browser.xhtml` and does
  **not** match a web page;
- confirms the `scripts` key maps to a file that really exists;
- parses `js/zen-flow.uc.mjs` as an ES module with `node --check`;
- checks that every `:root` flag attribute the CSS matches by literal value is
  written with that literal value, and that class/attribute names agree between
  the JavaScript and both stylesheets;
- checks that every observer, preference observer, listener and element has a
  teardown path, and that no `setInterval` is used anywhere.

All 90 checks pass.

### Not verified — needs a running Zen install

These are the things no amount of reading source code can settle:

- How the four features actually **look** and feel.
- Whether `browser.contentDocument` is reachable for `about:newtab` on your
  build. If it is not (likely, since the page can run in a separate privileged
  process), the mod automatically uses the chrome overlay instead — worth
  eyeballing first.
- Whether Sine's content stylesheet reaches `about:newtab` with its typography.
  Layout is set from JavaScript either way, so the clock stays correctly
  positioned even if the typography does not arrive.
- Multi-tab, rapid-navigation, failed-load and popup open/close behaviour, and
  the absence of console errors or leaks.

Set `zen-flow.debug` to `true` and watch the Browser Console (`Ctrl` +
`Shift` + `J`) for `[Zen Flow]` messages while you work through this list:

1. **Install** via `yourname/zen-flow`, enable the mod, enable
   “Allow external/unsafe JavaScript”, restart Zen.
2. **Feature 1** — load a heavy page. The centred bar should fade in, sweep,
   and fade out. Then test a redirect (`http://` → `https://`), a page that
   fails to load, and Ctrl+R spam: the bar must never get stuck on.
3. **Feature 2** — open several tabs that are slow to load at once. Only the
   loading tabs should show a ring; tabs that are merely selected, hovered or
   audible must not.
4. **Feature 3** — focus the URL bar on a busy page. The page behind should
   blur while the popup, its text, icons and input stay perfectly sharp. Press
   `Esc`: the blur must disappear immediately. Then tab through and type to
   confirm focus, keyboard navigation and search are unaffected.
5. **Feature 4** — open a new tab: date, clock and message should appear above
   the search field, with the clock ticking from one minute to the next. Type
   into the search field — the clock must stay put and the popup must stay
   usable. Then visit `https://example.com` and confirm the clock is gone;
   check a second ordinary site too, and confirm there is never a duplicate
   clock. Change `zen-flow.message` in Sine's settings and confirm the new text
   appears immediately, without a restart.
6. **Cleanup** — disable the mod (not just the prefs). The bar, ring, blur and
   clock must all disappear with no restart, and the Browser Console must show
   no errors.
7. **Reduced motion** — turn on your OS's reduce-motion setting (or set
   `ui.prefersReducedMotion` to `2` in `about:config`) and reload. The bar and
   the ring should be visible but completely still.

If any of these misbehave, the README sections above plus `zen-flow.debug`
should make the cause obvious.

---

## 9. License

MIT — see [LICENSE](LICENSE).
