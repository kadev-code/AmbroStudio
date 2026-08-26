# Ambro Studio

Aplicativo desktop local da Ambro Personalizados para Produção, Precificação e Clientes.

## Estado atual

- Interface React/TypeScript integrada ao Electron.
- Banco SQLite local, sem login e sem dependência de internet.
- Precificação por produto, com custos e margem próprios.
- Cadastro de clientes com vários produtos, negociações e vendas.
- Anexos de negociações armazenados como dados binários dentro do SQLite.
- Produção com prazos, prioridade, etapas, entrega e arquivamento.
- Vínculo único entre negociação e pedido de produção.
- Backups automáticos rotativos e backup/restauração manual.
- Logger técnico local com código de incidente `AMB-XXXXX`, sem dados de clientes.
- Exportação dos eventos técnicos sanitizados para suporte.
- Atualização pelo GitHub Releases, com download sob confirmação e backup antes
  da instalação.

## Desenvolvimento

Requisitos:

- Node.js 22.13 ou superior.
- pnpm 11.

Comandos:

1. `pnpm install`
2. `pnpm desktop:dev` para abrir o aplicativo em desenvolvimento.
3. `pnpm desktop:build` para gerar o instalador do Windows.

A versão web de demonstração continua disponível com `pnpm dev` em
`http://localhost:3000`. No navegador, ela usa o armazenamento local; no
aplicativo instalado, usa SQLite.

Para transferir cadastros já existentes no navegador, abra Diagnóstico, use
`Exportar dados do navegador` e depois restaure esse arquivo no aplicativo
desktop.

## Dados locais e backup

O banco fica na pasta de dados do aplicativo mantida pelo Windows. A aplicação
não expõe caminhos arbitrários para a interface: somente três documentos
validados podem atravessar a ponte do Electron.

O aplicativo cria uma cópia automática a cada 15 minutos e ao fechar. São
mantidos arquivos rotativos por dia da semana na subpasta `backups`. Na tela
Diagnóstico também é possível criar e restaurar uma cópia manual.

Os anexos aceitam PDF, imagens, documentos de texto e planilhas, com limite de
25 MB por arquivo e 20 arquivos por negociação. Eles fazem parte do mesmo
backup; cópias temporárias usadas para abrir um documento são limpas ao iniciar
e ao fechar o aplicativo.

## Verificações

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `pnpm desktop:compile`

Todas devem passar antes de gerar o instalador.

## Segurança

- A interface não possui acesso direto ao Node.js, SQLite ou sistema de arquivos.
- Toda persistência passa por uma ponte tipada e uma lista fechada de chaves.
- Backups são validados antes de substituir os dados atuais.
- Logs recusam campos desconhecidos e nunca incluem nomes, contatos, pedidos,
  produtos, valores, anexos, tokens ou texto livre.

Consulte `docs/ARCHITECTURE.md` e `docs/LOGGING.md` antes de alterar integrações,
fórmulas ou eventos técnicos.

O processo de publicação e atualização está documentado em `docs/UPDATES.md`.
