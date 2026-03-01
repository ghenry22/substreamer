# Changelog

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
