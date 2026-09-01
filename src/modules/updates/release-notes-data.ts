export type ReleaseKind = 'feature' | 'hotfix' | 'improvement';

export type ReleaseNote = {
  version: string;
  releasedOn: string;
  kind: ReleaseKind;
  title: string;
  summary: string;
  reason: string;
  changes: string[];
  howToUse: string[];
};

export const releaseKindLabels: Record<ReleaseKind, string> = {
  feature: 'Novidade',
  hotfix: 'Hotfix',
  improvement: 'Melhoria',
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '0.9.0',
    releasedOn: '01/09/2026',
    kind: 'feature',
    title: 'Central de atualizações dentro do aplicativo',
    summary: 'As novidades, correções e instruções de uso agora podem ser consultadas sem sair do Ambro Studio.',
    reason: 'Facilitar o entendimento das mudanças depois de cada atualização e reduzir dúvidas sobre novas funções.',
    changes: [
      'Nova tela com histórico de novidades, melhorias e hotfixes.',
      'Cada versão informa o que mudou, por que mudou e como utilizar.',
      'Acesso direto pela tela de Diagnóstico.',
    ],
    howToUse: [
      'Abra Diagnóstico no menu lateral.',
      'Clique em “Ler novidades e hotfixes”.',
      'Use os filtros para consultar novidades, melhorias ou correções.',
    ],
  },
  {
    version: '0.8.0',
    releasedOn: '01/09/2026',
    kind: 'feature',
    title: 'Tabela de preços e histórico de versões',
    summary: 'Cada precificação salva passou a manter resultados confirmados e versões anteriores consultáveis.',
    reason: 'Impedir que alterações futuras em materiais, margens ou taxas modifiquem silenciosamente preços já confirmados.',
    changes: [
      'Nova aba Tabela de preços.',
      'Histórico imutável V1, V2, V3 e seguintes.',
      'Preços separados para Q=1, revenda e quantidade de referência.',
      'Clientes usam o preço da última versão confirmada.',
    ],
    howToUse: [
      'Abra Precificação e selecione uma precificação salva.',
      'Faça os ajustes necessários e clique em “Recalcular e salvar versão”.',
      'Abra “Tabela de preços” para consultar a versão atual ou o histórico.',
    ],
  },
  {
    version: '0.7.0',
    releasedOn: '01/09/2026',
    kind: 'feature',
    title: 'Precificação por quantidade e aproveitamento A4',
    summary: 'A simulação passou a calcular lotes, revenda e o número real de folhas A4 necessárias.',
    reason: 'Calcular corretamente custos que mudam conforme a quantidade e evitar a cobrança duplicada do papel usado no aproveitamento A4.',
    changes: [
      'Comparação automática para 1, 10, 20, 50, 100 e quantidade personalizada.',
      'Quantidade mínima para revenda e unidade comercial.',
      'Cálculo de unidades por folha A4 e folhas necessárias.',
      'Custo total, unitário, preço mínimo, venda e lucro.',
    ],
    howToUse: [
      'Informe a quantidade analisada no início da simulação.',
      'Se o produto usar folha A4, ative o aproveitamento e informe largura e altura.',
      'Confira os valores na tabela de comparação e salve a precificação.',
    ],
  },
  {
    version: '0.6.3',
    releasedOn: '01/09/2026',
    kind: 'hotfix',
    title: 'Gravações retiradas da interface principal',
    summary: 'As gravações do aplicativo desktop deixaram de bloquear a tela enquanto são processadas.',
    reason: 'Corrigir travamentos relatados em outros computadores durante operações de salvamento.',
    changes: [
      'Fila segura e ordenada para gravações locais.',
      'Operações de SQLite executadas fora da interface.',
      'Preservação integral do banco existente.',
    ],
    howToUse: ['Nenhuma ação adicional é necessária; a correção funciona automaticamente.'],
  },
  {
    version: '0.6.2',
    releasedOn: '01/09/2026',
    kind: 'hotfix',
    title: 'Campos de preço e cadastro de materiais estabilizados',
    summary: 'Campos numéricos passaram a aceitar edição e apagamento completo sem recolocar valores durante a digitação.',
    reason: 'Eliminar travamentos ao digitar na precificação e falhas ao criar ou editar materiais.',
    changes: [
      'Digitação livre com vírgula decimal.',
      'Valores podem ser apagados antes de informar o novo número.',
      'Mensagens de validação sem quebrar o formulário.',
    ],
    howToUse: ['Edite os campos normalmente; a validação aparece somente quando o valor precisa ser corrigido.'],
  },
  {
    version: '0.6.1',
    releasedOn: '28/08/2026',
    kind: 'hotfix',
    title: 'Correção de congelamentos no armazenamento local',
    summary: 'O acesso ao SQLite e aos arquivos locais foi reorganizado para reduzir pausas na aplicação.',
    reason: 'Melhorar o funcionamento em computadores com armazenamento mais lento.',
    changes: [
      'Operações locais assíncronas.',
      'Diagnóstico seguro em caso de falha.',
      'Compatibilidade mantida com bancos anteriores.',
    ],
    howToUse: ['A correção é automática e não exige recriar cadastros ou restaurar backup.'],
  },
  {
    version: '0.6.0',
    releasedOn: '26/08/2026',
    kind: 'improvement',
    title: 'Exclusão definitiva de clientes',
    summary: 'Clientes podem ser removidos do banco junto com seus vínculos, após confirmação explícita.',
    reason: 'Permitir a limpeza de cadastros de teste ou registros criados incorretamente.',
    changes: ['Botão de exclusão no cadastro do cliente.', 'Remoção coordenada de negociações, pedidos e anexos vinculados.'],
    howToUse: ['Abra o histórico do cliente, escolha editar e utilize “Excluir cliente”.', 'Leia o resumo e confirme a exclusão definitiva.'],
  },
  {
    version: '0.5.0',
    releasedOn: '26/08/2026',
    kind: 'feature',
    title: 'Acompanhamento de pagamentos',
    summary: 'Negociações passaram a registrar pagamento pendente, parcial ou pago.',
    reason: 'Evitar que entregas com saldo pendente sejam esquecidas.',
    changes: ['Situação de pagamento em negociações.', 'Avisos de pagamentos pendentes na página inicial.', 'Conclusão automática da negociação após entrega e arquivamento.'],
    howToUse: ['Ao criar ou editar uma negociação, selecione a situação do pagamento.', 'Consulte os avisos na tela de Produção.'],
  },
  {
    version: '0.4.1',
    releasedOn: '26/08/2026',
    kind: 'improvement',
    title: 'Menu e cabeçalho fixos',
    summary: 'Somente o conteúdo central passou a rolar nas telas maiores.',
    reason: 'Manter navegação e identificação da página sempre visíveis em telas com muitos registros.',
    changes: ['Menu lateral fixo.', 'Cabeçalho fixo.', 'Rolagem independente do conteúdo principal.'],
    howToUse: ['Role o conteúdo normalmente; os controles de navegação permanecem disponíveis.'],
  },
  {
    version: '0.4.0',
    releasedOn: '26/08/2026',
    kind: 'feature',
    title: 'Materiais de uso e receitas por produto',
    summary: 'Materiais podem ser cadastrados e vinculados em quantidades próprias a cada precificação.',
    reason: 'Substituir o custo manual de materiais por uma composição rastreável e reutilizável.',
    changes: ['Catálogo de materiais.', 'Custo proporcional por unidade de consumo.', 'Seleção múltipla de materiais.', 'Receita persistente por produto.'],
    howToUse: ['Cadastre as compras em “Materiais de uso”.', 'Na simulação, clique em “Selecionar materiais”, informe o consumo e confirme.', 'Salve a precificação para manter a receita.'],
  },
  {
    version: '0.3.3',
    releasedOn: '26/08/2026',
    kind: 'feature',
    title: 'Atualizações automáticas pelo aplicativo',
    summary: 'O Ambro Studio passou a verificar, baixar e instalar versões publicadas no GitHub.',
    reason: 'Permitir a distribuição segura de correções sem reinstalação manual a cada versão.',
    changes: ['Verificação de novas versões.', 'Download diferencial.', 'Backup automático antes da instalação.'],
    howToUse: ['Abra Diagnóstico e clique em “Verificar atualização”.', 'Baixe a versão disponível e escolha “Instalar e reiniciar”.'],
  },
];
