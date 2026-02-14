import { Event } from '../constants';
import type { EventPayloadByEventWithType } from '../interfaces';
/**
 * Attaches a handler to the given TrackPlayer events and performs cleanup on unmount
 * @param events - TrackPlayer events to subscribe to
 * @param handler - callback invoked when the event fires
 */
export declare const useTrackPlayerEvents: <T extends Event[], H extends (data: EventPayloadByEventWithType[T[number]]) => void>(events: T, handler: H) => void;
//# sourceMappingURL=useTrackPlayerEvents.d.ts.map