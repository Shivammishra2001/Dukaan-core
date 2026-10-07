import {
  Boxes,
  Building2,
  History,
  LayoutDashboard,
  PackagePlus,
  ReceiptIndianRupee,
  ShoppingCart,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavLink {
  href: string;
  label: string;
  labelLocal: string;
  /** Key into lib/translations/index.ts's `nav.*` namespace — see context/LanguageContext.tsx's t(). Falls back to `label`/`labelLocal` when absent. */
  navKey?: string;
  icon: LucideIcon;
  badge?: 'live';
}

export interface NavGroup {
  title: string;
  /** Key into lib/translations/index.ts's `nav.*` namespace for the group heading. */
  titleKey?: string;
  links: NavLink[];
}

/** Single source of truth for AppSidebar's grouped links — shared by the desktop rail, tablet icon rail and mobile drawer so the three surfaces never drift. */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Core',
    titleKey: 'nav.groupCore',
    links: [
      { href: '/dashboard', label: 'Dashboard', labelLocal: 'डैशबोर्ड', navKey: 'nav.dashboard', icon: LayoutDashboard },
      { href: '/pos', label: 'POS Counter', labelLocal: 'बिलिंग काउंटर', navKey: 'nav.pos', icon: ReceiptIndianRupee, badge: 'live' },
    ],
  },
  {
    title: 'B2B Wholesale',
    titleKey: 'nav.groupB2B',
    links: [
      { href: '/b2b/purchases', label: 'Maal Inward / Stock In', labelLocal: 'माल आवक', navKey: 'nav.maalInward', icon: PackagePlus },
      { href: '/b2b/orders', label: 'Book Wholesale Order', labelLocal: 'थोक ऑर्डर', navKey: 'nav.orders', icon: ShoppingCart },
      { href: '/b2b/dispatch', label: 'Gaadi Dispatch & Challans', labelLocal: 'गाड़ी चालान', navKey: 'nav.gaadiDispatch', icon: Truck },
      { href: '/b2b/suppliers', label: 'Suppliers (Karkhana)', labelLocal: 'सप्लायर / कारखाना', navKey: 'nav.suppliers', icon: Building2 },
    ],
  },
  {
    title: 'Khata & Inventory',
    titleKey: 'nav.groupKhataInventory',
    links: [
      { href: '/customers/ledger', label: 'Customer Khata (AR)', labelLocal: 'ग्राहक खाता', navKey: 'nav.customerKhata', icon: Users },
      { href: '/inventory', label: 'Saman & Rates', labelLocal: 'सामान व भाव', navKey: 'nav.samanRates', icon: Boxes },
      { href: '/reports/shifts', label: 'Galla & Shifts', labelLocal: 'गल्ला व शिफ्ट', navKey: 'nav.gallaShifts', icon: History },
    ],
  },
];

export const PRESET_LABELS: Record<string, string> = {
  KIRANA: 'Kirana Store',
  SALOON: 'Saloon',
  DHABA: 'Dhaba / Restaurant',
  REPAIR: 'Repair Shop',
  DISTRIBUTOR: 'Wholesale Distributor',
};
