"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.usePlayWhenReady = void 0;
var _react = require("react");
var _trackPlayer = require("../trackPlayer");
var _constants = require("../constants");
const usePlayWhenReady = () => {
  const [playWhenReady, setPlayWhenReady] = (0, _react.useState)(undefined);
  (0, _react.useEffect)(() => {
    let mounted = true;
    (0, _trackPlayer.getPlayWhenReady)().then(initialState => {
      if (!mounted) return;
      // Only set the state if it wasn't already set by the Event.PlaybackPlayWhenReadyChanged listener below:
      setPlayWhenReady(state => state ?? initialState);
    }).catch(() => {
      /** getState only throw while you haven't yet setup, ignore failure. */
    });
    const sub = (0, _trackPlayer.addEventListener)(_constants.Event.PlaybackPlayWhenReadyChanged, event => {
      setPlayWhenReady(event.playWhenReady);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return playWhenReady;
};
exports.usePlayWhenReady = usePlayWhenReady;
//# sourceMappingURL=usePlayWhenReady.js.map