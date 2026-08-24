CREATE TABLE `album_artists` (
	`album_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`album_id`, `pos`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `album_disc_titles` (
	`album_id` text NOT NULL,
	`disc` integer NOT NULL,
	`title` text NOT NULL,
	PRIMARY KEY(`album_id`, `disc`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `album_genres` (
	`album_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`album_id`, `pos`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `album_info` (
	`album_id` text PRIMARY KEY NOT NULL,
	`notes` text,
	`last_fm_url` text,
	`music_brainz_id` text,
	`image_url_small` text,
	`image_url_medium` text,
	`image_url_large` text,
	`enriched_notes` text,
	`enriched_notes_url` text,
	`override_mbid` text,
	`retrieved_at` integer NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `album_list_entries` (
	`list_type` text NOT NULL,
	`pos` integer NOT NULL,
	`album_id` text NOT NULL,
	PRIMARY KEY(`list_type`, `pos`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `album_moods` (
	`album_id` text NOT NULL,
	`pos` integer NOT NULL,
	`mood` text NOT NULL,
	PRIMARY KEY(`album_id`, `pos`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `album_record_labels` (
	`album_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`album_id`, `pos`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `album_release_types` (
	`album_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`album_id`, `pos`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`artist_id` text,
	`name` text,
	`artist` text,
	`display_artist` text,
	`cover_art` text,
	`song_count` integer,
	`duration` integer,
	`play_count` integer,
	`created` integer,
	`starred` integer,
	`year` integer,
	`genre` text,
	`played` text,
	`user_rating` integer,
	`version` text,
	`music_brainz_id` text,
	`sort_name` text,
	`sort_title` text,
	`sort_artist` text,
	`is_compilation` integer,
	`explicit_status` text,
	`original_release_year` integer,
	`original_release_month` integer,
	`original_release_day` integer,
	`release_year` integer,
	`release_month` integer,
	`release_day` integer,
	`norm_name` text,
	`norm_artist` text,
	`dmeta_name` text,
	`dmeta_artist` text,
	`synced_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_albums_sort` ON `albums` (`sort_title`,`id`);--> statement-breakpoint
CREATE INDEX `idx_albums_artist_sort` ON `albums` (`sort_artist`,`sort_title`,`id`);--> statement-breakpoint
CREATE INDEX `idx_albums_artist` ON `albums` (`artist_id`);--> statement-breakpoint
CREATE INDEX `idx_albums_starred_key` ON `albums` (`starred`,`id`) WHERE "albums"."starred" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_albums_created` ON `albums` (`created`);--> statement-breakpoint
CREATE INDEX `idx_albums_norm_name` ON `albums` (`norm_name`);--> statement-breakpoint
CREATE INDEX `idx_albums_dmeta_name` ON `albums` (`dmeta_name`);--> statement-breakpoint
CREATE INDEX `idx_albums_dmeta_artist` ON `albums` (`dmeta_artist`);--> statement-breakpoint
CREATE TABLE `artist_bio` (
	`artist_id` text PRIMARY KEY NOT NULL,
	`biography` text,
	`resolved_mbid` text,
	`checked_at` integer,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `artist_info` (
	`artist_id` text PRIMARY KEY NOT NULL,
	`biography` text,
	`last_fm_url` text,
	`music_brainz_id` text,
	`image_url_small` text,
	`image_url_medium` text,
	`image_url_large` text,
	`retrieved_at` integer NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `artist_roles` (
	`artist_id` text NOT NULL,
	`pos` integer NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`artist_id`, `pos`),
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `artist_similar` (
	`artist_id` text NOT NULL,
	`pos` integer NOT NULL,
	`similar_artist_id` text,
	`name` text,
	`cover_art` text,
	`album_count` integer,
	`user_rating` integer,
	PRIMARY KEY(`artist_id`, `pos`),
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `artist_top_songs` (
	`artist_id` text NOT NULL,
	`pos` integer NOT NULL,
	`song_id` text NOT NULL,
	PRIMARY KEY(`artist_id`, `pos`),
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `artist_top_songs_state` (
	`artist_id` text PRIMARY KEY NOT NULL,
	`retrieved_at` integer NOT NULL,
	`list_length` integer NOT NULL,
	`song_count` integer NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `artists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`sort_name` text,
	`sort_title` text,
	`cover_art` text,
	`artist_image_url` text,
	`album_count` integer,
	`starred` integer,
	`user_rating` integer,
	`music_brainz_id` text,
	`norm_name` text,
	`dmeta_name` text
);
--> statement-breakpoint
CREATE INDEX `idx_artists_sort` ON `artists` (`sort_title`,`id`);--> statement-breakpoint
CREATE INDEX `idx_artists_starred_key` ON `artists` (`starred`,`id`) WHERE "artists"."starred" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_artists_norm_name` ON `artists` (`norm_name`);--> statement-breakpoint
CREATE INDEX `idx_artists_dmeta_name` ON `artists` (`dmeta_name`);--> statement-breakpoint
CREATE TABLE `cached_albums` (
	`item_id` text PRIMARY KEY NOT NULL,
	`artist_id` text,
	`name` text,
	`artist` text,
	`display_artist` text,
	`cover_art` text,
	`song_count` integer,
	`duration` integer,
	`play_count` integer,
	`created` integer,
	`starred` integer,
	`year` integer,
	`genre` text,
	`played` text,
	`user_rating` integer,
	`version` text,
	`music_brainz_id` text,
	`sort_name` text,
	`sort_title` text,
	`sort_artist` text,
	`is_compilation` integer,
	`explicit_status` text,
	`original_release_year` integer,
	`original_release_month` integer,
	`original_release_day` integer,
	`release_year` integer,
	`release_month` integer,
	`release_day` integer,
	FOREIGN KEY (`item_id`) REFERENCES `cached_items`(`item_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cached_images` (
	`cover_art_id` text NOT NULL,
	`size` integer NOT NULL,
	`ext` text NOT NULL,
	`bytes` integer NOT NULL,
	`cached_at` integer NOT NULL,
	PRIMARY KEY(`cover_art_id`, `size`)
);
--> statement-breakpoint
CREATE INDEX `idx_cached_images_cached_at` ON `cached_images` (`cached_at`);--> statement-breakpoint
CREATE INDEX `idx_cached_images_cover_art_id` ON `cached_images` (`cover_art_id`);--> statement-breakpoint
CREATE TABLE `cached_item_songs` (
	`item_id` text NOT NULL,
	`position` integer NOT NULL,
	`song_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `position`),
	FOREIGN KEY (`item_id`) REFERENCES `cached_items`(`item_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`song_id`) REFERENCES `cached_songs`(`song_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cached_item_songs_song_id` ON `cached_item_songs` (`song_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cached_item_songs_item_song` ON `cached_item_songs` (`item_id`,`song_id`);--> statement-breakpoint
CREATE TABLE `cached_items` (
	`item_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`artist` text,
	`cover_art_id` text,
	`expected_song_count` integer NOT NULL,
	`parent_album_id` text,
	`last_sync_at` integer NOT NULL,
	`downloaded_at` integer NOT NULL,
	`raw_json` text,
	`meta_v` integer,
	`derived` integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `cached_playlists` (
	`item_id` text PRIMARY KEY NOT NULL,
	`name` text,
	`comment` text,
	`cover_art` text,
	`created` integer,
	`changed` integer,
	`duration` integer,
	`owner` text,
	`public` integer,
	`song_count` integer,
	`sort_title` text,
	FOREIGN KEY (`item_id`) REFERENCES `cached_items`(`item_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cached_song_album_artists` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `cached_songs`(`song_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cached_song_artists` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `cached_songs`(`song_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cached_song_contributors` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`role` text NOT NULL,
	`sub_role` text,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `cached_songs`(`song_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cached_song_genres` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `cached_songs`(`song_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cached_song_moods` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`mood` text NOT NULL,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `cached_songs`(`song_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cached_songs` (
	`song_id` text PRIMARY KEY NOT NULL,
	`album_id` text NOT NULL,
	`suffix` text NOT NULL,
	`bit_rate` integer,
	`bit_depth` integer,
	`sampling_rate` integer,
	`bytes` integer NOT NULL,
	`format_captured_at` integer NOT NULL,
	`downloaded_at` integer NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`album` text,
	`cover_art` text,
	`duration` integer NOT NULL,
	`src_album_id` text,
	`src_suffix` text,
	`src_bit_rate` integer,
	`src_bit_depth` integer,
	`src_sampling_rate` integer,
	`artist_id` text,
	`display_artist` text,
	`display_album_artist` text,
	`display_composer` text,
	`track` integer,
	`disc_number` integer,
	`year` integer,
	`genre` text,
	`size` integer,
	`content_type` text,
	`transcoded_content_type` text,
	`transcoded_suffix` text,
	`channel_count` integer,
	`path` text,
	`user_rating` integer,
	`average_rating` real,
	`play_count` integer,
	`created` integer,
	`starred` integer,
	`played` text,
	`type` text,
	`bpm` integer,
	`comment` text,
	`sort_name` text,
	`sort_title` text,
	`sort_artist` text,
	`music_brainz_id` text,
	`explicit_status` text,
	`bookmark_position` integer,
	`is_video` integer,
	`is_dir` integer,
	`parent` text,
	`original_width` integer,
	`original_height` integer,
	`rg_track_gain` real,
	`rg_album_gain` real,
	`rg_track_peak` real,
	`rg_album_peak` real,
	`rg_base_gain` real,
	`rg_fallback_gain` real,
	`raw_json` text,
	`meta_v` integer
);
--> statement-breakpoint
CREATE INDEX `idx_cached_songs_album_id` ON `cached_songs` (`album_id`);--> statement-breakpoint
CREATE TABLE `download_queue` (
	`queue_id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`artist` text,
	`cover_art_id` text,
	`status` text NOT NULL,
	`total_songs` integer NOT NULL,
	`completed_songs` integer NOT NULL,
	`error` text,
	`added_at` integer NOT NULL,
	`queue_position` integer NOT NULL,
	`songs_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_download_queue_status` ON `download_queue` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_download_queue_position_unique` ON `download_queue` (`queue_position`);--> statement-breakpoint
CREATE TABLE `download_queue_song_album_artists` (
	`queue_id` text NOT NULL,
	`song_pos` integer NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`queue_id`, `song_pos`, `pos`),
	FOREIGN KEY (`queue_id`,`song_pos`) REFERENCES `download_queue_songs`(`queue_id`,`pos`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `download_queue_song_artists` (
	`queue_id` text NOT NULL,
	`song_pos` integer NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`queue_id`, `song_pos`, `pos`),
	FOREIGN KEY (`queue_id`,`song_pos`) REFERENCES `download_queue_songs`(`queue_id`,`pos`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `download_queue_song_contributors` (
	`queue_id` text NOT NULL,
	`song_pos` integer NOT NULL,
	`pos` integer NOT NULL,
	`role` text NOT NULL,
	`sub_role` text,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`queue_id`, `song_pos`, `pos`),
	FOREIGN KEY (`queue_id`,`song_pos`) REFERENCES `download_queue_songs`(`queue_id`,`pos`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `download_queue_song_genres` (
	`queue_id` text NOT NULL,
	`song_pos` integer NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`queue_id`, `song_pos`, `pos`),
	FOREIGN KEY (`queue_id`,`song_pos`) REFERENCES `download_queue_songs`(`queue_id`,`pos`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `download_queue_song_moods` (
	`queue_id` text NOT NULL,
	`song_pos` integer NOT NULL,
	`pos` integer NOT NULL,
	`mood` text NOT NULL,
	PRIMARY KEY(`queue_id`, `song_pos`, `pos`),
	FOREIGN KEY (`queue_id`,`song_pos`) REFERENCES `download_queue_songs`(`queue_id`,`pos`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `download_queue_songs` (
	`queue_id` text NOT NULL,
	`pos` integer NOT NULL,
	`song_id` text NOT NULL,
	`title` text,
	`artist` text,
	`album` text,
	`cover_art` text,
	`duration` integer,
	`album_id` text,
	`suffix` text,
	`bit_rate` integer,
	`bit_depth` integer,
	`sampling_rate` integer,
	`artist_id` text,
	`display_artist` text,
	`display_album_artist` text,
	`display_composer` text,
	`track` integer,
	`disc_number` integer,
	`year` integer,
	`genre` text,
	`size` integer,
	`content_type` text,
	`transcoded_content_type` text,
	`transcoded_suffix` text,
	`channel_count` integer,
	`path` text,
	`user_rating` integer,
	`average_rating` real,
	`play_count` integer,
	`created` integer,
	`starred` integer,
	`played` text,
	`type` text,
	`bpm` integer,
	`comment` text,
	`sort_name` text,
	`music_brainz_id` text,
	`explicit_status` text,
	`bookmark_position` integer,
	`is_video` integer,
	`is_dir` integer,
	`parent` text,
	`original_width` integer,
	`original_height` integer,
	`rg_track_gain` real,
	`rg_album_gain` real,
	`rg_track_peak` real,
	`rg_album_peak` real,
	`rg_base_gain` real,
	`rg_fallback_gain` real,
	PRIMARY KEY(`queue_id`, `pos`),
	FOREIGN KEY (`queue_id`) REFERENCES `download_queue`(`queue_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_download_queue_songs_song_id` ON `download_queue_songs` (`song_id`);--> statement-breakpoint
CREATE TABLE `favorite_album_artists` (
	`album_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`album_id`, `pos`),
	FOREIGN KEY (`album_id`) REFERENCES `favorite_albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_album_disc_titles` (
	`album_id` text NOT NULL,
	`disc` integer NOT NULL,
	`title` text NOT NULL,
	PRIMARY KEY(`album_id`, `disc`),
	FOREIGN KEY (`album_id`) REFERENCES `favorite_albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_album_genres` (
	`album_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`album_id`, `pos`),
	FOREIGN KEY (`album_id`) REFERENCES `favorite_albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_album_moods` (
	`album_id` text NOT NULL,
	`pos` integer NOT NULL,
	`mood` text NOT NULL,
	PRIMARY KEY(`album_id`, `pos`),
	FOREIGN KEY (`album_id`) REFERENCES `favorite_albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_album_record_labels` (
	`album_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`album_id`, `pos`),
	FOREIGN KEY (`album_id`) REFERENCES `favorite_albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_album_release_types` (
	`album_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`album_id`, `pos`),
	FOREIGN KEY (`album_id`) REFERENCES `favorite_albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_albums` (
	`id` text PRIMARY KEY NOT NULL,
	`starred` integer NOT NULL,
	`sort_title` text,
	`sort_artist` text,
	`json` text NOT NULL,
	`name` text,
	`artist_id` text,
	`artist` text,
	`display_artist` text,
	`cover_art` text,
	`song_count` integer,
	`duration` integer,
	`play_count` integer,
	`created` integer,
	`year` integer,
	`genre` text,
	`played` text,
	`user_rating` integer,
	`version` text,
	`music_brainz_id` text,
	`sort_name` text,
	`is_compilation` integer,
	`explicit_status` text,
	`original_release_year` integer,
	`original_release_month` integer,
	`original_release_day` integer,
	`release_year` integer,
	`release_month` integer,
	`release_day` integer
);
--> statement-breakpoint
CREATE INDEX `idx_favorite_albums_starred_key` ON `favorite_albums` (`starred`,`id`);--> statement-breakpoint
CREATE TABLE `favorite_artist_roles` (
	`artist_id` text NOT NULL,
	`pos` integer NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`artist_id`, `pos`),
	FOREIGN KEY (`artist_id`) REFERENCES `favorite_artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_artists` (
	`id` text PRIMARY KEY NOT NULL,
	`starred` integer NOT NULL,
	`sort_title` text,
	`json` text NOT NULL,
	`name` text,
	`sort_name` text,
	`cover_art` text,
	`artist_image_url` text,
	`album_count` integer,
	`user_rating` integer,
	`music_brainz_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_favorite_artists_starred_key` ON `favorite_artists` (`starred`,`id`);--> statement-breakpoint
CREATE TABLE `favorite_song_album_artists` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `favorite_songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_song_artists` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `favorite_songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_song_contributors` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`role` text NOT NULL,
	`sub_role` text,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `favorite_songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_song_genres` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `favorite_songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_song_moods` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`mood` text NOT NULL,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `favorite_songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorite_songs` (
	`id` text PRIMARY KEY NOT NULL,
	`starred` integer NOT NULL,
	`duration` integer,
	`sort_title` text,
	`sort_artist` text,
	`json` text NOT NULL,
	`title` text,
	`artist` text,
	`album` text,
	`cover_art` text,
	`album_id` text,
	`suffix` text,
	`bit_rate` integer,
	`bit_depth` integer,
	`sampling_rate` integer,
	`artist_id` text,
	`display_artist` text,
	`display_album_artist` text,
	`display_composer` text,
	`track` integer,
	`disc_number` integer,
	`year` integer,
	`genre` text,
	`size` integer,
	`content_type` text,
	`transcoded_content_type` text,
	`transcoded_suffix` text,
	`channel_count` integer,
	`path` text,
	`user_rating` integer,
	`average_rating` real,
	`play_count` integer,
	`created` integer,
	`played` text,
	`type` text,
	`bpm` integer,
	`comment` text,
	`sort_name` text,
	`music_brainz_id` text,
	`explicit_status` text,
	`bookmark_position` integer,
	`is_video` integer,
	`is_dir` integer,
	`parent` text,
	`original_width` integer,
	`original_height` integer,
	`rg_track_gain` real,
	`rg_album_gain` real,
	`rg_track_peak` real,
	`rg_album_peak` real,
	`rg_base_gain` real,
	`rg_fallback_gain` real
);
--> statement-breakpoint
CREATE INDEX `idx_favorite_songs_starred_key` ON `favorite_songs` (`starred`,`id`);--> statement-breakpoint
CREATE TABLE `genres` (
	`name` text PRIMARY KEY NOT NULL,
	`pos` integer NOT NULL,
	`song_count` integer,
	`album_count` integer
);
--> statement-breakpoint
CREATE TABLE `image_download_queue` (
	`cover_art_id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`added_at` integer NOT NULL,
	`cycle_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_image_download_queue_status` ON `image_download_queue` (`status`,`added_at`);--> statement-breakpoint
CREATE INDEX `idx_image_download_queue_cycle` ON `image_download_queue` (`cycle_id`);--> statement-breakpoint
CREATE TABLE `lyric_lines` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`start_ms` integer NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `lyrics`(`song_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lyrics` (
	`song_id` text PRIMARY KEY NOT NULL,
	`title` text,
	`artist` text,
	`synced` integer,
	`lang` text,
	`offset_ms` integer,
	`source` text
);
--> statement-breakpoint
CREATE TABLE `mbid_overrides` (
	`type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_name` text,
	`mbid` text NOT NULL,
	PRIMARY KEY(`type`, `entity_id`)
);
--> statement-breakpoint
CREATE TABLE `pending_scrobble_album_artists` (
	`scrobble_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`scrobble_id`, `pos`),
	FOREIGN KEY (`scrobble_id`) REFERENCES `pending_scrobble_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pending_scrobble_artists` (
	`scrobble_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`scrobble_id`, `pos`),
	FOREIGN KEY (`scrobble_id`) REFERENCES `pending_scrobble_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pending_scrobble_contributors` (
	`scrobble_id` text NOT NULL,
	`pos` integer NOT NULL,
	`role` text NOT NULL,
	`sub_role` text,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`scrobble_id`, `pos`),
	FOREIGN KEY (`scrobble_id`) REFERENCES `pending_scrobble_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pending_scrobble_events` (
	`id` text PRIMARY KEY NOT NULL,
	`time` integer NOT NULL,
	`song_id` text,
	`artist` text,
	`artist_id` text,
	`album` text,
	`album_id` text,
	`cover_art` text,
	`genre` text,
	`year` integer,
	`duration` integer,
	`title` text,
	`display_artist` text,
	`display_composer` text,
	`track` integer,
	`disc_number` integer,
	`suffix` text,
	`bit_rate` integer,
	`size` integer,
	`content_type` text,
	`bpm` integer,
	`path` text,
	`parent` text,
	`sort_name` text,
	`music_brainz_id` text,
	`explicit_status` text,
	`user_rating` integer,
	`average_rating` real,
	`play_count` integer,
	`created` integer,
	`starred` integer,
	`played` text,
	`rg_track_gain` real,
	`rg_track_peak` real
);
--> statement-breakpoint
CREATE INDEX `idx_pending_scrobble_events_time` ON `pending_scrobble_events` (`time`);--> statement-breakpoint
CREATE TABLE `pending_scrobble_genres` (
	`scrobble_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`scrobble_id`, `pos`),
	FOREIGN KEY (`scrobble_id`) REFERENCES `pending_scrobble_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pending_scrobble_moods` (
	`scrobble_id` text NOT NULL,
	`pos` integer NOT NULL,
	`mood` text NOT NULL,
	PRIMARY KEY(`scrobble_id`, `pos`),
	FOREIGN KEY (`scrobble_id`) REFERENCES `pending_scrobble_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `playlist_allowed_users` (
	`playlist_id` text NOT NULL,
	`pos` integer NOT NULL,
	`username` text NOT NULL,
	PRIMARY KEY(`playlist_id`, `pos`),
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `playlist_songs` (
	`playlist_id` text NOT NULL,
	`position` integer NOT NULL,
	`song_id` text NOT NULL,
	PRIMARY KEY(`playlist_id`, `position`),
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_playlist_songs_song` ON `playlist_songs` (`song_id`);--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`comment` text,
	`cover_art` text,
	`created` integer,
	`changed` integer,
	`duration` integer,
	`owner` text,
	`public` integer,
	`song_count` integer,
	`sort_title` text,
	`norm_name` text,
	`dmeta_name` text,
	`detail_changed` integer,
	`detail_song_count` integer
);
--> statement-breakpoint
CREATE INDEX `idx_playlists_sort_title` ON `playlists` (`sort_title`,`id`);--> statement-breakpoint
CREATE INDEX `idx_playlists_norm_name` ON `playlists` (`norm_name`);--> statement-breakpoint
CREATE TABLE `queue_snapshot_song_album_artists` (
	`snapshot_id` text NOT NULL,
	`song_pos` integer NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`snapshot_id`, `song_pos`, `pos`),
	FOREIGN KEY (`snapshot_id`,`song_pos`) REFERENCES `queue_snapshot_songs`(`snapshot_id`,`pos`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `queue_snapshot_song_artists` (
	`snapshot_id` text NOT NULL,
	`song_pos` integer NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`snapshot_id`, `song_pos`, `pos`),
	FOREIGN KEY (`snapshot_id`,`song_pos`) REFERENCES `queue_snapshot_songs`(`snapshot_id`,`pos`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `queue_snapshot_song_contributors` (
	`snapshot_id` text NOT NULL,
	`song_pos` integer NOT NULL,
	`pos` integer NOT NULL,
	`role` text NOT NULL,
	`sub_role` text,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`snapshot_id`, `song_pos`, `pos`),
	FOREIGN KEY (`snapshot_id`,`song_pos`) REFERENCES `queue_snapshot_songs`(`snapshot_id`,`pos`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `queue_snapshot_song_genres` (
	`snapshot_id` text NOT NULL,
	`song_pos` integer NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `song_pos`, `pos`),
	FOREIGN KEY (`snapshot_id`,`song_pos`) REFERENCES `queue_snapshot_songs`(`snapshot_id`,`pos`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `queue_snapshot_song_moods` (
	`snapshot_id` text NOT NULL,
	`song_pos` integer NOT NULL,
	`pos` integer NOT NULL,
	`mood` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `song_pos`, `pos`),
	FOREIGN KEY (`snapshot_id`,`song_pos`) REFERENCES `queue_snapshot_songs`(`snapshot_id`,`pos`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `queue_snapshot_songs` (
	`snapshot_id` text NOT NULL,
	`pos` integer NOT NULL,
	`origin` text,
	`song_id` text NOT NULL,
	`title` text,
	`artist` text,
	`album` text,
	`cover_art` text,
	`duration` integer,
	`album_id` text,
	`suffix` text,
	`bit_rate` integer,
	`bit_depth` integer,
	`sampling_rate` integer,
	`artist_id` text,
	`display_artist` text,
	`display_album_artist` text,
	`display_composer` text,
	`track` integer,
	`disc_number` integer,
	`year` integer,
	`genre` text,
	`size` integer,
	`content_type` text,
	`transcoded_content_type` text,
	`transcoded_suffix` text,
	`channel_count` integer,
	`path` text,
	`user_rating` integer,
	`average_rating` real,
	`play_count` integer,
	`created` integer,
	`starred` integer,
	`played` text,
	`type` text,
	`bpm` integer,
	`comment` text,
	`sort_name` text,
	`music_brainz_id` text,
	`explicit_status` text,
	`bookmark_position` integer,
	`is_video` integer,
	`is_dir` integer,
	`parent` text,
	`original_width` integer,
	`original_height` integer,
	`rg_track_gain` real,
	`rg_album_gain` real,
	`rg_track_peak` real,
	`rg_album_peak` real,
	`rg_base_gain` real,
	`rg_fallback_gain` real,
	PRIMARY KEY(`snapshot_id`, `pos`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `queue_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `queue_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`created_at` integer NOT NULL,
	`current_index` integer NOT NULL,
	`position_sec` real,
	`track_count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scrobble_album_artists` (
	`scrobble_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`scrobble_id`, `pos`),
	FOREIGN KEY (`scrobble_id`) REFERENCES `scrobble_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scrobble_artists` (
	`scrobble_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`scrobble_id`, `pos`),
	FOREIGN KEY (`scrobble_id`) REFERENCES `scrobble_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scrobble_contributors` (
	`scrobble_id` text NOT NULL,
	`pos` integer NOT NULL,
	`role` text NOT NULL,
	`sub_role` text,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`scrobble_id`, `pos`),
	FOREIGN KEY (`scrobble_id`) REFERENCES `scrobble_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scrobble_events` (
	`id` text PRIMARY KEY NOT NULL,
	`time` integer NOT NULL,
	`song_id` text,
	`artist` text,
	`artist_id` text,
	`album` text,
	`album_id` text,
	`cover_art` text,
	`genre` text,
	`year` integer,
	`duration` integer,
	`hour` integer,
	`day_key` text,
	`title` text,
	`display_artist` text,
	`display_composer` text,
	`track` integer,
	`disc_number` integer,
	`suffix` text,
	`bit_rate` integer,
	`size` integer,
	`content_type` text,
	`bpm` integer,
	`path` text,
	`parent` text,
	`sort_name` text,
	`music_brainz_id` text,
	`explicit_status` text,
	`user_rating` integer,
	`average_rating` real,
	`play_count` integer,
	`created` integer,
	`starred` integer,
	`played` text,
	`rg_track_gain` real,
	`rg_track_peak` real
);
--> statement-breakpoint
CREATE INDEX `idx_scrobble_events_time` ON `scrobble_events` (`time`);--> statement-breakpoint
CREATE INDEX `idx_scrobble_events_hour` ON `scrobble_events` (`hour`);--> statement-breakpoint
CREATE TABLE `scrobble_exclusions` (
	`type` text NOT NULL,
	`entity_id` text NOT NULL,
	`name` text,
	PRIMARY KEY(`type`, `entity_id`)
);
--> statement-breakpoint
CREATE TABLE `scrobble_genres` (
	`scrobble_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`scrobble_id`, `pos`),
	FOREIGN KEY (`scrobble_id`) REFERENCES `scrobble_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scrobble_moods` (
	`scrobble_id` text NOT NULL,
	`pos` integer NOT NULL,
	`mood` text NOT NULL,
	PRIMARY KEY(`scrobble_id`, `pos`),
	FOREIGN KEY (`scrobble_id`) REFERENCES `scrobble_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `share_entries` (
	`share_id` text NOT NULL,
	`pos` integer NOT NULL,
	`song_id` text NOT NULL,
	`title` text,
	`artist` text,
	`album` text,
	`album_id` text,
	`cover_art` text,
	PRIMARY KEY(`share_id`, `pos`),
	FOREIGN KEY (`share_id`) REFERENCES `shares`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`pos` integer NOT NULL,
	`url` text,
	`description` text,
	`created` integer,
	`expires` integer,
	`last_visited` integer,
	`username` text,
	`visit_count` integer
);
--> statement-breakpoint
CREATE TABLE `song_album_artists` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `song_artists` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `song_contributors` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`role` text NOT NULL,
	`sub_role` text,
	`artist_id` text,
	`artist_name` text,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `song_genres` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `song_moods` (
	`song_id` text NOT NULL,
	`pos` integer NOT NULL,
	`mood` text NOT NULL,
	PRIMARY KEY(`song_id`, `pos`),
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `songs` (
	`id` text PRIMARY KEY NOT NULL,
	`album_id` text,
	`artist_id` text,
	`title` text,
	`album` text,
	`artist` text,
	`display_artist` text,
	`display_album_artist` text,
	`display_composer` text,
	`track` integer,
	`disc_number` integer,
	`year` integer,
	`genre` text,
	`cover_art` text,
	`duration` integer,
	`size` integer,
	`content_type` text,
	`suffix` text,
	`transcoded_content_type` text,
	`transcoded_suffix` text,
	`bit_rate` integer,
	`bit_depth` integer,
	`sampling_rate` integer,
	`channel_count` integer,
	`path` text,
	`user_rating` integer,
	`average_rating` real,
	`play_count` integer,
	`created` integer,
	`starred` integer,
	`played` text,
	`type` text,
	`bpm` integer,
	`comment` text,
	`sort_name` text,
	`sort_title` text,
	`sort_artist` text,
	`music_brainz_id` text,
	`explicit_status` text,
	`bookmark_position` integer,
	`is_video` integer,
	`is_dir` integer,
	`parent` text,
	`original_width` integer,
	`original_height` integer,
	`rg_track_gain` real,
	`rg_album_gain` real,
	`rg_track_peak` real,
	`rg_album_peak` real,
	`rg_base_gain` real,
	`rg_fallback_gain` real,
	`norm_title` text,
	`norm_artist` text,
	`dmeta_title` text,
	`dmeta_artist` text,
	`synced_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_songs_sort` ON `songs` (`sort_title`,`id`);--> statement-breakpoint
CREATE INDEX `idx_songs_artist_sort` ON `songs` (`sort_artist`,`sort_title`,`id`);--> statement-breakpoint
CREATE INDEX `idx_songs_album` ON `songs` (`album_id`);--> statement-breakpoint
CREATE INDEX `idx_songs_artist` ON `songs` (`artist_id`);--> statement-breakpoint
CREATE INDEX `idx_songs_starred_key` ON `songs` (`starred`,`id`) WHERE "songs"."starred" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_songs_norm_title` ON `songs` (`norm_title`);--> statement-breakpoint
CREATE INDEX `idx_songs_dmeta_title` ON `songs` (`dmeta_title`);--> statement-breakpoint
CREATE INDEX `idx_songs_dmeta_artist` ON `songs` (`dmeta_artist`);--> statement-breakpoint
CREATE TABLE `storage` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
