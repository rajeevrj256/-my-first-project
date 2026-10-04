# Weight Tracker

A small app for logging your weight. It shows two graphs:

- **Daily weight**: one point per day. If you log more than once in a day, that day shows the average.
- **Weekly average**: the average for each Monday–Sunday week.

You can switch both graphs between 1 month, 3 months, 6 months, 1 year and all time. Tap a graph to see the exact value.

**Dark mode:** the app follows your iPhone's light/dark setting. Tap the moon/sun button at the top right to choose dark or light yourself; the app remembers your choice.

## Your data stays on your phone

- Entries are saved in the app's local storage on your device. Nothing is uploaded anywhere.
- Each entry is about 22 bytes, so 10 years of daily entries is under 100 KB.
- Under **Backup** you can **Export CSV**, which opens the share sheet so you can save the file to Files or iCloud Drive. **Import CSV** loads a backup back in and skips duplicates.

## Why it's not an APK

An APK only installs on Android. iPhones can't install APKs. This is a web app (a PWA) instead: you add it to your Home Screen from Safari, and it opens full-screen like a normal app and works offline.

## Install on iPhone

The app is hosted with GitHub Pages at
**https://rajeevrj256.github.io/-my-first-project/weight-tracker/**

1. On your iPhone, open that link in **Safari** (not Chrome).
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Always open the app from the new **Weight** icon on your Home Screen.

> iOS keeps the Home Screen app's data separate from Safari's data, so enter your weights in the installed app, not in the Safari tab.

If the link doesn't load, check **Settings → Pages** in the repository: **Source** should be **Deploy from a branch** with the default branch and **/ (root)** selected.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page layout |
| `style.css` | Styles (follows the phone's light/dark mode) |
| `app.js` | Saving, graphs, history, backup |
| `sw.js` | Service worker, so the app opens offline |
| `manifest.webmanifest`, `icon*.png`, `icon.svg` | App name and Home Screen icon |

To try it on a computer, serve the repository root with any static server, for example
`npx http-server .`, and open `http://localhost:8080/weight-tracker/`.
