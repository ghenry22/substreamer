import { md5 } from "./md5";
import { arrayBufferToBase64 } from "./utils";

import type { AlbumInfo, AlbumList, AlbumList2, AlbumWithSongsID3, ArtistInfo, ArtistInfo2, ArtistWithAlbumsID3, ArtistsID3, Bookmarks, ChatMessages, Child, ClientInfo, Directory, Genres, Indexes, InternetRadioStations, JukeboxPlaylist, JukeboxStatus, License, Lyrics, LyricsList, MusicFolders, NewestPodcasts, NowPlaying, OpenSubsonicExtensions, PlayQueue, PlayQueueByIndex, Playlist, PlaylistWithSongs, Playlists, PodcastEpisode, Podcasts, ScanStatus, SearchResult2, SearchResult3, Shares, SimilarSongs, SimilarSongs2, Songs, Starred, Starred2, StructuredLyrics, TokenInfo, TopSongs, TranscodeDecision, User, Users, VideoInfo, Videos } from "./types";
export * from "./types";

interface SubsonicConfig {
	/** The base URL of the Subsonic server, e.g., https://demo.navidrome.org. */
	url: string;

	/** The authentication details to use when connecting to the server. */
	auth:
		| {
				username: string;
				password: string;
				apiKey?: never;
		  }
		| {
				username?: never;
				password?: never;
				apiKey: string;
		  };

	/** A salt to use when hashing the password (optional). */
	salt?: string;

	/**
	 * Whether to reuse generated salts.
	 *
	 * If not provided, a random salt will be generated for each request.
	 *
	 * Ignored if `salt` is provided.
	 */
	reuseSalt?: boolean;

	/**
	 * Use legacy plaintext password authentication (`p` param) instead of
	 * token-based auth (`t` + `s` params).
	 *
	 * Required for servers like Nextcloud Music and Ampache that reject token auth.
	 * The password is sent hex-encoded with the `enc:` prefix.
	 */
	legacyAuth?: boolean;

	/**
	 * Whether to use a POST requests instead of GET requests.
	 *
	 * Only supported by OpenSubsonic compatible servers with the `formPost` extension.
	 */
	post?: boolean;

	/** The fetch implementation to use. If not provided, the global fetch will be used. */
	fetch?: typeof fetch;

	/**
	 * The crypto implementation to use.
	 *
	 * If not provided, the global WebCrypto object or the Node.js crypto module will be used.
	 */
	crypto?: Crypto;

	/** The client name sent as the `c` parameter. Defaults to `'substreamer8'`. */
	clientName?: string;

	/** The API version sent as the `v` parameter. Defaults to `'1.15.0'`. */
	clientVersion?: string;
}

export type SubsonicBaseResponse =
	| {
			status: string;
			version: string;
			openSubsonic?: false;
	  }
	| {
			status: string;
			version: string;
			openSubsonic: true;
			type: string;
			serverVersion: string;
	  };

export default class SubsonicAPI {
	#config: SubsonicConfig;
	#fetch: typeof fetch;
	#crypto?: Crypto;

	constructor(config: SubsonicConfig) {
		if (!config) throw new Error("no config provided");
		if (!config.url) throw new Error("no url provided");
		if (!config.auth) throw new Error("no auth provided");

		if (!config.auth.apiKey) {
			if (!config.auth.username) throw new Error("no username provided");
			if (!config.auth.password) throw new Error("no password provided");
		}

		this.#config = config;
		this.#crypto = config.crypto || globalThis.crypto;
		if (!this.#crypto && !this.#config.salt && !config.legacyAuth)
			throw new Error("no crypto implementation available. Provide a salt or crypto implementation.");

		this.#fetch = (config.fetch || globalThis.fetch).bind(globalThis);
		if (!this.#fetch) throw new Error("no fetch implementation available");
	}

	/**
	 * Connect to the auth api of a navidrome server and fetch the session token.
	 */
	async navidromeSession() {
		const base = this.baseURL();
		const response = await this.#fetch!(`${base}auth/login`, {
			method: "POST",
			body: JSON.stringify({ username: this.#config.auth.username, password: this.#config.auth.password }),
		});

		if (!response.ok) return Promise.reject(response.statusText);

		const data: {
			id: string;
			isAdmin: boolean;
			name: string;
			subsonicSalt: string;
			subsonicToken: string;
			token: string;
			username: string;
		} = await response.json();

		return data;
	}

	async #generateSalt() {
		if (!this.#crypto) {
			try {
				this.#crypto = await import("node:crypto").then((crypto) => (crypto as any).webcrypto as Crypto);
			} catch (_) {
				throw new Error("crypto not available");
			}
		}
		return arrayBufferToBase64(this.#crypto.getRandomValues(new Uint8Array(16)));
	}

	async #generateToken(password: string) {
		let salt = this.#config.salt;
		if (!salt || !this.#config.reuseSalt) salt = await this.#generateSalt();
		if (this.#config.reuseSalt) this.#config.salt = salt;
		return {
			salt,
			token: md5(password + salt),
		};
	}

	#hexEncode(password: string): string {
		return "enc:" + Array.from(password)
			.map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
			.join("");
	}

	async #applyAuth(url: URL): Promise<void> {
		if (this.#config.auth.apiKey) {
			url.searchParams.set("apiKey", this.#config.auth.apiKey);
		} else if (this.#config.auth.username) {
			url.searchParams.set("u", this.#config.auth.username);
			if (this.#config.legacyAuth) {
				url.searchParams.set("p", this.#hexEncode(this.#config.auth.password));
			} else {
				const { token, salt } = await this.#generateToken(this.#config.auth.password);
				url.searchParams.set("t", token);
				url.searchParams.set("s", salt);
			}
		} else {
			throw new Error("no auth provided");
		}
	}

	/**
	 * Make a custom request to the Subsonic server.
	 */
	async custom(method: string, params: Record<string, unknown>) {
		return this.#request(method, params);
	}

	/**
	 * Make a custom JSON request to the Subsonic server.
	 */
	async customJSON<T>(method: string, params: Record<string, unknown>) {
		return this.#requestJSON<T>(method, params);
	}

	async #requestJSON<T>(method: string, args?: Record<string, unknown>) {
		return this.#request(method, args)
			.then(async (res) => res.json())
			.then(async (res) => res?.["subsonic-response"] as Promise<T>);
	}

	/**
	 * Get the base URL of the Subsonic server.
	 */
	baseURL() {
		let base = this.#config.url;
		if (!base.startsWith("http")) base = `https://${base}`;
		if (!base.endsWith("/")) base += "/";
		return base;
	}

	async #request(method: string, params?: Record<string, unknown>) {
		let base = this.baseURL();
		if (!base.endsWith("rest/")) base += "rest/";

		if (!method.endsWith(".m3u8")) base += `${method}.view`;

		const url = new URL(base);
		url.searchParams.set("v", this.#config.clientVersion ?? "1.15.0");
		url.searchParams.set("c", this.#config.clientName ?? "substreamer8");
		url.searchParams.set("f", "json");

		if (params) {
			for (const [key, value] of Object.entries(params)) {
				if (typeof value === "undefined" || value === null) continue;
				if (Array.isArray(value)) {
					for (const v of value) {
						url.searchParams.append(key, v.toString());
					}
				} else {
					url.searchParams.set(key, value.toString());
				}
			}
		}

		await this.#applyAuth(url);

		if (this.#config.post) {
			const [path, search] = url.toString().split("?");
			return this.#fetch(path, {
				method: "POST",
				body: search,
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
			});
		}

		return this.#fetch(url.toString(), {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
			},
		});
	}

	// -----------------
	// OPENSUBSONIC APIs
	// -----------------

	/**
	 * List the OpenSubsonic extensions supported by this server.\
	 * Only supported by OpenSubsonic compatible servers.
	 *
	 * https://opensubsonic.netlify.app/docs/endpoints/getopensubsonicextensions/
	 */
	async getOpenSubsonicExtensions() {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				openSubsonicExtensions: OpenSubsonicExtensions[];
			}
		>("getOpenSubsonicExtensions", {});
	}

	/**
	 * Get structured lyrics for a song.\
	 * Only supported by OpenSubsonic compatible servers with the `songLyrics` extension.
	 *
	 * https://opensubsonic.netlify.app/docs/endpoints/getlyricsbysongid/
	 */
	async getLyricsBySongId(args: { id: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				lyricsList?: LyricsList;
			}
		>("getLyricsBySongId", args);
	}

	/**
	 * Get information about an API key.\
	 * Only supported by OpenSubsonic compatible servers with the `apiKeyAuthentication` extension.
	 *
	 * https://opensubsonic.netlify.app/docs/endpoints/tokeninfo/
	 */
	async tokenInfo() {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				tokenInfo: TokenInfo;
			}
		>("tokenInfo", {});
	}

	/**
	 * Get the play queue using index-based positioning.\
	 * Only supported by OpenSubsonic compatible servers with the `indexBasedQueue` extension.
	 *
	 * https://opensubsonic.netlify.app/docs/endpoints/getplayqueuebyindex/
	 */
	async getPlayQueueByIndex() {
		return this.#requestJSON<
			SubsonicBaseResponse & Partial<{
				playQueueByIndex: PlayQueueByIndex;
			}>
		>("getPlayQueueByIndex", {});
	}

	/**
	 * Save the play queue using index-based positioning.\
	 * Call with no arguments to clear the queue.\
	 * Only supported by OpenSubsonic compatible servers with the `indexBasedQueue` extension.
	 *
	 * https://opensubsonic.netlify.app/docs/endpoints/saveplayqueuebyindex/
	 */
	async savePlayQueueByIndex(args?: { id?: string | string[]; currentIndex?: number; position?: number }) {
		return this.#requestJSON<SubsonicBaseResponse>("savePlayQueueByIndex", args);
	}

	/**
	 * Report playback status to the server.\
	 * Only supported by OpenSubsonic compatible servers with the `playbackReport` extension.
	 *
	 * https://opensubsonic.netlify.app/docs/endpoints/reportplayback/
	 */
	async reportPlayback(args: {
		mediaId: string;
		mediaType: "song" | "podcast";
		positionMs: number;
		state: "starting" | "playing" | "paused" | "stopped";
		playbackRate?: number;
		ignoreScrobble?: boolean;
	}) {
		return this.#requestJSON<SubsonicBaseResponse>("reportPlayback", args);
	}

	/**
	 * Get a transcode decision for a media item based on client capabilities.\
	 * Only supported by OpenSubsonic compatible servers with the `transcoding` extension.
	 *
	 * Note: This endpoint requires POST with a JSON body for the client info.
	 * The `clientInfo` parameter is sent as the POST body.
	 *
	 * https://opensubsonic.netlify.app/docs/endpoints/gettranscodedecision/
	 */
	async getTranscodeDecision(args: {
		mediaId: string;
		mediaType: "song" | "podcast";
		clientInfo: ClientInfo;
	}) {
		const { clientInfo, ...queryParams } = args;

		// Build the URL with auth + query params
		let base = this.baseURL();
		if (!base.endsWith("rest/")) base += "rest/";
		base += "getTranscodeDecision.view";

		const url = new URL(base);
		url.searchParams.set("v", this.#config.clientVersion ?? "1.15.0");
		url.searchParams.set("c", this.#config.clientName ?? "substreamer8");
		url.searchParams.set("f", "json");

		for (const [key, value] of Object.entries(queryParams)) {
			if (value != null) url.searchParams.set(key, String(value));
		}

		await this.#applyAuth(url);

		const res = await this.#fetch(url.toString(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(clientInfo),
		});

		const json = await res.json();
		return json?.["subsonic-response"] as SubsonicBaseResponse & {
			transcodeDecision: TranscodeDecision;
		};
	}

	/**
	 * Get a transcoded media stream.\
	 * Only supported by OpenSubsonic compatible servers with the `transcoding` extension.
	 *
	 * Returns a raw binary audio stream (not JSON).
	 *
	 * https://opensubsonic.netlify.app/docs/endpoints/gettranscodestream/
	 */
	async getTranscodeStream(args: {
		mediaId: string;
		mediaType: "song" | "podcast";
		transcodeParams: string;
		offset?: number;
	}) {
		return this.#request("getTranscodeStream", args);
	}

	// ----------
	// SYSTEM API
	// ----------

	async ping() {
		return this.#requestJSON<SubsonicBaseResponse>("ping", {});
	}

	async getLicense() {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				license: License;
			}
		>("getLicense", {});
	}

	// ------------
	// BROWSING API
	// ------------

	async getMusicFolders() {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				musicFolders: MusicFolders;
			}
		>("getMusicFolders", {});
	}

	async getIndexes(args?: { musicFolderId?: string | number; ifModifiedSince?: number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				indexes: Indexes;
			}
		>("getIndexes", args);
	}

	async getMusicDirectory(args: { id: string | number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				directory: Directory;
			}
		>("getMusicDirectory", args);
	}

	async getGenres() {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				genres: Genres;
			}
		>("getGenres", {});
	}

	async getArtists(args?: { musicFolderId?: string | number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				artists: ArtistsID3;
			}
		>("getArtists", args);
	}

	async getArtist(args: { id: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				artist: ArtistWithAlbumsID3;
			}
		>("getArtist", args);
	}

	async getAlbum(args: { id: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				album: AlbumWithSongsID3;
			}
		>("getAlbum", args);
	}

	async getSong(args: { id: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				song: Child;
			}
		>("getSong", args);
	}

	async getVideos(args?: { musicFolderId?: string | number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				videos: Videos;
			}
		>("getVideos", args);
	}

	async getVideoInfo(args: { id: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				videoInfo: VideoInfo;
			}
		>("getVideoInfo", args);
	}

	async getArtistInfo(args: { id: string; count?: number; includeNotPresent?: boolean }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				artistInfo: ArtistInfo;
			}
		>("getArtistInfo", args);
	}

	async getArtistInfo2(args: { id: string; count?: number; includeNotPresent?: boolean }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				artistInfo2: ArtistInfo2;
			}
		>("getArtistInfo2", args);
	}

	async getAlbumInfo(args: { id: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				albumInfo: AlbumInfo;
			}
		>("getAlbumInfo", args);
	}

	async getAlbumInfo2(args: { id: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				albumInfo: AlbumInfo;
			}
		>("getAlbumInfo2", args);
	}

	async getSimilarSongs(args: { id: string; count?: number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				similarSongs: SimilarSongs;
			}
		>("getSimilarSongs", args);
	}

	async getSimilarSongs2(args: { id: string; count?: number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				similarSongs2: SimilarSongs2;
			}
		>("getSimilarSongs2", args);
	}

	async getTopSongs(args: { artist?: string; count?: number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				topSongs: TopSongs;
			}
		>("getTopSongs", args);
	}

	async getAlbumList(args: {
		type:
			| "alphabeticalByName"
			| "alphabeticalByArtist"
			| "byYear"
			| "random"
			| "newest"
			| "highest"
			| "frequent"
			| "recent";
		size?: number;
		offset?: number;
		fromYear?: number;
		toYear?: number;
		genre?: string;
		musicFolderId?: string | number;
	}) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				albumList: AlbumList;
			}
		>("getAlbumList", args);
	}

	async getAlbumList2(args: {
		type:
			| "alphabeticalByName"
			| "alphabeticalByArtist"
			| "byYear"
			| "random"
			| "newest"
			| "highest"
			| "frequent"
			| "recent";
		size?: number;
		offset?: number;
		fromYear?: number;
		toYear?: number;
		genre?: string;
		musicFolderId?: string | number;
	}) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				albumList2: AlbumList2;
			}
		>("getAlbumList2", args);
	}

	async getRandomSongs(args?: {
		size?: number;
		genre?: string;
		fromYear?: number;
		toYear?: number;
		musicFolderId?: string | number;
	}) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				randomSongs: Songs;
			}
		>("getRandomSongs", args);
	}

	async getSongsByGenre(args: {
		genre: string;
		count?: number;
		offset?: number;
		musicFolderId?: string | number;
	}) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				songsByGenre: Songs;
			}
		>("getSongsByGenre", args);
	}

	async getNowPlaying() {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				nowPlaying: NowPlaying;
			}
		>("getNowPlaying", {});
	}

	async getStarred(args?: { musicFolderId?: string | number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				starred: Starred;
			}
		>("getStarred", args);
	}

	async getStarred2(args?: { musicFolderId?: string | number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				starred2: Starred2;
			}
		>("getStarred2", args);
	}

	/**
	 * @deprecated Deprecated since 1.4.0, use search2 instead.
	 */
	async search(args?: {
		artist?: string;
		album?: string;
		title?: string;
		any?: string;
		count?: number;
		offset?: number;
		newerThan: number;
	}) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				searchResult2: SearchResult2;
			}
		>("search2", args);
	}

	async search2(args: {
		query: string;
		artistCount?: number;
		artistOffset?: number;
		albumCount?: number;
		albumOffset?: number;
		songCount?: number;
		songOffset?: number;
		musicFolderId?: string | number;
	}) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				searchResult2: SearchResult2;
			}
		>("search2", args);
	}

	async search3(args: {
		query: string;
		artistCount?: number;
		artistOffset?: number;
		albumCount?: number;
		albumOffset?: number;
		songCount?: number;
		songOffset?: number;
		musicFolderId?: string | number;
	}) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				searchResult3: SearchResult3;
			}
		>("search3", args);
	}

	async getPlaylists(args?: { username?: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				playlists: Playlists;
			}
		>("getPlaylists", args);
	}

	async getPlaylist(args: { id: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				playlist: PlaylistWithSongs;
			}
		>("getPlaylist", args);
	}

	async createPlaylist(args: { playlistId?: string; name: string; songId?: string[] }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				playlist: PlaylistWithSongs;
			}
		>("createPlaylist", args);
	}

	async updatePlaylist(args: {
		playlistId: string;
		name?: string;
		comment?: string;
		public?: boolean;
		songIdToAdd?: string[];
		songIndexToRemove?: number[];
	}) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				playlist: Playlist;
			}
		>("updatePlaylist", args);
	}

	async deletePlaylist(args: { id: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				playlist: Playlist;
			}
		>("deletePlaylist", args);
	}

	async stream(args: {
		id: string;
		maxBitRate?: number;
		/**
		 * `'raw'` is the canonical "no transcoding" sentinel; any other
		 * string is sent verbatim. Server semantics vary — Navidrome treats
		 * it as a codec name, gonic as a profile name (e.g. `opus_128_car`).
		 */
		format?: string;
		timeOffset?: number;
		size?: number;
		estimateContentLength?: boolean;
		converted?: boolean;
	}) {
		return this.#request("stream", args);
	}

	async download(args: {
		id: string;
		/**
		 * Only supported by Navidrome
		 */
		maxBitRate?: number;
		/**
		 * Only supported by Navidrome. `'raw'` is the canonical
		 * "no transcoding" sentinel; any other string is sent verbatim.
		 */
		format?: string;
		/**
		 * Only supported by Navidrome
		 */
		timeOffset?: number;
	}) {
		return this.#request("download", args);
	}

	async hls(args: { id: string; bitRate?: number; audioTrack?: number }) {
		return this.#request("hls.m3u8", args);
	}

	async getCaptions(args: { id: string; format?: "srt" | "vtt" }) {
		return this.#request("getCaptions", args);
	}

	async getCoverArt(args: { id: string; size?: number }) {
		return this.#request("getCoverArt", args);
	}

	async getLyrics(args: { artist?: string; title?: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				lyrics: Lyrics;
			}
		>("getLyrics", args);
	}

	async getAvatar(args: { username: string; size?: number }) {
		return this.#request("getAvatar", args);
	}

	async star(args: { id?: string; albumId?: string; artistId?: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("star", args);
	}

	async unstar(args: { id?: string; albumId?: string; artistId?: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("unstar", args);
	}

	async setRating(args: { id: string; rating: number }) {
		return this.#requestJSON<SubsonicBaseResponse>("setRating", args);
	}

	async scrobble(args: { id: string; submission?: boolean; time?: number }) {
		return this.#requestJSON<SubsonicBaseResponse>("scrobble", args);
	}

	async getShares() {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				shares: Shares;
			}
		>("getShares", {});
	}

	async createShare(args: { id: string | string[]; description?: string; expires?: number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				shares: Shares;
			}
		>("createShare", args);
	}

	async updateShare(args: { id: string; description?: string; expires?: number }) {
		return this.#requestJSON<SubsonicBaseResponse>("updateShare", args);
	}

	async deleteShare(args: { id: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("deleteShare", args);
	}

	async getPodcasts(args?: { id?: string; includeEpisodes?: boolean }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				podcasts: Podcasts;
			}
		>("getPodcasts", args);
	}

	async getNewestPodcasts(args?: { since?: number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				newestPodcasts: NewestPodcasts;
			}
		>("getNewestPodcasts", args);
	}

	async refreshPodcasts() {
		return this.#requestJSON<SubsonicBaseResponse>("refreshPodcasts", {});
	}

	async createPodcastChannel(args: { url: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("createPodcastChannel", args);
	}

	async deletePodcastChannel(args: { id: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("deletePodcastChannel", args);
	}

	async deletePodcastEpisode(args: { id: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("deletePodcastEpisode", args);
	}

	async downloadPodcastEpisode(args: { id: string }) {
		return this.#request("downloadPodcastEpisode", args);
	}

	/**
	 * Returns details for a podcast episode.
	 * Only supported by OpenSubsonic compatible servers with the `getPodcastEpisode` extension.
	 *
	 * https://opensubsonic.netlify.app/docs/endpoints/getPodcastEpisode/
	 */
	async getPodcastEpisode(args: { id: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				podcastEpisode: PodcastEpisode;
			}
		>("getPodcastEpisode", args);
	}

	async jukeboxControl(args: {
		action:
			| "start"
			| "stop"
			| "skip"
			| "add"
			| "setGain"
			| "clear"
			| "shuffle"
			| "get"
			| "status"
			| "remove"
			| "set";
		index?: number;
		gain?: number;
		id?: string | string[];
		offset?: number;
	}) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				jukeboxStatus: JukeboxStatus;
				jukeboxPlaylist: JukeboxPlaylist;
			}
		>("jukeboxControl", args);
	}

	async getInternetRadioStations() {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				internetRadioStations: InternetRadioStations;
			}
		>("getInternetRadioStations", {});
	}

	async createInternetRadioStation(args: { name: string; streamUrl: string; homepageUrl?: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("createInternetRadioStation", args);
	}

	async updateInternetRadioStation(args: {
		id: string;
		name?: string;
		streamUrl?: string;
		homepageUrl?: string;
	}) {
		return this.#requestJSON<SubsonicBaseResponse>("updateInternetRadioStation", args);
	}

	async deleteInternetRadioStation(args: { id: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("deleteInternetRadioStation", args);
	}

	async getChatMessages(args?: { since?: number }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				chatMessages: ChatMessages;
			}
		>("getChatMessages", args);
	}

	async addChatMessage(args: { message: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("addChatMessage", args);
	}

	async getUser(args?: { username?: string }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				user: User;
			}
		>("getUser", args);
	}

	async getUsers() {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				users: Users;
			}
		>("getUsers", {});
	}

	async createUser(args: {
		username: string; // The name of the new user.
		password: string; // The password of the new user, either in clear text of
		// hex-encoded (see above).
		email: string; // The email address of the new user.

		ldapAuthenticated?: string; //	Whether the user is authenicated in LDAP.
		adminRole?: string; //	Whether the user is administrator.
		settingsRole?: string; //	Whether the user is allowed to change personal
		//settings and password.
		streamRole?: string; //	Whether the user is allowed to play files.
		jukeboxRole?: string; //	Whether the user is allowed to play files in
		//jukebox mode.
		downloadRole?: string; //	Whether the user is allowed to download files.
		uploadRole?: string; //	Whether the user is allowed to upload files.
		playlistRole?: string; //	Whether the user is allowed to create and delete
		//playlists. Since 1.8.0, changing this role has no effect.
		coverArtRole?: string; //	Whether the user is allowed to change cover art
		//and tags.
		commentRole?: string; //	Whether the user is allowed to create and edit
		//comments and ratings.
		podcastRole?: string; //	Whether the user is allowed to administrate Podcasts.
		shareRole?: string; //	(Since 1.8.0) Whether the user is allowed to
		//share files with anyone.
		videoConversionRole?: string; //	(Since 1.15.0) Whether the user is
		//allowed to start video conversions.
		musicFolderId?: (string | number)[]; // (Since 1.12.0) IDs of the music folders the
		// user is allowed access to.
	}) {
		return this.#requestJSON<SubsonicBaseResponse>("createUser", args);
	}

	async updateUser(args: {
		username: string; // The name of the new user.
		password: string; // The password of the new user, either in clear text of
		// hex-encoded (see above).
		email: string; // The email address of the new user.

		ldapAuthenticated?: string; // Whether the user is authenicated in LDAP.
		adminRole?: string; // Whether the user is administrator.
		settingsRole?: string; //	Whether the user is allowed to change personal
		//settings and password.
		streamRole?: string; //	Whether the user is allowed to play files.
		jukeboxRole?: string; // Whether the user is allowed to play files in jukebox mode.
		downloadRole?: string; //	Whether the user is allowed to download files.
		uploadRole?: string; //	Whether the user is allowed to upload files.
		playlistRole?: string; //	Whether the user is allowed to create and delete
		//playlists. Since 1.8.0, changing this role has no effect.
		coverArtRole?: string; //	Whether the user is allowed to change cover art
		//and tags.
		commentRole?: string; // Whether the user is allowed to create and edit
		// comments and ratings.
		podcastRole?: string; // Whether the user is allowed to administrate Podcasts.
		shareRole?: string; // (Since 1.8.0) Whether the user is allowed to share
		// files with anyone.
		videoConversionRole?: string; // (Since 1.15.0) Whether the user is allowed
		// to start video conversions.
		musicFolderId?: (string | number)[]; // (Since 1.12.0) IDs of the music folders the
		// user is allowed access to.
		maxBitRate?: string; //	(Since 1.13.0) The maximum bit rate for this
		//user. 0 = no limit.
	}) {
		return this.#requestJSON<SubsonicBaseResponse>("createUser", args);
	}

	async deleteUser(args: { username: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("deleteUser", args);
	}

	async changePassword(args: { username: string; password: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("changePassword", args);
	}

	async getBookmarks() {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				bookmarks: Bookmarks;
			}
		>("getBookmarks", {});
	}

	async createBookmark(args: { id: string; position: number; comment?: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("createBookmark", args);
	}

	async deleteBookmark(args: { id: string }) {
		return this.#requestJSON<SubsonicBaseResponse>("deleteBookmark", args);
	}

	async getPlayQueue() {
		return this.#requestJSON<SubsonicBaseResponse & Partial<{ playQueue: PlayQueue }>>("getPlayQueue", {});
	}

	// id is optional on OpenSubsonic compatible servers
	async savePlayQueue(args: { id?: string; current?: string; position: number }) {
		return this.#requestJSON<SubsonicBaseResponse>("savePlayQueue", args);
	}

	async getScanStatus() {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				scanStatus: ScanStatus;
				lastScan?: number;
				folderCount?: number;
			}
		>("getScanStatus", {});
	}

	/**
	 * Start scanning the media library.
	 * @param args.fullScan Only supported by navidrome - whether to do a full scan, or just an incremental scan.
	 */
	async startScan(args?: { fullScan?: boolean }) {
		return this.#requestJSON<
			SubsonicBaseResponse & {
				scanStatus: ScanStatus;
			}
		>("startScan", args);
	}
}

export { SubsonicAPI };
