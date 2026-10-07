'use client';

import type { ReactNode } from 'react';
import { LayoutGrid, Search } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export type WorkAreaTab = 'quick-grid' | 'catalog';

interface WorkAreaProps {
  activeTab: WorkAreaTab;
  onTabChange: (tab: WorkAreaTab) => void;
  quickGrid: ReactNode;
  catalog: ReactNode;
}

/** Tab 1: Quick Grid (loose items) / Tab 2: Search & Catalog. F2 / F3 switch tabs (app/pos/page.tsx). */
export function WorkArea({ activeTab, onTabChange, quickGrid, catalog }: WorkAreaProps) {
  const { t } = useLanguage();
  return (
    <section className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 gap-1 border-b border-slate-200 bg-slate-50 px-3 pt-2">
        <TabButton active={activeTab === 'quick-grid'} onClick={() => onTabChange('quick-grid')} icon={LayoutGrid}>
          {t('pos.quickGridTab')} <kbd className="ml-1 text-[10px] text-slate-400">F2</kbd>
        </TabButton>
        <TabButton active={activeTab === 'catalog'} onClick={() => onTabChange('catalog')} icon={Search}>
          {t('pos.searchCatalogTab')} <kbd className="ml-1 text-[10px] text-slate-400">F3</kbd>
        </TabButton>
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-50">{activeTab === 'quick-grid' ? quickGrid : catalog}</div>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  icon: typeof LayoutGrid;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-t-lg px-4 py-2.5 text-sm font-semibold transition ${
        active ? 'border-x border-t border-slate-200 bg-white text-emerald-600' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      <Icon size={14} />
      {children}
    </button>
  );
}
