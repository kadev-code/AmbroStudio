'use client';

import { useEffect, useState } from 'react';
import { CLIENT_DRAFTS_STORAGE_KEY } from '@/src/infrastructure/clients/local-client-draft-repository';
import type { DesktopUpdateState } from '@/src/infrastructure/desktop/desktop-api';
import { safeLogger } from '@/src/infrastructure/logging/safe-logger';
import { PRODUCTION_DRAFTS_STORAGE_KEY } from '@/src/infrastructure/production/local-production-draft-repository';
import { PRICING_MATERIALS_STORAGE_KEY } from '@/src/infrastructure/pricing/local-material-catalog-repository';
import { PRICING_PRODUCTS_STORAGE_KEY } from '@/src/modules/pricing/pricing-product-drafts';

function updateStatusMessage(state: DesktopUpdateState) {
  switch (state.status) {
    case 'not-configured':
      return 'Aguardando a conexão com o repositório público de atualizações.';
    case 'development':
      return 'A verificação funciona no aplicativo instalado.';
    case 'checking':
      return 'Verificando se existe uma nova versão...';
    case 'up-to-date':
      return 'O Ambro Studio está atualizado.';
    case 'available':
      return `A versão ${state.availableVersion ?? 'mais recente'} está disponível.`;
    case 'downloading':
      return `Baixando atualização: ${Math.round(state.downloadPercent ?? 0)}%.`;
    case 'downloaded':
      return `A versão ${state.availableVersion ?? 'mais recente'} está pronta para instalar.`;
    case 'error':
      return 'Não foi possível concluir a atualização. Tente verificar novamente.';
    default:
      return 'As atualizações automáticas estão ativas.';
  }
}

export function DiagnosticsPanel({
  onOpenReleaseNotes,
}: {
  onOpenReleaseNotes: () => void;
}) {
  const [incidentCode, setIncidentCode] = useState<string>();
  const [desktopFeedback, setDesktopFeedback] = useState('');
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({
    status: 'development',
    currentVersion: '—',
  });
  const desktopAvailable = typeof window !== 'undefined' && window.ambroDesktop;

  useEffect(() => {
    const desktop = window.ambroDesktop;
    if (!desktop) return;

    let active = true;
    void desktop.updates
      .getState()
      .then((state) => {
        if (active) setUpdateState(state);
      })
      .catch(() => {
        if (active) {
          setUpdateState((current) => ({
            ...current,
            status: 'error',
            errorCode: 'UPDATE_STATE_UNAVAILABLE',
          }));
        }
      });
    const unsubscribe = desktop.updates.onStateChange((state) => {
      if (active) setUpdateState(state);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  function simulateTechnicalFailure() {
    const incident = safeLogger.record(
      {
        severity: 'error',
        eventCode: 'DIAGNOSTIC_TEST_EVENT',
        module: 'diagnostics',
        operation: 'test-safe-logger',
        result: 'failure',
        routeId: 'diagnostics.home',
        errorCode: 'CONTROLLED_TEST_ERROR',
      },
      new Error('Esta mensagem não deve aparecer no evento enviado.'),
    );
    setIncidentCode(incident.incidentCode);
  }

  async function createBackup() {
    try {
      const result = await window.ambroDesktop?.backup.create();
      if (result?.status === 'success') {
        setDesktopFeedback(`Backup salvo em ${result.path}`);
      }
    } catch {
      setDesktopFeedback('Não foi possível criar o backup. Tente novamente.');
    }
  }

  async function restoreBackup() {
    if (
      !window.confirm(
        'A restauração substituirá os dados atuais pelos dados do backup. Deseja continuar?',
      )
    ) {
      return;
    }
    try {
      const result = await window.ambroDesktop?.backup.restore();
      if (result?.status === 'success') window.location.reload();
    } catch {
      setDesktopFeedback(
        'O backup não pôde ser restaurado. Confirme se o arquivo é válido.',
      );
    }
  }

  async function exportDiagnostics() {
    try {
      const result = await window.ambroDesktop?.diagnostics.export();
      if (result?.status === 'success') {
        setDesktopFeedback(`Diagnóstico exportado para ${result.path}`);
      }
    } catch {
      setDesktopFeedback(
        'Não foi possível exportar o diagnóstico. Tente novamente.',
      );
    }
  }

  async function checkForUpdates() {
    try {
      await window.ambroDesktop?.updates.check();
    } catch {
      setDesktopFeedback('Não foi possível verificar atualizações agora.');
    }
  }

  async function downloadUpdate() {
    try {
      await window.ambroDesktop?.updates.download();
    } catch {
      setDesktopFeedback('Não foi possível baixar a atualização agora.');
    }
  }

  async function installUpdate() {
    if (
      !window.confirm(
        'O Ambro Studio criará um backup, fechará e instalará a atualização. Deseja continuar?',
      )
    ) {
      return;
    }
    try {
      await window.ambroDesktop?.updates.install();
    } catch {
      setDesktopFeedback('Não foi possível iniciar a instalação da atualização.');
    }
  }

  function exportBrowserData() {
    try {
      const documents = Object.fromEntries(
        [
          CLIENT_DRAFTS_STORAGE_KEY,
          PRODUCTION_DRAFTS_STORAGE_KEY,
          PRICING_PRODUCTS_STORAGE_KEY,
          PRICING_MATERIALS_STORAGE_KEY,
        ].flatMap((key) => {
          const value = window.localStorage.getItem(key);
          return value ? [[key, JSON.parse(value)]] : [];
        }),
      );
      const backup = {
        format: 'ambro-studio-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        documents,
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: 'application/json',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `Ambro-Studio-Navegador-${new Date().toISOString().slice(0, 10)}.ambrobackup`;
      link.click();
      URL.revokeObjectURL(url);
      setDesktopFeedback(
        'Arquivo criado. No aplicativo desktop, use Restaurar backup.',
      );
    } catch {
      setDesktopFeedback(
        'Não foi possível exportar os dados deste navegador.',
      );
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-3xl border border-[#ded2c5] bg-white p-6 shadow-[0_8px_24px_rgb(76_53_42/5%)]">
        <div className="flex items-start gap-4">
          <span className="mt-1 h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgb(16_185_129/12%)]" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9a6f57]">Observabilidade</p>
            <h2 className="mt-1 text-xl font-bold">{desktopAvailable ? 'Sistema de diagnóstico ativo' : 'Sistema de diagnóstico preparado'}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#735f54]">A fundação já gera códigos pesquisáveis, agrupa eventos pela operação e transforma a stack em fingerprint. Nenhuma mensagem bruta do erro é incluída.</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            ['Schema fechado', 'Somente campos técnicos aprovados são aceitos.'],
            [desktopAvailable ? 'Persistência local' : 'Dupla sanitização', desktopAvailable ? 'Eventos técnicos ficam no SQLite e podem ser exportados.' : 'Cliente e servidor validarão o mesmo contrato.'],
            ['Sem replay', 'Não gravamos tela, teclado ou conteúdo de formulários.'],
          ].map(([title, description]) => (
            <article key={title} className="rounded-2xl border border-[#e6dcd2] bg-[#faf7f3] p-4">
              <h3 className="text-sm font-bold">{title}</h3>
              <p className="mt-2 text-xs leading-5 text-[#7b675c]">{description}</p>
            </article>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-[#eadfd4] p-5">
          <h3 className="text-sm font-bold">Teste controlado</h3>
          <p className="mt-1 text-sm leading-6 text-[#776359]">Gera um evento técnico seguro para comprovar o formato do código de suporte.</p>
          <button className="mt-4 rounded-xl bg-[#5c3d2e] px-4 py-2.5 text-sm font-bold text-white" onClick={simulateTechnicalFailure} type="button">Gerar código de teste</button>
          {incidentCode ? (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-[#f2ece5] px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wide text-[#8b7569]">Código gerado</span>
              <strong className="font-mono text-lg tracking-wider">{incidentCode}</strong>
            </div>
          ) : null}
        </div>

        <div className="mt-4 rounded-2xl border border-[#eadfd4] bg-[#faf7f3] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-bold">Novidades e hotfixes</h3>
              <p className="mt-1 text-sm leading-6 text-[#776359]">
                Veja o que foi adicionado, o motivo das mudanças e como usar
                cada função nova.
              </p>
            </div>
            <button
              className="shrink-0 rounded-xl bg-[#5c3d2e] px-4 py-2.5 text-sm font-bold text-white"
              onClick={onOpenReleaseNotes}
              type="button"
            >
              Ler novidades e hotfixes
            </button>
          </div>
        </div>

        {desktopAvailable ? (
          <div className="mt-4 rounded-2xl border border-[#eadfd4] p-5">
            <h3 className="text-sm font-bold">Dados e suporte local</h3>
            <p className="mt-1 text-sm leading-6 text-[#776359]">
              Salve uma cópia dos dados, restaure um backup ou exporte somente
              os eventos técnicos sanitizados para diagnóstico.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-xl bg-[#5c3d2e] px-4 py-2.5 text-sm font-bold text-white" onClick={createBackup} type="button">Criar backup</button>
              <button className="rounded-xl border border-[#d7c8ba] px-4 py-2.5 text-sm font-bold text-[#70574a]" onClick={restoreBackup} type="button">Restaurar backup</button>
              <button className="rounded-xl border border-[#d7c8ba] px-4 py-2.5 text-sm font-bold text-[#70574a]" onClick={exportDiagnostics} type="button">Exportar diagnóstico</button>
            </div>
            <p className="mt-3 break-all text-xs text-[#806b60]" role="status">{desktopFeedback}</p>

            <div className="mt-5 border-t border-[#eadfd4] pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold">Atualizações do aplicativo</h3>
                  <p className="mt-1 text-xs text-[#806b60]">
                    Versão instalada: {updateState.currentVersion}
                  </p>
                </div>
                <span className="rounded-full bg-[#f2ece5] px-3 py-1 text-xs font-bold text-[#70574a]">
                  {updateState.status === 'downloaded' ? 'Pronta' : 'Segura e local'}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#776359]" role="status">
                {updateStatusMessage(updateState)}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="rounded-xl border border-[#d7c8ba] px-4 py-2.5 text-sm font-bold text-[#70574a] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={
                    updateState.status === 'checking' ||
                    updateState.status === 'downloading' ||
                    updateState.status === 'not-configured'
                  }
                  onClick={checkForUpdates}
                  type="button"
                >
                  Verificar atualização
                </button>
                {updateState.status === 'available' ? (
                  <button className="rounded-xl bg-[#5c3d2e] px-4 py-2.5 text-sm font-bold text-white" onClick={downloadUpdate} type="button">Baixar atualização</button>
                ) : null}
                {updateState.status === 'downloaded' ? (
                  <button className="rounded-xl bg-[#5c3d2e] px-4 py-2.5 text-sm font-bold text-white" onClick={installUpdate} type="button">Instalar e reiniciar</button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-[#eadfd4] p-5">
            <h3 className="text-sm font-bold">Levar dados para o aplicativo</h3>
            <p className="mt-1 text-sm leading-6 text-[#776359]">
              Exporte os cadastros deste navegador e, depois de instalar o
              Ambro Studio, restaure o arquivo na tela Diagnóstico.
            </p>
            <button className="mt-4 rounded-xl bg-[#5c3d2e] px-4 py-2.5 text-sm font-bold text-white" onClick={exportBrowserData} type="button">Exportar dados do navegador</button>
            <p className="mt-3 break-all text-xs text-[#806b60]" role="status">{desktopFeedback}</p>
          </div>
        )}
      </section>

      <aside className="rounded-3xl bg-[#4b3027] p-6 text-white shadow-[0_18px_48px_rgb(70_43_33/18%)]">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#d7b56f]">Dados proibidos</p>
        <h2 className="mt-2 text-xl font-bold">Nunca entram no log</h2>
        <ul className="mt-5 space-y-3 text-sm text-[#e4d6ce]">
          {[
            'Nome, telefone, e-mail ou endereço',
            'Conteúdo de pedidos e negociações',
            'Valores, margens ou pagamentos',
            'Arquivos e URLs do Storage',
            'Senhas, tokens e cookies',
            'Texto livre digitado pela pessoa usuária',
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <span className="mt-1 text-[#e0bd71]">×</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
