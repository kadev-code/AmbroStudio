import { Component, type ReactNode } from 'react';
import { safeLogger } from '@/src/infrastructure/logging/safe-logger';

type Props = { children: ReactNode };
type State = { failed: boolean; incidentCode?: string };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    const incident = safeLogger.record(
      {
        severity: 'fatal',
        eventCode: 'APP_RENDER_FAILED',
        module: 'app',
        operation: 'render-application',
        result: 'failure',
        routeId: 'app.root',
        errorCode: 'UNEXPECTED_RENDER_ERROR',
      },
      error,
    );

    this.setState({ incidentCode: incident.incidentCode });
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f1e9] p-6 text-[#34251f]">
        <section className="w-full max-w-lg rounded-3xl border border-[#ddcfc1] bg-white p-8 text-center shadow-xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#9a6f57]">Ambro Studio</p>
          <h1 className="mt-3 text-2xl font-bold">Não foi possível abrir o sistema</h1>
          <p className="mt-3 text-sm leading-6 text-[#745f54]">Atualize a página. Se o problema continuar, informe somente o código abaixo ao suporte.</p>
          <div className="mt-6 rounded-2xl bg-[#f4eee7] px-4 py-3 font-mono text-lg font-bold tracking-wider">
            {this.state.incidentCode ?? 'Gerando código...'}
          </div>
          <button className="mt-6 rounded-xl bg-[#5c3d2e] px-5 py-3 text-sm font-bold text-white" onClick={() => window.location.reload()} type="button">Atualizar página</button>
        </section>
      </main>
    );
  }
}
