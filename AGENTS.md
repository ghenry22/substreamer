# AGENTS.md

Drop-in operating instructions for coding agents. Read this file before every task.

**Working code only. Finish the job. Plausibility is not correctness.**

This file follows the [AGENTS.md](https://agents.md) open standard (Linux Foundation / Agentic AI Foundation). Claude Code, Codex, Cursor, Windsurf, Copilot, Aider, Devin, Amp read it natively. For tools that look elsewhere, symlink:

```bash
ln -s AGENTS.md CLAUDE.md
ln -s AGENTS.md GEMINI.md
```

---

## 0. Non-negotiables

These rules override everything else in this file when in conflict:

1. **No flattery, no filler.** Skip openers like "Great question", "You're absolutely right", "Excellent idea", "I'd be happy to". Start with the answer or the action.
2. **Disagree when you disagree.** If the user's premise is wrong, say so before doing the work. Agreeing with false premises to be polite is the single worst failure mode in coding agents.
3. **Never fabricate.** Not file paths, not commit hashes, not API names, not test results, not library functions. If you don't know, read the file, run the command, or say "I don't know, let me check."
4. **Stop when confused.** If the task has two plausible interpretations, ask. Do not pick silently and proceed.
5. **Touch only what you must.** Every changed line must trace directly to the user's request. No drive-by refactors, reformatting, or "while I was in there" cleanups.

---

## 1. Before writing code

**Goal: understand the problem and the codebase before producing a diff.**

- State your plan in one or two sentences before editing. For anything non-trivial, produce a numbered list of steps with a verification check for each.
- Read the files you will touch. Read the files that call the files you will touch. Claude Code: use subagents for exploration so the main context stays clean.
- Match existing patterns in the codebase. If the project uses pattern X, use pattern X, even if you'd do it differently in a greenfield repo.
- Surface assumptions out loud: "I'm assuming you want X, Y, Z. If that's wrong, say so." Do not bury assumptions inside the implementation.
- If two approaches exist, present both with tradeoffs. Do not pick one silently. Exception: trivial tasks (typo, rename, log line) where the diff fits in one sentence.

---

## 2. Writing code: simplicity first

**Goal: the minimum code that solves the stated problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code. No configurability, flexibility, or hooks that were not requested.
- No error handling for impossible scenarios. Handle the failures that can actually happen.
- If the solution runs 200 lines and could be 50, rewrite it before showing it.
- If you find yourself adding "for future extensibility", stop. Future extensibility is a future decision.
- Bias toward deleting code over adding code. Shipping less is almost always better.

The test: would a senior engineer reading the diff call this overcomplicated? If yes, simplify.

---

## 3. Surgical changes

**Goal: clean, reviewable diffs. Change only what the request requires.**

- Do not "improve" adjacent code, comments, formatting, or imports that are not part of the task.
- Do not refactor code that works just because you are in the file.
- Do not delete pre-existing dead code unless asked. If you notice it, mention it in the summary.
- Do clean up orphans created by your own changes (unused imports, variables, functions your edit made obsolete).
- Match the project's existing style exactly: indentation, quotes, naming, file layout.

The test: every changed line traces directly to the user's request. If a line fails that test, revert it.

---

## 4. Goal-driven execution

**Goal: define success as something you can verify, then loop until verified.**

Rewrite vague asks into verifiable goals before starting:

- "Add validation" becomes "Write tests for invalid inputs (empty, malformed, oversized), then make them pass."
- "Fix the bug" becomes "Write a failing test that reproduces the reported symptom, then make it pass."
- "Refactor X" becomes "Ensure the existing test suite passes before and after, and no public API changes."
- "Make it faster" becomes "Benchmark the current hot path, identify the bottleneck with profiling, change it, show the benchmark is faster."

For every task:

1. State the success criteria before writing code.
2. Write the verification (test, script, benchmark, screenshot diff) where practical.
3. Run the verification. Read the output. Do not claim success without checking.
4. If the verification fails, fix the cause, not the test.

---

## 5. Tool use and verification

- Prefer running the code to guessing about the code. If a test suite exists, run it. If a linter exists, run it. If a type checker exists, run it.
- Never report "done" based on a plausible-looking diff alone. Plausibility is not correctness.
- When debugging, address root causes, not symptoms. Suppressing the error is not fixing the error.
- For UI changes, verify visually: screenshot before, screenshot after, describe the diff.
- Use CLI tools (gh, aws, gcloud, kubectl) when they exist. They are more context-efficient than reading docs or hitting APIs unauthenticated.
- When reading logs, errors, or stack traces, read the whole thing. Half-read traces produce wrong fixes.

---

## 6. Session hygiene

- Context is the constraint. Long sessions with accumulated failed attempts perform worse than fresh sessions with a better prompt.
- After two failed corrections on the same issue, stop. Summarize what you learned and ask the user to reset the session with a sharper prompt.
- Use subagents (Claude Code: "use subagents to investigate X") for exploration tasks that would otherwise pollute the main context with dozens of file reads.
- When committing, write descriptive commit messages (subject under 72 chars, body explains the why). No "update file" or "fix bug" commits. No "Co-Authored-By: Claude" attribution unless the project explicitly wants it.

---

## 7. Communication style

- Direct, not diplomatic. "This won't scale because X" beats "That's an interesting approach, but have you considered...".
- Concise by default. Two or three short paragraphs unless the user asks for depth. No padding, no restating the question, no ceremonial closings.
- When a question has a clear answer, give it. When it does not, say so and give your best read on the tradeoffs.
- Celebrate only what matters: shipping, solving genuinely hard problems, metrics that moved. Not feature ideas, not scope creep, not "wouldn't it be cool if".
- No excessive bullet points, no unprompted headers, no emoji. Prose is usually clearer than structure for short answers.

---

## 8. When to ask, when to proceed

**Ask before proceeding when:**
- The request has two plausible interpretations and the choice materially affects the output.
- The change touches something you've been told is load-bearing, versioned, or has a migration path.
- You need a credential, a secret, or a production resource you don't have access to.
- The user's stated goal and the literal request appear to conflict.

**Proceed without asking when:**
- The task is trivial and reversible (typo, rename a local variable, add a log line).
- The ambiguity can be resolved by reading the code or running a command.
- The user has already answered the question once in this session.

---

## 9. Self-improvement loop

**This file is living. Keep it short by keeping it honest.**

After every session where the agent did something wrong:

1. Ask: was the mistake because this file lacks a rule, or because the agent ignored a rule?
2. If lacking: add the rule under "Project Learnings" below, written as concretely as possible ("Always use X for Y" not "be careful with Y").
3. If ignored: the rule may be too long, too vague, or buried. Tighten it or move it up.
4. Every few weeks, prune. For each line, ask: "Would removing this cause the agent to make a mistake?" If no, delete. Bloated AGENTS.md files get ignored wholesale.

Boris Cherny (creator of Claude Code) keeps his team's file around 100 lines. Under 300 is a good ceiling. Over 500 and you are fighting your own config.

---

## 10. Project context

Substreamer — React Native music streaming client for Subsonic-compatible servers (Subsonic, Navidrome, Gonic, Nextcloud Music, Ampache, etc.).

### Stack

- React Native 0.83 + Expo SDK 55 (New Architecture / Fabric enabled, Hermes engine).
- TypeScript strict, React 19. Path alias: `@/*` → `./src/*`.
- Routing: Expo Router (file-based). State: Zustand + SQLite (`substreamer7.db`).
- Audio: `react-native-track-player` (local fork in `modules/`, Media3-based on Android).
- Lists: `@shopify/flash-list` v2. Animations: `react-native-reanimated` v4.
- i18n: `react-i18next` v17 (English source; community translations via Crowdin).
- Image cache: custom disk cache via `expo-file-system`.

### Commands

- Install / sync deps: `npm install`
- Test (all): `npx jest --no-coverage`
- Test (one file): `npx jest path/to/test.ts`
- Test (coverage): `npx jest --coverage --coverageReporters=text`
- Typecheck: `npx tsc --noEmit`
- Validate i18n: `node scripts/validate-translations.js`
- Validate Intl helpers: `node scripts/validate-intl.js`
- Native build (Android): `npm run android`
- Native build (iOS): `npm run ios`
- Both concurrent: `npm run concurrent`
- Native module rebuild only: `scripts/build-modules.sh`

**Native builds are available when needed** — typically to verify a native-side change compiles and links cleanly, not as part of every task. The npm scripts source `scripts/env-android.sh` internally (sets `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, prepends emulator/platform-tools to `PATH`, and starts an Android emulator if none is running). For ad-hoc `gradle` / `adb` / `emulator` commands outside the npm scripts, prefix with `source scripts/env-android.sh && ` so the env is populated. To target a real device instead of the emulator: `npm run android:device`.

### Session start

Run these once per fresh session, before any other work:

1. Read this `AGENTS.md` end-to-end. Subagents must be passed the rules — when launching one via the Agent tool, include "Follow the project conventions in `AGENTS.md`" in the subagent prompt and trust it to read the file from the working directory.
2. Trigger Symdex re-indexing of the repo (`mcp__symdex__index_repo`) so symbol/text search reflects the current tree.
3. Only if a native build will actually be needed this session (e.g. to verify a native-side change compiles), `source scripts/env-android.sh` once. Each Bash call spawns a fresh shell, so the env needs to be re-sourced or chained per-command — using the npm scripts handles that automatically. Skip this for JS-only sessions.

### Layout

```
src/
  app/          file-based routes (thin wrappers; import from screens/)
    (tabs)/     bottom tab navigator
    [entity]/[id].tsx
  screens/      screen components with business logic
  components/   reusable UI
  hooks/        custom hooks
  services/     API clients + integrations (plain async functions, no classes)
  store/        Zustand stores (one per domain)
  i18n/         singleton + locale JSON
  utils/        shared helpers
modules/        local Expo native modules
plans/          local working docs (gitignored)
fastlane/       store-listing metadata
scripts/        build helpers + CI validators
```

### Don't modify

- `android/` and `ios/` — regenerated by `expo prebuild`, gitignored, lost on next regen. Use Expo config plugins or `app.json` for native config.
- `node_modules/` — patches go through `patches/` + patch-package only.

### Conventions

**Files:** PascalCase for components (`AlbumCard.tsx`); kebab-case for screens and routes (`album-detail.tsx`); camelCase for hooks/stores/services/utils (`useTheme.ts`).

**Naming:** stores end with `Store`. Constants UPPER_SNAKE_CASE. Handlers `handle*`; callback props `on*`.

**Imports:** external → internal → type-only. Use `import type` for types.

**Components:** functional with `memo` for list items / frequently re-rendered. Inline props for simple cases (`{ album }: { album: AlbumID3 }`); named `ComponentNameProps` for complex/shared.

**Routes are thin wrappers** — `src/app/foo.tsx` imports and renders the screen from `src/screens/foo.tsx`. Auth redirects live in `src/app/_layout.tsx`. Use `useRouter()` and `useLocalSearchParams<{ id: string }>()`.

**Stores:** export the store directly (not a hook). Persist via `createJSONStorage(() => sqliteStorage)` with name `substreamer-{domain}`. Use `partialize` to exclude transient state. Selectors in components (`store((s) => s.field)`); `getState()` outside React. Cross-store reactions: `subscribe()` at module scope from the dependent store's file. **Never** `require()` inside an action — restructure to eliminate the cycle.

**Services:** plain TS modules of async functions. No classes, no singletons. Return `null` on failure rather than throwing. Comment swallowed `.catch()` blocks with the reason.

**Theming:** `useTheme()` returns `{ colors, theme, ... }`. Never import theme constants directly. Apply colors inline: `style={[styles.title, { color: colors.textPrimary }]}`. `Pressable` with function styles for pressed states.

**Cover art:** always `<CachedImage coverArtId={x} size={300} />`. Never raw `<Image>` for Subsonic artwork. Standard sizes 50/150/300/600.

**FlashList v2:** `keyExtractor`, memoised `renderItem`, `drawDistance` to control off-screen rendering. **Don't pass** `estimatedItemSize`, `windowSize`, `maxToRenderPerBatch`, `initialNumToRender`, `getItemLayout`, `removeClippedSubviews` — all FlatList-only and unsupported. Grid: `numColumns={N}`; handle gaps via per-item padding (no `columnWrapperStyle`). Ref type `useRef<FlashListRef<T>>(null)`. Exception: drag-reorder uses `react-native-reorderable-list`; bounded horizontal carousels (≤20 items) may use RN `FlatList`.

**Animations:** `react-native-reanimated` everywhere — `useSharedValue`, `useAnimatedStyle`, `withTiming`/`withSpring`/etc. Do not import `Animated`/`Easing` from `react-native` **except** for slow linear translations (e.g. `MarqueeText`'s scroll), where `Animated` + `useNativeDriver: true` produces uniform display-synced motion that worklets can't match at low speeds.

**Modals / sheets:** RN `Modal` with transparent backdrop. Bottom padding via `useSafeAreaInsets()` → `Math.max(insets.bottom, 16)`.

**Swipe rows:** primary action goes at the **outside edge** (last in the array). Full swipe triggers the outermost action — visual hierarchy matches gesture.

**Pull-to-refresh:** wrap with `minDelay()` from `utils/stringHelpers.ts` so the spinner is visible long enough to perceive.

**Navigation transitions:** detail screens defer heavy rendering with `useTransitionComplete()` to avoid janky push animations.

**i18n:** every user-facing string via `useTranslation` (in components) or `i18n.t(...)` (outside React). Module-level option arrays: store `labelKey`, render with `t(opt.labelKey)`. Keys are flat camelCase (`recentlyAdded`, not `home.recentlyAdded`). Single namespace; reuse before creating. Plurals via key suffix `_one`/`_other` plus optional `_few`/`_many` (CLDR). **Don't translate:** remote API data, "Substreamer", technical IDs, log messages, format strings.

**Subsonic API:** all calls go through `src/services/subsonicService.ts` (cached `SubsonicAPI` instance). Cover-art and stream auth cached separately via `applyUrlAuth()`. Stream URLs include settings from `playbackSettingsStore`. New endpoints: function returns `null` on failure; re-export needed types from `subsonic-api`.

**Native modules** (`modules/{name}/`): four registration steps required or the module silently doesn't compile into the APK — (1) `expo-module.config.json` declaring platform classes; (2) `package.json` with `"main": "src/index.ts"`; (3) `android/build.gradle` (the absolute non-negotiable — without this the autolinker finds the module via config but never compiles it); (4) root `package.json` dependency entry plus `expo.install.exclude` and `expo.doctor.reactNativeDirectoryCheck.exclude`. Then `npm install` to symlink. Native rebuild required after creation; Metro bundling alone is insufficient. JS wrapper always provides a graceful fallback when the native module isn't available.

**iOS 26 Liquid Glass theme sync:** three-layer guard in root `_layout.tsx` to prevent white flash during native push/pop on iOS 26 — (1) `<ThemeProvider value={navigationTheme}>` from `@react-navigation/native` with `navigationTheme` overriding `colors.background`; (2) `backgroundColor: colors.background` on `GestureHandlerRootView`; (3) module-scope `Appearance.setColorScheme(...)` reading the persisted theme synchronously from SQLite, plus runtime sync in `useEffect`. Don't combine `headerBlurEffect: 'systemMaterial'` with custom `BlurView` headers — causes grey/white button backgrounds.

### Sensitive

Public repository. **Never** commit secrets, credentials, API keys, PII, names, emails. Use env vars (`fastlane/.env`, gitignored) or GitHub Secrets via `${{ secrets.* }}` / `ENV["..."]`, never literals. Review every new file before committing.

### Tests

- ≥80% statement and ≥80% branch coverage on every file in `src/` and `modules/`.
- Test real cases: null/undefined inputs, error paths, empty arrays, state transitions, subsystem interactions — not just the happy path.
- Run `npx tsc --noEmit && npx jest --no-coverage` before starting and after finishing every task.
- Update tests alongside code; remove tests for removed code.

### Plans

Save every non-trivial plan to `plans/` (gitignored) before implementation begins. Update during/after with what actually happened — deviations, issues, final state. Plans are resumable; keep them current at session end.

### Commits

Short, factual subject lines. **No** preamble, recap, ceremonial summaries. **No** mentions of test counts, coverage %, TS/lint status unless the commit is specifically about those. **No** attribution trailers — `Co-Authored-By`, `Signed-off-by`, "Generated with", "🤖", tool credits — ever, in any commit, full stop. Only commit when explicitly asked.

### Code search

Prefer Symdex MCP server (when available) over Glob/Grep for symbol lookup, file outlines, call graphs, and full-text search across the indexed repo. Fall back to filesystem search when Symdex misses or for content outside the index (`node_modules/`, etc.).

**Re-index after every commit.** Symdex caches an AST snapshot — without a refresh, post-commit symbol searches return stale results. After `git commit`, immediately call `mcp__symdex__index_repo` (incremental; only reprocesses changed files). Same applies on session start (covered above).

### Forbidden

- Editing `android/` or `ios/` directly — generated, will be lost.
- `expo run:android` / `expo run:ios` directly — use `npm run android` / `npm run ios` (they handle env setup and emulator). Direct `./gradlew` invocations are fine when you've sourced `scripts/env-android.sh` first.
- Lazy `require()` inside store actions — architectural smell; restructure.
- Brand-gating (`Build.MANUFACTURER` checks) in native code — prefer generic dispatch.
- `String.prototype.localeCompare(...)` — use `defaultCollator` / `baseCollator` from `src/utils/intl.ts`. Hermes Android ARM64 has a perf bug (#867) cloning a fresh ICU collator per call. CI guards via `validate-intl.js`.
- `new Intl.DateTimeFormat(...)` — use `getDateTimeFormat(locale, options)` from `src/utils/intl.ts`. Same reason; same guard.
- Class components — all functional with `memo`.
- Class-based or singleton services — plain modules of async functions.
- Raw `<Image>` for Subsonic cover art — `<CachedImage>`.
- FlatList-only props on FlashList (`estimatedItemSize`, `windowSize`, etc.).
- Author tags in commits.
- Committing without explicit user request.

---

## 11. Project Learnings

**Accumulated corrections. This section is for the agent to maintain, not just the human.**

When the user corrects your approach, append a one-line rule here before ending the session. Write it concretely ("Always use X for Y"), never abstractly ("be careful with Y"). If an existing line already covers the correction, tighten it instead of adding a new one. Remove lines when the underlying issue goes away (model upgrades, refactors, process changes).

- (empty)

---

## 12. How this file was built

This boilerplate synthesizes:
- Sean Donahoe's IJFW ("It Just F\*cking Works") principles: one install, working code, no ceremony.
- Andrej Karpathy's observations on LLM coding pitfalls (the four principles: think-first, simplicity, surgical changes, goal-driven execution).
- Boris Cherny's public Claude Code workflow (reactive pruning, keep it ~100 lines, only rules that fix real mistakes).
- Anthropic's official Claude Code best practices (explore-plan-code-commit, verification loops, context as the scarce resource).
- Community anti-sycophancy patterns (explicit banned phrases, direct-not-diplomatic).
- The AGENTS.md open standard (cross-tool portability via symlinks).

Read once. Edit sections 10 and 11 for your project. Prune the rest over time. This file gets better the more you use it.
