# Substreamer – Project Overview

Substreamer is a React Native music streaming client for Subsonic-compatible servers (Subsonic, Navidrome, etc.), built with Expo SDK 55, React 19, and TypeScript (strict mode).

## Tech Stack

- **Framework:** Expo ~55 / React Native 0.83 (New Architecture enabled)
- **Routing:** Expo Router (file-based) with Stack + Tab navigators
- **State:** Zustand with SQLite persistence (`expo-sqlite`)
- **API:** `subsonic-api` library for Subsonic REST protocol
- **Audio:** `react-native-track-player` (RNTP, local fork in `modules/`) for streaming and background playback
- **Lists:** `@shopify/flash-list` v2 (FlashList) for all performant lists – replaces React Native FlatList
- **Image caching:** Custom disk cache via `expo-file-system`
- **Animations:** `react-native-reanimated` (v4) for all animations – see `ux-quality` rule for details and exceptions
- **i18n:** `react-i18next` v17 + `i18next` v26 with `@formatjs/intl-pluralrules` polyfill for Hermes
- **Styling:** `StyleSheet.create` + inline theme colors (no CSS-in-JS libraries)
- **Path alias:** `@/*` maps to `./src/*`

## Directory Structure

```
src/
  app/            # Expo Router routes (thin wrappers that import from screens/)
    _layout.tsx   # Root Stack layout, auth guard, splash screen
    (tabs)/       # Bottom tab navigator group
    album/[id]    # Dynamic routes for entities
    artist/[id]
    playlist/[id]
  screens/        # Screen components with business logic
  components/     # Reusable UI components
  hooks/          # Custom hooks
  services/       # API clients and external integrations
  store/          # Zustand stores
  i18n/           # react-i18next singleton, locale JSON files, language list
  constants/      # Theme definitions
  utils/          # Formatting, color, string, and timing helpers
  assets/         # App icons, splash images
modules/          # Local Expo native modules (see native-modules rule)
scripts/          # Build helper scripts
fastlane/         # Store listing metadata (descriptions, screenshots, release notes)
  metadata/       # Plain-text metadata files for iOS and Android stores
```

## Key Architectural Patterns

1. **Route/Screen separation:** Route files in `app/` are thin wrappers; business logic lives in `screens/`. See `routing-and-navigation` rule.
2. **Zustand stores** manage all app state. See `zustand-stores` rule.
3. **Services** are plain modules exporting async functions (no classes). See `services-and-api` rule.
4. **CachedImage** is the standard component for all cover art – never use raw `<Image>` for Subsonic artwork.
5. **`useTheme()`** provides `{ theme, colors }` – all components consume colors from this hook rather than importing theme constants directly.
6. **Shared utilities** live in `src/utils/` – common helpers (alphabet indexing via `getFirstLetter`, minimum-delay promises via `minDelay`) are extracted here rather than duplicated.
7. **All user-facing strings** are translated via `react-i18next`. See `Internationalization` section below.

## Internationalization (i18n)

All user-facing strings use `react-i18next`. English is the source language; translations are stored as flat JSON in `src/i18n/locales/`.

### Setup

- **Runtime:** `i18next` v26 + `react-i18next` v17 + `i18next-resources-to-backend` for lazy loading
- **Hermes polyfill:** `@formatjs/intl-pluralrules/polyfill-force` — imported first in `src/i18n/i18n.ts` (must precede i18next init)
- **Locale persistence:** `localeStore` (Zustand + SQLite) — `null` = follow device locale
- **Test setup:** `src/test-utils/i18nSetup.ts` initializes i18next with English resources; included in Jest `setupFiles`

### Usage Patterns

**In React components** — use the `useTranslation` hook:

```tsx
import { useTranslation } from 'react-i18next';

function MyScreen() {
  const { t } = useTranslation();
  return <Text>{t('recentlyAdded')}</Text>;
}
```

**In services/stores (outside React)** — import `i18next` directly:

```tsx
import i18n from 'i18next';

processingOverlayStore.getState().showSuccess(i18n.t('playlistCreated'));
```

**Module-level constant arrays** — use `labelKey` instead of `label`:

```tsx
const OPTIONS = [
  { value: 'recent', labelKey: 'recentlyAdded' },
];
// At render: <Text>{t(opt.labelKey)}</Text>
```

**Interpolation:** `t('greeting', { name: 'Miles' })` → key: `"greeting": "Hello {{name}}"`

**Plurals:** Key-suffix convention with `_one`/`_other`:

```json
{ "songCount_one": "{{count}} song", "songCount_other": "{{count}} songs" }
```
```tsx
t('songCount', { count: 5 }) // "5 songs"
```

### Key Naming Rules

- Flat camelCase: `recentlyAdded`, not `home.recentlyAdded`
- Single `translation` namespace (no namespace prefix in `t()` calls)
- Reuse existing keys for shared strings (`cancel`, `delete`, `save`, `albums`, etc.)
- Check `src/i18n/locales/en.json` before creating new keys

### What NOT to Translate

- Remote API data (album titles, artist names, track titles)
- App name "Substreamer"
- Technical identifiers, log messages, file paths
- Numeric format strings from formatters (`1h30m`, `1.2 GB`)

### Crowdin Integration

Community translations are managed via [Crowdin](https://crowdin.com/). The `crowdin.yml` config at the repo root maps `src/i18n/locales/en.json` as the source file.

**Automated sync** (`.github/workflows/crowdin.yml`):
- **Upload**: source strings push to Crowdin automatically when `en.json` changes on `master`
- **Download**: translations pull weekly (Monday 6am UTC) into a PR on branch `crowdin-translations`. Can also be triggered manually via `workflow_dispatch`.

**Validation**: `scripts/validate-translations.js` runs in CI and checks all locale files for missing/extra keys and interpolation placeholder mismatches. Run locally with `npm run validate:i18n`.

**Adding a new language** (e.g. `ja`):
1. The locale JSON file arrives via Crowdin PR (`src/i18n/locales/ja.json`)
2. Add polyfill import in `src/i18n/i18n.ts`: `import '@formatjs/intl-pluralrules/locale-data/ja.js'`
3. Add JSON import + entry in `localeResources` in `src/i18n/i18n.ts`
4. Add/uncomment entry in `src/i18n/languages.ts`
5. Update test mocks in `src/i18n/__tests__/i18n-fallbacks.test.ts`
6. Run `npx tsc --noEmit && npx jest`

Translation files can exist in the repo before the language is enabled — a language only becomes user-visible when added to `languages.ts`.

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Component files | PascalCase | `AlbumCard.tsx` |
| Screen files | kebab-case | `album-detail.tsx` |
| Route files | kebab-case / `[id]` | `album/[id].tsx` |
| Components | PascalCase | `AlbumCard` |
| Hooks | camelCase with `use` prefix | `useTheme` |
| Stores | camelCase with `Store` suffix | `playerStore` |
| Constants | UPPER_SNAKE_CASE | `ROW_HEIGHT`, `COVER_SIZE` |
| Handler functions | `handle` prefix | `handlePress` |
| Callback props | `on` prefix | `onPress`, `onClose` |
| Props types | Inline for simple; named `ComponentNameProps` for complex | `{ album: AlbumID3; width: number }`, `AlphabetScrollerProps` |

## Import Organization

Order imports as: external packages, then internal modules, then type-only imports.

```typescript
import { useRouter } from 'expo-router';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { CachedImage } from './CachedImage';
import { useTheme } from '../hooks/useTheme';
import { type AlbumID3 } from '../services/subsonicService';
```

Use `type` keyword for type-only imports: `import { type AlbumID3 } from '...'`.

## Native Modules

Local native modules live in `modules/` and are referenced in `package.json` as `"module-name": "file:./modules/module-name"`. Current modules: `expo-async-fs`, `expo-ssl-trust`, `expo-gzip`, `expo-backup-exclusions`, `expo-move-to-back`, `react-native-track-player`, `subsonic-api`. After adding or removing a module dependency, **always run `npm install`** to update the symlink. See `native-modules` rule for the full creation checklist.

## Generated Native Directories — DO NOT EDIT

The `android/` and `ios/` directories are **generated by `expo prebuild`** and are **not persisted** (they are gitignored and rebuilt from scratch). **NEVER edit files inside `android/` or `ios/` directly** — all changes will be lost on the next prebuild. To modify native configuration, use Expo config plugins in `app.json` / `app.config.js`, or create a local config plugin. This is non-negotiable.

## Public Repository — No Secrets or PII

This is a **public repository**. **NEVER** commit secrets, credentials, API keys, personal information (names, emails, phone numbers, addresses), or any other sensitive data to the repo. This is non-negotiable.

- Secrets and credentials must be stored in environment variables (via `fastlane/.env`, gitignored) or GitHub Secrets for CI.
- Use `.env-template` files with placeholder values for reference — never real values.
- Review contact information (e.g. App Store review contact) must be passed via environment variables, not checked into metadata files.
- If you need to reference sensitive values in code or configuration, always use `ENV["..."]` or `${{ secrets.* }}` — never hardcode them.
- Before committing, verify that no sensitive information is included in new or modified files.

## Native Builds

Use the npm scripts in `package.json` for native builds:

| Command | What it does |
|---------|-------------|
| `npm run android` | Build and run on Android (sets env vars automatically) |
| `npm run ios` | Build and run on iOS |
| `npm run concurrent` | Build and run both platforms concurrently |
| `scripts/build-android.sh` | One-off manual Android build with additional options |
| `scripts/build-modules.sh` | Builds local native module JS/types |

Do not run `./gradlew`, `expo run:android`, or `expo run:ios` directly — the npm scripts handle environment setup (`JAVA_HOME`, `ANDROID_HOME`) automatically.

**Do not run native builds from within the agent.** Native builds require network access and environment setup that the agent sandbox does not provide. When a plan includes a build verification step, note it as a manual step for the user to run in their own terminal.

## Store Listing Metadata

App Store and Play Store listing metadata (descriptions, screenshots, keywords, release notes) is managed via **fastlane** and version-controlled in `fastlane/metadata/`. EAS handles builds and binary submission; fastlane handles metadata only.

| Command | What it does |
|---------|-------------|
| `bundle exec fastlane ios metadata` | Push iOS metadata to App Store Connect |
| `bundle exec fastlane android metadata` | Push Android metadata to Play Store |
| `bundle exec fastlane ios pull_metadata` | Pull current iOS listings into local files |
| `bundle exec fastlane android pull_metadata` | Pull current Android listings into local files |

A GitHub Actions workflow (`.github/workflows/store-metadata.yml`) automatically pushes metadata to both stores when files under `fastlane/metadata/` change on `master`. See `fastlane/README.md` for credential setup and full documentation.

## Testing

**Before starting any work**, run both a TypeScript compilation check (`npx tsc --noEmit`) and the full test suite (`npx jest --no-coverage`). Ensure there are no errors or warnings. If there are failures, resolve them before making any changes.

**After completing work**, run both checks again. There must be no TypeScript errors, and any new warnings introduced by your changes should be seriously considered and resolved. All tests must still pass. Always check if tests need to be updated, added, or removed to keep the test suite aligned with the changes made.

**Coverage target (non-negotiable):** Every source file in `src/` and `modules/` must maintain **≥ 80% statement coverage and ≥ 80% branch coverage**. If a file does not yet have a corresponding test file, create one. Run `npx jest path/to/test --coverage --coverageReporters=text` to verify after writing or updating tests.

**Test real use cases, not just the happy path.** Tests should cover the scenarios users and code actually encounter:

- Null/undefined inputs and optional fields (e.g. `userRating` absent, `song` array missing)
- Error and failure paths (API returns null, network error, empty results)
- Edge cases and boundary conditions (empty arrays, zero values, duplicate calls)
- State transitions across multiple steps (e.g. lifecycle tests that progress through a sequence without resetting between steps)
- Interactions between subsystems (e.g. verifying that a store fetch triggers reconciliation in another store)

Avoid tests that only confirm the trivial success case. If a function has branches, test them.

## AI Instruction Files — Keep in Sync

Three files contain AI agent instructions and must always stay identical in **instructional content**:

- `.cursor/rules/project-overview.mdc` (Cursor)
- `.github/copilot-instructions.md` (GitHub Copilot)
- `CLAUDE.md` (Claude Code)

Tool-specific headers are expected to differ (e.g. Cursor's `.mdc` YAML frontmatter). The instructional body must match across all three files.

**When any one of these files is updated, the same change must be applied to all three.** This is non-negotiable. Never update one without updating the others in the same operation.

## Project Markdown Files

When asked to work on any of the project's own markdown files (`README.md`, `CONTRIBUTING.md`, `LICENSE`, etc.), **look in the project root directory only**. Do not search `node_modules/` or other subdirectories for project files. If you cannot find the file in the root, ask the user before looking elsewhere.

Searching `node_modules/` README files and documentation is fine when researching the capabilities of installed packages — just not when looking for the project's own files.

## Planning

When creating or presenting a plan, **always** end with a **bulleted list of todos** — each a single actionable step using clear, imperative phrasing. Keep the list proportional to the work.

---

# UX & UI Quality

## Excellence by Default

Every change must consider the user experience beyond the basic functional requirement. Prioritize how the interface looks, feels, and responds — not just whether it works.

## Smooth, Consistent Animations

Animations and transitions should be smooth, beautiful, and stylistically consistent across the entire application. Use consistent easing curves and durations so the app feels cohesive. Avoid jarring cuts, instant state swaps, or mismatched motion styles between screens.

## Prefer Reanimated

All animations should use `react-native-reanimated` by default. Reanimated runs animations on the UI thread via worklets, avoiding JS thread bottlenecks and enabling smooth 60fps motion even under load.

Key APIs to use:

- `useSharedValue` for mutable animated values
- `useAnimatedStyle` for styles driven by shared values
- `withTiming`, `withSpring`, `withDelay`, `withSequence`, `withRepeat` for animation composition
- `interpolate` (inside `useAnimatedStyle`) for value mapping
- `cancelAnimation` to stop running animations
- `runOnJS` to call JS-thread functions from animation callbacks
- `Animated.View`, `Animated.Image` etc. imported from `react-native-reanimated`

Do **not** import `Animated` or `Easing` from `react-native`, except in the case noted below.

### Exception: Slow Linear Translations

For **slow, constant-velocity linear animations** such as marquee or ticker scrolling, use React Native's built-in `Animated` API with `useNativeDriver: true` instead of Reanimated. The native driver delegates interpolation directly to the platform's display-synced animation loop (CADisplayLink on iOS, Choreographer on Android), which produces perfectly uniform frame-to-frame deltas. Reanimated's worklet-thread timing introduces micro-jitter at low speeds that is perceptible to users.

Canonical example: `MarqueeText` (`src/components/MarqueeText.tsx`) uses `Animated.timing` + `Animated.loop` from `react-native` for this reason.

## Let Animations Breathe

Give animations and transitions enough time to run and complete so users can perceive what is happening. Do not skip or shortcut visual feedback in favor of speed. The user should always understand the result of their action through motion and visual cues.

Existing patterns that embody this principle:

- **`useTransitionComplete()`** – defer heavy rendering until a navigation transition finishes, preventing janky animations.
- **`minDelay()`** – ensure loading spinners and refresh indicators remain visible long enough for the user to perceive them.

## Native Theme Synchronization (iOS 26 Liquid Glass)

On iOS 26, native UI elements (liquid glass header capsules, navigation bar materials) derive their appearance from the native UIKit layer, not from React. If the app's theme preference diverges from the system setting, native elements will flash with the wrong color scheme during navigation transitions unless all three synchronization layers are in place:

### 1. ThemeProvider (critical)

Expo Router's `NavigationContainer` defaults to React Navigation's `DefaultTheme`, which has a near-white background (`rgb(242, 242, 242)`). During native push/pop transitions, `react-native-screens` briefly exposes this background — on iOS 26 the liquid glass refracts it, causing a white flash.

**Fix:** Wrap root layout content with `<ThemeProvider value={navigationTheme}>` from `@react-navigation/native`. Build `navigationTheme` via `useMemo`, spreading `DarkTheme` or `DefaultTheme` and overriding `colors` with the app's resolved theme colors.

### 2. Root View Background Color

`GestureHandlerRootView` must have `backgroundColor: colors.background` in its style. Without it, the native `RCTRootView` falls back to `UIColor.systemBackgroundColor` (white in system light mode), which the glass material can sample during transitions.

### 3. Module-Scope Appearance Sync

Call `Appearance.setColorScheme()` at module scope in `_layout.tsx` by reading the persisted theme from SQLite synchronously (`sqliteStorage.getItem('substreamer-theme')`). This sets `UIUserInterfaceStyle` before any React component renders. A companion `useEffect` watching `preference` from `useTheme()` handles runtime theme changes.

### What Does NOT Work

- **`headerBlurEffect: 'systemMaterial'`** conflicts with custom `BlurView` headerBackground — causes grey headers and permanent white button backgrounds.
- **`Appearance.setColorScheme()` alone** is insufficient — it sets the window-level override but the navigation container's white default background still shows through during transitions.
