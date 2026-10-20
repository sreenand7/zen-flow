# Zen Flow

A small [Sine](https://github.com/CosmoCreeper/Sine) mod for [Zen Browser](https://zen-browser.app) that reworks the browser's loading indicators and gives new tabs a live date, clock and message.

- **Slim loading bar** — a glowing gradient segment that sweeps across the top of the window from left to right while the current tab is navigating, then disappears.
- **Loading-tab outline** — a thin gradient ring around every tab that is actually loading, on any number of tabs at once.
- **Blurred URL-bar backdrop** — the page behind the open URL-bar popup is blurred, while the popup, its text, icons and input stay sharp.
- **New-tab clock** — weekday, date, a large live clock and a short message on the new-tab page, with the search bar below.

All four are driven by the browser's own loading state, so redirects, failed loads and fast back-to-back navigation cannot leave an indicator stuck on. Nothing polls, and every animation stops when there is nothing to show.

## Requirements

- **Zen Browser**, reasonably recent (Firefox 128 or newer).
- **[Sine](https://github.com/CosmoCreeper/Sine)**, installed and working.
- **“Allow external/unsafe JavaScript”** enabled in Sine's settings.

That last point is not optional. Sine only runs scripts from mods outside its marketplace when that toggle is on; without it Zen Flow's styles still load, but the loading bar, tab outline and clock do nothing.

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

### URL bar

| Setting | Pref | Default | Notes |
|---|---|---|---|
| Blur the page behind the popup | `zen-flow.blur-behind-popup` | on | Disabled automatically when the system asks for reduced transparency. |
| Hide Zen's loading bar | `zen-flow.hide-native-loading-bar` | on | Avoids showing two indicators at once. |

### Advanced

| Setting | Pref | Default | Notes |
|---|---|---|---|
| Debug logging | `zen-flow.debug` | off | Prints clock and overlay decisions to the Browser Console. See [Troubleshooting](#troubleshooting). |

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
| `--zen-flow-clock-font` | system UI stack | Font used by both clocks. |

Values set by the settings UI are written as inline custom properties on `:root`, so they take precedence over anything in the stylesheet.

## Troubleshooting

### The styles work but the bar, outline and clock do nothing

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
- Verified against the Zen `dev` source: the tab `busy`/`progress` attributes, `zen-newtab`, `zen-empty-tab`, `zen-has-empty-tab`, `zen-welcome-stage`, `#zen-loading-progress-bar`, `#tabbrowser-tabbox` and `window.gReduceMotion`. The exact selectors and where each one comes from are listed under [Zen internals](#zen-internals).

### Known limitations

- On builds where the real `about:newtab` page runs in a separate privileged process, `browser.contentDocument` is not reachable. Zen Flow then draws the clock as a chrome overlay positioned over the content area instead of inside the page. It looks the same, but it is not part of the page's DOM.
- Zen's new-tab implementation has changed between releases. The clock follows the markers available on the running build and falls back to a centred overlay when it can find the empty tab but not the expanded URL bar.
- Sine cannot unload background scripts, so this mod deliberately ships a single chrome script and cleans up after itself through `window.addUnloadListener`. That is what makes `"supportsUnload": true` accurate.
- The mod does not modify any browser preferences other than the ones it owns under the `zen-flow.` prefix.

## How it works

- **Loading state** comes from the tab's own `busy` and `progress` attributes, the same test Zen's `ZenProgressBar` uses. A single `MutationObserver` watches those two attributes (plus `zen-empty-tab`) on the tab strip; `TabSelect`, `TabOpen` and `TabClose` cover structural changes. There is no timer and no progress API, which is why a failed load or a redirect cannot leave the bar stuck.
- **Visuals** are entirely CSS. The script only publishes state: `zen-flow-loading` on tabs, `data-active` on the bar, and `zen-flow-*` attributes / custom properties on `:root`.
- **The clock** has one timer, armed for the next minute boundary and stopped completely while no clock is on screen. It is injected into the new-tab page when that document is reachable, and rendered as a chrome overlay otherwise.
- **Teardown** removes every element, listener, observer, timer and inline property the script created, so disabling the mod restores the window without a restart.

## Development

### Repository layout

The repository root **is** the mod folder. Sine downloads the repository zip and unpacks it directly as the mod directory, so nothing may be nested under an extra folder.

```
.
├── theme.json          # Sine manifest (id, version, script mapping)
├── preferences.json    # Settings shown in Sine
├── userChrome.css      # Browser chrome styles (features 1–3, clock overlay)
├── userContent.css     # New-tab page clock
├── js/
│   └── zen-flow.uc.mjs # The only script; runs in browser.xhtml
├── README.md
├── LICENSE
├── .gitignore
└── .gitattributes      # Forces LF line endings in the downloaded zip
```

`theme.json` maps exactly one script, `js/zen-flow.uc.mjs`, and restricts it to `chrome://browser/content/browser.xhtml`. There is no `.sys.mjs` background module on purpose: Sine cannot unload those, which would make the mod's unload support a lie.

### Checks

```sh
node --check js/zen-flow.uc.mjs
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
| `#tabbrowser-tabbox`, `#tabbrowser-tabpanels` | The web content area | Firefox |
| `window.gReduceMotion` | Reduced-motion state | Zen, backed by `ui.prefersReducedMotion` |
| `.tab-background::after` | Tab outline | Free: Zen only uses `::before` in `vertical-tabs.css`, and Firefox uses neither. |

`window.addUnloadListener(fn)` is Sine's unload hook; it must be called with a single argument so Sine can derive the script path from the caller.

</details>

## License

MIT. See [LICENSE](LICENSE).
