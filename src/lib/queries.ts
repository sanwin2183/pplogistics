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
import { db } from './firebase';

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

/** Fetch a single doc; returns null if missing. */
export async function fetchDoc<T>(path: string, id: string): Promise<(T & { id: string }) | null> {
  const snap = await getDoc(doc(db, path, id));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as T) } as T & { id: string }) : null;
}

/** Fetch a collection with optional constraints — returns docs with id merged in. */
export async function fetchCol<T>(path: string, ...constraints: QueryConstraint[]): Promise<Array<T & { id: string }>> {
  const q = constraints.length ? query(collection(db, path), ...constraints) : collection(db, path);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }) as T & { id: string });
}

export { where, orderBy, limit };
