import { create } from 'zustand';
import { closeShift as closeShiftApi, getActiveShift, getExpectedCash, openShift as openShiftApi, recordCashMovement } from '@/lib/shift-client';
import { getPendingOutboxCount } from '@/lib/sync/outbox-sync';
import type { CashMovementReasonCode, CloseShiftRequest, CloseShiftResponse, ExpectedCashResponse, ShiftSummary } from '@/types/shift';

/**
 * REQUIREMENTS.md §5 (Cash Drawer & Shift Reconciliation). Kept separate
 * from pos-store.ts (the cart machine) deliberately: a shift spans many
 * sales across a whole day, whereas the cart resets after each one —
 * different lifetimes, different store.
 */
interface ShiftStoreState {
  shift: ShiftSummary | null;
  busy: boolean;
  error: string | null;

  open: (counterId: string, openingFloatPaise: number) => Promise<boolean>;
  /** Loads the server's OPEN shift for this cashier (page reload / first mount). Resolves false when the lookup itself failed. */
  hydrate: () => Promise<boolean>;
  refreshExpected: () => Promise<ExpectedCashResponse | null>;
  /** Rule SH-4 gate. CloseShiftModal calls this before offering to close. */
  checkOutboxGate: () => Promise<number>;
  close: (request: CloseShiftRequest) => Promise<CloseShiftResponse | null>;
  /** REQUIREMENTS.md §5.2's cash_in/cash_out terms — mid-shift float top-ups and payouts. */
  cashMovement: (direction: 'IN' | 'OUT', amountPaise: number, reasonCode: CashMovementReasonCode, note?: string) => Promise<boolean>;
  clearError: () => void;
  reset: () => void;
}

export const useShiftStore = create<ShiftStoreState>((set, get) => ({
  shift: null,
  busy: false,
  error: null,

  open: async (counterId, openingFloatPaise) => {
    set({ busy: true, error: null });
    const res = await openShiftApi(counterId, openingFloatPaise);
    set({ busy: false });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    set({ shift: res.data });
    return true;
  },

  hydrate: async () => {
    const res = await getActiveShift();
    if (!res.ok) return false;
    set({ shift: res.data });
    return true;
  },

  refreshExpected: async () => {
    const shift = get().shift;
    if (!shift) return null;
    const res = await getExpectedCash(shift.id);
    if (!res.ok) {
      set({ error: res.error });
      return null;
    }
    return res.data;
  },

  checkOutboxGate: () => getPendingOutboxCount(),

  close: async (request) => {
    const shift = get().shift;
    if (!shift) return null;
    set({ busy: true, error: null });
    const res = await closeShiftApi(shift.id, request);
    set({ busy: false });
    if (!res.ok) {
      set({ error: res.error });
      return null;
    }
    set({ shift: null }); // shift closed — back to the Open Shift gate
    return res.data;
  },

  cashMovement: async (direction, amountPaise, reasonCode, note) => {
    const shift = get().shift;
    if (!shift) return false;
    set({ busy: true, error: null });
    const res = await recordCashMovement({ shift_id: shift.id, direction, amount_paise: amountPaise, reason_code: reasonCode, note });
    set({ busy: false });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    return true;
  },

  clearError: () => set({ error: null }),
  reset: () => set({ shift: null, busy: false, error: null }),
}));
