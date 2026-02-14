"use strict";

import { Constants } from '../NativeTrackPlayer';
export let RatingType = function (RatingType) {
  RatingType[RatingType["Heart"] = Constants?.RATING_HEART ?? 1] = "Heart";
  RatingType[RatingType["ThumbsUpDown"] = Constants?.RATING_THUMBS_UP_DOWN ?? 2] = "ThumbsUpDown";
  RatingType[RatingType["ThreeStars"] = Constants?.RATING_3_STARS ?? 3] = "ThreeStars";
  RatingType[RatingType["FourStars"] = Constants?.RATING_4_STARS ?? 4] = "FourStars";
  RatingType[RatingType["FiveStars"] = Constants?.RATING_5_STARS ?? 5] = "FiveStars";
  RatingType[RatingType["Percentage"] = Constants?.RATING_PERCENTAGE ?? 6] = "Percentage";
  return RatingType;
}({});
//# sourceMappingURL=RatingType.js.map