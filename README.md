# Substreamer

A React Native music streaming client for Subsonic-compatible servers (Subsonic, Navidrome, etc.), built with Expo SDK 54, React 19, and TypeScript.

## Getting Started

```bash
# Install dependencies
npm install

# Start the dev server
npx expo start
```

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
