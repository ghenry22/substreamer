export interface AlbumID3 {
	artist?: string;
	artistId?: string;
	coverArt?: string;
	created: Date;
	duration: number;
	genre?: string;
	id: string;
	name: string;
	playCount?: number;
	songCount: number;
	starred?: Date;
	year?: number;
	version?: string;
	played?: string;
	userRating?: number;
	recordLabels?: RecordLabel[];
	musicBrainzId?: string;
	genres?: string[];
	artists?: ArtistID3[];
	displayArtist?: string;
	releaseTypes?: string[];
	moods?: string[];
	sortName?: string;
	originalReleaseDate?: ItemDate;
	releaseDate?: ItemDate;
	isCompilation?: boolean;
	explicitStatus?: string;
	discTitles?: DiscTitle[];
}

export interface DiscTitle {
	disc: number;
	title: string;
}

export interface ItemDate {
	year?: number;
	month?: number;
	day?: number;
}

export interface RecordLabel {
	name: string;
}

export interface AlbumInfo {
	largeImageUrl?: string;
	lastFmUrl?: string;
	mediumImageUrl?: string;
	musicBrainzId?: string;
	notes?: string;
	smallImageUrl?: string;
}

export interface AlbumList {
	album?: Child[];
}

export interface AlbumList2 {
	album?: AlbumID3[];
}

export interface AlbumWithSongsID3 extends AlbumID3 {
	song?: Child[];
}

export interface Artist {
	artistImageUrl?: string;
	averageRating?: number;
	id: string;
	name: string;
	starred?: Date;
	userRating?: number;
}

export interface ArtistID3 {
	albumCount: number;
	artistImageUrl?: string;
	coverArt?: string;
	id: string;
	name: string;
	starred?: Date;
	userRating?: number;
	musicBrainzId?: string;
	sortName?: string;
	roles?: string[];
}

export interface ArtistInfo extends ArtistInfoBase {
	similarArtist?: Artist[];
}

export interface ArtistInfo2 extends ArtistInfoBase {
	similarArtist?: ArtistID3[];
}

export interface ArtistInfoBase {
	biography?: string;
	largeImageUrl?: string;
	lastFmUrl?: string;
	mediumImageUrl?: string;
	musicBrainzId?: string;
	smallImageUrl?: string;
}

export interface ArtistsID3 {
	ignoredArticles: string;
	index?: IndexID3[];
}

export interface ArtistWithAlbumsID3 extends ArtistID3 {
	album?: AlbumID3[];
}

export interface AudioTrack {
	id: string;
	languageCode?: string;
	name?: string;
}

export type AverageRating = number;

export interface Bookmark {
	changed: Date;
	comment?: string;
	created: Date;
	position: number;
	username: string;
	entry: Child;
}

export interface Bookmarks {
	bookmark?: Bookmark[];
}

export interface Captions {
	id: string;
	name?: string;
}

export interface ChatMessage {
	message: string;
	time: number;
	username: string;
}

export interface ChatMessages {
	chatMessage?: ChatMessage[];
}

export interface Child {
	album?: string;
	albumId?: string;
	artist?: string;
	artistId?: string;
	averageRating?: number;
	bitRate?: number;
	bitDepth?: number;
	samplingRate?: number;
	channelCount?: number;
	bookmarkPosition?: number;
	contentType?: string;
	coverArt?: string;
	created?: Date;
	discNumber?: number;
	duration?: number;
	genre?: string;
	id: string;
	isDir: boolean;
	isVideo?: boolean;
	originalHeight?: number;
	originalWidth?: number;
	parent?: string;
	path?: string;
	playCount?: number;
	size?: number;
	starred?: Date;
	suffix?: string;
	title: string;
	track?: number;
	transcodedContentType?: string;
	transcodedSuffix?: string;
	type?: MediaType;
	userRating?: number;
	year?: number;
	played?: string;
	bpm?: number;
	comment?: string;
	sortName?: string;
	musicBrainzId?: string;
	genres?: string[];
	artists?: ArtistID3[];
	displayArtist?: string;
	albumArtists?: ArtistID3[];
	displayAlbumArtist?: string;
	contributors?: Contributor[];
	displayComposer?: string;
	moods?: string[];
	replayGain?: ReplayGain;
	explicitStatus?: string;
}

export interface Contributor {
	role: string;
	subRole?: string;
	artist?: ArtistID3;
}

export interface ReplayGain {
	trackGain: number;
	albumGain: number;
	trackPeak: number;
	albumPeak: number;
	baseGain: number;
	fallbackGain: number;
}

export interface Directory {
	averageRating?: number;
	id: string;
	name: string;
	parent?: string;
	playCount?: number;
	starred?: Date;
	userRating?: number;
	child?: Child[];
}

export interface Error {
	code: number;
	message?: string;
	helpUrl?: string;
}

export interface Genre {
	value: string;
	albumCount: number;
	songCount: number;
}

export interface Genres {
	genre?: Genre[];
}

export interface Index {
	name: string;
	artist?: Artist[];
}

export interface IndexID3 {
	name: string;
	artist?: ArtistID3[];
}
export interface Indexes {
	ignoredArticles: string;
	lastModified: number;
	child?: Child[];
	index?: Index[];
	shortcut?: Artist[];
}

export interface InternetRadioStation {
	homePageUrl?: string;
	id: string;
	name: string;
	streamUrl: string;
}

export interface InternetRadioStations {
	internetRadioStation?: InternetRadioStation[];
}

export interface JukeboxPlaylist extends JukeboxStatus {
	entry?: Child[];
}

export interface JukeboxStatus {
	currentIndex: number;
	gain: number;
	playing: boolean;
	position?: number;
}

export interface License {
	email?: string;
	licenseExpires?: Date;
	trialExpires?: Date;
	valid: boolean;
}

export interface Lyrics {
	artist?: string;
	title?: string;
	value?: string;
}

export type MediaType = "music" | "podcast" | "audiobook" | "video";

export interface MusicFolder {
	id: number;
	name?: string;
}

export interface MusicFolders {
	musicFolder?: MusicFolder[];
}

export interface NewestPodcasts {
	episode?: PodcastEpisode[];
}

export interface NowPlaying {
	entry?: NowPlayingEntry[];
}

export interface NowPlayingEntry extends Child {
	minutesAgo: number;
	playerId: number;
	playerName?: string;
	username: string;
}

export interface Playlist {
	changed: Date;
	comment?: string;
	coverArt?: string;
	created: Date;
	duration: number;
	id: string;
	name: string;
	owner?: string;
	public?: boolean;
	songCount: number;
	allowedUser?: string[];
}

export interface Playlists {
	playlist?: Playlist[];
}

export interface PlaylistWithSongs extends Playlist {
	entry?: Child[];
}

export interface PlayQueue {
	changed: Date;
	changedBy: string;
	current?: number | string; // string in navidrome
	position?: number;
	username: string;
	entry?: Child[];
}

export interface PodcastChannel {
	coverArt?: string;
	description?: string;
	errorMessage?: string;
	id: string;
	originalImageUrl?: string;
	status: PodcastStatus;
	title?: string;
	url: string;
	episode?: PodcastEpisode[];
}

export interface PodcastEpisode extends Child {
	channelId: string;
	description?: string;
	publishDate?: Date;
	status: PodcastStatus;
	streamId?: string;
}

export interface Podcasts {
	channel?: PodcastChannel[];
}

export type PodcastStatus = "new" | "downloading" | "completed" | "error" | "deleted" | "skipped";

export interface BaseResponse {
	status: ResponseStatus;
	version: string;
	type: string;
	serverVersion: string;
}

export type ResponseStatus = "ok" | "failed";

export interface ScanStatus {
	count?: number;
	scanning: boolean;
}

export interface SearchResult {
	offset: number;
	totalHits: number;
	match?: Child[];
}

export interface SearchResult2 {
	album?: Child[];
	artist?: Artist[];
	song?: Child[];
}

export interface SearchResult3 {
	album?: AlbumID3[];
	artist?: ArtistID3[];
	song?: Child[];
}

export interface Share {
	created: Date;
	description?: string;
	expires?: Date;
	id: string;
	lastVisited?: Date;
	url: string;
	username: string;
	visitCount: number;
	entry?: Child[];
}

export interface Shares {
	share?: Share[];
}

export interface SimilarSongs {
	song?: Child[];
}

export interface SimilarSongs2 {
	song?: Child[];
}

export interface Songs {
	song?: Child[];
}

export interface Starred {
	album?: Child[];
	artist?: Artist[];
	song?: Child[];
}

export interface Starred2 {
	album?: AlbumID3[];
	artist?: ArtistID3[];
	song?: Child[];
}

export interface TopSongs {
	song?: Child[];
}

export interface User {
	adminRole: boolean;
	avatarLastChanged?: Date;
	commentRole: boolean;
	coverArtRole: boolean;
	downloadRole: boolean;
	email?: string;
	jukeboxRole: boolean;
	maxBitRate?: number;
	playlistRole: boolean;
	podcastRole: boolean;
	scrobblingEnabled: boolean;
	settingsRole: boolean;
	shareRole: boolean;
	streamRole: boolean;
	uploadRole: boolean;
	username: string;
	videoConversionRole: boolean;
	folder?: number[];
}

export type UserRating = number;

export interface Users {
	user?: User[];
}

export type Version = string;

export interface VideoConversion {
	audioTrackId?: number;
	bitRate?: number;
	id: string;
}

export interface VideoInfo {
	id: string;
	audioTrack?: AudioTrack[];
	captions?: Captions[];
	conversion?: VideoConversion[];
}

export interface Videos {
	video?: Child[];
}

export interface OpenSubsonicExtensions {
	name: string;
	versions: number[];
}

// OpenSubsonic Extensions

export interface StructuredLyrics {
	lang: string;
	synced: boolean;
	line: Line[];
	displayArtist?: string;
	displayTitle?: string;
	offset?: number;
}

export interface Line {
	value: string;
	start?: number;
}

/**
 * OpenSubsonic `lyricsList` wrapper. The field is optional on the response —
 * spec-compliant servers (Navidrome) may omit the whole wrapper when no
 * lyrics exist.
 *
 * At runtime, `structuredLyrics` may arrive as:
 *   - an array (Navidrome, Gonic, Nextcloud Music — spec-compliant)
 *   - a single object (Ampache — deviates from spec; clients must normalise)
 *   - absent (Navidrome when no lyrics)
 *
 * The typed shape here stays spec-compliant (`StructuredLyrics[]`); clients
 * must normalise the Ampache deviation before consuming the value.
 */
export interface LyricsList {
	structuredLyrics?: StructuredLyrics[];
}

// apiKeyAuthentication extension

export interface TokenInfo {
	username: string;
}

// indexBasedQueue extension

export interface PlayQueueByIndex {
	currentIndex?: number;
	position?: number;
	username: string;
	changed: string;
	changedBy: string;
	entry?: Child[];
}

// playbackReport extension

export type PlaybackReportMediaType = "song" | "podcast";

export type PlaybackState = "starting" | "playing" | "paused" | "stopped";

// transcoding extension

export interface TranscodeDecision {
	canDirectPlay: boolean;
	canTranscode: boolean;
	transcodeReason?: string[];
	errorReason?: string;
	transcodeParams?: string;
	sourceStream?: StreamDetails;
	transcodeStream?: StreamDetails;
}

export interface StreamDetails {
	protocol: string;
	container: string;
	codec: string;
	audioChannels?: number;
	audioBitrate?: number;
	audioProfile?: string;
	audioSamplerate?: number;
	audioBitdepth?: number;
}

export interface ClientInfo {
	name: string;
	platform: string;
	maxAudioBitrate?: number;
	maxTranscodingAudioBitrate?: number;
	directPlayProfiles?: DirectPlayProfile[];
	transcodingProfiles?: TranscodingProfile[];
	codecProfiles?: CodecProfile[];
}

export interface DirectPlayProfile {
	containers: string[];
	audioCodecs: string[];
	protocols: string[];
	maxAudioChannels: number;
}

export interface TranscodingProfile {
	container: string;
	audioCodec: string;
	protocol: string;
	maxAudioChannels: number;
}

export interface CodecProfile {
	type: string;
	name: string;
	limitations?: Limitation[];
}

export interface Limitation {
	name: string;
	comparison: string;
	values: string[];
	required?: boolean;
}
