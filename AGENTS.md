# AGENTS.md

Drop-in operating instructions for coding agents. Read this file before every task.

**Working code only. Finish the job. Plausibility is not correctness.**

This file follows the [AGENTS.md](https://agents.md) open standard (Linux Foundation / Agentic AI Foundation). Claude Code, Codex, Cursor, Windsurf, Copilot, Aider, Devin and Amp read it natively.

**This is the only rules file.** `CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md` were all retired on 2026-08-06 — every tool reads AGENTS.md now. Do not reintroduce a per-tool copy: two rules files drift, and the stale one is always the one that gets read. (The retired Copilot files had gone stale exactly that way — none of them knew the data model existed.)

---

## 0. Non-negotiables

These rules override everything else in this file when in conflict:

1. **No flattery, no filler.** Skip openers like "Great question", "You're absolutely right", "Excellent idea", "I'd be happy to". Start with the answer or the action.
2. **Disagree when you disagree.** If the user's premise is wrong, say so before doing the work. Agreeing with false premises to be polite is the single worst failure mode in coding agents.
3. **Never fabricate.** Not file paths, not commit hashes, not API names, not test results, not library functions. If you don't know, read the file, run the command, or say "I don't know, let me check."
4. **Stop when confused.** If the task has two plausible interpretations, ask. Do not pick silently and proceed.
5. **Touch only what you must.** Every changed line must trace directly to the user's request. No drive-by refactors, reformatting, or "while I was in there" cleanups.
6. **Never assume, never guess, always validate.** A mechanism you have not observed is a hypothesis, not a fact — never state it as one, and never build a fix on top of it. When behaviour surprises you, get evidence *before* theorising: read the actual source (not what you remember it does), capture the real logs (`adb logcat`, instrument the code, add a temporary diagnostic), and reproduce it. Diff against the correct baseline (the shipped tag, not whatever branch is handy). Phrases like "it probably works like…", "this should fix it", or "I presume" are red flags — replace them with what you measured. A wrong root cause asserted confidently wastes more time than saying "I don't know yet — let me get evidence."
7. **Check the latest version before adding a dependency.** When adding any package, look up its current version on the web / npm registry first (e.g. `npm view <pkg> version`) and install that deliberately. Never blindly accept whatever a resolver picks (`expo install`, an SDK version map, a template) — they lag npm-latest. If you intentionally pin below latest, say why.

---

## 1. Before writing code

**Goal: understand the problem and the codebase before producing a diff.**

- State your plan in one or two sentences before editing. For anything non-trivial, produce a numbered list of steps with a verification check for each.
- Read the files you will touch. Read the files that call the files you will touch. Claude Code: use subagents for exploration so the main context stays clean.
- Match existing patterns in the codebase. If the project uses pattern X, use pattern X, even if you'd do it differently in a greenfield repo.
- Surface assumptions out loud: "I'm assuming you want X, Y, Z. If that's wrong, say so." Do not bury assumptions inside the implementation.
- If two approaches exist, present both with tradeoffs. Do not pick one silently. Exception: trivial tasks (typo, rename, log line) where the diff fits in one sentence.

### Server behaviour: READ THE SOURCE, never assume

Every Subsonic-compatible server we support is open source, and local read-only clones live in
`reference/` (gitignored — see `reference/README.md`). **Never guess, infer or "reason about" what
a server does when the answer can be read.** Never write a defensive branch for a failure mode you
have not confirmed exists in a real implementation.

- Establishing a behaviour means citing `reference/<server>/<file>:<line>`, not an observation, a
  plausible mechanism, or an existing code comment.
- A comment in OUR code is not evidence. Comments record what someone believed at the time. Two
  such comments in the sync path ("search3 is not reliably pageable", "a server that ignores
  `albumOffset` returns the same first page forever") were both agent-written assumptions, both
  wrong, and both shaped real design decisions for weeks before anyone checked.
- Rationale written as assertion is how this spreads. Write "guards an UNVERIFIED failure mode —
  never observed" rather than a confident description of a server that may not exist.
- When a real server genuinely misbehaves, cite its source too, and treat it as that server's bug —
  do not generalise one server's defect into a rule about the API.

`plans/research-search3-paging-behaviour.md` is the worked example: five servers read from source,
which disproved both assumptions and identified the actual defect in the one server that had one.

### The planning cycle

For anything beyond a trivial fix, plan before you touch code, and get the plan approved before you implement:

1. **Write the plan** to `plans/` (see section 10, Plans). State the goal, the steps, and how each step is verified.
2. **Review it adversarially** — a subagent, or a deliberate second pass hunting for what is wrong with it. The reviewer's job is to find defects, not to agree.
3. **Assess every finding on the evidence.** Read the actual source and confirm or refute it. A finding is not true because a reviewer asserted it, and not false because it is inconvenient. Say which it is.
4. **Fix the plan** for the findings that hold. If a finding reveals a defect in shipped code, it goes IN SCOPE — never deferred (section 12).
5. **Iterate 2–4** until a review produces no new valid findings. Resolve every open question with evidence; a plan containing "investigate X during implementation" is not finished.
6. **Submit the clean plan for approval. Never start significant implementation without it.** Sequencing decisions, scope changes and reversals of an earlier decision go back to the user too.
7. **Keep the plan current** as you implement — deviations, surprises, final state, test results.

The review step is not ceremony. It has repeatedly found live bugs in already-shipped code, and it has caught chosen approaches that would not have worked.

---

## 2. Writing code: simplicity first

**Goal: the minimum code that solves the stated problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code. No configurability, flexibility, or hooks that were not requested.
- No error handling for impossible scenarios. Handle the failures that can actually happen.
- If the solution runs 200 lines and could be 50, rewrite it before showing it.
- If you find yourself adding "for future extensibility", stop. Future extensibility is a future decision.
- Bias toward deleting code over adding code. Shipping less is almost always better.

**Weigh cases by whether a real user of THIS app can actually hit them.** This is a music client: someone browses a library, plays tracks, downloads albums, stars things, syncs, logs out. Before hardening a path, say concretely how a user reaches it. Cases that are merely *not forbidden by a hard technical limit* — but that nothing in the app can actually produce — are not worth code, tests, or plan sections; note the assumption and move on. We have burned real time chasing scenarios that turned out to be impossible in practice, and the cost is not just the wasted work: it buries the failures that do happen. Two exceptions, where "unlikely" is not a defence: **data loss** and **anything that fires on every launch**.

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
2. If lacking: add the rule — a project fact to section 11, a working correction to section 12 — as concretely as possible ("Always use X for Y", not "be careful with Y").
3. If ignored: the rule may be too long, too vague, or buried. Tighten it or move it up.
4. Every few weeks, prune. For each line, ask: "Would removing this cause the agent to make a mistake?" If no, delete. Bloated AGENTS.md files get ignored wholesale.
5. **Re-verify section 10 against `package.json` and the tree whenever the stack moves.** Every version line in it was wrong by the time it was next read — an agent that trusts a stale fact goes looking for a library that isn't there.

Aim for ~300 lines of rules; over 500 you are fighting your own config. Section 11 is exempt from the diet — it is the expensive-to-rediscover material, and it should grow when something bites us and shrink when a subsystem is retired.

---

## 10. Project context

Substreamer — React Native music streaming client for Subsonic-compatible servers (Subsonic, Navidrome, Gonic, Nextcloud Music, Ampache, etc.).

### Stack

Verified against `package.json` on 2026-10-23 — correct a line here the moment it stops being true.

- React Native 0.88 + Expo SDK 58 (New Architecture + Hermes, both SDK defaults). RN 0.88's Strict TypeScript API is on: type refs with `ViewInstance` / `ScrollViewInstance` / `TextInputInstance`, not the component.
- TypeScript ~6.0 strict, React 19.3. Path alias: `@/*` → `./src/*`.
- Routing: Expo Router (file-based). State: Zustand v5.
- Persistence: **op-SQLite** (`@op-engineering/op-sqlite`) — one connection to `substreamer7.db`. `expo-sqlite` is gone; do not reintroduce it.
- Audio: **`react-native-queue-player`** — our own package (`github.com/ghenry22/react-native-queue-player`), installed from npm, NOT in `modules/`. Media3-based on Android. (It replaced `react-native-track-player`; that name should appear nowhere in new code.)
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
- Validate native module inventory: `npm run validate:modules`
- Circular imports: `npx madge --circular --extensions ts,tsx src`
- Native build (Android): `npm run android` (device: `npm run android:device`)
- Native build (iOS): `npm run ios`
- Both concurrent: `npm run concurrent`
- Native module rebuild only: `npm run build:modules`
- Android build with explicit flags (`--gradle-only`, `--release`, `--no-install`): `scripts/build-android.sh`

The full quality gate, run before starting and after finishing any task that touches `src/`:

```bash
npx tsc --noEmit && npx jest --no-coverage
node scripts/validate-intl.js && node scripts/validate-translations.js
npx madge --circular --extensions ts,tsx src
```

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
  db/           persistence — THE data layer (see section 11)
    client.ts     op-SQLite connection + the `InternalDb` surface every module uses
    schema.ts     normalized schema (source of truth; DDL generated from it)
    repository/   per-entity SQL: albums, artists, songs, playlists, favorites, search…
    migrations/   versioned data migrations
    testing/      the op-SQLite ⇄ better-sqlite3 Jest substitute (see `__mocks__/`)
  store/        Zustand stores (one per domain) + store/persistence (KV + row tables)
  constants/    theme definitions
  i18n/         singleton + locale JSON
  types/        shared type declarations
  utils/        shared helpers
  test-utils/   test helpers
modules/        local Expo native modules (expo-async-fs, expo-ssl-trust, expo-gzip,
                expo-image-colors, expo-image-resize, expo-move-to-back,
                expo-backup-exclusions, subsonic-api)
plans/          local working docs — plans, reports, handovers (gitignored)
docs/           the GitHub Pages SITE (index.html, privacy, assets). Never put a plan or
                report here — it publishes to the public website
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

**Stores:** export the store directly (not a hook). Persist via SQLite (`substreamer7.db` `storage` table) with name `substreamer-{domain}`, choosing the adapter by need: default `createJSONStorage(() => kvStorage)` (async — IO off the JS thread); `createJSONStorage(() => kvStorageSync)` ONLY for stores that must be hydrated before first paint (theme/locale/auth/onboarding) or read synchronously by hand-rolled callers — async hydration there reintroduces the startup flash; `createDebouncedPersistStorage()` for large catalog stores whose full blob is rewritten on every mutation (coalesces writes + defers `JSON.stringify` to one flush). Use `partialize` to exclude transient state. Selectors in components (`store((s) => s.field)`); `getState()` outside React. Cross-store reactions: `subscribe()` at module scope from the dependent store's file. **Never** `require()` inside an action — restructure to eliminate the cycle.

**Services:** plain TS modules of async functions. No classes, no singletons. Return `null` on failure rather than throwing. Comment swallowed `.catch()` blocks with the reason.

**Theming:** `useTheme()` returns `{ colors, theme, ... }`. Never import theme constants directly. Apply colors inline: `style={[styles.title, { color: colors.textPrimary }]}`. `Pressable` with function styles for pressed states.

**Cover art:** always `<CachedImage coverArtId={x} size={300} />`. Never raw `<Image>` for Subsonic artwork. Standard sizes 50/150/300/600.

**FlashList v2:** `keyExtractor`, memoised `renderItem`, `drawDistance` to control off-screen rendering. **Don't pass** `estimatedItemSize`, `windowSize`, `maxToRenderPerBatch`, `initialNumToRender`, `getItemLayout`, `removeClippedSubviews` — all FlatList-only and unsupported. Grid: `numColumns={N}`; handle gaps via per-item padding (no `columnWrapperStyle`). Ref type `useRef<FlashListRef<T>>(null)`. Exception: drag-reorder uses `react-native-reorderable-list`; bounded horizontal carousels (≤20 items) may use RN `FlatList`.

**`maintainVisibleContentPosition` is ON by default in v2 — pass `{{ disabled: true }}` on any list whose data is REPLACED rather than appended.** It anchors the viewport to a previously-visible item; when the replacement data puts that item at a different index the list parks where nothing is drawn, and only a manual scroll recovers it. The home carousels hit this on every filter toggle, section refresh and sync — cards rendered at full size with a correct list layout, and still nothing painted. Keep it enabled where the user's scroll position is worth preserving across an append, i.e. the keyset browse lists loading a backward page.

**Animations:** `react-native-reanimated` everywhere — `useSharedValue`, `useAnimatedStyle`, `withTiming`/`withSpring`/etc. Do not import `Animated`/`Easing` from `react-native` **except** for slow linear translations (e.g. `MarqueeText`'s scroll), where `Animated` + `useNativeDriver: true` produces uniform display-synced motion that worklets can't match at low speeds.

**Modals / sheets:** RN `Modal` with transparent backdrop. Bottom padding via `useSafeAreaInsets()` → `Math.max(insets.bottom, 16)`.

**Swipe rows:** primary action goes at the **outside edge** (last in the array). Full swipe triggers the outermost action — visual hierarchy matches gesture.

**Pull-to-refresh:** go through `onPullToRefresh(scope)` in `services/dataSyncService`, which holds the `minDelay()` that keeps the spinner perceptible and the offline no-op (offline there is nothing to refresh — that is intended, not a gap). It refreshes the **server source of whatever the view shows**, so pick the scope from the source, never from the filters: a favourites view refreshes `favorites` (`getStarred2`) whatever else is filtered on top, and a Downloaded filter still refreshes the library it filters. A filter narrows a VIEW; it never changes the source. A filtered branch whose refresh differs from its unfiltered one is a bug.

**Navigation transitions:** detail screens defer heavy rendering with `useTransitionComplete()` to avoid janky push animations.

**i18n:** every user-facing string via `useTranslation` (in components) or `i18n.t(...)` (outside React). Module-level option arrays: store `labelKey`, render with `t(opt.labelKey)`. Keys are flat camelCase (`recentlyAdded`, not `home.recentlyAdded`). Single namespace; reuse before creating. Plurals via key suffix `_one`/`_other` plus optional `_few`/`_many` (CLDR). **Don't translate:** remote API data, "Substreamer", technical IDs, log messages, format strings.

**Subsonic API:** all calls go through `src/services/subsonicService.ts` (cached `SubsonicAPI` instance). Cover-art and stream auth cached separately via `applyUrlAuth()`. Stream URLs include settings from `playbackSettingsStore`. New endpoints: function returns `null` on failure; re-export needed types from `subsonic-api`.

**Native modules** (`modules/{name}/`): four registration steps required or the module silently doesn't compile into the APK — (1) `expo-module.config.json` declaring platform classes; (2) `package.json` with `"main": "src/index.ts"`; (3) `android/build.gradle` (the absolute non-negotiable — without this the autolinker finds the module via config but never compiles it); (4) root `package.json` dependency entry plus `expo.install.exclude` and `expo.doctor.reactNativeDirectoryCheck.exclude`. Then `npm install` to symlink. Native rebuild required after creation; Metro bundling alone is insufficient. JS wrapper always provides a graceful fallback when the native module isn't available. Every module also ships **`mocks/<NativeName>.ts`**: jest-expo loads it as the native module for `requireNativeModule('<NativeName>')` in every test, so no suite writes its own one-off mock and no test prints "Native module not found". Module tests use it too (`jest.mocked(XModule)` — jest-expo wraps each export in `jest.fn`); never add a `src/__mocks__/` copy. `npm run validate:modules` fails on either.

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

Short, factual subject lines. **No** preamble, recap, ceremonial summaries. **No** mentions of test counts, coverage %, TS/lint status unless the commit is specifically about those. **No** attribution trailers — `Co-Authored-By`, `Signed-off-by`, "Generated with", "🤖", tool credits — ever, in any commit, full stop.

**Local commits are allowed; pushing is not.** When working through an approved plan, commit each step at a gate-green boundary — that is what makes the work resumable and reviewable step by step. **Never `git push`, open a PR, or publish anything to a remote without explicit approval**, every time; approval to commit is never approval to push. Outside an approved plan, ask before committing.

**Closing issues:** to close a GitHub issue, put `Closes #N` **in the commit message** — it auto-closes when the commit is pushed. This is the ONLY way to close an issue. **Never** run `gh issue close` manually. When the user says "close the ticket with the commit message" (or "close #N with the commit"), they mean literally add `Closes #N` to the commit message — not close it by hand. "Commit" still means commit locally and stop (never push unless told); the issue closes later when the commit is pushed, which is fine — do not manually close it in the meantime.

### Code search

Prefer Symdex MCP server (when available) over Glob/Grep for symbol lookup, file outlines, call graphs, and full-text search across the indexed repo. Fall back to filesystem search when Symdex misses or for content outside the index (`node_modules/`, etc.).

**Re-index after every commit.** Symdex caches an AST snapshot — without a refresh, post-commit symbol searches return stale results. After `git commit`, immediately call `mcp__symdex__index_repo` (incremental; only reprocesses changed files). Same applies on session start (covered above).

### Forbidden

- Editing `android/` or `ios/` directly — generated, will be lost.
- `expo run:android` / `expo run:ios` directly — use `npm run android` / `npm run ios` (they handle env setup and emulator). Direct `./gradlew` invocations are fine when you've sourced `scripts/env-android.sh` first.
- Lazy `require()` of project code — **anywhere**, not just store actions: services, components,
  migrations, all of it. It hides a cycle from the compiler instead of fixing it, defeats typing
  (the destructured binding is `any` unless hand-cast), and hides a real dependency from the test
  graph. If there is a cycle, **re-architect to remove it**; a lazy require is never the answer.
  If the blocker is a test-environment gap (a native module with no Jest bridge), mock it in the
  SUITE — production code does not carry workarounds for test wiring. Only exceptions: RN static
  assets (`require('../assets/x.png')`, the required idiom) and `jest.mock` factories.
- Brand-gating (`Build.MANUFACTURER` checks) in native code — prefer generic dispatch.
- `String.prototype.localeCompare(...)` — use `defaultCollator` / `baseCollator` from `src/utils/intl.ts`. Hermes Android ARM64 has a perf bug (facebook/hermes#867) cloning a fresh ICU collator per call. CI guards via `validate-intl.js`.
- `new Intl.DateTimeFormat(...)` — use `getDateTimeFormat(locale, options)` from `src/utils/intl.ts`. Same reason; same guard.
- Class components — all functional with `memo`.
- Class-based or singleton services — plain modules of async functions.
- Raw `<Image>` for Subsonic cover art — `<CachedImage>`.
- FlatList-only props on FlashList (`estimatedItemSize`, `windowSize`, etc.).
- Author tags in commits.
- Pushing to a remote, opening a PR, or publishing anything outward without explicit approval — every time. Local commits at gate-green step boundaries are fine (see Commits).

---

## 11. Key decisions and findings

**Hard-won and expensive to rediscover. Read before touching persistence. Do not re-litigate without new evidence.**

### The write path (atomic-writes programme, Phases 1–3, 2026-08)

- **There is NO JS-side write mutex.** `serializeDbWrite` and `withTransactionAsync` were deleted. The native pool is ONE thread, FIFO (`cpp/OPThreadPool.cpp`), so it serializes work that reaches it. Do not add a JS mutex back.
- **A BATCH DOES NOT REACH THE POOL WHEN YOU CALL IT — a read issued after a batch runs BEFORE it.** op-SQLite's JS layer parks every `executeBatch` on a transaction lock and starts it from a **`setImmediate`** (`node_modules/@op-engineering/op-sqlite/src/functions.ts:64-66,114-123`), serialized behind every other in-flight batch. `execute` — every read, and every `runAsync` write — passes straight through at call time. So the pool's FIFO orders *arrival*, and batches arrive at least a macrotask late.

  **Never fire a batch un-awaited and then read what it wrote in the same tick.** Two live bugs came from exactly that: a queued download read its own payload rows before the insert landed and errored "Failed to read songs" on every album, and `cached_item_songs` edges written with bare `runAsync` hit an FK against parents still sitting in a deferred batch, were rejected, and were swallowed — losing the edge for a song the user had downloaded. Either await the write, or put the dependent write in the SAME batch so it shares the lane.

  **The Jest SQLite substitute models this**: `src/db/testing/opSqliteBetterSqlite3.ts` carries the same lock — `executeBatch`/`transaction` park on it and start from a `setImmediate`, everything else applies at call time. Submission order is ordinary JS scheduling, so the suite CAN hold it. Drain the lock with `settleDbWrites()` (`src/test-utils/`) wherever a test asserts on an un-awaited write; a suite on fake timers owns `setImmediate` too, so it must either pay 1ms of clock per macrotask or opt out with `jest.useFakeTimers({ doNotFake: ['setImmediate'] })`.
- **Multi-statement writes MUST use `runAtomicBatchAsync`.** It is the only way to get all-or-nothing. It brackets the statements in `SAVEPOINT`/`RELEASE` inside one `executeBatch` and enqueues the `ROLLBACK TO` in the *same tick* — because an aborted batch never reaches its `RELEASE`, and recovering from the JS `catch` leaves the savepoint open across a round trip while the pool keeps draining, silently swallowing other writers' work. That was a real shipped bug.
- **`runBatchAsync` is NOT atomic**, whatever any comment says. op-SQLite's `opsqlite_execute_batch` has its `BEGIN` commented out and aborts on the first failure with everything before it committed. Use it only where a half-applied run is self-repairing.
- **`withTransactionSync` issues its BEGIN on the JS thread**, bypassing the pool, and hard-fails on Android if a pool transaction is open. Use it only where nothing else writes (boot, the migration chain). At runtime, `await awaitDbWritesIdle()` from `db/client.ts` first — logout is the only such caller today.
- **Never `INSERT OR REPLACE` into a table other rows FK to.** It is DELETE-then-INSERT and fires `ON DELETE CASCADE`, wiping children silently. Always `INSERT … ON CONFLICT DO UPDATE`.
- **A promise you will await later still needs a handler now.** A write kicked off without `await` (the `bulkUpsert` pipeline) is an unhandled rejection until something observes it.

### Data model

- The **normalized tables are the source of truth** (`src/db/schema.ts`); all reads go through `src/db/repository/*`. The legacy blob/KV caches are frozen and being retired — do not write to them.
- **Download `queue_position` values are UNIQUE but deliberately NOT dense.** Renumbering to close gaps is O(N²) across a full-library download. See `plans/download-queue-position-density.md` before "fixing" the holes.
- Boot calls `ensureNormalizedSchema` once, at module scope. Runtime callers were removed; do not add one.

### Working on the data model

- **Two upsert policies, and picking the wrong one loses data.** A writer that enumerates the whole entity (the library sync, a full `getAlbum`) overwrites authoritatively. A **supplementary** writer holding a partial view (a list endpoint, `getArtist`'s album array) must pass `merge: true` — `COALESCE(excluded.col, col)` — or it blanks every column its payload omits. The merge flag also skips the child DELETE/INSERT when the payload carries no child rows, because a COALESCE cannot protect a child table and an absent child set means "no opinion", not "none". This was a live bug: opening an artist wiped album genre/year/MBID until the next full sync.
- **Regenerating the DDL** after editing `src/db/schema.ts`: `rm -f src/db/migrations/*.sql && rm -rf src/db/migrations/meta` → `npx drizzle-kit generate` → `node scripts/build-normalized-ddl.js`. The build script requires exactly ONE .sql file (a full schema, not a delta) and errors out otherwise. Never hand-edit `normalizedDdl.ts`.
- **Every new table must be classified** in `MODEL_TABLES` (server-scoped; logout drops it) or `KEPT_TABLES` (permanent user data) in `createNormalizedTables.ts`. A suite guard enforces it, and the allowlist fails CLOSED — an unclassified table is never dropped, so a server-scoped one would leak between accounts.
- **FK to your own parent, never to `songs`.** Only true song children (`song_artists`, `song_genres`, …) reference `songs`. A table that merely holds a song id (`artist_top_songs` is the model) must not, because the song need not be in the library — and with `PRAGMA foreign_keys = ON` the INSERT fails outright.
- **The RELEASED tag is the baseline, never `master`.** The store version is what users actually have; everything past it exists only on the owner's test devices. Before reasoning about what a user's database, store or blob looks like, read the shipped file — `git show v<latest>:<path>` — because a store's `partialize`, a table's columns and the migration counter all differ on master. This has produced wrong plans more than once. It also means **migrations past the released counter are freely mutable**: reorder, merge, renumber or move them out of the chain as needed; only the released ones are fixed.
- **The legacy blob tables are retained deliberately and stay commented out until the owner says otherwise.** `library_albums`, `song_index` and `album_details` are kept so the blob→SQL conversion can be re-run and re-tested on a device. The task that drops them is the LAST in the migration list and is disabled on purpose — not forgotten, not blocked on a bug. Do not enable it, and do not infer a reason for the comment other than this one.
- **Hydrate stores from SQL in `rehydrateAllStores`**, not from a store's persist config. `headlessMediaService` runs the same pair before building the CarPlay browse tree, so doing it there makes headless work for free.

### Testing reality

- **Jest reproduces the SUBMISSION order, not the pool.** The substitute (`src/db/testing/opSqliteBetterSqlite3.ts`) carries op-SQLite's transaction lock, so which writes are visible to a later read is checkable in the suite — that is JS scheduling. What it cannot reproduce is the native pool draining underneath: no thread, no interleaving window mid-batch. A concurrency claim of that kind still needs a throwaway on-device spike; that is how the open-savepoint window (section 11, "The write path") was found. The rebuild's spike screens were deleted on 2026-08-08 — recover one from git history rather than reasoning from the suite.
- Where a hazard is device-only, say so in the plan rather than implying the suite covers it.

---

## 12. Project Learnings

**Accumulated corrections. This section is for the agent to maintain, not just the human.**

When the user corrects your approach, append a one-line rule here before ending the session. Write it concretely ("Always use X for Y"), never abstractly ("be careful with Y"). If an existing line already covers the correction, tighten it instead of adding a new one. Remove lines when the underlying issue goes away (model upgrades, refactors, process changes).

- **Plain text only — never typographic symbols like the section sign, pilcrow, daggers or similar as shorthand.** Write "section 12", not a glyph. Applies to every artefact the agent writes: chat, plans, commit messages, comments, docs. The glyphs are ambiguous to read aloud, unsearchable, and look like noise in a terminal.
- **Never defer a pre-existing defect you find on the way.** If work uncovers a bug in shipped code, it goes in scope and gets its own commit. Do not relay a subagent's "out of scope" as if it were settled.
- **Don't soften a rule to fit what the code does.** A lazy `require()` in a service was described as "adjacent to the rule" because the rule said "store actions"; it was a breach. When shipped code violates the *rationale* of a rule, the finding is a breach and the rule's wording is what needs fixing.
- **Migrations run SEQUENTIALLY, in id order, exactly ONCE per install. Stop reasoning about old migrations as if they could fire after the current model landed.** `getPendingTasks` returns `id > completedVersion` and runs them in order, so a lower-numbered task can never execute after a higher-numbered one, for anybody. An old migration is history: it runs only for an install that has not reached that version, and always *before* everything after it. Two wrong claims came out of forgetting this — "m17 will re-add `raw_json` so the drop brings the column back" (it cannot; m17 runs first, the drop runs later, end state is dropped) and framing a within-chain ordering question as old migrations interfering with the remodel. If a genuine ordering concern exists it is between two tasks *in the same run*, so say which two and in which order — never "an old migration might run later". **And an old migration is FROZEN: it writes the model that existed when it was written, and is never retro-fitted to a later schema.** "Should m14 also write the new tables?" is not a question — m14 predates them. A new migration handles the new model; that is what new migrations are for.
- **Text an agent wrote earlier is not project convention, and checking that it predates THIS session proves nothing.** Most prose in this repo — comments, docs, even parts of this file — was agent-authored. Citing it back as established practice is circular: it is your own output wearing the project's clothes. If a term, pattern or claim needs authority, its source is the owner, the code's behaviour, or an external spec — never "it was already written down here". This bites hardest with jargon: a coinage gets used once, appears in the repo, and is then defended as house vocabulary by the agent that coined it. Plain words, unless the owner used the jargon first.
- **Our own comments are what someone believed when they wrote them, not authority.** Cite them as a lead, verify against the code before repeating them as fact, and correct them when they are wrong. Three of the four lazy `require()`s cited cycles or test needs; `madge` found no cycle at any of them. `childFromCachedSong`'s docstring claimed it "carries every field the cached row holds… never narrow a reconstruction to today's consumers" while emitting 7 of ~50. `resetNormalizedSchema`'s docblock still says full-resync is its only caller; logout calls it too. A comment that has drifted is worse than none, because it reads as confirmation.
- **The same goes for a spec's "must".** It tells you what a conformant server owes you, not what the servers in the wild actually do — `probeEmptySearch3` exists because a documented requirement was not universally honoured. Never present a spec guarantee as evidence of real-world behaviour.
- **A single green suite run is not evidence when the suite has ever been flaky.** Two screen suites failed intermittently under full-suite load for a whole session while passing alone; every "gate green" in between was a sampled run that happened to pass. When a failure looks flaky, characterise it — alone, paired, full, repeated — before dismissing it. Fixed by `asyncUtilTimeout`/`testTimeout` in `src/test-utils/asyncTimeouts.ts`; if it returns, raise both and keep the 3× margin.
- **Comments state what a developer needs to know, not how it was discovered.** A comment exists so someone working on the code can see what it does, what it needs, and any quirk they could not infer from reading it. Concise, focused, factual. No narrating the investigation, no recapping the bug report, no arguing the case, no "this used to…", "an earlier version…", "previously…", "rev 1 said…", no commit hashes, no `plans/` paths. That is project worklog, and worklog in source is terrible practice — it belongs in the commit message or `plans/`. If it takes more than ~3 lines, it is not a comment. Match the density of the surrounding code.
- **NEVER put ticket numbers in code comments — ours or GitHub's.** `(#202)`, `issue #90`, `migration #33`, `task #14`, `Pre-#159` — all out. A reader cannot resolve them, they rot, and they turn source into a worklog index. Describe the behaviour instead; if the detail is too big for that, it belongs in `plans/`. **The one exception is a THIRD-PARTY tracker reference for a workaround we carry until upstream fixes it** — `facebook/react-native#56343`, `software-mansion/react-native-screens#3786`, `Navidrome #3185`. Those are actionable: they tell the next reader when the workaround can go. Always qualify them with the project name.
- **Don't describe intended behaviour as a "quirk", "legacy" or a workaround.** Twice in one session that framing sent work down a wrong path — a design decision was filed as a bug, and a lazy `require()` was preserved on a cycle claim that was false. Say it is intended and why, in one line.
- **Fix native-layer inconsistencies in native code**, not with JS workarounds.
- **Verify a subagent's findings yourself** before acting on them, and before reporting them as fact. They are frequently right and occasionally confidently wrong.
- **Run sub-agents one at a time** on multi-phase work — protects context and avoids conflicting edits.
- **Never propose a fix for a symptom whose mechanism you have not observed.** A confirmed defect found on the way is not the cause until evidence links it to the symptom. Report the unexplained part as unexplained, and propose how to get the evidence, not a fix.
- **Read the app's existing settings and behaviour before asking the owner for a product decision.** If the app already defines it (e.g. the scrobble threshold `scrobbleTrigger`), that is the answer; do not propose a new rule.
- **Never invent evidence.** No fabricated user anecdotes or observations to support an argument.
- **Re-index Symdex after every commit** — its AST snapshot goes stale and post-commit searches silently return old results.
- **Don't paste plan/tracker contents back into chat.** Summarize the headlines; the file is the artifact.
- **Commit as you go; never spend time splitting a missed commit.** If changes piled up and do not separate cleanly by whole file, bundle them into one commit — no hand-built intermediate file states, no asking how to split.
- Affirmative action in a confirmation dialog uses a positive label (OK/Delete), never Cancel.
- User-facing copy: never a comma before "and"; write "one time" as two words, never "one-time".
- Shares exist for albums, playlists and the player queue — not individual songs.
- Drop a one-line status note when working silently for a long stretch.
