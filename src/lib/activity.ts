import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { ActivityEntry } from '../types';

type LogPayload = Omit<ActivityEntry, 'id' | 'timestamp'>;

/** Append an entry to the activity feed. Fire-and-forget — errors are swallowed. */
export function logActivity(payload: LogPayload): Promise<void> {
  return addDoc(collection(db, 'activity'), { ...payload, timestamp: serverTimestamp() })
    .then(() => undefined)
    .catch((err) => {
      // Don't break the user's flow if logging fails; just surface to console.
      console.warn('[activity] log failed', err);
    });
}
