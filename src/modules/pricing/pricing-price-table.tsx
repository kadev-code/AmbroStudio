'use client';

import { useState } from 'react';
import { money } from './pricing-format';
import {
  latestPricingProductVersion,
  type PricingProductDraft,
} from './pricing-product-drafts';
import { commercialUnitLabels } from './pricing-form-state';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function formatVersionDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Data indisponível' : dateTime.format(parsed);
}

export function PricingPriceTable({
  drafts,
  onRecalculate,
}: {
  drafts: PricingProductDraft[];
  onRecalculate: (draftId: string) => void;
}) {
  const [historyDraftId, setHistoryDraftId] = useState('');
  const historyDraft = drafts.find(({ id }) => id === historyDraftId);

  return (
    <section className="rounded-3xl border border-[#ded2c5] bg-white p-5 shadow-[0_8px_24px_rgb(76_53_42/5%)] sm:p-6">
      <div className="flex flex-col gap-2 border-b border-[#eee4da] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9a6f57]">Valores consolidados</p>
          <h2 className="mt-1 text-xl font-bold">Tabela de preços</h2>
          <p className="mt-1 text-sm text-[#806b60]">Os valores abaixo pertencem à última versão salva e não mudam quando um material é editado.</p>
        </div>
        <p className="text-xs font-semibold text-[#806b60]">{drafts.length} {drafts.length === 1 ? 'precificação salva' : 'precificações salvas'}</p>
      </div>

      {drafts.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[#d9cabc] px-4 py-12 text-center text-sm text-[#806b60]">
          Salve uma precificação para criar a primeira linha da tabela.
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-[#e2d6ca]">
          <table className="min-w-[1050px] w-full border-collapse text-sm">
            <thead className="bg-[#f4eee7] text-left text-xs uppercase tracking-wide text-[#765f52]">
              <tr>
                <th className="px-4 py-3">Precificação</th>
                <th className="px-4 py-3">Versão</th>
                <th className="px-4 py-3 text-right">Unitário (Q=1)</th>
                <th className="px-4 py-3 text-right">Revenda</th>
                <th className="px-4 py-3 text-right">Referência</th>
                <th className="px-4 py-3">Salva em</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => {
                const version = latestPricingProductVersion(draft);
                return (
                  <tr className="border-t border-[#eee4da]" key={draft.id}>
                    <td className="px-4 py-4">
                      <p className="font-bold text-[#4b3027]">{draft.name}</p>
                      <p className="mt-1 text-xs text-[#806b60]">por {commercialUnitLabels[draft.form.commercialUnit].toLocaleLowerCase('pt-BR')}</p>
                    </td>
                    <td className="px-4 py-4">
                      {version ? (
                        <span className="rounded-full bg-[#f1eadf] px-2.5 py-1 text-xs font-bold text-[#765f52]">V{version.versionNumber}</span>
                      ) : (
                        <span className="text-xs text-[#9a7f70]">Sem versão</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right font-bold text-[#4b3027]">{version ? money.format(version.results.unit.suggestedUnitPriceCents / 100) : '—'}</td>
                    <td className="px-4 py-4 text-right">
                      {version ? (
                        <>
                          <p className="font-bold text-[#4b3027]">{money.format(version.results.resale.suggestedUnitPriceCents / 100)}</p>
                          <p className="mt-1 text-xs text-[#806b60]">Q={version.results.resale.quantity}</p>
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-4 text-right">
                      {version ? (
                        <>
                          <p className="font-bold text-[#4b3027]">{money.format(version.results.reference.suggestedUnitPriceCents / 100)}</p>
                          <p className="mt-1 text-xs text-[#806b60]">Q={version.results.reference.quantity}</p>
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-4 text-xs text-[#6d5448]">{version ? formatVersionDate(version.createdAt) : '—'}</td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button className="rounded-xl border border-[#ccbbaa] bg-white px-3 py-2 text-xs font-bold text-[#6d5448]" onClick={() => onRecalculate(draft.id)} type="button">Recalcular</button>
                        <button className="rounded-xl bg-[#5c3d2e] px-3 py-2 text-xs font-bold text-white" onClick={() => setHistoryDraftId((current) => current === draft.id ? '' : draft.id)} type="button">Histórico ({draft.versions.length})</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {historyDraft && (
        <section className="mt-5 rounded-2xl border border-[#e2d6ca] bg-[#fcfaf7] p-4" aria-label={`Histórico de ${historyDraft.name}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#9a6f57]">Histórico preservado</p>
              <h3 className="mt-1 font-bold text-[#4b3027]">{historyDraft.name}</h3>
            </div>
            <button className="text-sm font-bold text-[#765f52]" onClick={() => setHistoryDraftId('')} type="button">Fechar</button>
          </div>
          <div className="mt-4 space-y-2">
            {[...historyDraft.versions]
              .sort((first, second) => second.versionNumber - first.versionNumber)
              .map((version) => (
                <article className="grid gap-3 rounded-xl border border-[#e8ddd2] bg-white px-4 py-3 sm:grid-cols-[auto_1fr_repeat(3,minmax(0,0.7fr))] sm:items-center" key={version.id}>
                  <span className="rounded-full bg-[#f1eadf] px-2.5 py-1 text-center text-xs font-bold text-[#765f52]">V{version.versionNumber}</span>
                  <div>
                    <p className="text-xs font-semibold text-[#6d5448]">{formatVersionDate(version.createdAt)}</p>
                    <p className="mt-1 text-[11px] text-[#9a7f70]">{version.calculationRuleVersion === 'legacy-import-v1' ? 'Versão importada do cadastro anterior' : `${version.materials.length} materiais · margem ${version.form.marginPercent}%`}</p>
                  </div>
                  <div className="text-right"><p className="text-[11px] text-[#806b60]">Unitário</p><p className="font-bold">{money.format(version.results.unit.suggestedUnitPriceCents / 100)}</p></div>
                  <div className="text-right"><p className="text-[11px] text-[#806b60]">Revenda Q={version.results.resale.quantity}</p><p className="font-bold">{money.format(version.results.resale.suggestedUnitPriceCents / 100)}</p></div>
                  <div className="text-right"><p className="text-[11px] text-[#806b60]">Referência Q={version.results.reference.quantity}</p><p className="font-bold">{money.format(version.results.reference.suggestedUnitPriceCents / 100)}</p></div>
                </article>
              ))}
          </div>
        </section>
      )}
    </section>
  );
}
