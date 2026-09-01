'use client';

import { useEffect, useRef, useState } from 'react';
import { ClientsPanel } from '@/src/modules/clients/clients-panel';
import { DiagnosticsPanel } from '@/src/modules/diagnostics/diagnostics-panel';
import { PricingSimulator } from '@/src/modules/pricing/pricing-simulator';
import { ProductionBoard } from '@/src/modules/production/production-board';
import { ReleaseNotesPanel } from '@/src/modules/updates/release-notes-panel';

type ModuleId = 'production' | 'pricing' | 'clients' | 'diagnostics' | 'updates';

const navigation: Array<{
  id: ModuleId;
  label: string;
  short: string;
}> = [
  { id: 'production', label: 'Produção', short: 'P' },
  { id: 'pricing', label: 'Precificação', short: '$' },
  { id: 'clients', label: 'Clientes', short: 'C' },
  { id: 'diagnostics', label: 'Diagnóstico', short: 'D' },
];

const headings: Record<
  ModuleId,
  { eyebrow: string; title: string; description: string }
> = {
  production: {
    eyebrow: 'Operação',
    title: 'Fila de produção',
    description: 'Pedidos em andamento, prazos e prioridades.',
  },
  pricing: {
    eyebrow: 'Formação de preço',
    title: 'Precificação',
    description: 'Custos reais, taxas e margem por produto.',
  },
  clients: {
    eyebrow: 'Relacionamento',
    title: 'Clientes',
    description: 'Cadastro, negociações e histórico de compras.',
  },
  diagnostics: {
    eyebrow: 'Suporte técnico',
    title: 'Diagnóstico',
    description: 'Rastreamento de falhas sem dados pessoais.',
  },
  updates: {
    eyebrow: 'Novidades do aplicativo',
    title: 'Atualizações',
    description: 'Novas funções, melhorias e hotfixes do Ambro Studio.',
  },
};

export function StudioShell() {
  const [activeModule, setActiveModule] = useState<ModuleId>('production');
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const heading = headings[activeModule];

  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [activeModule]);

  return (
    <main className="min-h-screen bg-[#f6f1e9] text-[#34251f] lg:h-dvh lg:overflow-hidden">
      <div className="grid min-h-screen lg:h-dvh lg:min-h-0 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="border-b border-[#dfd4c7] bg-[#4b3027] px-5 py-5 text-white lg:h-dvh lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="flex items-center">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#c69a45] text-lg font-black text-[#3d291f] shadow-sm">A</div>
              <div>
                <p className="text-lg font-bold tracking-tight">Ambro Studio</p>
                <p className="text-xs text-[#d9c8bc]">Central de gestão</p>
              </div>
            </div>
          </div>

          <nav aria-label="Navegação principal" className="mt-5 grid grid-cols-4 gap-2 lg:mt-8 lg:grid-cols-1">
            {navigation.map((item) => {
              const active = item.id === activeModule;
              return (
                <button
                  aria-current={active ? 'page' : undefined}
                  key={item.id}
                  className={'flex min-w-0 items-center justify-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition lg:justify-start ' + (active ? 'bg-[#c69a45] text-[#34251f] shadow-sm' : 'text-[#eaded4] hover:bg-white/10')}
                  onClick={() => setActiveModule(item.id)}
                  type="button"
                >
                  <span className={'grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-black ' + (active ? 'bg-white/35' : 'bg-white/10')}>{item.short}</span>
                  <span className="hidden truncate sm:block">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-10 hidden rounded-2xl border border-white/10 bg-white/5 p-4 lg:block">
            <div className="flex items-start gap-3">
              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgb(52_211_153/12%)]" />
              <div>
                <p className="text-sm font-semibold">Sistema monitorado</p>
                <p className="mt-1 text-xs leading-5 text-[#d9c8bc]">Falhas recebem um código seguro para diagnóstico, sem dados de clientes.</p>
              </div>
            </div>
          </div>
        </aside>

        <section className="min-w-0 lg:flex lg:h-dvh lg:min-h-0 lg:flex-col">
          <header className="shrink-0 border-b border-[#dfd4c7] bg-white/75 px-5 py-5 backdrop-blur lg:px-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#9a6f57]">{heading.eyebrow}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{heading.title}</h1>
              <p className="mt-1 text-sm text-[#7c685d]">{heading.description}</p>
            </div>
          </header>

          <div
            className="p-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-8"
            ref={contentScrollRef}
          >
            {activeModule === 'production' ? <ProductionBoard /> : null}
            {activeModule === 'pricing' ? <PricingSimulator /> : null}
            {activeModule === 'clients' ? <ClientsPanel /> : null}
            {activeModule === 'diagnostics' ? (
              <DiagnosticsPanel
                onOpenReleaseNotes={() => setActiveModule('updates')}
              />
            ) : null}
            {activeModule === 'updates' ? (
              <ReleaseNotesPanel
                onBack={() => setActiveModule('diagnostics')}
              />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
