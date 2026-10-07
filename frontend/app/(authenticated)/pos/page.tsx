'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePosStore } from '@/stores/pos-store';
import { useShiftStore } from '@/stores/shift-store';
import { ensureSessionScope } from '@/lib/session-scope';
import { useCartTotals } from '@/hooks/use-cart-totals';
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useOutboxStatus } from '@/hooks/use-outbox-status';
import { useSession } from '@/hooks/use-session';
import { useLocalStockOverrides, applyLocalStockOverrides } from '@/hooks/use-local-catalog';
import { startOutboxWorker } from '@/lib/sync/outbox-sync';
import { listCounters } from '@/lib/counter-client';
import { listPurchasableProducts } from '@/lib/b2b-client';
import { listCustomers } from '@/lib/customer-client';
import { STORE_CONFIG } from '@/lib/mock-data';
import type { CounterLite, CustomerLite, Product } from '@/types/pos';

import { TopBar } from '@/components/pos/top-bar';
import { WorkArea, type WorkAreaTab } from '@/components/pos/work-area';
import { QuickGrid } from '@/components/pos/quick-grid';
import { CatalogSearch } from '@/components/pos/catalog-search';
import { CartPanel } from '@/components/pos/cart-panel';
import { CheckoutModal } from '@/components/pos/checkout-modal';
import { ShortcutsHelp } from '@/components/pos/shortcuts-help';
import { ParkedCartsPanel } from '@/components/pos/parked-carts-panel';
import { ToastStack, type Toast } from '@/components/pos/toast-stack';
import { OpenShiftDrawer } from '@/components/pos/open-shift-drawer';
import { CloseShiftModal } from '@/components/pos/close-shift-modal';
import { CashMovementModal } from '@/components/pos/cash-movement-modal';
import { QuickCustomEntry } from '@/components/pos/quick-custom-entry';
import { useLanguage } from '@/context/LanguageContext';
import { dateLocale, translateError } from '@/lib/translations';

// Fallback only for the brief window before GET /api/auth/me resolves — middleware.ts already guarantees a session cookie is present to reach this route.
const FALLBACK_CASHIER_NAME = 'Cashier';

/** Milestone 4: SALOON/DHABA lean on the fixed Quick Grid (their "menu"); REPAIR/DISTRIBUTOR lean on search across many SKUs. */
function defaultTabForPreset(): WorkAreaTab {
  return STORE_CONFIG.business_preset === 'REPAIR' || STORE_CONFIG.business_preset === 'DISTRIBUTOR' ? 'catalog' : 'quick-grid';
}

/**
 * SYSTEM_ARCHITECTURE.md Rule FE-1: the POS route is a client island, not
 * server-rendered — it renders from local state instantly with no critical
 * network dependency. (Catalogue sync from IndexedDB is Milestone 3; this
 * milestone's "bootstrap" is the static seed in lib/mock-data.ts.)
 */
export default function PosPage() {
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<WorkAreaTab>(defaultTabForPreset());
  const [category, setCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [cashMovementOpen, setCashMovementOpen] = useState(false);
  const [customEntryOpen, setCustomEntryOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [primaryCounter, setPrimaryCounter] = useState<CounterLite | null>(null);
  // Starts true so the first paint shows "Loading counter…" rather than a
  // false-negative error before the fetch effect below has had a chance to run.
  const [counterLoading, setCounterLoading] = useState(true);
  const [counterError, setCounterError] = useState<string | null>(null);

  const shift = useShiftStore((s) => s.shift);
  const { profile: session } = useSession();
  const [sessionReady, setSessionReady] = useState(false);

  // Bind cart/shift state to the verified session before anything is billed:
  // state carried over from another store/user makes checkout 403 with
  // ERR_STORE_MISMATCH. A held shift is only trusted if the server reports it
  // as this session's active shift.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void ensureSessionScope({ storeId: session.store.id, userId: session.user.id }).then(async () => {
      if (cancelled) return;
      const held = useShiftStore.getState().shift;
      if (held && held.id !== session.active_shift?.id) useShiftStore.getState().reset();
      // After a reload (F5) memory is empty even though the server still has
      // this cashier's shift OPEN — resume it instead of offering Open Shift.
      if (!useShiftStore.getState().shift && session.active_shift) await useShiftStore.getState().hydrate();
      if (!cancelled) setSessionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);
  const cashierName = session?.user.full_name ?? FALLBACK_CASHIER_NAME;

  const searchInputRef = useRef<HTMLInputElement>(null);

  const addByProduct = usePosStore((s) => s.addByProduct);
  const addByBarcode = usePosStore((s) => s.addByBarcode);
  const setStoreContext = usePosStore((s) => s.setStoreContext);
  const park = usePosStore((s) => s.park);
  const parkedCount = usePosStore((s) => s.parked_carts.length);
  const linesCount = usePosStore((s) => s.lines.length);

  const totals = useCartTotals(STORE_CONFIG.supply_type, STORE_CONFIG.round_off_mode);
  const { online, pendingCount } = useOutboxStatus();

  // Real, store-scoped catalogue and customer directory (GET /api/inventory/products,
  // GET /api/customers) — previously lib/mock-data.ts's CATALOG_PRODUCTS/
  // QUICK_GRID_PRODUCTS/MOCK_CUSTOMERS, whose hardcoded ids (e.g. 'p-tel-sunflower')
  // don't exist in the real backend for any store, so every checkout failed with
  // ERR_STORE_MISMATCH ("Product p-tel-sunflower not found in this store").
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<CustomerLite[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listPurchasableProducts().then((res) => {
      if (cancelled || !res.ok) return;
      setProducts(res.data);
    });
    void listCustomers().then((res) => {
      if (cancelled || !res.ok) return;
      setCustomers(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category).filter(Boolean))), [products]);

  const localStockOverrides = useLocalStockOverrides();
  const quickGridProducts = useMemo(
    () => applyLocalStockOverrides(products.filter((p) => p.is_loose), localStockOverrides),
    [products, localStockOverrides]
  );
  const catalogProducts = useMemo(() => applyLocalStockOverrides(products, localStockOverrides), [products, localStockOverrides]);

  // SYSTEM_ARCHITECTURE.md §5.7-equivalent for this milestone's scope: replay
  // the outbox on reconnect and on a periodic timer for the life of the tab.
  useEffect(() => startOutboxWorker(), []);

  // Open Shift already requires connectivity (lib/shift-client.ts has no offline
  // fallback for it), so fetching the real counter here doesn't add a new
  // offline dependency. Without this, POST /api/shifts/open 403s with
  // ERR_STORE_MISMATCH: STORE_CONFIG.counter_id (lib/mock-data.ts) is a fake
  // id that never belongs to the logged-in session's actual store.
  useEffect(() => {
    if (!STORE_CONFIG.shift_enabled || shift || !sessionReady) return;
    let cancelled = false;
    setCounterLoading(true);
    setCounterError(null);
    void listCounters().then((res) => {
      if (cancelled) return;
      setCounterLoading(false);
      if (!res.ok) {
        setCounterError(res.error);
        return;
      }
      setPrimaryCounter(res.data[0] ?? null);
      if (res.data.length === 0) setCounterError('ERR_NO_COUNTER_CONFIGURED');
    });
    return () => {
      cancelled = true;
    };
  }, [shift, sessionReady]);

  // The cart is created with placeholder store/counter ids at module load
  // (see stores/pos-store.ts) since real ones aren't known until session +
  // counter resolve. Push the real ones in as soon as both are available —
  // this is what actually fixes checkout's ERR_STORE_MISMATCH: without it,
  // every order submits counter_id: 'counter-1', which never belongs to any
  // real store.
  useEffect(() => {
    if (!sessionReady || !session?.store.id) return;
    // An open shift carries its own counter; otherwise use the store's primary counter.
    const counterId = shift?.counter.id ?? primaryCounter?.id;
    if (!counterId) return;
    setStoreContext(session.store.id, counterId);
  }, [sessionReady, session?.store.id, shift?.counter.id, primaryCounter?.id, setStoreContext]);

  const notify = useCallback((message: string, tone: Toast['tone'] = 'error') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const addProduct = useCallback(
    (product: Product, enteredQty?: string, unit?: Product['default_sale_unit']) => {
      const res = addByProduct(product, enteredQty ? { enteredQty, unit } : undefined);
      if (!res.ok) notify(res.error ?? 'ERR_QTY_INVALID');
    },
    [addByProduct, notify]
  );

  const handleScan = useCallback(
    (code: string) => {
      const res = addByBarcode(code, products);
      if (!res.ok) notify(res.error === 'ERR_PRODUCT_NOT_FOUND' ? t('pos.noProductForCode').replace('{code}', code) : (res.error ?? 'ERR_PRODUCT_NOT_FOUND'));
    },
    [addByBarcode, notify, products, t]
  );

  useBarcodeScanner(handleScan, !checkoutOpen);

  useHotkeys(
    {
      F1: () => searchInputRef.current?.focus(),
      F2: () => setActiveTab('quick-grid'),
      F3: () => setActiveTab('catalog'),
      F4: () => linesCount > 0 && setCheckoutOpen(true),
      F6: () => {
        document.getElementById('cart-discount-trigger')?.click();
      },
      F8: () => {
        if (linesCount > 0) {
          park(`${t('pos.cartLabel')} ${new Date().toLocaleTimeString(dateLocale(language))}`);
          notify(t('pos.cartParked'), 'success');
        }
      },
      F9: () => {
        document.getElementById('attach-customer-trigger')?.click();
      },
      Escape: () => {
        setCheckoutOpen(false);
        setShortcutsOpen(false);
        setParkedOpen(false);
      },
      '?': () => setShortcutsOpen((v) => !v),
    },
    true
  );

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-900">
      <TopBar
        ref={searchInputRef}
        storeConfig={STORE_CONFIG}
        cashierName={cashierName}
        parkedCount={parkedCount}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSubmit={(value) => {
          const product = products.find((p) => p.sku === value);
          if (product) {
            addProduct(product);
            setSearchQuery('');
          } else {
            setActiveTab('catalog');
          }
        }}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onOpenParked={() => setParkedOpen(true)}
        online={online}
        pendingSyncCount={pendingCount}
        onOpenCustomEntry={() => setCustomEntryOpen(true)}
        onCloseShift={STORE_CONFIG.shift_enabled && shift ? () => setCloseShiftOpen(true) : undefined}
        onOpenCashMovement={STORE_CONFIG.shift_enabled && shift ? () => setCashMovementOpen(true) : undefined}
      />

      {/* REQUIREMENTS.md §5.1: no selling without an open shift, when shifts are enabled for this store. */}
      {STORE_CONFIG.shift_enabled && !shift ? (
        counterLoading || !sessionReady ? (
          <div className="flex h-full flex-1 items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 text-sm text-slate-500">
            {t('pos.loadingCounter')}
          </div>
        ) : primaryCounter ? (
          <OpenShiftDrawer counterId={primaryCounter.id} counterName={primaryCounter.name} cashierName={cashierName} />
        ) : (
          <div className="flex h-full flex-1 items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4 text-center text-sm text-rose-600">
            {counterError === 'ERR_NO_COUNTER_CONFIGURED'
              ? t('pos.noActiveCounter')
              : `${t('pos.couldNotLoadCounter')} (${translateError(t, counterError ?? 'ERR_UNKNOWN')}).`}
          </div>
        )
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_400px]">
          <WorkArea
            activeTab={activeTab}
            onTabChange={setActiveTab}
            quickGrid={<QuickGrid products={quickGridProducts} onAdd={addProduct} />}
            catalog={
              <CatalogSearch
                products={catalogProducts}
                categories={categories}
                query={searchQuery}
                category={category}
                onCategoryChange={setCategory}
                onAdd={(product) => addProduct(product)}
                showStock={STORE_CONFIG.track_inventory}
              />
            }
          />
          <CartPanel totals={totals} customers={customers} onCheckout={() => linesCount > 0 && setCheckoutOpen(true)} onPark={() => {
            if (linesCount > 0) {
              park(`${t('pos.cartLabel')} ${new Date().toLocaleTimeString(dateLocale(language))}`);
              notify(t('pos.cartParked'), 'success');
            }
          }} notify={notify} />
        </div>
      )}

      <CloseShiftModal open={closeShiftOpen} onClose={() => setCloseShiftOpen(false)} />
      <CashMovementModal open={cashMovementOpen} onClose={() => setCashMovementOpen(false)} />
      <QuickCustomEntry open={customEntryOpen} onClose={() => setCustomEntryOpen(false)} onAdd={(product) => addProduct(product)} />

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        totals={totals}
        storeConfig={STORE_CONFIG}
        cashierName={cashierName}
        onCompleted={(invoiceNo) => {
          setCheckoutOpen(false);
          notify(`${t('pos.saleCompleted')} · ${invoiceNo}`, 'success');
        }}
      />
      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ParkedCartsPanel open={parkedOpen} onClose={() => setParkedOpen(false)} />
      <ToastStack toasts={toasts} />
    </div>
  );
}
