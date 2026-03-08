# Substreamer

[![Tests](https://github.com/ghenry22/substreamer/actions/workflows/tests.yml/badge.svg)](https://github.com/ghenry22/substreamer/actions/workflows/tests.yml)
![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey)
![Expo SDK](https://img.shields.io/badge/Expo%20SDK-55-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)

A React Native music streaming client for Subsonic-compatible servers (Subsonic, Navidrome, etc.), built with Expo SDK 55, React 19, and TypeScript.

## Getting Started

```bash
# Install dependencies
npm install

# Start the dev server
npx expo start
```

## Native Builds

Native Android builds require `JAVA_HOME` and `ANDROID_HOME` to be set. Use the helper script which auto-detects Android Studio's bundled JBR and the Android SDK:

```bash
# Default: runs npx expo run:android with correct env
scripts/build-android.sh

# Gradle only (assembleDebug)
scripts/build-android.sh --gradle-only

# Release variant via Gradle
scripts/build-android.sh --gradle-only --release

# Build without installing on device
scripts/build-android.sh --no-install
```

## Releasing

Releases are managed by a script that increments the version, updates the changelog, commits, tags, pushes, and creates a GitHub release.

### Prerequisites

[GitHub CLI](https://cli.github.com) must be installed and authenticated:

```bash
brew install gh
gh auth login
```

### Creating a Release

```bash
npm run release -- patch   # 8.0.0 → 8.0.1
npm run release -- minor   # 8.0.0 → 8.1.0
npm run release -- major   # 8.0.0 → 9.0.0
```

The script will:

1. Increment the version in `app.json` and `package.json`
2. Collect all commits since the last release tag
3. Prepend a new entry to `CHANGELOG.md`
4. Commit the changes, create a git tag, and push to origin
5. Create a GitHub release with the changelog as release notes

The working tree must be clean (no uncommitted changes) before running.

## Data Migration System

Substreamer includes a versioned data migration system that runs automatically during the animated splash screen on app launch. Migrations handle changes to stored data or cached files between app versions.

### How It Works

1. On every launch the splash screen plays its logo animation.
2. After the animation, the system checks for pending migration tasks by comparing the store's `completedVersion` against the task registry.
3. If there are no pending tasks the splash fades out normally -- the user sees nothing different.
4. If there are pending tasks the logo shrinks and slides up, a status message and spinner appear, and tasks run sequentially. On completion a green checkmark and "Update complete" message display briefly before the splash fades out.

### Key Files

| File | Purpose |
|------|---------|
| `src/services/migrationService.ts` | Task definitions and runner |
| `src/store/migrationStore.ts` | Tracks which migration version has completed |
| `src/components/AnimatedSplashScreen.tsx` | Splash screen with integrated migration UI |

### Adding a New Migration Task

1. Open `src/services/migrationService.ts`.
2. Add a new entry to the `MIGRATION_TASKS` array with the next sequential `id`:

```typescript
{
  id: 2,
  name: 'Short description for the user',
  run: async () => {
    // Your migration logic here.
    // Use expo-file-system, Zustand stores, or any other service.
    // Throw an error to signal failure (the task will not be retried
    // automatically -- handle retries inside `run` if needed).
  },
},
```

3. That's it. The runner picks up any task whose `id` is greater than `completedVersion` and executes them in order.

### Persistence

The migration store is currently **non-persisted** so that migrations run on every app launch during development. This makes it easy to iterate on migration tasks and test the UI.

To persist the store for production (so each task only runs once per device):

```typescript
// In src/store/migrationStore.ts, add the persist middleware:
import { createJSONStorage, persist } from 'zustand/middleware';
import { sqliteStorage } from './sqliteStorage';

export const migrationStore = create<MigrationState>()(
  persist(
    (set) => ({
      completedVersion: 0,
      setCompletedVersion: (completedVersion) => set({ completedVersion }),
    }),
    {
      name: 'substreamer-migration',
      storage: createJSONStorage(() => sqliteStorage),
    }
  )
);
```
