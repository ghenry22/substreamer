"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RepeatMode = void 0;
var _NativeTrackPlayer = require("../NativeTrackPlayer");
let RepeatMode = exports.RepeatMode = function (RepeatMode) {
  /** Playback stops when the last track in the queue has finished playing. */
  RepeatMode[RepeatMode["Off"] = _NativeTrackPlayer.Constants?.REPEAT_OFF ?? 1] = "Off";
  /** Repeats the current track infinitely during ongoing playback. */
  RepeatMode[RepeatMode["Track"] = _NativeTrackPlayer.Constants?.REPEAT_TRACK ?? 2] = "Track";
  /** Repeats the entire queue infinitely. */
  RepeatMode[RepeatMode["Queue"] = _NativeTrackPlayer.Constants?.REPEAT_QUEUE ?? 3] = "Queue";
  return RepeatMode;
}({});
//# sourceMappingURL=RepeatMode.js.map