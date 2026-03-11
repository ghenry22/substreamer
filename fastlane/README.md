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

The GitHub Actions workflow (`.github/workflows/store-metadata.yml`) automatically pushes metadata to both stores when files under `fastlane/metadata/` change on the `master` branch.

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
          phoneScreenshots/         # Phone screenshots
          sevenInchScreenshots/     # 7" tablet screenshots
          tenInchScreenshots/       # 10" tablet screenshots
    ios/
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
```

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
