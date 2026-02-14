"use strict";

import { Constants } from '../NativeTrackPlayer';
export let RepeatMode = function (RepeatMode) {
  /** Playback stops when the last track in the queue has finished playing. */
  RepeatMode[RepeatMode["Off"] = Constants?.REPEAT_OFF ?? 1] = "Off";
  /** Repeats the current track infinitely during ongoing playback. */
  RepeatMode[RepeatMode["Track"] = Constants?.REPEAT_TRACK ?? 2] = "Track";
  /** Repeats the entire queue infinitely. */
  RepeatMode[RepeatMode["Queue"] = Constants?.REPEAT_QUEUE ?? 3] = "Queue";
  return RepeatMode;
}({});
//# sourceMappingURL=RepeatMode.js.map