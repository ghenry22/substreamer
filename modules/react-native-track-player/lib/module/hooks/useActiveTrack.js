"use strict";

import { useState, useEffect } from 'react';
import { getActiveTrack } from "../trackPlayer.js";
import { Event } from "../constants/index.js";
import { useTrackPlayerEvents } from "./useTrackPlayerEvents.js";
export const useActiveTrack = () => {
  const [track, setTrack] = useState();

  // Sets the initial index (if still undefined)
  useEffect(() => {
    let unmounted = false;
    getActiveTrack().then(initialTrack => {
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
  useTrackPlayerEvents([Event.PlaybackActiveTrackChanged], async ({
    track: newTrack
  }) => {
    setTrack(newTrack ?? undefined);
  });
  return track;
};
//# sourceMappingURL=useActiveTrack.js.map