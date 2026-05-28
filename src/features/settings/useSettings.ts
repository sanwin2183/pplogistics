import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '../../lib/firebase';
import type { AppSettings, PaymentMethod, BusinessInfo, MessageTemplates } from '../../types';

const KEY = ['settings'] as const;

const DEFAULT_SETTINGS: AppSettings = {
  payment: { methods: [] },
  business: {
    name: 'PP Logistics',
    tagline: 'Hand-carry between Bangkok ↔ Myanmar',
  },
  templates: {
    en: `Hi {customerName}, your order #{orderNumber} is ready. Total {totalAmount} for {totalWeight}. Track and pay here: {trackingUrl}`,
    th: `สวัสดีค่ะ {customerName} ออเดอร์ #{orderNumber} พร้อมแล้วค่ะ ยอดรวม {totalAmount} น้ำหนัก {totalWeight} ตรวจสอบและชำระได้ที่: {trackingUrl}`,
    my: `မင်္ဂလာပါ {customerName}၊ သင့်အော်ဒါ #{orderNumber} ပြင်ဆင်ပြီးပါပြီ။ စုစုပေါင်း {totalAmount}၊ အလေးချိန် {totalWeight}။ ဤနေရာတွင် စစ်ဆေး၍ ငွေပေးချေနိုင်ပါသည် - {trackingUrl}`,
  },
};

export function useSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<AppSettings> => {
      const snap = await getDoc(doc(db, 'settings', 'app'));
      if (!snap.exists()) return DEFAULT_SETTINGS;
      const data = snap.data() as Partial<AppSettings>;
      // Backfill defaults so the UI never crashes on a partial document.
      return {
        payment: data.payment ?? DEFAULT_SETTINGS.payment,
        business: { ...DEFAULT_SETTINGS.business, ...(data.business ?? {}) },
        templates: { ...DEFAULT_SETTINGS.templates, ...(data.templates ?? {}) },
      };
    },
  });
}

export function useUpdatePaymentMethods() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (methods: PaymentMethod[]) => {
      await setDoc(doc(db, 'settings', 'app'), { payment: { methods } }, { merge: true });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save payment methods');
    },
  });
}

export function useUpdateBusinessInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (business: BusinessInfo) => {
      await setDoc(doc(db, 'settings', 'app'), { business }, { merge: true });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save business info');
    },
  });
}

export function useUpdateTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (templates: MessageTemplates) => {
      await setDoc(doc(db, 'settings', 'app'), { templates }, { merge: true });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save templates');
    },
  });
}
