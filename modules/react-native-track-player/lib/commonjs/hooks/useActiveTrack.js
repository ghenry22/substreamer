"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useActiveTrack = void 0;
var _react = require("react");
var _trackPlayer = require("../trackPlayer");
var _constants = require("../constants");
var _useTrackPlayerEvents = require("./useTrackPlayerEvents");
const useActiveTrack = () => {
  const [track, setTrack] = (0, _react.useState)();

  // Sets the initial index (if still undefined)
  (0, _react.useEffect)(() => {
    let unmounted = false;
    (0, _trackPlayer.getActiveTrack)().then(initialTrack => {
      if (unmounted) return;
      setTrack(currentTrack => currentTrack ?? initialTrack ?? undefined);
    }).catch(() => {
      // throws when you haven't yet setup, which is fine because it also
      // means there's no active track
    });
    return () => {
      unmounted = true;
    };
  }, []);
  (0, _useTrackPlayerEvents.useTrackPlayerEvents)([_constants.Event.PlaybackActiveTrackChanged], async ({
    track: newTrack
  }) => {
    setTrack(newTrack ?? undefined);
  });
  return track;
};
exports.useActiveTrack = useActiveTrack;
//# sourceMappingURL=useActiveTrack.js.map