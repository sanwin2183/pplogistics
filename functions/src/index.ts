import { initializeApp } from 'firebase-admin/app';

// Single init for the whole codebase — functions import from ./getTrackingOrder etc.
initializeApp();

export { getTrackingOrder } from './getTrackingOrder';
export { submitPaymentProof } from './submitPaymentProof';
export { markTripPaid } from './markTripPaid';
