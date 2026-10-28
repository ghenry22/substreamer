/**
 * Guard that stops Subsonic error documents from being counted as downloaded
 * audio.
 *
 * Subsonic (and OpenSubsonic) define the `stream` endpoint's failure mode as
 * "HTTP 200 + a `subsonic-response status=\"failed\"` XML/JSON document" — there
 * is no HTTP status code in the spec. The native downloader
 * (`ExpoAsyncFsModule.downloadFileAsyncWithProgress`) only checks `isSuccessful()`,
 * so a 220-byte error envelope gets written as the track file and counted as a
 * success (see plans/fix-download-false-success.md).
 *
 * This module detects that case by reading the first few bytes of a file and
 * checking whether they are a text error document. It is the only place that
 * sniffs bytes; the rest of the app keys off filename suffixes.
 */

import { File, FileMode } from 'expo-file-system';

/** How many leading bytes we read to classify a file. */
export const HEAD_BYTES = 64;

/**
 * Read the first bytes of a file. Three-state by design:
 *   - `null`       → could not read (missing, locked, or `File.open` unavailable)
 *   - `Uint8Array` → the head that was actually read (possibly shorter than HEAD_BYTES)
 *
 * A `null` is "no evidence". Download paths treat it as "accept" (fail open) so a
 * device without a working `File.open` never rejects every download; cache-state
 * checks treat it as "not usable" (fail safe) so a missing/unreadable file is
 * re-downloaded rather than trusted. Collapsing the two would be wrong either way.
 */
export async function readFileHead(uri: string): Promise<Uint8Array | null> {
  try {
    const file = new File(uri);
    const handle = file.open(FileMode.ReadOnly);
    try {
      const buf = await handle.readBytes(HEAD_BYTES);
      return buf ?? null;
    } finally {
      try {
        handle.close();
      } catch {
        /* best-effort */
      }
    }
  } catch {
    return null;
  }
}

const FIRST_WHITESPACE = new Set<number>([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, // tab/lf/vt/ff/cr/space
]);

/**
 * True when `head` is a text error document — a Subsonic JSON/XML error envelope
 * (`{` or `<` first), or an HTML/plain-text error page a proxy might return with
 * a 200.
 *
 * Callers MUST pass a non-null head (one that {@link readFileHead} successfully
 * read). The function assumes it is looking at real bytes.
 *
 * Rule: skip a UTF-8 BOM (EF BB BF) and ASCII whitespace, then if no bytes remain
 * (empty/BOM-only/whitespace-only) OR the first remaining byte is `{` (0x7B) or
 * `<` (0x3C) → text. 0x00 is deliberately NOT skipped: it is the leading byte of
 * an MP4 box length, so real m4a/mp4 would be misread as empty.
 *
 * No audio container this app can produce starts with `{` or `<`:
 *   mp3 = ID3 / 0xFF, flac = fLaC, ogg/opus = OggS, m4a/aac/alac = …ftyp,
 *   wav = RIFF, aiff = FORM, wma = ASF GUID, mka/webm = 1A45DFA3,
 *   ape = MAC , wv = wvpk, dsd = DSD /FRM8.
 *
 * Intentionally does NOT require `audio/*`: servers streaming as
 * `application/octet-stream` (or without a Content-Type) must still count as
 * success.
 */
export function headIsTextDocument(head: Uint8Array): boolean {
  let i = 0;
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    i = 3; // UTF-8 BOM
  }
  for (; i < head.length; i++) {
    if (FIRST_WHITESPACE.has(head[i])) continue;
    break;
  }
  if (i >= head.length) return true; // nothing but BOM/whitespace → unusable
  return head[i] === 0x7b || head[i] === 0x3c;
}

/**
 * Download paths: fail OPEN. Reject only on positive evidence of a text document.
 * A `null` (couldn't read the head) is treated as "accept" — see module note.
 */
export async function isErrorDocument(uri: string): Promise<boolean> {
  const head = await readFileHead(uri);
  return head !== null && headIsTextDocument(head);
}

/**
 * Cache-state checks: fail SAFE. Unreadable or missing → not usable, so the track
 * is re-downloaded instead of trusted from the in-memory pool.
 */
export async function isUsableAudioFile(uri: string): Promise<boolean> {
  const head = await readFileHead(uri);
  return head !== null && !headIsTextDocument(head);
}
