import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  type Query,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore';
import { auth, db } from './firebase';

/**
 * Build a typed Firestore collection ref.
 * (Firestore JS SDK is permissive about types; we keep the cast surface narrow.)
 */
export function col<T>(path: string): Query<T, DocumentData> {
  return collection(db, path) as unknown as Query<T, DocumentData>;
}

/** Make a typed doc ref. */
export function docRef<T>(path: string, id: string) {
  return doc(db, path, id) as unknown as ReturnType<typeof doc<T, DocumentData>>;
}

// [firestore-debug] Shared error logger. Logs the failing operation kind
// (doc / col), the collection path, the Firestore error code (e.g.
// 'permission-denied', 'not-found', 'failed-precondition'), the message,
// and the current signed-in uid so we can correlate rule denials with
// the auth state at the moment of the read. Re-throws so React Query
// still sees the failure and surfaces it to the UI. Remove once the
// lockout is resolved.
function logFirestoreError(
  kind: 'doc' | 'col',
  path: string,
  err: unknown,
): never {
  const code = (err as { code?: string })?.code ?? '(no code)';
  const message = err instanceof Error ? err.message : String(err);
  const currentUid = auth.currentUser?.uid ?? '(not signed in)';
  // eslint-disable-next-line no-console
  console.error(
    `[firestore-debug] ${kind} read failed`,
    {
      path,
      code,
      message,
      currentUid,
      // Most useful: 'permission-denied' = your rule denies this uid;
      // 'not-found' = the database itself doesn't exist (would also catch
      // the (default) vs default quirk if the init were wrong);
      // 'unauthenticated' = no token at all.
    },
    err,
  );
  throw err;
}

/** Fetch a single doc; returns null if missing. */
export async function fetchDoc<T>(path: string, id: string): Promise<(T & { id: string }) | null> {
  try {
    const snap = await getDoc(doc(db, path, id));
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as T) } as T & { id: string }) : null;
  } catch (err) {
    logFirestoreError('doc', `${path}/${id}`, err);
  }
}

/** Fetch a collection with optional constraints — returns docs with id merged in. */
export async function fetchCol<T>(path: string, ...constraints: QueryConstraint[]): Promise<Array<T & { id: string }>> {
  try {
    const q = constraints.length ? query(collection(db, path), ...constraints) : collection(db, path);
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }) as T & { id: string });
  } catch (err) {
    logFirestoreError('col', path, err);
  }
}

export { where, orderBy, limit };
