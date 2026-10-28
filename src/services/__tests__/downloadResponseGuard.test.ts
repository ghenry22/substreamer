/**
 * Tests for the download-response guard: detecting Subsonic error documents
 * (served with HTTP 200) so they aren't counted as downloaded audio.
 */

let headBytes: Uint8Array | null = new Uint8Array([0x66, 0x4c, 0x61, 0x43]); // 'fLaC'
let openThrows = false;

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(...args: any[]) {
      this.uri = typeof args[0] === 'string' ? args[0] : 'file:///x';
    }
    get exists() {
      return !openThrows;
    }
    open = () => {
      if (openThrows || headBytes === null) throw new Error('ENOENT');
      return { readBytes: () => headBytes!, close: () => {} };
    };
  }
  return {
    File: MockFile,
    Directory: class {},
    FileMode: { ReadOnly: 'readOnly', WriteOnly: 'writeOnly', ReadWrite: 'readWrite' },
    Paths: { document: { uri: 'file:///document' } },
  };
});

import {
  headIsTextDocument,
  isErrorDocument,
  isUsableAudioFile,
  readFileHead,
} from '../downloadResponseGuard';

const enc = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
  headBytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43]);
  openThrows = false;
});

describe('headIsTextDocument', () => {
  it('flags a JSON Subsonic error envelope', () => {
    expect(headIsTextDocument(enc('{"subsonic-response":{"status":"failed"'))).toBe(true);
  });

  it('flags an XML error envelope', () => {
    expect(headIsTextDocument(enc('<?xml version="1.0"?><subsonic-response status="failed">'))).toBe(true);
  });

  it('flags an HTML error page from a proxy', () => {
    expect(headIsTextDocument(enc('<!doctype html><html><body>502'))).toBe(true);
  });

  it('does not flag mp3 (ID3)', () => {
    expect(headIsTextDocument(new Uint8Array([0x49, 0x44, 0x33, 0x03]))).toBe(false);
  });

  it('does not flag flac', () => {
    expect(headIsTextDocument(new Uint8Array([0x66, 0x4c, 0x61, 0x43]))).toBe(false);
  });

  it('does not flag ogg/opus', () => {
    expect(headIsTextDocument(new Uint8Array([0x4f, 0x67, 0x67, 0x53]))).toBe(false);
  });

  it('does not flag m4a/mp4 (box length then ftyp)', () => {
    // First byte is the box length (0x00), never '{' or '<'.
    expect(headIsTextDocument(new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBe(false);
  });

  it('does not flag wav', () => {
    expect(headIsTextDocument(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false);
  });

  it('treats an empty head as unusable text', () => {
    expect(headIsTextDocument(new Uint8Array(0))).toBe(true);
  });

  it('skips leading ASCII whitespace before a JSON marker', () => {
    expect(headIsTextDocument(enc('   \n\t{"status":"failed"'))).toBe(true);
  });

  it('skips a UTF-8 BOM before an XML marker', () => {
    expect(headIsTextDocument(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x3f]))).toBe(true);
  });
});

describe('readFileHead', () => {
  it('returns the head bytes for a readable file', async () => {
    headBytes = enc('{"error":true}');
    const head = await readFileHead('file:///song.mp3');
    expect(head).not.toBeNull();
    expect(new TextDecoder().decode(head!)).toContain('error');
  });

  it('returns null when the file cannot be opened (missing)', async () => {
    openThrows = true;
    expect(await readFileHead('file:///gone.mp3')).toBeNull();
  });

  it('returns the (short) bytes when the file is shorter than HEAD_BYTES', async () => {
    headBytes = enc('{}');
    const head = await readFileHead('file:///small.mp3');
    expect(head?.length).toBe(2);
  });
});

describe('isErrorDocument (download path — fail open)', () => {
  it('true for a Subsonic JSON error document', async () => {
    headBytes = enc('{"subsonic-response":{"status":"failed"');
    expect(await isErrorDocument('file:///song.mp3')).toBe(true);
  });

  it('false for real audio', async () => {
    headBytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43]);
    expect(await isErrorDocument('file:///song.flac')).toBe(false);
  });

  it('false (accept) when the head cannot be read', async () => {
    openThrows = true;
    expect(await isErrorDocument('file:///song.mp3')).toBe(false);
  });
});

describe('isUsableAudioFile (cache-state — fail safe)', () => {
  it('true for real audio', async () => {
    headBytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43]);
    expect(await isUsableAudioFile('file:///song.flac')).toBe(true);
  });

  it('false for a Subsonic error document', async () => {
    headBytes = enc('{"subsonic-response":{"status":"failed"');
    expect(await isUsableAudioFile('file:///song.mp3')).toBe(false);
  });

  it('false (re-download) when the head cannot be read', async () => {
    openThrows = true;
    expect(await isUsableAudioFile('file:///song.mp3')).toBe(false);
  });
});
