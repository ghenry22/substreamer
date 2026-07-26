# Changelog

## [8.0.91] - 2026-07-23

- chore: deps
- chore: deps
- ci: update coverage badge [skip ci]
## [8.0.90] - 2026-07-23

- fix(offline): downloaded items self-cache metadata and never auto-remove it
- Updated release notes
- ci: update coverage badge [skip ci]
## [8.0.89] - 2026-07-21

- docs(agents): close issues via "Closes #N" in the commit, never gh issue close
- ci: update coverage badge [skip ci]
- feat(playlist): edit name, description & public/private in edit mode
- feat(search): recent searches on the empty search screen
- ci: update coverage badge [skip ci]
## [8.0.88] - 2026-07-20

- ci: update coverage badge [skip ci]
- fix(keyboard): drop redundant statusBarTranslucent on KeyboardProvider
- perf(library): defer segment list render past the tap
- feat: keyboard-controller + input-sheet standardisation, playlist refresh, dep bumps
- fix(images): render cover art via expo-image, fixing Fresco crash
- chore: expo deps
- ci: update coverage badge [skip ci]
- fix(swipe): reserve left edge for iOS back gesture over row swipe (#217)
- fix(player): tint from dominant cover colour, not vibrant accent (#172)
- fix(tuned-in): genre-mix feedback + compound-genre resolution (#219)
- fix(tabs): contain the Android tab-bar ripple so it isn't clipped (#222)
- fix(overlay): never render ProcessingOverlay empty or trapping (#223)
- fix(subsonic-api): don't skip /rest path for .rest TLD hosts (#225)
- ci: update coverage badge [skip ci]
- perf(migrations): fast-track the no-op sweep on fresh installs
- ci: update coverage badge [skip ci]
## [8.0.87] - 2026-07-17

- feat: RNQP 1.0.9 + gray placeholder artwork; run player/scrobble init headless
- ci: update coverage badge [skip ci]
## [8.0.86] - 2026-07-15

- fix(image-cache): build variant URI via File/Directory so sanitised ids resolve
- docs: trim verbose/history-narration comments in the search feature
- feat(search): structured voice intent + restore artist results
- fix(search): non-blocking local-first + per-token scoring + result caps
- feat(voice): on-device voice-search diagnostics logging
- feat(search): local-first full-library routing for voice + in-app box
- feat(search): norm/dmeta columns on song_index + library_albums
- feat(search): fuzzy/phonetic offline search via searchMatch
- feat(sync): add fullSyncCompletedAt + libraryLastUpdatedAt to syncStatusStore
- feat(search): fuzzy-match core module (normalize, phonetic, tiered scorer)
- fix(voice): use structured song/artist fields, stop concatenating the query
- perf(db): index the song_index list sort (kills the 38k-row scan+sort)
- chore(deps): bump react-native-queue-player 1.0.7 → 1.0.8
- fix(image-cache): wipe on-disk files unconditionally on clear/logout
- chore(db): fix stale references left by the dead-code sweep
- refactor(db): remove dead persistence functions + their tests/mocks
- perf(db): wire last two interactive DB reads onto async
- perf(db): async music-cache write API + atomic refcount orphan (Phase 2)
- refactor(sqlite): async DB writes Phase 1 — move interactive paths off the JS thread
- fix(sqlite): serialize all async writes on one connection-wide mutex + tuning PRAGMAs
- ci: update coverage badge [skip ci]
## [8.0.85] - 2026-07-11

- chore(deps): bump react-native-queue-player to 1.0.7
- feat(library-sync): capability-probed paged search3 + download-refcount cleanup
- fix(intl): use baseCollator, not localeCompare, in headless media service
## [8.0.84] - 2026-07-10

- refactor(headless): headlessMediaService rename + shared offline data path
## [8.0.83] - 2026-07-09

- fix(carplay): headless divergence fixes + offline snapshot refresh
- chore: fix some npm audit findings
## [8.0.82] - 2026-07-08

- chore: bump expo deps
- chore: bump react-native-queue-player to 1.0.2 (ktor R8 proguard fix)
## [8.0.81] - 2026-07-07

- chore: bump reanimated and worklets (resolves worklets specific crash on android)
- chore: deprecation warnings for local expo modules
- chore: expo sdk57 update
- chore: expo-doctor dep bumps
## [8.0.80] - 2026-07-06

- feat(car): CarPlay + Android Auto support
- refactor(home): extract album-list composition into homeSectionsService
- adjustment for cache config to app start
- feat(settings): live cache-usage bar in the playback cache card
- feat(player): ReplayGain loudness normalisation setting
- style(player): unify playback-source badge icons
- refactor(settings): tidy Sound & Playback layout and copy
- feat(player): graphical equalizer
- feat(player): enable pitch correction at non-1x speed
- feat(player): gapless / crossfade playback mode setting
- feat(scrobble): configurable milestone for the playback report
- feat(rnqp): lookahead cache + source badge, buffered fix, background-CPU throttling
- chore(rnqp): bump react-native-nitro-modules to 0.36.1
- fix(rnqp): dedupe React via Metro resolver (fixes route picker crash)
- feat(rnqp): audio route picker (Cast + AirPlay/Bluetooth)
- chore(rnqp): delete vendored react-native-track-player fork (E4)
- chore(rnqp): cutover native config — remove RNTP, enable RNQP plugin
- feat(rnqp): migrate player core from RNTP fork to react-native-queue-player
- chore(rnqp): add react-native-queue-player + nitro-modules deps
- ci: update coverage badge [skip ci]
## [8.0.79] - 2026-07-02

- fix(player): keep hero gradient colour across player tab switches
- fix(player): always play downloaded tracks from disk, never stream
- ci: update coverage badge [skip ci]
## [8.0.78] - 2026-07-01

- release notes
- ci: update coverage badge [skip ci]
## [8.0.77] - 2026-06-29

- fix(#209): lift BottomSheet above the on-screen keyboard
- ci: update coverage badge [skip ci]
- perf(#200): drop NetInfo HTTP reachability probe; connection state from isConnected
- refactor(connectivity): rename isInternetReachable -> hasConnection
- perf(#200): slow healthy server-ping heartbeat 10s -> 60s
- ci: update coverage badge [skip ci]
- perf(#200): pause server-ping heartbeat while backgrounded
- perf(#200): gate NetInfo reachability probe to the foreground
- perf(#200): dedupe NetInfo-triggered server pings
- perf(#200): gate shouldFetchWiFiSSID to home-wifi auto-offline
- i18n(ru): apply 3 validated fixes from PR #184
- i18n: enable Japanese as a selectable language
- ci: update coverage badge [skip ci]
- Merge pull request #194 from ghenry22/crowdin-translations
- i18n: update translations from Crowdin
- ci: update coverage badge [skip ci]
## [8.0.76] - 2026-06-28

- fix(download): make song download-status reactive on removal
- ci: update coverage badge [skip ci]
- refactor(moreOptions): collapse the duplicated isPlayerSource branches
- refactor(moreOptions): extract MoreOptionsRow primitive
- refactor(player): extract useCoverGradient hook
- refactor(player): extract usePlaybackState hook
- refactor(offline): extract reusable SettingsRow primitive
- refactor(offline): SSID prompt Modal → BottomSheet
- refactor(offline): extract useHomeWifiSetup hook
- refactor(musicCache): split reconcile god-function into named passes
- perf: small Phase-5 polish (search memo, icon types, scrobble key)
- perf: derive row tap action from props, not inline closures
- refactor: extract DetailHeroButtons (shuffle + play-all)
- refactor: extract useDetailFetch for the 3 detail screens
- refactor: extract DetailScreenBackground for the 3 detail screens
- refactor: extract confirm() for two-button confirmation dialogs
- refactor: extract runWithOverlay() for the processing-overlay flow
- refactor: extract mergeExistingWins() for backup-restore merges
- refactor: extract bumpPlayStats() store helper
- refactor: extract onAppForeground() for the AppState foreground listeners
- refactor: route date formatting through a cached Intl util
- docs: relocate misplaced JSDoc; drop dead download accumulators
- refactor: hoist Subsonic client/version to named constants
- docs: fix stale and misleading comments
- refactor: drop two verbatim formatter copies for shared utils
- refactor: centralize unknown-error to message coercion in errMessage()
- fix: correctness hardening from holistic review
- fix(sync): consume change-detection markers once at startup
- chore(i18n): remove unused translation keys
- chore: drop redundant export keywords
- chore(store): remove superseded dead actions
- chore: fix stale comments and remove component orphans
- test: eliminate React act() warnings from async state updates
- refactor(store): drop write-only dead state fields
- chore: remove dead test hooks and orphaned helpers
- ci: update coverage badge [skip ci]
- chore: remove dead connectivity-restored hook
- perf(startup): de-duplicate the cold-start home-list refresh
- perf(startup): defer heavy housekeeping stages to idle
- refactor(startup): shared runWhenIdle util; defer recache drain to idle
- feat(image-cache): dismissible error banner when a refresh cycle fails
- fix(boot): defer persisted-queue restore until after the animated splash
- chore(i18n): drop stale failover keys from locale files
## [8.0.75] - 2026-06-26

- refactor(player): remove transcode-offset resume mechanism (#197)
- fix(shares): rebuild share links from the configured server URL
- chore(deps): bump in-range patch/minor updates
- refactor(failover): replace auto-switch with detect-and-confirm
- fix: catch unguarded async rejections in auto-offline + failover
- chore(migration): clear persisted player queue once for a clean restart
- fix(player): harden transcoded-stream recovery + detection
- fix(failover): rebuild queue + reload covers on server switch
- fix(cover-art): resolve covers by the coverArt value, not entity ID
- fix(player): skip past the current track under repeat-one
- fix: sync libraries larger than 10k albums
- fix(ios): don't crash on uncaught exception in async void TurboModule
- fix(android): repeat remote Next/Previous over Bluetooth (#205)
- feat(settings): trust untrusted server cert inline when editing URL
- feat(settings): legacy-auth toggle with verify-before-commit
- fix(ssl-trust): raise iOS streaming proxy idle timeout to 300s
- fix(ssl-trust): never pin a certificate the system already trusts
- ci: update coverage badge [skip ci]
## [8.0.74] - 2026-06-15

- fix(player): remove Android swipe-to-dismiss that blocked now-playing controls
- ci: update coverage badge [skip ci]
- chore(deps): bump @shopify/flash-list to 2.3.2 and expo SDK 56 patch releases
- ci: update coverage badge [skip ci]
## [8.0.73] - 2026-06-13

- release notes
- chore(fastlane): refresh store release notes
- ci: update coverage badge [skip ci]
- fix(lyrics): crash when app backgrounded with lyrics screen open
- ci: update coverage badge [skip ci]
- i18n: cherry-pick new keys from Crowdin PR #162
- i18n(zh-Hant): pull in translation corrections from #181
- ci: update coverage badge [skip ci]
- fix(i18n): drop orphaned albumCacheRefresh keys from locales
- feat: playback speed picker bottom sheet
- chore(ios): enable CarPlay audio entitlement (build 157)
## [8.0.72] - 2026-06-09

- fix(tuned-in): suppress Jump back in flash before For You renders
- fix(ssl-trust): Android first-time trust + iOS proxy + server-address UI
- docs(agents): non-negotiable rule — never assume, never guess, always validate
- debug+fix(ssl-trust): proxy diagnostics + ensureRunning duplicate-listener fix
- fix(ssl-trust): clear ALL native certs on logout (query native, not JS list)
- fix(ssl-trust): clear native trust + stop proxy on logout
- refactor(ssl-trust): NSURLSession swizzle for login/browse, proxy only for AVPlayer
- fix(ssl-trust): don't reconcile proxy upstreams on trust (clobber race)
- fix(login): prompt to trust self-signed cert on iOS (RN reports -1005)
- chore: gitignore tools/ (local dev test harnesses with personal server details)
- feat(expo-ssl-trust): iOS self-signed support via in-plugin loopback proxy (#175)
- perf: move cached-download deletes off the JS thread (async unlinks)
## [8.0.71] - 2026-06-08

- fix(expo-ssl-trust): make the trust store thread-safe + guard unsafe casts
- fix(expo-async-fs): iOS space-tolerant path resolution
- fix(expo-gzip): iOS truncation detection + dest-dir parity with Android
- fix: clear/unref lingering background timers (clean jest worker exit)
- fix: clean up useShuffleOverlay on unmount; atomic delete in usePlayerAlbumInfo
- fix: unref the debounced-persist flush timer so jest exits cleanly
- fix: don't drop a mid-switch failover intent; unblock awaitFirstPing on no-API
- fix: surface HTTP errors + missing envelope in subsonic-api requestJSON
- fix: make redownloadTrack atomic (download to .tmp, then swap)
- perf: stabilise home FlashList separator/data + album-detail keys
- fix: ignore transitional NetInfo 'unknown' state in auto-offline
- chore: remove remaining dead code; fix MiniBarChart highlight no-op
- perf: debounce+defer persist for artist/playlist detail stores
- fix: stop unbounded envelope-cache leak in musicCacheStore
- fix: hash UTF-8 bytes in the forked md5 so non-ASCII passwords authenticate
- fix: guard player recovery/retry/queue-insert against mid-await track changes
- fix: serialize song_index async transactions to prevent torn writes
- feat: add root React error boundary
- chore: remove dead code found in post-refactor audit
- feat(image-cache): scan-on-open settings + clearer browser repair feedback
- refactor(image-cache): async, DB-authoritative cover-art resolution
- fix: render cover art with plain Image, not reanimated opacity
- fix: cap BottomSheet to screen height and scroll tall content
- fix: responsive Now Playing layout for very small screens (#90)
- fix: mark location hardware features optional so GPS-less devices aren't filtered
- feat: swipe-down to dismiss the player on Android
- refactor: move battery-optimization card to Sound & Playback settings
- fix: even spacing of secondary player controls on short screens
- fix: expo-move-to-back Android Kotlin compile error
- feat: Fire-OS background-playback guidance (#136)
- fix: default RNTP ExoPlayer wake mode to NETWORK
- fix: exclude __mocks__ from RNTP publish build (TS6 jest-types regression)
## [8.0.70] - 2026-06-04

- fix: serve cover-art lookup from an in-memory index, not sync FS
- fix: build track maps after cachedSongs hydration
- fix: downloaded-music edge cases + enable timer/skip buttons
- fix: centralize partial-download indicator colour
- fix: store full song Child in song_index so the Songs list keeps all metadata
- fix: don't offer scrobble-exclusion for playlists in More Options
- fix: revert My Listening recentScrobbles memoization
- fix: move recentScrobbles useMemo above My Listening early returns
- perf: JS-only sync→async (review E/G)
- perf: native modules + off-thread filesystem (review C/F/H)
- refactor: drop dead sync hydrateFromDb store methods (review D)
- refactor: remove dead sync fetchAllSongsByTitle (review D)
- perf: single-pass offline genre list for Tuned-In builder (review A.3)
- perf: async writes for queue + album detail; gate fetch-on-empty (review A.1/A.2/B)
- fix: review follow-ups — resetAllStores drop order, hydration gate, docs
- perf: debounced deferred-stringify writes for library stores (phase 4)
- perf: async kvStorage adapter off the JS thread (phase 3)
- perf: async boot rehydration off the JS thread (phase 2)
- perf: defer sync hot-path work off the JS thread (phase 1)
- Merge branch 'perf/flakiness-cleanup-sdk56': post-SDK56 flakiness fixes
- perf: fix post-SDK56 flakiness (freezes, blank lists, car art, songs)
- ci: update coverage badge [skip ci]
## [8.0.69] - 2026-06-02

- fix: deprecation
- ci: update coverage badge [skip ci]
- Merge pull request #165 from ghenry22/perf/songs-library-prewarm
- perf(library): keep songs cache warm + fetch off the JS thread
- ci: update coverage badge [skip ci]
- Merge pull request #164 from ghenry22/feat/tablet-portrait-player
- feat(player): tablet-portrait mini player
- feat(downloads): add Download Full Library (#88)
- feat(tuned-in): tablet layouts + multi-decade builder; fix Intl timezone
- chore(deps): bump Expo SDK 56 patch releases
- feat(player+cache): player reorg, tablet-portrait rework, canonical cover-art IDs
- fix(player): align secondary control row under the primary row
- feat(player): add bookmark button to expanded player secondary row
- feat(player): rework tablet-portrait top section to a horizontal band
- refactor(player): use shared Favorite/Bookmark buttons in all 4 players
- refactor(player): extract shared FavoriteButton + BookmarkButton
- test(player): expect 2 shuffle buttons in queue tab (controls + header)
- feat(player): route /player to TabletPortraitPlayer on tablet portrait
- feat(player): add TabletPortraitPlayer screen
- feat(player): add UpNextPanel inline draggable queue/info/lyrics panel
- refactor(player): migrate PlayerPanel onto shared shuffle/queue hooks
- refactor(player): migrate ExpandedPlayerView onto shared shuffle/queue hooks
- refactor(player): migrate PlayerView onto shared shuffle/queue hooks
- refactor(player): extract shuffle overlay + queue actions into shared hooks
- ci: update coverage badge [skip ci]
## [8.0.68] - 2026-05-31

- ci: update coverage badge [skip ci]
- Merge pull request #161 from ghenry22/crowdin-translations
- i18n: update translations from Crowdin
- feat(bookmarks): capture & restore play-queue bookmarks
- fix(downloads): authoritative expectedSongCount; classify singles correctly (#159)
- feat(search-overlay): dynamic sizing, pinned see-more, unified loading
- chore(migrations): drop one-shot pre-release reset
## [8.0.67] - 2026-05-27

- docs(migration-25): refresh comment for post-refactor image cache
- refactor(image-cache): phase 4 — queue state merge + drop redundant Async suffix
- refactor(image-cache): phase 3 — fold wipeImageCacheForLogout into clearImageCache
- refactor(image-cache): phase 2 — consumer migration to clean API names
- refactor(image-cache): phase 1 — rebuild CachedImage on 3-state model
## [8.0.66] - 2026-05-27

- fix first load image cache and remove some packages from expo exclusions as expo recommended versions have caught up
- i18n(en): rename "Audio Diagnostics" section to "Player Logging"
- fix(player): align shuffle with proven reset+add path
- refactor(migrations): consolidate unshipped 22-26 + add one-shot reset
- refactor(player): extract stateless helpers to playerHelpers
- refactor(cached-image): unify errorSuppress clear-paths around R7
- refactor(settings/index): split SettingsLinkRow + VersionFooter
- refactor(settings/library-data): decompose into per-card components
- refactor(settings/server): decompose into per-card components
- refactor(settings/connectivity): decompose into per-card components
- refactor(settings/storage): decompose into per-card components
- refactor(settings/appearance): decompose into per-card components
- refactor(settings/playback): decompose into per-card components
- feat(settings): add shared primitives for upcoming decomposition
- refactor(image-cache): unify clearImageCache + wipeImageCacheForLogout
- refactor(backup): extract writeBackupDataset helper
- refactor(image-cache): delete mount-time microtask cacheAllSizes
- refactor(image-cache): delete boot-retry + connectivity-store subscriber
- refactor(image-cache): delete post-Migration-25 dead code
- perf(search): rewrite offline search around cachedSongs only
- refactor(sync): name STARTUP_PREFETCH_SETTLE_MS
- refactor(failover): use shared withTimeout util in pingUrl
- chore(logging): rename migration-log screen to logging
- chore(i18n): drop 22 unreferenced en.json keys
- refactor(alerts): delete dead alertProps shim + local ThemedAlert renders
- ci: update coverage badge [skip ci]
- feat(library): Songs segment + matching row/list padding alignment
- feat(song_index): add album column + Migration 26 backfill
- feat(settings): album cache refresh dropdown with simpler labels
- fix(cover-art): fire fetch on mount, not just after debounce
- fix(cover-art): self-retry boot-race when cacheAllSizes lands no file
- fix(image-cache): correct disk-usage accounting for resized variants
- fix(cover-art): unstick CachedImage on server-reachable transition
- feat(image-cache): Migration 25 — wipe image cache for entity-ID model
- fix(cover-art): key cover-art lookups off entity IDs everywhere
- revert(cover-art): drop the _\d+$ parent fallback in getCachedImageUri
## [8.0.65] - 2026-05-25

- ci: update coverage badge [skip ci]
- feat(more-options): Play Next action for songs (#149)
- ci: update coverage badge [skip ci]
- fix(expo-screen-orientation): silence iOS 16+ deprecated-API warning
- fix(settings-server): align Log out button width with Change Password
- feat(failover): transient banner for auto-failover switches
- feat(failover): wire connectivityService → failoverService via hooks
- feat(failover): Settings → Connectivity — Server Failover card
- feat(failover): Settings → Server & Account — Secondary URL field
- feat(failover): failoverService — switchToServer + pingUrl + recovery poller
- feat(failover): rebuildQueueForServerSwitch in playerService
- feat(failover): authStore schema for primary + secondary server URLs
- ci: update coverage badge [skip ci]
- fix(more-options): unblock chained-modal opens on android
- fix(streak): align timeAgo "yesterday" + daily-activity chart with calendar dates
- feat(my-listening): make items tappable to play / navigate (#102)
- ci: update coverage badge [skip ci]
- fix(cover-art): fall back to parent ID for per-track _N coverArt variants
- fix(cover-art): reactive cache subscription + 600px source-size fallback in CachedImage
- fix(image-cache): native sanitisation pipeline + drop dead format=jpg recovery
- ci: update coverage badge [skip ci]
## [8.0.64] - 2026-05-24

- fix(detail): unify hero positioning on paddingTop, drop iOS contentOffset
- ci: update coverage badge [skip ci]
## [8.0.63] - 2026-05-24

- ci: update coverage badge [skip ci]
- refactor(settings): move Metadata Refresh + Artist Play Mode to better homes
- chore(deps): SDK 56 patch bumps + safe minor/patch updates
- build(metro): add default metro.config.js to satisfy expo-doctor
- refactor(album-lists): rename maybeRefreshAll → refreshAllIfDue
- feat(home): auto-refresh album lists on launch + foreground
- feat(share): add single-song sharing to the more-options menu
- fix(stale-id): persist queue after reactive recovery so restarts don't re-recover
- fix(stale-id): conservative defaults for metadata-refresh threshold
- feat(stale-id): proactive metadata refresh before queue load
- feat(stale-id): persist album-wide recovery on stream-failure self-heal
- fix(player): self-heal stale song IDs on playback failure
- docs(bottom-sheet): clarify when onCloseComplete is needed (audit follow-up)
- fix(more-options): await BottomSheet teardown before opening chained modals
- fix(more-options): top up 'Play More Like This' with layered fallbacks
- fix(tuned-in): honour era filter in Build-A-Mix when no genres selected
- fix(image-cache): center the refreshing-progress text
- fix(image-cache): hide in-flight covers from incomplete count + tidy refresh UI
- fix(ios): bump local-module podspecs to iOS 16.4
- feat(image-cache): Phase 5 — settings UI overhaul
- feat(image-cache): Phase 4 — drop legacy cover-art-recache kvStorage blob
- feat(image-cache): Phase 3 — store + banner rename + cutover
- feat(image-cache): Phase 2 — queue worker + recovery + pause/resume/cancel
- feat(image-cache): Phase 1 — persistent download-queue table
- fix(cover-art-recache): include per-song covers (downloaded playlists)
- fix(connectivity): debounce server-unreachable banner
- fix(home): add drawDistance to horizontal FlashLists
- fix(home): genre chips disappearing until app restart
- refactor(cover-art-recache): move banner to BannerStack as a pill
- chore(deps): upgrade TypeScript 5.9.3 → 6.0.3
- refactor(icons): migrate @expo/vector-icons → @react-native-vector-icons/*
- build(android): opt into expo-build-properties usePrecompiledHeaders
- fix(patches): rebase patch-package patches onto RN 0.85.3 + screens 4.25.2
- chore(deps): upgrade to Expo SDK 56 / React Native 0.85.3
- ci: update coverage badge [skip ci]
## [8.0.62] - 2026-05-23

- fix(deps): restore node-addon-api — required by sharp's native install
- ci: update coverage badge [skip ci]
## [8.0.61] - 2026-05-23

- build(modules): discover tested modules dynamically instead of hardcoding
- build(android): move ProGuard rules to a versioned .pro file
- refactor(split-layout): gate timer callbacks behind a transition-id ref
- refactor(player): extract usePlayerAlbumInfo + usePlayerLyrics hooks
- refactor(boot): move lifecycle-sensitive subscriptions out of module scope
- fix(library): honor empty fetches + capture reconcile baseline at commit time
- feat(persistence): surface degraded-mode + refuse login when SQLite unavailable
- refactor(persistence): per-store rehydration with structured result
- refactor(boot): isolate deferred-startup stages with per-stage try/catch
- fix(deps): restore node-gyp — required by sharp's native install
- ci: update coverage badge [skip ci]
## [8.0.60] - 2026-05-22

- release: v8.0.59
- ci: update coverage badge [skip ci]
- fix(now-playing): resume animation after pause → play
- ci: update coverage badge [skip ci]
- feat(settings-server): editable server URL with test gate (#145)
- ci: update coverage badge [skip ci]
- feat(track-row): animated now-playing indicator across detail views
- ci: update coverage badge [skip ci]
- fix(artist-bio): reliability pass for MusicBrainz + Wikipedia lookup
- refactor(track-row): widen titles via two-line metadata layout
- feat(image-cache): use raw server cover-art IDs end-to-end
- fix(deps): restore expo-system-ui — required by app.json userInterfaceStyle
- chore(deps): clean up unused packages + apply non-major bumps
- feat(backup): tag backups with source device + offer merge restore
- fix(album-detail): disable non-downloaded tracks in offline mode
- fix(image-cache): connectivity-gated purge for stuck-incomplete rows
## [8.0.59] - 2026-05-22

- fix(now-playing): resume animation after pause → play
- ci: update coverage badge [skip ci]
- feat(settings-server): editable server URL with test gate (#145)
- ci: update coverage badge [skip ci]
- feat(track-row): animated now-playing indicator across detail views
- ci: update coverage badge [skip ci]
- fix(artist-bio): reliability pass for MusicBrainz + Wikipedia lookup
- refactor(track-row): widen titles via two-line metadata layout
- feat(image-cache): use raw server cover-art IDs end-to-end
- fix(deps): restore expo-system-ui — required by app.json userInterfaceStyle
- chore(deps): clean up unused packages + apply non-major bumps
- feat(backup): tag backups with source device + offer merge restore
- fix(album-detail): disable non-downloaded tracks in offline mode
- fix(image-cache): connectivity-gated purge for stuck-incomplete rows
## [8.0.58] - 2026-05-01

- i18n(splash): translate migration validating/complete subtitles
- release: v8.0.57
- ci: update coverage badge [skip ci]
- fix(image-cache): recover from offline-mode errorSuppress on reconnect
- ci: update coverage badge [skip ci]
- refactor(image-cache): centralise logout wipe + diagnostics filenames
- ci: update coverage badge [skip ci]
- refactor(image-cache): consolidate scan/repair/refresh in service
- ci: update coverage badge [skip ci]
- fix(image-cache): unstick missing covers and add diagnostic logging
- ci: update coverage badge [skip ci]
## [8.0.57] - 2026-05-01

- fix(image-cache): recover from offline-mode errorSuppress on reconnect
- ci: update coverage badge [skip ci]
- refactor(image-cache): centralise logout wipe + diagnostics filenames
- ci: update coverage badge [skip ci]
- refactor(image-cache): consolidate scan/repair/refresh in service
- ci: update coverage badge [skip ci]
- fix(image-cache): unstick missing covers and add diagnostic logging
- ci: update coverage badge [skip ci]
## [8.0.56] - 2026-04-25

- docs(rules): consolidate project rules into AGENTS.md
- fix(android): MIUI/Redmi notification controls (re #87)
- fix(perf): cache Intl.Collator/DateTimeFormat to avoid Hermes #867 ANR
- android: edge-to-edge safe area handling improvement
- feat(library): article-stripped sort with server-supplied article list
- fix(chrome): hard-mount banner only when queue has work; don't cache null URIs
- feat(rows): standardise list-row trailing meta into fixed-width slots
- fix(home): auto-scale listening time to days so heavy totals fit the column
- feat(downloads): unified BottomChrome; remove routine playback toasts
- fix(downloads): hide banner when queue has only ghost-status rows
- feat(music-cache): preserve full Subsonic envelope; backfill partial albums
- fix(image-cache): guarantee placeholder, simplify CachedImage, sanitise disc IDs
- fix(image-cache): unstick incomplete rows and surface repair feedback
- fix(player): bulletproof queue resume on cold start
- ci: update coverage badge [skip ci]
## [8.0.55] - 2026-04-22

- ci: update coverage badge [skip ci]
- chore: gitignore .claude/scheduled_tasks.lock runtime lockfile
- ci: update coverage badge [skip ci]
- fix(expanded-player): reorder right-panel toggles to queue/info/lyrics to match PlayerTabBar
- fix(album-info): theme-aware skeleton fill so bars are visible in light mode
- feat(downloads): partial-album state, top-up, filter, cache-browser UI
- feat(scrobble): update play count + last-played locally on scrobble
- ci: update coverage badge [skip ci]
- fix(media): recover blank album art from broken cached images
- ci: update coverage badge [skip ci]
## [8.0.54] - 2026-04-21

- fix(palette): 2-stop gradient on phone layouts — secondary → theme bg
- ci: update coverage badge [skip ci]
- fix(palette): 3-stop gradient — primary/secondary at top, theme bg at bottom
- feat(palette): local expo-image-colors module replaces react-native-image-colors
- fix(android): suppress Fresco drawee-controller release race
- fix(settings-storage): spinner + min-display for image cache Scan button
- ci: update coverage badge [skip ci]
- fix(expo-image-resize): add missing android/build.gradle
- ci: update coverage badge [skip ci]
- fix(android): bypass expo-image-manipulator with a local resize module
- ci: update coverage badge [skip ci]
## [8.0.53] - 2026-04-21

- reset changelog
- ci: update coverage badge [skip ci]
- fix(player): make MiniPlayer and PlayerProgressBar share a single source
- ci: update coverage badge [skip ci]
- i18n(zh): fill 38 remaining English placeholders in zh-Hans + zh-Hant
- ci: update coverage badge [skip ci]
- i18n: round-2 defense of Apple-aligned values
- i18n: update translations from Crowdin (#121)
- ci: update coverage badge [skip ci]
- i18n(zh-Hant): full Taiwan Traditional pass from zh-Hans baseline
- ci: update coverage badge [skip ci]
- i18n: defend Apple-aligned zh-Hans and ru terminology
- ci: update coverage badge [skip ci]
- i18n: update translations from Crowdin (#120)
- i18n: Apple Music / Spotify terminology pass for 6 locales
- ci: update coverage badge [skip ci]
- i18n: update translations from Crowdin (#119)
- ci: update coverage badge [skip ci]
- fix(image-cache): drop isProcessing guard blocking bulk repair
- ci: update coverage badge [skip ci]
## [8.0.52] - 2026-04-20

- refactor(scrobbles): move pendingScrobbleStore to per-row SQLite
- chore(settings): remove My Listening nav row from Library & Data
- fix(lyrics): wrap long lines within viewport width
- fix(splash): start waveform ripple when visible so forward sweep plays
- fix(player): avoid hang when server unreachable in offline mode
- ci: update coverage badge [skip ci]
- feat(image-cache): Scan + Repair actions, auto-repair on reconnect
- ci: update coverage badge [skip ci]
## [8.0.51] - 2026-04-19

- fix(sync): skip cover prefetch during library sync; surface offline pause
- ci: update coverage badge [skip ci]
## [8.0.50] - 2026-04-19

- fix(release): stop clobbering curated store release notes
- ci: update coverage badge [skip ci]
- fix(lyrics): rewrite auto-scroll + tab visibility + UI polish
- chore(deps): patch-level bumps across Expo SDK 55 + ecosystem
- ci: update coverage badge [skip ci]
- chore: QA sweep hardening
- docs(release-notes): trim and refresh for next release
- fix(migration-log): use generic Share/Clear labels
- fix(home): render Mix It Up chip unconditionally
- refactor(image-cache): per-row SQLite replaces whole-tree FS walks
- refactor(persistence): consolidate into a single SQLite service
- feat(music-cache): migration 14 removes v1 blob after successful migration
- feat(music-cache): Music Downloads v2 + critical persistence fixes
- refactor(scrobbles): move completedScrobbleStore to per-row SQLite
- feat(sync): canonical album-data sync pipeline
- ci: update coverage badge [skip ci]
- fix(segment-control): boost background opacity to 85% for readability
- ci: update coverage badge [skip ci]
- fix(language-picker): use bottom sheet so list is scrollable on login
- ci: update coverage badge [skip ci]
- fix(tuned-in): respect list length setting for offline and multi-genre playlists
- ci: update coverage badge [skip ci]
## [8.0.49] - 2026-04-16

- docs: release notes
- ci: update coverage badge [skip ci]
- trim release notes
- fix(release): validate store metadata after changelog generation
## [8.0.48] - 2026-04-16

- ci: update coverage badge [skip ci]
- i18n(de): replace Song/Songs with Titel throughout German translations
- ci: update coverage badge [skip ci]
- i18n: remove directory path labels from translations
- ci: update coverage badge [skip ci]
- revert: remove --import-eq-suggestions from Crowdin upload
- i18n: complete fr/de/es/it translations, fill plural variants, enable eq suggestions
- ci: update coverage badge [skip ci]
- i18n: restore fr/de/es/it translations overwritten by Crowdin download
- ci: update coverage badge [skip ci]
- Merge pull request #113 from ghenry22/crowdin-translations
- i18n: update translations from Crowdin
- ci: update coverage badge [skip ci]
- i18n: add fr/de/es/it translations for lyrics, storage, and streak keys
- ci: update coverage badge [skip ci]
- feat(player): persist queue across restarts, recover raw streams on error
- fix(i18n): simplify crowdin.yml Chinese mapping to avoid export collision
- ci: update coverage badge [skip ci]
- i18n: translate hardcoded chrome strings, localize Intl calls
- feat(i18n): distinguish Simplified (zh-Hans) and Traditional (zh-Hant) Chinese
- feat(i18n): add _few/_many plural variants for Russian/Ukrainian
- ci: update coverage badge [skip ci]
- chore: disable PlaybackToast now that MiniPlayer is visible on all screens
- feat: show MiniPlayer as footer on detail, settings, and browser screens
- feat: add MiniPlayerFooter wrapper for non-tab screens
- ci: update coverage badge [skip ci]
- feat(lyrics): show breathing dots during instrumental gaps over 5s
- feat(lyrics): synthesize fake timings for eligible unsynced tracks
- feat(lyrics): add synced lyrics view with auto-scroll and tap-to-seek
- feat(lyrics): wire LyricsContent into phone and tablet players
- feat(lyrics): add lyrics data model, service, and store
- fix(subsonic-api): correct getLyricsBySongId response type
- ci: update coverage badge [skip ci]
- fix(player): bound album/artist/album-info fetches with timeouts
- feat(i18n): enable Russian and Simplified Chinese
- i18n: update translations from Crowdin (#107)
- ci: update coverage badge [skip ci]
- i18n: fill German, French, Italian, Spanish translations to 100%
- i18n: update translations from Crowdin (#104)
- ci: update coverage badge [skip ci]
- chore(i18n): translate missed strings, downgrade missing-key validation to warning
- fix(player): align album info skeleton with new layout
- fix(android): crash on startup when System appearance is selected
- style: normalize typography, spacing, and colors for UX consistency
- feat(home): add suffix prop to AnimatedNumber, show streak in days
- refactor(settings): restructure settings, add library-data and share-browser screens
- feat(server): fetch user roles via getUser, add role-aware capability helpers
- feat(theme): add green/orange semantic colors and shared viz palette
- ci: update coverage badge [skip ci]
- Merge pull request #94 from ghenry22/crowdin-translations
- i18n: update translations from Crowdin
- feat(artist): add play mode toggle for top songs vs all songs
- fix(i18n): translate hardcoded 'Current Queue' in share sheet
- feat: add native share sheet for share links with rich messages
- fix: restore swipe-left actions in cache browser screens
- fix: proactively cache cover art after store refreshes
- ui: redesign album info panel with centered hero layout and inline metadata
- docs: add plan persistence as non-negotiable project rule
- ui: redesign track info panel with format badge, genre pills, quick stats
- subsonic-api: add OpenSubsonic audio precision fields to Child
- audio: add effective format capture for downloads and queue
- fix(album): make artist name navigable from album detail
- fix(albums): refresh full library when new albums surface
- lists: update re-orderable lists away from deprecated library
- player: defer SkipIntervalButton SVG mount until transition completes (U21)
- refresh-control: bump key once after first mount (U22)
- auto-offline: retry stale cold-start NetInfo result (U19)
- scrobble: re-trigger queue processing on app foreground (U17)
- BottomSheet: defer programmatic close by one frame (U8)
- patch: react-native-screens fragmentWrapper memory leak (U7)
- RNTP fork: U6 sibling — Android coroutine + force-unwrap hardening
- expo-* iOS: replace force-unwraps with guarded fallbacks (U6 hygiene)
- RNTP iOS: replace as!-force-casts with safe rejects (U6 root cause)
- RNTP iOS: wrap TurboModule methods in NSException safe-call shim
- android: enable useLegacyPackaging to mitigate SoLoader startup crash
- eas: pin EXPO_USE_PRECOMPILED_MODULES=0 for production builds
- expo: bump expo, expo-router, expo-modules-core to latest 55.x patches
- docs: add non-negotiable commit message rule
- banners: drive expand/collapse with Reanimated instead of LayoutAnimation
- i18n: route consumers through local singleton to ensure Intl polyfills load
- android: harden migration runner against rehydration races and task failures
- android: harden backupService and backupStore against startup failures
- ci: update coverage badge [skip ci]
- RNTP fork: second-pass crash hardening from native module audit
- android: native module audit fixes, SSL trust resilience, init hardening
- audio: add some more playback base formats and server transcoding guides to support them
- ci: update coverage badge [skip ci]
- audio: add more streaming and download formats, allow for custom formats that users define.
- ci: update coverage badge [skip ci]
- player: tablet sleep timer parity + fix empty panel on first play
- ci: update coverage badge [skip ci]
- player: move sleep timer countdown to floating capsule on cover art
- android: crash and ANR hardening for SDK 36 / large libraries
- ci: reset changelogs
- ci: update coverage badge [skip ci]
- ci: fix tests
- player: missed some test updates for the sleep timer.
- player: sleep stop timer, configurable in settings to display or not on the player. Implemented at native level in RNTP fork.
- ci: update coverage badge [skip ci]
- publishing: add MiniMediaServer
- ci: update coverage badge [skip ci]
- Merge pull request #66 from ghenry22/crowdin-translations
- i18n: update translations from Crowdin
- ci: update coverage badge [skip ci]
- Publishing: add translation info to the repo and website
- ci: integrate Crowdin for community translations
- ci: update coverage badge [skip ci]
## [8.0.47] - 2026-04-05

- publishing: change log too long
- ci: update coverage badge [skip ci]
## [8.0.46] - 2026-04-05

- publishing: changelog trimmed
- ci: update coverage badge [skip ci]
- fix(android): resolve top 3 crash causes (57.6% of reported crashes)
- playlists: dynamic playlists, artist top songs, home screen lists (recently played, recently added etc) now all have dynamic length.  The length of lists can be configured in settings.
- ci: update coverage badge [skip ci]
## [8.0.45] - 2026-04-05

- publishing: trim changelogs
- ci: update coverage badge [skip ci]
- publishing: stash reddit images
- ci: update coverage badge [skip ci]
- android: fix miniplayer song title wrapping
- android: stop music playback and clear notification when app killed.
- il8n: Implement translation support.  English as base, create some initial translations for other languages where we have user base.  These are AI generated to provide a starting point, mechanisms for community contribution will be put in place for fixes and new translations
- ci: update coverage badge [skip ci]
- player: improve the player layout and enable lyrics and album info display on phone screens.
- ci: update coverage badge [skip ci]
- shuffle play: Add shuffle play button to album, playlist and favorite songs screens.
- ci: update coverage badge [skip ci]
- downloads: fix download resume to not redownload items that finished.
- ci: update coverage badge [skip ci]
## [8.0.44] - 2026-04-03

- ci: update coverage badge [skip ci]
- accessibility: When iOS reduce motion setting is enabled the static splashscreen is displayed for ~15s. This is because the animated splashscreen is used to trigger the transition and the animation never runs in reduce motion mode. The delay is a safety net that always dismissed the splash screen at 15 if nothing else does.
- ci: update coverage badge [skip ci]
- publishing: update readme and website
- backups: user and server scoped with allowance for same server accessed on a different URL.
- ci: update coverage badge [skip ci]
- player: skip previous behaviour aligned to industry standards.  If less than ~3s into track skip to previous otherwise seek to start of current track.  Rapid double click seeks to start and then skips back. Closes #55
- ci: update coverage badge [skip ci]
- RNTP: refactor events handling for android.  Make consistent with iOS behaviour. Resolve a bunch of issues with end of track events, stale data and no completion events for last tracks in queues. Closes #61
- player: fix seek on android, requires estimated content length when transcoding or all seeks fail. Audio Quality: add 192kbps
- ci: update coverage badge [skip ci]
- track options: Add track detail to more options sheet to provide much more detailed information on the file.
- ci: update coverage badge [skip ci]
- player: next and previous track buttons now properly disable when there is no valid action for them (ie first track or last track and no repeat).
- search: when tapping a song in results, only add that one song to the queue, not all the results
- ui: playback status toast on tuned in screen
- UI: Fix arrow placement on skip interval buttons UI: Fix spacing when skip interval buttons are shown
- docs: update local setup for cocoapods
- ci: update version in package-lock
- docs: update local setup guide
- CI: eas running metadata push when it shouldn't
- docs: update local environment setup guide
- chore: update gitignore
- ci: update coverage badge [skip ci]
- Tuned In: Add Mix It Up (totally random) chip to the homescreen and tuned in page
- wide view: smooth out animated entry and exit of the panel player
- Implement albumInfo on expanded player view.  Closes #49 Implement Album level MBID override when server picks the wrong ID. Update MBID override browser and backups to handle artist & album overrides Implement fallback artist name / album title fuzzy text search when no MBID or no result returned for the MBID
## [8.0.43] - 2026-03-30

- ci: update coverage badge [skip ci]
- CI: update release script to check metadata char limits
- ci: update coverage badge [skip ci]
- CI: updated change log for character limits
## [8.0.42] - 2026-03-30

- My Listening: Fix some stale coverart in My Listening, improve artist name icon, add pull to refresh
- tablet: unlock UI orientation for tablets
- UI: Review and clean up iconography with clearer and more specific icons
- Tablet layout improvements for #18
- ci: update coverage badge [skip ci]
- Show coverart in bottom sheets and context menus
- ci: update coverage badge [skip ci]
- WIP tablet layout for landscape mode and some clean up for tablet layout in portrait mode
- tablet: Add more breakpoints for gridview on tablets. Closes #42 WIP for #18
- ci: update coverage badge [skip ci]
- ci: fix badge push during rapid commits
- ci: update coverage badge [skip ci]
- migrations: fix a small additional issue with startup
- migrations: persist migration status so they don't run unnecessarily (speed up start up)
- publishing: only push images to playstore on change
- ci: update coverage badge [skip ci]
- ci: reset changelogs
## [8.0.41] - 2026-03-27

- ci: update coverage badge [skip ci]
- publishing: update server compatibility
- UI: max width for bottom sheets on tablets
- release: v8.0.40
- ci: update coverage badge [skip ci]
- UI: Update banner spacing animation
- auth: support legacy auth for Nextcloud Music & Ampache
- DOCS: AI Project instructions
- ci: update coverage badge [skip ci]
- publishing: get store release notes up to date for next version
- ci: update coverage badge [skip ci]
- ci: release notes for app stores
## [8.0.40] - 2026-03-27

- UI: Update banner spacing animation
- auth: support legacy auth for Nextcloud Music & Ampache
- DOCS: AI Project instructions
- ci: update coverage badge [skip ci]
- publishing: get store release notes up to date for next version
- ci: update coverage badge [skip ci]
- ci: release notes for app stores
## [8.0.39] - 2026-03-26

- playlists: empty state placeholder when offline with no downloaded content
- shares: can't manage shares when offline as requires API access
- onboarding: centered on larger screens and tablets
- ci: update coverage badge [skip ci]
- publishing: add favicon for web
- ci: update coverage badge [skip ci]
- publishing: web content update
- ci: update coverage badge [skip ci]
- publishing: handle ios editable version incrementing
- ci: update coverage badge [skip ci]
- subsonic-api: add tests to the forked package
- docs: update supported server details everywhere
- server compatibility: navidrome, subsonic, airsonic-advanced, gonic all properly supported now closes #33
- logout: stop playback and clear playback state on logout
- ci: update coverage badge [skip ci]
## [8.0.38] - 2026-03-24

- banners: adopt pill style for banners
- connectivity banner: transparent background
- backup: rebuild tuned in aggregates after backup restoration
- android: fix pull to refresh display
- android: fix header style
- ci: update coverage badge [skip ci]
- storage: fix bug with cancelled or incomplete downloads not being removed from storage use. ensure storage use is recalculated when needed (especially post logout)
- ci: update coverage badge [skip ci]
## [8.0.37] - 2026-03-23

- ci: update coverage badge [skip ci]
- onboarding: add first time onboarding guide
- ci: update coverage badge [skip ci]
- storage lists: fix swipe actions
- header buttons: always white
- fix: android metadata fastlane path
- publishing: play store updates
- alphabet scroller: add haptic feedback
## [8.0.36] - 2026-03-22

- ci: update coverage badge [skip ci]
- release: v8.0.35
- ci: update coverage badge [skip ci]
- favorite songs download: fix downloaded state of favorite songs being lost on restart
- diagnostics: off by default
- ci: update coverage badge [skip ci]
- publishing: fix ios screenshot uploading
- Create CNAME
## [8.0.35] - 2026-03-22

- favorite songs download: fix downloaded state of favorite songs being lost on restart
- diagnostics: off by default
- ci: update coverage badge [skip ci]
- publishing: fix ios screenshot uploading
- Create CNAME
## [8.0.34] - 2026-03-21

- RNTP: resume after long background further adjustments
- notifications: local notifications not firing when backgrounded with downloads running
- favorites: if offline and not downloaded show the appropriate empty placeholder
- auto offline: check connection type before trying to check SSID
- list browsers: swipe left to trigger refresh on items
- layout: warning banner positioning
- update readme
- ci: update coverage badge [skip ci]
- metadata: release prep
- logout: refresh all data when logout and then login in same session
- tablets: add some sensible max sizes for tablet layouts
- ios: fix favorite icon in header auto adapting colour
- ci: update coverage badge [skip ci]
- clean up: unused imports and variables after recent changes
- tuned in: jump back in should play the album directly
- ci: update coverage badge [skip ci]
## [8.0.33] - 2026-03-20

- chore: rename discovery to tunedin for consistency
- UX: list item and scroll behaviour consistency...Gotta love testing... Recommendations: originally called this discovery but the more I see it the less I like it.  Changed to Tuned In for something substreamer distinctive to build upon
## [8.0.32] - 2026-03-19

- ios: liquid glass white flash on navigation fix
- offline mode: don't show random scroller in offline mode, never enough content
- expo: remove some exclusions, expo caught up...
- expo: various package updates
- theme: ensure native elements like liquid glass get the correect theme set
- RNTP: Work around a known AVPlayer bug when the app is suspended for more than 2mins and then tries to resume playback from a dead TCP stream.
- ci: update coverage badge [skip ci]
## [8.0.31] - 2026-03-18

- theming: soft background gradient based on primary theme preference on pages without hero image.
## [8.0.30] - 2026-03-18

- ci: update coverage badge [skip ci]
- account: ensure logout clears storage, retains backups though
- backup: add scrobble exclusion list to backups
- debug: file explorer file view and copy lists: restore transparent background
- ci: update coverage badge [skip ci]
- tests: fix ts error
- tests: ssl store
- tests: stop cheating by ignoring those where a test file does not exist yet
## [8.0.29] - 2026-03-17

- detail pages: request error place holder
- RNTP: cover some edge cases for playback transitions and put in some debug logging
- clean up: quick clean up and refactor, fix some type safety work arounds and old comments and general tidy and consistency
- ci: update coverage badge [skip ci]
- Discovery: music discovery based on playback history
- refactor search online and search offline ready for carplay/android auto. genres: fix genres metadata passing prefer the genres field when available, fall back to the old single genre field. genres: add Play some... to the home page to quickly make genre based playlists.  Leverages your top genres from my listening and if that  does not have at least 8 then tops up from the genres with the most songs on the server, avoiding duplicates.
- ci: update coverage badge [skip ci]
- playback: scrobble exclusions, you can set an album, artist or playlist to be excluded from playback history (good for things like ambient listening at night, kids songs etc) UI: update swipeablerow shared component to handle swiped content shading rather than having it duplicated into every instance.
- ci: update coverage badge [skip ci]
## [8.0.28] - 2026-03-16

- data: convenient clear all for image and music cache in the list view
- home: empty list place holders for horizontal scrollers (ie recent, frequent etc)
- detail screens: quick visibility and access to favorite an album or artist
- ssl: indicate expired certs in the list
- self signed SSL handling: update the SSL handling with more functionality. Easier review and addition/replacement of certs in settings, clear visibility of current cert, ability to add a REAL certificate if you should need to (maybe it works externally with your domain but not internally with your IP). SSL Error checks added to connectivity monitor and auto prompt to update the certs (covers cert renewal case). Login was not using the certificate service, updated to always use service not duplicate logic.
- auto offline: netInfo events don't fire when app suspended in background or closed.  netInfo fetch delivers cached status, always use refresh, always check on status on return to foreground and on app cold start
- tests: coverage for the sheet changes
- sheets: reduce some duplicated code, pull the bottomsheet out to a reusable component, add swipe to dismiss, fix some android gesture handling in modals with RNGH
- settings: hide diagnostic tools by default
- ci: update coverage badge [skip ci]
- playback: Play more by artists (online & offline support)
- eas: auto-publish beta releases to Play Store
## [8.0.27] - 2026-03-14

- add a shortcut to rebase
- RNTP: remote controls on first play on iOS troubleshooting
- ci: update coverage badge [skip ci]
## [8.0.26] - 2026-03-14

- tests: add tests for new functions and module
- RNTP: further testing for playback controls not available if phone locked on first track
- ci: update coverage badge [skip ci]
- android: add option to request exemption from battery optimization (some android devices have very aggressive background suspension even when audio is actively playing) android: back button handling. Don't kill the app, just send it to the back and go to the home screen.
- ci: update coverage badge [skip ci]
- fix: auto-offline home WiFi SSID detection broken after permission grant
- ui fixes: android vs ios quirks for various spacing, ensure lists are populated if empty on start, ensure playlist list is fresh before trying to add to a playlist
- build: simple terminal monitoring for claude code
## [8.0.25] - 2026-03-13

- build: update to address deprecation warning
- build: update the release script for new android versionCode
## [8.0.24] - 2026-03-13

- android: fix crazy version / versionCode handling.  Now I might actually get a beta release available!
## [8.0.23] - 2026-03-13

- android: alerts were not themed
- appearance: update some tab logos music notes for library (cause we're not listening to books) and substreamer logo for home
- appearance: default to dark theme
- expo-ssl-trust: owns network security, it should also ensure that usescleartext is always set
- RNTP: resolve build deprecation warning on android
- build: add a package.json script to build the modules
- android: fix lock screen media controls on OnePlus/Huawei OEM devices. Remove SDK version gate in onStartCommand() and add    event deduplication so media key intents are always handled, fixing broken lock screen controls on OEMs that don't route    through onMediaButtonEvent(). All credit to: https://github.com/doublesymmetry/react-native-track-player/pull/2559
- RNTP: iOS, on first play if user locks devices without backgrounding app play controls (playpause/skip) are sometimes not available until the next track.  All credit to: https://github.com/doublesymmetry/react-native-track-player/pull/2583
- appstore: metadata handling
- split app store metadata workflows
- app stores: test publishing an update to App Store
- app stores: allow for manual test of CI
- App Store Metadata Automation
- build: push android builds to closed beta, not internal track
## [8.0.22] - 2026-03-10

- web and readme
- github: add sponsor ship options, as that would be super helpful...
- update project rules
- website tweaks and privacy policy
- Release Prep: all the prep to open up...
- gitignore: feature notes
- Delete CNAME
- Create CNAME
- ci: update coverage badge [skip ci]
- tests: once more
- tests: fix coverage badge
- readme: add code coverage
- player: use progressUpdateEventInterval for native playback progress events versus polling for status.  Required for Android background playback but also makes implementation simpler on all platforms as event driven is cleaner than polling and managing timers anyway.
- RNTP: behaviour alignment with iOS, make stalled, buffer empty and buffer full events consistent with iOS.  Refactor buffering and loading events to not be bound only to stalls. Handle misleading seek to events on queue change.  Handle misleading playback stopped events when nothing playing or queued.
- player: buffer events are normal, should not be warnings
- tests: update color test for change to prefer secondary color on iOS
- UI: aim to extract a darker colour from images
- miniplayer: skip ahead button
- offline mode: refinement of offline mode UI and configuraiton options
- splashscreen: clean up the layout for migrations
- auth: oops removed a debug guard but left the debug function and cleared all the persisted data on launch...
- build: run dev builds on both ios and android concurrently
- 5 star rating: implement thorough tests for rating lifecycle and real world scenarios.  Implement fix for flaw in previous logic for rating overrides.
- build: more build updates
- build: fixes and mods for local dev builds
- tests autoOfflineService console logging clean up
- ai: update project rules with test coverage target so I can stop repeating it
- tests: all coverage over 80%
- auth: remove some debug
- update key packages.  Notably netInfo fix for SSID not returning on iOS26
- tests: run on push to master and PR to master.
- offline mode: if going offline results in the whole queue clearing (as no tracks were downloaded before) then close the player if it's open.  Add an empty screen placeholder just in case as well.
- tests: autoOfflineService coverage
- offline mode: change netInfo config point to start up so all subsequent requests have the right config to return SSID data
- tests: fix TS errors and add coverage for haptics util
- ai rules: review and sync
- tests: updated connectivity service test
- connectivity monitor: expose an API Ping endpoint that ignores the offline mode and other guards on the standard endpoints (as connectivity monitor is a special case).  Trying to resolve occasionally getting stuck in server unreachable even when clearly online and working.
## [8.0.21] - 2026-03-08

- No notable changes
## [8.0.20] - 2026-03-08

- No notable changes
## [8.0.19] - 2026-03-08

- offline mode: auto switching based on wifi/mobile or based on defined home network SSIDs offline mode: remove non-downloaded tracks from queue when going offline as they will not play and will stall the queue
- header: responsive liquid glass icons in headers for detail pages and player
- logging: hide some logs due to known RN bugs that can't be worked around from client side.  No impact, just spammy logs generated for both.
- update gitignore
- my listening: rename from playback-history to match the display name. implement incremental stats generation with persistent storage to avoid scaling problems as stats could grow to 100s of thousands of plays.
- build: Prod build optimizations
- tests: bring up coverage on services
- connectivity monitor: incorrect state flash on hide
- remove coverage folder from repo
- tests: update gitignore for generated coverage
- artists: Handle Various artists for list and detail views, go to artist etc.
## [8.0.18] - 2026-03-06

- tests: improve test coverage for services
- connectivity monitor: fix unreliable and stuck states
- tests: updated for my listening changes
- my listening: fix broken streak behaviour
- tests: let's try to test all the things
- my listening: show most recent pending scrobbles first not oldest as it looks like things are missing the other way round
- swipe actions: text should animate in / out with the action icon
- tests: unit tests for all local /modules
- RNTP: Bring Android implementation inline with iOS
- RNTP: Android playbackCompletedWithReason was not wired.  Bring it in line with iOS implementation
- AI: keep project rules in sync for all main platforms
- splashscreen: stop text jumping
- RNTP: Review all comments in Android code base, address where needed, clean up and update comments for accuracy.
- android: fix link in media notifcation, should just return to app, no need to deeplink for this
- RNTP: KotlinAudio was inlined in the 5.0.0alpha version we are based on.  No need to retain a seperate copy.
- ai: add project rules for claude code and github copilot
- android: fix download concurrency (was stuck at 1)
- react-native: interaction manager now marked as deprecated after RN 0.83 update
- android: set minsdk sensibly to SDK29/Android 10
- android RNTP: modernize fork — bump minSdk to 29, upgrade Media3 to 1.9.2, remove old-arch and compat code
- android: unused option removed on splashscreen
- expo-ssl-trust: should enable cleartext, not disable
- lock gradle version
- review and update project docs
- android: build scripts and env vars
## [8.0.17] - 2026-03-03

- UI: clean up on the storage settings page a bit.
- backup: backup data only stored locally to the platform native cloud service. Add auto backup functionality to the app Add manual backup function Add restore function Backups up playback history and MBID overrides for artists
- download icon: remaining percentage should be solid colour not dimmed for visibility
- music download: change download screen title
## [8.0.16] - 2026-03-03

- list views: fix empty list on offline/online switch. fix incorrect list position on filter disable
- UI: fix swipe item highlighting
- player: remove DuckOthers option, it wasn't what I expected.
## [8.0.15] - 2026-03-03

- expo: update to SDK55
- list items: background on content when swiping
- player: set some defaults for audio category and interruption handling. fix contradictory min/max buffer for android
- RNTP: user supplied duration param does not pass through to the native audio item in SwiftAudioEx, results in no progress and no duration/progress times in remote controls
- 5 star rating: save button should be save, not done.
- 5 star rating: enable setting and displaying 5 star ratings for songs, albums, artists.  Limited to navidrome currently as not all servers return userRating on all items like navidrome does.
- MBID: search and override for mismatched artists.  Closes #12
- player: seek when paused  progress bar now updates to the correct post seek position
## [8.0.14] - 2026-03-01

- expo-notifications: try again to strip the push capability and entitlement that we don't need
## [8.0.13] - 2026-03-01

- expo-notifications: remove unneeded push notificiation entitlement
## [8.0.12] - 2026-03-01

- android: expo-fs-async missing deps
- android: expo-fs-async fix for missing dependencies. Also remove unnecessarily committed build artefects
- remove expo-notifications from app.json as it always enables push notifications and I only want and use local.
## [8.0.11] - 2026-03-01

- keyboard: better keyboard behaviour on search inputs
- download queue & playlist edit: drag to re-order issues. fix: slow item pickup fix: pickup handle inconsistent fix: persistent shade after drop to new location
- scrobbles: intermittent incorrect scrobbles. PlaybackEndedWithReason and PlaybackActiveTrackChanged events are non-deterministic in firing order.  Fix catches when these fire out of order.
- music downloads: implement transfer speed stats. update our custom expo-async-fs module to include a downloadAsync variant that exposes progress events as expo-file-system is lacking this. Implement speed tracking across concurrent threads Implement transfer stats card on download queue to show the user more detail on what is happening beyond the standard per track progress bar.
- caching enhancement: queue recovery when backgrounding was too aggressive.  Now checks status so only recovers when needed. Add local notification reminder that downloads are running. Cleaner queue restart mechanism
- scripts: expand comment on the silence-hermes-warning script for clarity
## [8.0.10] - 2026-02-27

- offline mode: no pull to refresh in offline mode
- add item ID for image cache browser
- image cache: navidrome returns varying _hexsuffix as part of coverArtID's this was resulting in multiple copies of images in cache, the fix for that problem resulted in broken caching, excess downloads and missing images when offline. This fix strips the suffix from the coverArtID as we don't need it to cache bust and it doesn't give us any other value.
- missed some files
- appearance: remove the option to disable marquee scrolling on long titles. It's always useful and code is much simpler without this.
## [8.0.9] - 2026-02-27

- file-system: new expo-file-system removes many async operations which makes larger recursive operations block UI interaction which is not good. This was causing slow app start up as the integrity of offline images and music are checked at start. 1) implement a custom expo module with only the required async file functions. 2) move any legacy/async operations to the new custom module (as file-system/legacy will be removed in next major expo version breaking the app) 3) split cache init functions into base init (make sure cache directories exist) and validation passes so that heavier work can run deferred. 4) refactor all of image cache and music cache to use new async functions where appropriate.
- appearance: blue should be Blue (default) not just Default in colour picker
- show app version and build number in settings screen
- downled music: use swipe actions for delete instead of an icon on the line item. Consistent with download queue and playlist edit
- home: sections should not be refreshable or expandable when offline as these are API driven actions.
- scrobbles: pending scrobbles list should display newest to oldest
- image cache: duplicate images with differing suffix, The suffix is a hex encoded unix timestamp used for cache busting. Accomodate this and ensure clean up when a new version replaces old.
- more options: fix no actions available icon colour
- more options: fix add album / playlist to queue when offline
## [8.0.8] - 2026-02-25

- player: fix crash on progress drag
## [8.0.7] - 2026-02-25

- No notable changes
## [8.0.6] - 2026-02-25

- downloads: keep screen alive when there are active downloads in the queue so they don't keep stalling!
- player: fix progress bar swipe gesture being erratic (all gestures use RNGH)
- update project rules
## [8.0.5] - 2026-02-25

- player: fix close sometimes needs to be pressed multiple times to trigger
- player: fix back gesture to be a down swipe
- styling: header icons should always use textPrimary colour
- playlist edit: make the playlist editor use swipe to delete the same as download queue
- download queue: initial implementation was functional but not really usable. add manual retry option in case queue gets stuck use swipe right default action to delete item from queue use draggable list to reorder keep in progress item at the top of the list keep items needing manual retry at bottom of the list
- my listening: home screen card stats animate on change
- my listening: include pending scrobbles in streak calculation.  Otherwise streak appears broken when listening offline
- detail views: provide visual feedback when playback is started as the miniplayer is not on these pages.
- imagecache: update the image cache service to be consistent with the music download service. queue based concurrent operation controls in settings tmp file protection for partial operations clean up and recovery on start and restore from background rather than downloading 4 image variants from server, get the largest and then scale locally in native code for variants
- SQLite database optimisations
- exclude substreamer files from cloud back. app store rules state that large binary data should not be included in automated system backups.  Add an expo module that reads a list of paths to exlude from automatic backups.
- standardise capitalization in more options action sheet
- play similar artists
- songs: play similar songs from more options menu
- artist: create top songs playlist from more actions menu
- artist bio: improve sanitization of bio results. Improve formatting to provide paragraph formatting so it's actually readable.
- placeholder for empty search results updated to handle offline search
- fix spacing around action buttons on the filter bar when all options are shown.  action buttons were getting squashed.
- playing overlay in play queue and progress overlay in download queue should be 100% opacity for visibility
- split player queue and song actions in the action sheet on player view
- smoother splash screen transition from native to animated
- add music download recovery when returning to foreground
- reduce to 2 animation loops on the splashscreen
## [8.0.4] - 2026-02-23

- updated migration paths
## [8.0.3] - 2026-02-23

- legacy database migration migration logging for testing.
- update migrations to capture potential storage locations from previous versions
- make playlist card subtitle format consistent with other cards for grid view
- implement flash list for artist detail lists.
- make home screen section headers tappable instead of just the more icon as it is pretty small.
- fix: always 100% opacity for header icons for readability
- FIX: settings share list empty placeholder made consistent
- fix: My Listening screen empty placeholder missed in earlier styling
- fix: filter action bar has inconsistent height depending on content.  Fix the height to stop annoying shifting
- update all empty screen and list placeholders for consistency fix a couple of typescript errors.
- update project rules to stop trying to use estimatedItemSize with newer version of flashlist as it handles this automatically
- temporary file explorer to troubleshoot old version cache migration
## [8.0.2] - 2026-02-22

- fix eas workflow
- fix eas workflow
- more fixes for release script
## [8.0.1] - 2026-02-22

- fix release script
- release scripts because lazy
- build and release prep
- prep for actual builds and alpha releases
- show offline chip on filter bar for settings so it's still clear you are in offline mode
- add some protection against bad scrobbles.  Although this was primarily caused by app restarts during development it may occur due to app being killed in production so worth making it more robust
- playlist management: add song/album to playlist add playqueue to playlist
- update My Listening layout on home page for consistency
- add some missing visual feedback for taps and presses
- FIX: detail views, no indication that download has been queued and is waiting on the download button. when adding an item to the queue with the download button it would fail silently if there was already another item downloading.
- rename all instances of playback history to My Listening add a basic scrobble browser to storage settings
- FIX; some axis labels were messy on the activity stats NEW: date format preference in appearance and layout.  Only used for activity stats at the moment
- fix duplicate scrobbles
- playback analytics (very cool!)
- let's shift some of the useful debugging things under a dangerous options section in storage and data to prevent accidental taps
- catch a bunch of edge cases around offline mode and no connectivity scenarios. don't try to send now playing scrobbles if server is unavailable or offline mode ensure that coverart for all tracks in favorite songs and playlists are cached when downloading fix offline search returning duplicate items (song in a album and a playlist) fix offline search returning parent item coverart for songs instead of using the song coverArt fix user clears the downloaded music while there are downloaded tracks in the queue, they will fail to play as they no longer exist and the play queue is set.  Clear the playqueue before clearing the downloaded music Add an empty screen placeholder for the homescreen in offline mode if no music downloaded Add a file exists skip to the image downloader so it doesn't re-download things unnecessarily Add more detail to user warnings for deleting bits of offline content, it might affect offline playback
- More offline mode work don't try to make API calls on start when in offline mode don't try to process the scrobble queue when in offline mode clean up some circular dependency nasties and update the project rules to specifically disallow this kind of crap workaround
- move account settings to own screen and add some initial display of the current user details
- FIx: substreamer branded image for the favorite songs virtual playlist
- NEW: full offline mode
- NEW: UI filter bar for showing only downloaded or favorite items NEW: Downloaded Albums and Playlists display in homescreen
- NEW: download favorite songs and keep in sync
- playlist management edit playlist delete item reorder items sync downloaded playlist item delete entire playlist sync downloaded items by also deleting the downloaded playlist and it's files if existing. FIX: playlist hero image not displaying after saving an edit, coverart image not available in playlist list after editing.
- download icon fringing from background colour
- styling for download buttons for better clarity (transparent icon is hard to read)
- standardise downloaded and favorite status display across all item views (list and card)
- bunch of styling for settings page make player header consistent with detail view headers add clear queue function
- download banner styling
- fix: redownloading some tracks unnecssarily on stalleddownloadrecovery fix: add some guards so we don't try to "move" over an existing file
- NEW: album and playlist downloads TODO: refine where download icons are placed TODO: refine how we access the download queue TODO: update library to potentially have a downloaded items filter? TODO: storage limits
- show coverart and albumdetails on playlist items
- new: connectivity monitor flight mode inferance internet connection available from native connectivity monitoring server available by polling ping.api closes #2
- glass style header icons
- fix: false scrobble of first track in play queue when setting fix: janky scrolling on player view
- fix: janky marquee slow moving, constant rate animations work better with the base animated library. Revert it for the marquee and update the project rules to reflect.
- fix: more options in detail view some times requires multiple taps to open fix: album details not displaying
- Migrate all animations to reanimated.  Update project rules to reflect this for future. closes #28
- implement sharing support.  closes # 25
- let's stop writing design philosophy on every prompt...
- Refactor and clean centralise app wide styles extract some more util functions to avoid duplicate code fix a crappy circular dependency work around remove unused exports
- update project rules
- clean up comments and doc related to list handling, some stale flatlist details carried through and we now use flashlist
- fix styling on disc headers in album lists
- update playlist and album detail views to use flash list for list virtualization
- FIX: loading delay on playlists and album details.
- fix sort order alignment for album list on artist detail page
- FIX: delay on loading artist detail when data is CACHED. Implement in memory cache for cached image look up to save sync FS operations. Implement deferred loading on items below the hero image.
- FIX: don't use a modal for the playerview. Mode options menu and long press more options for player queue items now work properly.
- FIX: janky transitions when data and images are cached and color extraction runs during navigation
- NEW: more options for current track in player view. Long press enabled for queue items in player view favorite indicator on queue items in player view quick favorite / unfavorite for current playing track in player view adjust play queue text formatting to be aligned with the rest of the app. TODO: Opening the more options overlay is currently BROKEN on the player view, it only opens after the playerview is closed.
- Swiping: implement default swipe actions for all item types.
- FIX: stale currenttrack index when an item before current track is removed.
- FIX: when a track is in the play queue more than once then all instances get highlighted as now playing rather than just the currentTrack index.
- update wording on migrations page as updating can be misleading
- REFACTOR: full rework of favorites/starred item handling.
- check and update key packages
- Initial implementation for #17, still a work in progress. TODO: update starred status on items stored locally after changes TODO: favorite button still shows "favorite" without differentiation for remove/add TODO: default actions not implemented, just swipe to expose then press TODO: look into smoother animations and transitions for some swipeable actions (ie close down when delete instead of just vanish)
- update cursorrules for drift
- Splashscreen Updates Let's do a proper job of the animated splashscreen. use react-native-bootsplash for the native to react-native seamless hand off. Update the loading animation on our logo Update the asset generation script to output svg as well as PNGs. Update app config for both platforms for the new setup.
- android native build script to trigger native builds for debugging
- update presentation of the clear queue icon
- NEW: shuffle functionality
- NEW: repeat NEW: repeat 1 NEW: playback rate with rate persistence
- FIX: player queue not using flashlist results in delayed opening with large playqueues
- implement playqueue clear closes #23
- NEW: marquee scrolling for long track names in mini and full players. setting to disable and use standard truncation in appearance settings
- native app config allow clear text http traffic add encryption status to stop app store pestering
- fix miniplayer background gradient colour when in loading state.
- refactor image cache: peviously used a flat folder structure, easily results in a folder with thousands of files. restructure to use the coverArtID as a folder then files by size inside). Avoids very large directory listings and slow file operations.
- refactor settings page from monolith to modular
- Bundle RNTP, SwiftAudioEx and KotlinAudio into local modules folder. Restructure RNTP to include it's deps as a monorepo add build script for modules update RNTP to install SwiftAudioEx from locally built pod automatically fixes to expo-ssl-trust for android build errors several fixes for general android build failures
- fix hooks order in login screen
- NEW: album sort order in artist detail page
- update comment in player setup to describe new RNTP behaviour with minBuffer and waitsToMinimizeStalling.
- fix issues when there are potentially duplicate tracks in a flash list making item ID not unique
- update some lsit view layout to handle long album names in song list items and make other item types layout consistent
- FIX: more player updates.  Use new events emitted by the native RNTP to better handle playback. New native functionality implemented in the forked RNTP solves some of these issues at the source rather than trying to work around them reacrtively in JS.
- FIX: use fork of RNTP Fork uses 5.0-alpha which uses new RN architecture implement support for more native events for handling playback state and diagnostics.
- NEW: let's try to handle self signed certificates...
- buffer state updates are erratic and cannot be trusted, sometimes they work, sometimes it just stops updating which was causing unnecessary buffering interruptions.
- try to force more aggressive buffering
- NEW: opensubsonic transcodeOffset support. if the server supports it use the transcodeOffset support to recover from buffer underruns when streaming and transcoding.
- miniplayer smoother buffering to playing transition with loading indicators
- implement data migrations includes migration to clear the offline cache from previous versions of substreamer as they are not reusable
- fix player briefly showing the first track in the queue while loading.
- 1) update scrobble system to track completed scrobbles locally. Split the scrobble stores into seperate pending and completed for efficiency Update settings with visibility of pending and completed scrobble counts 2) move from async file storage to sqlite storage for both ios and android.
- basic scrobbling for now playing and complet playback. Includes support for offline scrobbles syncing when next online
- consistent placeholders for hero images.
- buffer status updates can be erratic, make an effort to detect when the download is likely complete (ie playback position past the buffered position and buffered position not changing).  When detected set buffer to 100% to enable seeking in the track
- move buffering message so it doesn't cause a layout shift
- Manage seek behaviour when streaming with transcoding (ie no range headers or duration detected as 0). 1) when streaming with transcoding limit seeks to within the buffered area. 2) deal with scenario where the buffered amount does not increase past a point which was blocking seeks even though the data was available.
- fix tracks not progressing sometimes when transcoding is used. stems from estimated content length different to real content length and stall detection
- fix progress bar scrubbing issues
- refresh favorites store on launch
- Implement server scan control and monitoring
- smooth out transition on loading plain colour native loading screen plain colour animated loading screen, starting blank and animating in and out
- refactor naming of cache management services for clarity.
- metadata cache management list filtering for metadata and image cache
- cache and persist detail view metadata use the store for detail views not local state in components
- handle 0 duration when streaming with transcoding
- initial full player view with queue
- implement lazy loading for images placeholder when there is a cache miss until downloaded smooth transition when image available debounce on remote requests when fast scrolling to prevent unnecessary loads.
- enable alphabetic scroller for grid view lists
- fix image cache browser screen opening delay.
- update from flatlist to flashlist for better scrolling performance on large lists.
- update cursorrules for flash list
- cursor rules
- silence hermes warning at build time
- clean up inconsistent styling across settings items
- playback settings
- album list sorting by artist or album title
- add play buttons to album and playlist detail view
- mini player updates
- initial playback and miniplayer
- pull to refresh on detail pages now refreshes hero images in the image cache implemented an image cache browser with delete and refresh functions per item for troubleshooting and those who are just curious. reorder the items on the settings page
- fix storage use display, use an imagecachestore
- image caching (basic)
- min refresh time for all pull to refresh to prevent odd UI behaviour when the refresh is very fast (local fast server or very small data sets)
- min delay on pull to refresh to stop the UI updating too fast when API calls are very quick
- pull to refresh on detail pages more options artist implemented
- fix favorite icon in track lists to be a heart. some layout updates for album detail page
- show album details in more options
- more options album started
- alphabetic scroller for library lists
- basic search
- favorites section implemented
- fix splashscreen transition style login screen
- app icons and splashscreens
- refactor and clean up
- implement musicbrainz for artist BIO
- update artist detail with more features
- playlist detail page initial
- user selectable accent colour
- implement playlist lists clean up list view data layouts implement skeleton artist and playlist detail pages add setting for default list/grid view
- start to split out resusable components
- lubrary album list view
- restructure project into /src folder for neatness
- restructure project to split navigation and logic fix colour extraction delay on album detail
- navigation working again
- first commit
All notable changes to this project will be documented in this file.
