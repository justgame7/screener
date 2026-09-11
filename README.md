# Screener

Ichimoku Breakout Screener (Binance USDT-M) — packaged as:
1. A static site served via **GitHub Pages** from `docs/`
2. A native **Android app** via **Capacitor**, wrapping the same UI from `www/`

Both `docs/index.html` and `www/index.html` are the same file. If you edit the
screener, copy your changes into **both** folders (or just keep one as the
source of truth and `cp` it into the other before you push / rebuild).

---

## 1. GitHub Pages (web version)

1. Push this repo to GitHub.
2. Repo → **Settings → Pages** → **Build and deployment** → Source: **Deploy
   from a branch** → Branch: `main` (or whichever branch you pushed) →
   Folder: **`/docs`** → **Save**.
3. GitHub will publish it at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two.

`docs/.nojekyll` is already included so GitHub Pages serves the file as-is
without Jekyll processing.

---

## 2. Android app (Capacitor)

The native Android project is already generated and sitting in `android/`,
with the app icon and splash screen installed. You just need to build it.

### Requirements
- **Node.js** 18+ and npm
- **Android Studio** (includes the Android SDK) — easiest path, *or*
  command-line SDK tools + a JDK 17/21 if you want to build headless

### Option A — Android Studio (recommended)
1. `npm install` in the repo root (installs the Capacitor CLI/core).
2. `npx cap sync android` — copies `www/` into the native project and syncs
   config. Run this again any time you change `www/index.html`.
3. `npx cap open android` — opens the `android/` project in Android Studio.
4. Let Gradle sync, then **Build → Generate Signed Bundle / APK** (or just
   **Run ▶** to install a debug build on a connected device/emulator).

### Option B — command line
```bash
npm install
npx cap sync android
cd android
./gradlew assembleDebug
# APK lands at android/app/build/outputs/apk/debug/app-debug.apk
```
For a release build you'll need to set up a signing key — see
https://capacitorjs.com/docs/android/deploying-to-google-play

> Note: `./gradlew` downloads the Gradle distribution and Android SDK
> components on first run, so it needs an internet connection and a machine
> with the Android SDK configured (`ANDROID_HOME` / `local.properties`
> pointing at your SDK, which Android Studio sets up for you automatically).

### App identity
- **App name:** Screener
- **Package / Application ID:** `com.tradesphere.screener`
- **Icon / splash:** custom-designed, see below

---

## 3. App icon & splash screen

A custom icon was designed to match TradeSphere's dark UI theme (Ichimoku
cloud + breakout candlestick, teal/blue/amber accents on the `#0A0C10`
background):

- Source SVGs are in `icon-source/` (`icon-full.svg` for the legacy/Play
  Store square icon, `icon-fg.svg` + `icon-bg.svg` for the adaptive icon
  layers, `splash.svg` for the splash screen).
- Rendered PNGs are already installed into
  `android/app/src/main/res/mipmap-*` (launcher icon, round icon, adaptive
  icon foreground/background) and `android/app/src/main/res/drawable*`
  (splash screens, portrait + landscape, all densities).
- If you want to redesign it later: edit the SVGs in `icon-source/`, then
  re-rasterize to PNG at the sizes already present in `android/app/src/main/res/mipmap-*`
  and `drawable-{port,land}-*` and re-copy them in. (Any SVG-to-PNG tool
  works — Inkscape, `cairosvg`, or an online converter.)

---

## 4. Repo layout

```
docs/                 GitHub Pages site (screener.html as index.html)
www/                  Capacitor web assets (same file)
android/              Native Android project (Capacitor-generated + custom icons/splash)
icon-source/          Source SVGs for the app icon & splash screen
capacitor.config.json Capacitor app config (appId, appName, webDir)
package.json          npm deps (@capacitor/core, @capacitor/android, @capacitor/cli)
```

---

## 5. Original screener notes

See the analysis modal, Ichimoku breakout detection (Daily/4H), candlestick
+ chart pattern engine, and trade-plan math already built into
`index.html` — this packaging step doesn't change any of that logic, it only
wraps the existing single-file app for web + Android distribution.
