/**
 * Tells whether the TrackPlayer is in a mode that most people would describe
 * as "playing." Great for UI to decide whether to show a Play or Pause button.
 * @returns playing - whether UI should likely show as Playing, or undefined
 *   if this isn't yet known.
 * @returns bufferingDuringPlay - whether UI should show as Buffering, or
 *   undefined if this isn't yet known.
 */
export declare function useIsPlaying(): {
    playing: undefined;
    bufferingDuringPlay: undefined;
} | {
    playing: boolean;
    bufferingDuringPlay: boolean;
};
/**
 * This exists if you need realtime status on whether the TrackPlayer is
 * playing, whereas the hooks all have a delay because they depend on responding
 * to events before their state is updated.
 *
 * It also exists whenever you need to know the play state outside of a React
 * component, since hooks only work in components.
 *
 * @returns playing - whether UI should likely show as Playing, or undefined
 *   if this isn't yet known.
 * @returns bufferingDuringPlay - whether UI should show as Buffering, or
 *   undefined if this isn't yet known.
 */
export declare function isPlaying(): Promise<{
    playing: undefined;
    bufferingDuringPlay: undefined;
} | {
    playing: boolean;
    bufferingDuringPlay: boolean;
}>;
//# sourceMappingURL=useIsPlaying.d.ts.map