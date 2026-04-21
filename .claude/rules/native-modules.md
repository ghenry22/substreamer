---
globs: modules/**/*
---

# Local Expo Native Modules

Custom native functionality lives in `modules/` as local Expo modules. Current modules: `expo-async-fs`, `expo-ssl-trust`, `expo-gzip`, `expo-backup-exclusions`, `expo-move-to-back`, `expo-image-resize`, a local fork of `react-native-track-player`, and a local fork of `subsonic-api`. Follow existing modules as reference.

## Directory Structure

```
modules/{module-name}/
  android/src/main/java/expo/modules/{moduleid}/
    {ModuleName}Module.kt
  ios/
    {ModuleName}.podspec
    {ModuleName}Module.swift
  src/
    {ModuleName}Module.ts    # requireNativeModule + fallback stub
    index.ts                 # Public typed exports
  expo-module.config.json
  package.json
```

## Registration Checklist

A local module requires **three** registration steps or Metro/native builds will fail:

1. **`expo-module.config.json`** -- declares platform module classes:
```json
{
  "platforms": ["ios", "android"],
  "ios": { "modules": ["{ModuleName}Module"] },
  "android": { "modules": ["expo.modules.{moduleid}.{ModuleName}Module"] }
}
```

2. **`package.json`** -- standard npm package metadata with `"main": "src/index.ts"`:
```json
{
  "name": "{module-name}",
  "version": "1.0.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "peerDependencies": { "expo": "*", "react": "*", "react-native": "*" }
}
```

3. **Root `package.json`** -- **critical**: add a dependency entry, a doctor exclusion, **and** an install exclusion (prevents `expo install` from overwriting the local version):
```json
{
  "dependencies": {
    "{module-name}": "file:./modules/{module-name}"
  },
  "expo": {
    "install": {
      "exclude": ["{module-name}"]
    },
    "doctor": {
      "reactNativeDirectoryCheck": {
        "exclude": ["{module-name}"]
      }
    }
  }
}
```
Then run `npm install` to create the symlink in `node_modules/`.

## Native Code Pattern

Use `AsyncFunction` for background-thread work (the Expo Modules API handles thread dispatch automatically):

```swift
// iOS
AsyncFunction("myFunction") { (arg: String) -> String in
  // Runs on native background thread
  return result
}
```

```kotlin
// Android
AsyncFunction("myFunction") { arg: String ->
  // Runs on native background thread
  result
}
```

## JS Wrapper Pattern

Always provide a graceful fallback when the native module isn't available (e.g. during JS-only development):

```typescript
// src/{ModuleName}Module.ts
import { requireNativeModule } from 'expo-modules-core';

let module: NativeInterface;
try {
  module = requireNativeModule('{ModuleName}');
} catch {
  console.warn('[{module-name}] Native module not found. Rebuild the app.');
  module = { /* no-op stubs */ } as any;
}
export default module;
```

## After Creating a Module

A **native rebuild** is required (`npx expo run:ios` / `npx expo run:android`). Metro bundling alone is not sufficient for new native modules.
