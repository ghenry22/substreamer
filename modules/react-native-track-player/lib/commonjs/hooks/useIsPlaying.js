"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isPlaying = isPlaying;
exports.useIsPlaying = useIsPlaying;
var TrackPlayer = _interopRequireWildcard(require("../trackPlayer"));
var _constants = require("../constants");
var _usePlayWhenReady = require("./usePlayWhenReady");
var _usePlaybackState = require("./usePlaybackState");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
/**
 * Tells whether the TrackPlayer is in a mode that most people would describe
 * as "playing." Great for UI to decide whether to show a Play or Pause button.
 * @returns playing - whether UI should likely show as Playing, or undefined
 *   if this isn't yet known.
 * @returns bufferingDuringPlay - whether UI should show as Buffering, or
 *   undefined if this isn't yet known.
 */
function useIsPlaying() {
  const state = (0, _usePlaybackState.usePlaybackState)().state;
  const playWhenReady = (0, _usePlayWhenReady.usePlayWhenReady)();
  return determineIsPlaying(playWhenReady, state);
}
function determineIsPlaying(playWhenReady, state) {
  if (playWhenReady === undefined || state === undefined) {
    return {
      playing: undefined,
      bufferingDuringPlay: undefined
    };
  }
  const isLoading = state === _constants.State.Loading || state === _constants.State.Buffering;
  const isErrored = state === _constants.State.Error;
  const isEnded = state === _constants.State.Ended;
  const isNone = state === _constants.State.None;
  return {
    playing: playWhenReady && !(isErrored || isEnded || isNone),
    bufferingDuringPlay: playWhenReady && isLoading
  };
}

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
async function isPlaying() {
  const [playbackState, playWhenReady] = await Promise.all([TrackPlayer.getPlaybackState(), TrackPlayer.getPlayWhenReady()]);
  return determineIsPlaying(playWhenReady, playbackState.state);
}
//# sourceMappingURL=useIsPlaying.js.map