# Changelog

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
