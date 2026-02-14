"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useTrackPlayerEvents = void 0;
var _react = require("react");
var _trackPlayer = require("../trackPlayer");
var _constants = require("../constants");
/**
 * Attaches a handler to the given TrackPlayer events and performs cleanup on unmount
 * @param events - TrackPlayer events to subscribe to
 * @param handler - callback invoked when the event fires
 */
const useTrackPlayerEvents = (events, handler) => {
  const savedHandler = (0, _react.useRef)(handler);
  savedHandler.current = handler;

  /* eslint-disable react-hooks/exhaustive-deps */
  (0, _react.useEffect)(() => {
    if (__DEV__) {
      const allowedTypes = Object.values(_constants.Event);
      const invalidTypes = events.filter(type => !allowedTypes.includes(type));
      if (invalidTypes.length) {
        console.warn('One or more of the events provided to useTrackPlayerEvents is ' + `not a valid TrackPlayer event: ${invalidTypes.join("', '")}. ` + 'A list of available events can be found at ' + 'https://rntp.dev/docs/api/events');
      }
    }
    const subs = events.map(type => (0, _trackPlayer.addEventListener)(type, payload => {
      // @ts-expect-error - we know the type is correct
      savedHandler.current({
        ...payload,
        type
      });
    }));
    return () => subs.forEach(sub => sub.remove());
  }, events);
};
exports.useTrackPlayerEvents = useTrackPlayerEvents;
//# sourceMappingURL=useTrackPlayerEvents.js.map