import type { Capability, RatingType } from '../constants';
import type { AndroidOptions } from './AndroidOptions';
import type { FeedbackOptions } from './FeedbackOptions';
export interface UpdateOptions {
    android?: AndroidOptions;
    ratingType?: RatingType;
    forwardJumpInterval?: number;
    backwardJumpInterval?: number;
    progressUpdateEventInterval?: number;
    likeOptions?: FeedbackOptions;
    dislikeOptions?: FeedbackOptions;
    bookmarkOptions?: FeedbackOptions;
    capabilities?: Capability[];
    notificationCapabilities?: Capability[];
    color?: number;
}
//# sourceMappingURL=UpdateOptions.d.ts.map