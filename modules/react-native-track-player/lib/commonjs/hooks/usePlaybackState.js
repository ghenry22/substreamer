"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.usePlaybackState = void 0;
var _react = require("react");
var _trackPlayer = require("../trackPlayer");
var _constants = require("../constants");
/**
 * Get current playback state and subsequent updates.
 *
 * Note: While it is fetching the initial state from the native module, the
 * returned state property will be `undefined`.
 * */
const usePlaybackState = () => {
  const [playbackState, setPlaybackState] = (0, _react.useState)({
    state: undefined
  });
  (0, _react.useEffect)(() => {
    let mounted = true;
    (0, _trackPlayer.getPlaybackState)().then(fetchedState => {
      if (!mounted) return;
      // Only set the state if it wasn't already set by the Event.PlaybackState listener below:
      setPlaybackState(currentState => currentState.state ? currentState : fetchedState);
    }).catch(() => {
      /** getState only throw while you haven't yet setup, ignore failure. */
    });
    const sub = (0, _trackPlayer.addEventListener)(_constants.Event.PlaybackState, state => {
      setPlaybackState(state);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return playbackState;
};
exports.usePlaybackState = usePlaybackState;
//# sourceMappingURL=usePlaybackState.js.map