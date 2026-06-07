import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

/**
 * Client wrapper for the `markTripPaid` Cloud Function.
 *
 * Why a callable + not a client-side batch:
 *   - Validation lives server-side (see functions/src/markTripPaid.ts) so a
 *     client with the right Firestore role can't bypass the eligibility
 *     check that prevents marking pending orders paid.
 *   - The function returns { affected, skipped } so the toast can say
 *     "8 paid, 2 already paid" idempotently.
 *
 * On success we invalidate both the byFlyer query (the flyer page that
 * triggered the call) AND the broad orders key so any other view (reports,
 * dashboard) sees the freshly-paid state on next focus.
 */
interface MarkTripPaidInput {
  flyerId: string;
  orderIds: string[];
  action: 'pay' | 'unpay';
}

interface MarkTripPaidResult {
  ok: true;
  affected: string[];
  skipped: string[];
}

export function useMarkTripPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MarkTripPaidInput): Promise<MarkTripPaidResult> => {
      const fn = httpsCallable<MarkTripPaidInput, MarkTripPaidResult>(
        functions,
        'markTripPaid',
      );
      const res = await fn(input);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
