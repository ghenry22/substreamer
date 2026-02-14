"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Capability = void 0;
var _NativeTrackPlayer = require("../NativeTrackPlayer");
let Capability = exports.Capability = function (Capability) {
  Capability[Capability["Play"] = _NativeTrackPlayer.Constants?.CAPABILITY_PLAY ?? 1] = "Play";
  Capability[Capability["PlayFromId"] = _NativeTrackPlayer.Constants?.CAPABILITY_PLAY_FROM_ID ?? 2] = "PlayFromId";
  Capability[Capability["PlayFromSearch"] = _NativeTrackPlayer.Constants?.CAPABILITY_PLAY_FROM_SEARCH ?? 3] = "PlayFromSearch";
  Capability[Capability["Pause"] = _NativeTrackPlayer.Constants?.CAPABILITY_PAUSE ?? 4] = "Pause";
  Capability[Capability["Stop"] = _NativeTrackPlayer.Constants?.CAPABILITY_STOP ?? 5] = "Stop";
  Capability[Capability["SeekTo"] = _NativeTrackPlayer.Constants?.CAPABILITY_SEEK_TO ?? 6] = "SeekTo";
  Capability[Capability["Skip"] = _NativeTrackPlayer.Constants?.CAPABILITY_SKIP ?? 7] = "Skip";
  Capability[Capability["SkipToNext"] = _NativeTrackPlayer.Constants?.CAPABILITY_SKIP_TO_NEXT ?? 8] = "SkipToNext";
  Capability[Capability["SkipToPrevious"] = _NativeTrackPlayer.Constants?.CAPABILITY_SKIP_TO_PREVIOUS ?? 9] = "SkipToPrevious";
  Capability[Capability["JumpForward"] = _NativeTrackPlayer.Constants?.CAPABILITY_JUMP_FORWARD ?? 10] = "JumpForward";
  Capability[Capability["JumpBackward"] = _NativeTrackPlayer.Constants?.CAPABILITY_JUMP_BACKWARD ?? 11] = "JumpBackward";
  Capability[Capability["SetRating"] = _NativeTrackPlayer.Constants?.CAPABILITY_SET_RATING ?? 12] = "SetRating";
  return Capability;
}({});
//# sourceMappingURL=Capability.js.map