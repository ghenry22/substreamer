"use strict";

import { Constants } from '../NativeTrackPlayer';
export let PitchAlgorithm = function (PitchAlgorithm) {
  /**
   * A high-quality time pitch algorithm that doesn’t perform pitch correction.
   * */
  PitchAlgorithm[PitchAlgorithm["Linear"] = Constants?.PITCH_ALGORITHM_LINEAR ?? 1] = "Linear";
  /**
   * A highest-quality time pitch algorithm that’s suitable for music.
   **/
  PitchAlgorithm[PitchAlgorithm["Music"] = Constants?.PITCH_ALGORITHM_MUSIC ?? 2] = "Music";
  /**
   * A modest quality time pitch algorithm that’s suitable for voice.
   **/
  PitchAlgorithm[PitchAlgorithm["Voice"] = Constants?.PITCH_ALGORITHM_VOICE ?? 3] = "Voice";
  return PitchAlgorithm;
}({});
//# sourceMappingURL=PitchAlgorithm.js.map