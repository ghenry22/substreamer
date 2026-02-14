"use strict";

import { Constants } from '../NativeTrackPlayer';
export let Capability = function (Capability) {
  Capability[Capability["Play"] = Constants?.CAPABILITY_PLAY ?? 1] = "Play";
  Capability[Capability["PlayFromId"] = Constants?.CAPABILITY_PLAY_FROM_ID ?? 2] = "PlayFromId";
  Capability[Capability["PlayFromSearch"] = Constants?.CAPABILITY_PLAY_FROM_SEARCH ?? 3] = "PlayFromSearch";
  Capability[Capability["Pause"] = Constants?.CAPABILITY_PAUSE ?? 4] = "Pause";
  Capability[Capability["Stop"] = Constants?.CAPABILITY_STOP ?? 5] = "Stop";
  Capability[Capability["SeekTo"] = Constants?.CAPABILITY_SEEK_TO ?? 6] = "SeekTo";
  Capability[Capability["Skip"] = Constants?.CAPABILITY_SKIP ?? 7] = "Skip";
  Capability[Capability["SkipToNext"] = Constants?.CAPABILITY_SKIP_TO_NEXT ?? 8] = "SkipToNext";
  Capability[Capability["SkipToPrevious"] = Constants?.CAPABILITY_SKIP_TO_PREVIOUS ?? 9] = "SkipToPrevious";
  Capability[Capability["JumpForward"] = Constants?.CAPABILITY_JUMP_FORWARD ?? 10] = "JumpForward";
  Capability[Capability["JumpBackward"] = Constants?.CAPABILITY_JUMP_BACKWARD ?? 11] = "JumpBackward";
  Capability[Capability["SetRating"] = Constants?.CAPABILITY_SET_RATING ?? 12] = "SetRating";
  return Capability;
}({});
//# sourceMappingURL=Capability.js.map