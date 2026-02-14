"use strict";

export let State = /*#__PURE__*/function (State) {
  /** Indicates that no media is currently loaded */
  State["None"] = "none";
  /** Indicates that the player is paused, but ready to start playing */
  State["Ready"] = "ready";
  /** Indicates that the player is currently playing */
  State["Playing"] = "playing";
  /** Indicates that the player is currently paused */
  State["Paused"] = "paused";
  /** Indicates that the player is currently stopped */
  State["Stopped"] = "stopped";
  /** Indicates that the initial load of the item is occurring. */
  State["Loading"] = "loading";
  /**
   * Indicates that the player is currently loading more data before it can
   * continue playing or is ready to start playing.
   */
  State["Buffering"] = "buffering";
  /**
   * Indicates that playback of the current item failed. Call `TrackPlayer.getError()`
   * to get more information on the type of error that occurred.
   * Call `TrackPlayer.retry()` or `TrackPlayer.play()` to try to play the item
   * again.
   */
  State["Error"] = "error";
  /**
   * Indicates that playback stopped due to the end of the queue being reached.
   */
  State["Ended"] = "ended";
  return State;
}({});
//# sourceMappingURL=State.js.map