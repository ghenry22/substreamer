/**
 * ICY (Shoutcast/Icecast) now-playing side-channel for live radio.
 *
 * RNQP exposes no stream-metadata events, so while a radio station plays we
 * periodically open a second connection to the stream with `Icy-MetaData: 1`,
 * read just enough bytes to hit the first in-band metadata block, extract
 * `StreamTitle='…'`, and abort. Each poll costs roughly one metaint window of
 * audio (typically 8–16 KB), repeated every 20 s in the foreground only.
 *
 * Stations that don't answer with `icy-metaint` are marked unsupported and
 * never re-polled until the station changes. Results land in
 * radioNowPlayingStore, which the player UI reads.
 */

import { fetch as expoFetch } from 'expo/fetch';

import { appStateStore } from '../store/appStateStore';
import { radioNowPlayingStore } from '../store/radioNowPlayingStore';

export const ICY_POLL_INTERVAL_MS = 20_000;
/** Abort a single poll after this long regardless of progress. */
export const ICY_POLL_TIMEOUT_MS = 8_000;
/** Hard cap on bytes read per poll (guards absurd icy-metaint values). */
export const ICY_MAX_BYTES_PER_POLL = 512 * 1024;
/** Give up on a station after this many consecutive failed polls. */
export const ICY_MAX_CONSECUTIVE_ERRORS = 5;

/** Decode raw ICY metadata bytes. Servers send UTF-8 or Latin-1; try UTF-8
 *  first and fall back to Latin-1 on malformed sequences. */
export function decodeIcyBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let out = '';
    for (const b of bytes) out += String.fromCharCode(b);
    return out;
  }
}

/** Pull the StreamTitle value out of a decoded metadata block, e.g.
 *  "StreamTitle='Artist - Song';StreamUrl='';". Null when absent or empty. */
export function extractStreamTitle(metadata: string): string | null {
  const match = /StreamTitle='(.*?)';/.exec(metadata);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

/**
 * Incremental ICY frame parser. Feed it raw stream chunks; it skips `metaint`
 * audio bytes, reads the length byte, collects the metadata block, and
 * returns the contained StreamTitle. Returns null while more bytes are needed;
 * empty metadata blocks (length 0) roll over to the next window.
 */
export class IcyTitleParser {
  private audioBytesLeft: number;
  private metaBytesLeft = 0;
  private metaChunks: number[] = [];
  private readingLength = false;

  constructor(private readonly metaint: number) {
    this.audioBytesLeft = metaint;
  }

  push(chunk: Uint8Array): string | null {
    for (let i = 0; i < chunk.length; i++) {
      if (this.audioBytesLeft > 0) {
        // Fast-skip the audio payload within this chunk.
        const skip = Math.min(this.audioBytesLeft, chunk.length - i);
        this.audioBytesLeft -= skip;
        i += skip - 1;
        if (this.audioBytesLeft === 0) this.readingLength = true;
        continue;
      }
      if (this.readingLength) {
        this.readingLength = false;
        this.metaBytesLeft = chunk[i] * 16;
        if (this.metaBytesLeft === 0) {
          // Empty block — some servers only fill it on song change; try the
          // next window (the caller's byte budget bounds how far we go).
          this.audioBytesLeft = this.metaint;
        }
        continue;
      }
      this.metaChunks.push(chunk[i]);
      this.metaBytesLeft--;
      if (this.metaBytesLeft === 0) {
        const bytes = new Uint8Array(this.metaChunks);
        // Strip NUL padding before decoding.
        let end = bytes.length;
        while (end > 0 && bytes[end - 1] === 0) end--;
        const title = extractStreamTitle(decodeIcyBytes(bytes.subarray(0, end)));
        if (title) return title;
        this.metaChunks = [];
        this.audioBytesLeft = this.metaint;
      }
    }
    return null;
  }
}

/** One poll: connect, parse until a title or a budget runs out. */
export async function fetchStreamTitle(
  streamUrl: string,
  fetchImpl: typeof expoFetch = expoFetch,
): Promise<{ title: string | null; unsupported: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ICY_POLL_TIMEOUT_MS);
  try {
    const response = await fetchImpl(streamUrl, {
      headers: { 'Icy-MetaData': '1' },
      signal: controller.signal,
    });
    const metaint = Number(response.headers.get('icy-metaint'));
    if (!Number.isFinite(metaint) || metaint <= 0 || metaint > ICY_MAX_BYTES_PER_POLL || !response.body) {
      controller.abort();
      return { title: null, unsupported: true };
    }
    const reader = response.body.getReader();
    const parser = new IcyTitleParser(metaint);
    let bytesRead = 0;
    try {
      while (bytesRead < ICY_MAX_BYTES_PER_POLL) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytesRead += value.byteLength;
        const title = parser.push(value);
        if (title) return { title, unsupported: false };
      }
      return { title: null, unsupported: false };
    } finally {
      controller.abort();
    }
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ */
/*  Polling loop driven by playerService track changes                 */
/* ------------------------------------------------------------------ */

let activeTrackId: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
let consecutiveErrors = 0;

async function pollTick(trackId: string, streamUrl: string): Promise<void> {
  // Foreground only — the title isn't visible in the background and RNQP's
  // notification can't be updated anyway.
  if (!appStateStore.getState().isActive) return;
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const { title, unsupported } = await fetchStreamTitle(streamUrl);
    if (activeTrackId !== trackId) return;
    if (unsupported) {
      stopIcyPolling();
      return;
    }
    consecutiveErrors = 0;
    if (title) {
      radioNowPlayingStore.getState().setNowPlaying(trackId, title);
    }
  } catch {
    consecutiveErrors++;
    if (consecutiveErrors >= ICY_MAX_CONSECUTIVE_ERRORS) stopIcyPolling();
  } finally {
    pollInFlight = false;
  }
}

/** Begin polling `streamUrl` for the given radio track. Idempotent per track. */
export function startIcyPolling(trackId: string, streamUrl: string): void {
  if (activeTrackId === trackId && pollTimer) return;
  stopIcyPolling();
  activeTrackId = trackId;
  consecutiveErrors = 0;
  void pollTick(trackId, streamUrl);
  pollTimer = setInterval(() => void pollTick(trackId, streamUrl), ICY_POLL_INTERVAL_MS);
}

/** Stop polling and forget the active station. Safe to call repeatedly. */
export function stopIcyPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  activeTrackId = null;
}
