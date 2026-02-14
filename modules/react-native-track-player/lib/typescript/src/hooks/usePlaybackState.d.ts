import type { PlaybackState } from '../interfaces';
/**
 * Get current playback state and subsequent updates.
 *
 * Note: While it is fetching the initial state from the native module, the
 * returned state property will be `undefined`.
 * */
export declare const usePlaybackState: () => PlaybackState | {
    state: undefined;
};
//# sourceMappingURL=usePlaybackState.d.ts.map