# Fastlane — Store Listing Metadata

Fastlane manages App Store and Play Store listing metadata (descriptions, screenshots, keywords, release notes). All content is version-controlled in `fastlane/metadata/` and automatically pushed to stores when changes land on `master`.

EAS continues to handle builds and binary submission via `.eas/workflows/build-and-submit.yml`. Fastlane only manages metadata.

## Setup

### 1. Install fastlane

```bash
bundle install
```

### 2. Configure credentials

Copy the template and fill in your values:

```bash
cp fastlane/.env-template fastlane/.env
```

`fastlane/.env` is gitignored. Fastlane auto-loads it — no need to `source` before running commands.

### 3. Apple App Store credentials

Create an App Store Connect API key:

1. Go to [App Store Connect > Users and Access > Integrations > App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
2. Generate a new key with "App Manager" role
3. Download the `.p8` file and place it in `fastlane/` (all `*.p8` files are gitignored)

Fill in the `.env` values:

```
APP_STORE_CONNECT_API_KEY_KEY_ID=your-key-id
APP_STORE_CONNECT_API_KEY_ISSUER_ID=your-issuer-id
APP_STORE_CONNECT_API_KEY_KEY_FILEPATH=./fastlane/app-store-connect-key.p8
```

For CI, add these as GitHub repository secrets (Settings > Secrets and variables > Actions > New repository secret):

- **`ASC_KEY_ID`** — The Key ID string shown next to your key in App Store Connect (e.g. `QQ9C2BVNGR`)
- **`ASC_ISSUER_ID`** — The Issuer ID shown at the top of the API keys page (e.g. `69a6de83-502d-47e3-e053-5b8c7c11a4d1`)
- **`ASC_KEY_CONTENT`** — The full contents of the `.p8` file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. Copy the entire file content as-is:
  ```bash
  cat fastlane/app-store-connect-key.p8 | pbcopy
  ```
  Then paste directly into the GitHub secret value field. Preserve the newlines — GitHub Secrets handles multi-line values correctly.

### 4. Google Play credentials

Create a service account:

1. Go to [Google Cloud Console > Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Create a service account and download the JSON key
3. Place the JSON key file in `fastlane/` as `play-store-key.json` (gitignored)
4. In [Google Play Console > Users and Permissions](https://play.google.com/console/users-and-permissions), invite the service account email
5. Under **App permissions**, select your app and grant **Store presence > Manage store presence**

Fill in the `.env` value:

```
SUPPLY_JSON_KEY_FILE=./fastlane/play-store-key.json
```

For CI, add the JSON key contents as a GitHub secret:

- **`PLAY_STORE_KEY_JSON`** — The full contents of the service account JSON file. Copy the entire file as-is:
  ```bash
  cat fastlane/play-store-key.json | pbcopy
  ```
  Then paste directly into the GitHub secret value field. The JSON must remain valid (preserve all formatting, quotes, and newlines). GitHub Secrets handles multi-line values correctly.

  Note: CI uses `SUPPLY_JSON_KEY_DATA` (inline JSON content) rather than `SUPPLY_JSON_KEY_FILE` (file path) since the key file doesn't exist on the CI runner.

## Usage

### Pull current metadata from stores

Downloads your current store listings into the local directory structure. Useful for initial setup or syncing after manual changes in the store consoles:

```bash
bundle exec fastlane ios pull_metadata
bundle exec fastlane android pull_metadata
```

Note: `android pull_metadata` will skip download if the `metadata/android/` directory already exists. Delete it first to force a fresh pull.

### Push metadata to stores

```bash
bundle exec fastlane ios metadata
bundle exec fastlane android metadata
```

### Automatic push via CI

Separate GitHub Actions workflows push metadata to each store independently:

- `.github/workflows/store-metadata-ios.yml` — triggers on changes to `fastlane/metadata/ios/**` or `fastlane/screenshots/**`
- `.github/workflows/store-metadata-android.yml` — triggers on changes to `fastlane/metadata/android/**`

Both support `workflow_dispatch` for manual runs.

**iOS behavior:** If no editable App Store version exists, the workflow creates one using the version from `app.json` and pushes all metadata to it. If an editable version already exists, it updates it in place. The version is left in "Prepare for Submission" — it is not submitted for review automatically.

## Directory Structure

```
fastlane/
  Appfile                           # App identifier
  Fastfile                          # Lane definitions
  .env                              # Credentials (gitignored, see .env-template)
  .env-template                     # Credential template for new contributors
  metadata/
    android/
      en-US/
        title.txt                   # App name (50 chars max)
        short_description.txt       # Short description (80 chars max)
        full_description.txt        # Full description (4000 chars max)
        video.txt                   # Promo video URL (optional)
        images/
          featureGraphic.png        # 1024x500 feature graphic
          icon.png                  # 512x512 hi-res icon
          phoneScreenshots/         # Phone screenshots (1080x1920)
          sevenInchScreenshots/     # 7" tablet screenshots (1200x1920)
          tenInchScreenshots/       # 10" tablet screenshots (1920x2560)
    ios/
      copyright.txt                 # Copyright line (non-localized)
      en-US/
        name.txt                    # App name (30 chars max)
        subtitle.txt                # Subtitle (30 chars max)
        description.txt             # Description (4000 chars max)
        keywords.txt                # Keywords, comma-separated (100 chars max)
        release_notes.txt           # What's New
        promotional_text.txt        # Promo text (170 chars max)
        privacy_url.txt             # Privacy policy URL
        support_url.txt             # Support URL
        marketing_url.txt           # Marketing URL
  screenshots/
    en-US/
      iphone_1_home.png             # Fastlane detects device type by resolution
      ipad_1_home.png               # Prefix with iphone_/ipad_ to avoid name collisions
```

## iOS Screenshots

Apple requires screenshots for two sizes. All smaller sizes auto-scale from these:

| Size | Dimensions | Required? | Auto-scales to |
|------|-----------|-----------|----------------|
| **iPhone 6.9"** | 1320 x 2868 | **Yes** | 6.7", 6.5", 6.3", 6.1", 5.5", 4.7" |
| **iPad Pro 13"** | 2064 x 2752 | **Yes** (if app runs on iPad) | 12.9", 11", 10.5", 9.7" |
| iPhone 6.7" | 1290 x 2796 | No | Same chain as 6.9" minus 6.9" |
| iPhone 6.1" | 1179 x 2556 | No | Smaller iPhones |
| iPad Pro 11" | 1668 x 2388 | No | Smaller iPads |

Provide 2-10 screenshots per size. Only the two required sizes are needed — Apple auto-scales from these for all other device sizes, so there is no need to provide separate screenshots for smaller displays.

Fastlane identifies the target device by image resolution, not folder name. All screenshot files must be placed **directly inside the language folder** (e.g. `screenshots/en-US/`), not in device-named subdirectories. Fastlane's loader only scans for images at the language folder level. Prefix filenames with `iphone_` / `ipad_` to avoid naming collisions between device types.

### Capturing iOS screenshots

Use the iOS Simulator with the device models below to produce the correct resolutions. Take screenshots with **Cmd+S** in the Simulator (saves to Desktop by default). Name files with a numeric prefix for ordering and a device prefix: `iphone_1_home.png`, `ipad_1_home.png`, etc.

| Size | Simulator Device | Resolution | Launch Command |
|------|-----------------|------------|----------------|
| **iPhone 6.9"** | iPhone 17 Pro Max | 1320 x 2868 | `npm run ios -- --device "iPhone 17 Pro Max"` |
| **iPad Pro 13"** | iPad Pro 13-inch (M5) | 2064 x 2752 | `npm run ios -- --device "iPad Pro 13-inch (M5)"` |

List available simulators with `xcrun simctl list devices available`. If a device is missing, install the iOS runtime via **Xcode → Settings → Platforms**.

## Android Screenshots

| Folder | Recommended Dimensions | Required? |
|--------|----------------------|-----------|
| `phoneScreenshots/` | 1080 x 1920 | Yes (min 2, max 8) |
| `sevenInchScreenshots/` | 1200 x 1920 | No (unlocks "Designed for tablets" badge) |
| `tenInchScreenshots/` | 1920 x 2560 | No (unlocks badge) |

Google Play does **not** auto-scale between sizes. If you want the tablet badge, you must provide separate tablet screenshots.

Google Play dimension rules for all screenshot types:
- **Minimum:** 320px on the shortest side
- **Maximum:** 3840px on the longest side
- **Aspect ratio:** Cannot exceed 2:1
- **Format:** JPEG or 24-bit PNG (no alpha/transparency)
- **Max file size:** 8 MB per image

### Capturing Android screenshots

Use the Android Emulator with the device profiles below. Take screenshots with the camera button in the emulator toolbar, or run `adb exec-out screencap -p > screenshot.png`.

Google Play enforces a strict **2:1 maximum aspect ratio** — screenshots from modern tall-screen phones (e.g. Pixel 9 Pro at 1280x2856, ratio 2.23:1) will be rejected. Use the devices below which produce the exact recommended dimensions.

| Folder | Emulator Device | Resolution | Launch Command |
|--------|----------------|------------|----------------|
| `phoneScreenshots/` | Pixel 2 | 1080 x 1920 | `npm run android -- --device "Pixel_2"` |
| `sevenInchScreenshots/` | Nexus 7 | 1200 x 1920 | `npm run android -- --device "Nexus_7_2013"` |
| `tenInchScreenshots/` | Pixel C | 1800 x 2560 | `npm run android -- --device "Pixel_C"` |

List available emulators with `emulator -list-avds`. Create new AVDs via **Android Studio → Device Manager** if needed. These older device profiles are still available in Android Studio and produce the exact resolutions Google Play expects.

Additional image assets in `metadata/android/en-US/images/`:
- `icon.png` — 512 x 512 hi-res icon
- `featureGraphic.png` — 1024 x 500 feature graphic (displayed at top of store listing)

## Updating release notes

Before each release, update the release notes files:

- **iOS:** `fastlane/metadata/ios/en-US/release_notes.txt`
- **Android:** Create `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`

These will be pushed automatically when merged to `master`.

## Security

Credential files are gitignored:
- `*.p8` — Apple API keys
- `play-store-key.json` — Google service account key
- `fastlane/.env` — Credential environment variables
- `fastlane/.api_key.json` — Temporary API key (auto-cleaned)
- `fastlane/report.xml` — Fastlane run reports
