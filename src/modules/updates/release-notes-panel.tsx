'use client';

import { useMemo, useState } from 'react';
import {
  RELEASE_NOTES,
  releaseKindLabels,
  type ReleaseKind,
} from './release-notes-data';

type ReleaseFilter = 'all' | ReleaseKind;

const filterLabels: Record<ReleaseFilter, string> = {
  all: 'Todas',
  feature: 'Novidades',
  improvement: 'Melhorias',
  hotfix: 'Hotfixes',
};

const kindStyles: Record<ReleaseKind, string> = {
  feature: 'bg-[#f3e6c7] text-[#7a5714]',
  improvement: 'bg-[#e8eee5] text-[#44603e]',
  hotfix: 'bg-[#f3e4e2] text-[#87483f]',
};

export function ReleaseNotesPanel({ onBack }: { onBack: () => void }) {
  const [filter, setFilter] = useState<ReleaseFilter>('all');
  const currentVersion = import.meta.env.VITE_APP_VERSION;
  const filteredReleases = useMemo(
    () =>
      filter === 'all'
        ? RELEASE_NOTES
        : RELEASE_NOTES.filter(({ kind }) => kind === filter),
    [filter],
  );

  return (
    <div>
      <section className="rounded-3xl border border-[#ded2c5] bg-white p-5 shadow-[0_8px_24px_rgb(76_53_42/5%)] sm:p-6">
        <div className="flex flex-col gap-4 border-b border-[#eee4da] pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9a6f57]">Histórico do aplicativo</p>
            <h2 className="mt-1 text-xl font-bold">Novidades e hotfixes</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#735f54]">Consulte o que foi adicionado, o motivo de cada mudança e como usar as funções novas. Este conteúdo acompanha o aplicativo e pode ser lido sem internet.</p>
          </div>
          <button className="shrink-0 rounded-xl border border-[#d7c8ba] px-4 py-2.5 text-sm font-bold text-[#70574a]" onClick={onBack} type="button">Voltar ao diagnóstico</button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2" aria-label="Filtrar atualizações">
          {(Object.keys(filterLabels) as ReleaseFilter[]).map((item) => (
            <button
              aria-pressed={filter === item}
              className={`rounded-full px-4 py-2 text-sm font-bold ${filter === item ? 'bg-[#5c3d2e] text-white' : 'border border-[#d7c8ba] bg-white text-[#70574a]'}`}
              key={item}
              onClick={() => setFilter(item)}
              type="button"
            >
              {filterLabels[item]}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-4">
          {filteredReleases.map((release) => (
            <article className="rounded-2xl border border-[#e2d6ca] bg-[#fcfaf7] p-4 sm:p-5" key={release.version}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${kindStyles[release.kind]}`}>{releaseKindLabels[release.kind]}</span>
                    <strong className="text-sm text-[#4b3027]">Versão {release.version}</strong>
                    {release.version === currentVersion && <span className="rounded-full bg-[#5c3d2e] px-2.5 py-1 text-xs font-bold text-white">Versão instalada</span>}
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-[#34251f]">{release.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#735f54]">{release.summary}</p>
                </div>
                <time className="shrink-0 text-xs font-semibold text-[#92796c]">{release.releasedOn}</time>
              </div>

              <div className="mt-4 rounded-xl border border-[#e6d9cc] bg-white px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#9a6f57]">Por que foi feito</p>
                <p className="mt-2 text-sm leading-6 text-[#6f5a4f]">{release.reason}</p>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <h4 className="text-sm font-bold text-[#4b3027]">O que mudou</h4>
                  <ul className="mt-2 space-y-2 text-sm leading-6 text-[#735f54]">
                    {release.changes.map((change) => <li className="flex gap-2" key={change}><span className="text-[#b8860b]">•</span><span>{change}</span></li>)}
                  </ul>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#4b3027]">Como usar</h4>
                  <ol className="mt-2 space-y-2 text-sm leading-6 text-[#735f54]">
                    {release.howToUse.map((instruction, index) => <li className="flex gap-2" key={instruction}><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#f1e6d8] text-[11px] font-bold text-[#765f52]">{index + 1}</span><span>{instruction}</span></li>)}
                  </ol>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
