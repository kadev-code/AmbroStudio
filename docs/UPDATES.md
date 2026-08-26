# Atualizações do Ambro Studio

## Como funciona

O aplicativo consulta as versões públicas do Ambro Studio no GitHub Releases.
Ele não executa `git pull`, não baixa o código-fonte e não precisa guardar um
token do GitHub no computador da pessoa usuária.

O instalador NSIS gera três artefatos importantes:

- `Ambro-Studio-Setup-X.Y.Z.exe`: instalador completo;
- `Ambro-Studio-Setup-X.Y.Z.exe.blockmap`: mapa para download diferencial;
- `latest.yml`: metadados usados para identificar a versão atual.

O aplicativo verifica uma nova versão 15 segundos após iniciar, novamente a
cada seis horas e quando a pessoa usa **Verificar atualização** em Diagnóstico.
O download e a instalação exigem confirmação. Antes de instalar, o aplicativo
gera um backup local automático.

## Primeira transição

A versão atualmente instalada (`0.2.0`) ainda não conhece o atualizador. Por
isso, a primeira versão conectada ao GitHub deverá ser instalada manualmente
uma única vez. A versão planejada para essa transição é `0.3.0`. A partir dela,
as próximas versões poderão ser obtidas dentro do próprio aplicativo.

O banco SQLite, anexos e backups ficam na pasta de dados do usuário, fora da
pasta do programa. Uma instalação sobre a versão anterior preserva esses dados.
O `appId` do Electron (`com.ambropersonalizados.studio`) não deve ser alterado.

## Repositório público

As atualizações estão conectadas a
`https://github.com/kadev-code/AmbroStudio`. A versão de transição é `0.3.0`.

## Publicar uma versão

1. Atualize `version` no `package.json` e no lockfile, usando uma versão maior
   que a publicada anteriormente.
2. Execute `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` e
   `pnpm desktop:compile`.
3. Faça commit das alterações.
4. Crie uma tag igual à versão, por exemplo `v0.3.0`, e envie a tag ao GitHub.
5. O workflow `.github/workflows/release.yml` valida o projeto e publica a
   release estável com o instalador, o blockmap e o `latest.yml`.
6. Confirme no GitHub que o workflow e a release foram concluídos. Releases em
   rascunho não são oferecidas aos aplicativos instalados.

Nunca coloque `GH_TOKEN` no código ou no instalador. A automação usa somente o
`GITHUB_TOKEN` temporário fornecido pelo GitHub Actions durante a publicação.

## Diagnóstico seguro

O log registra somente códigos fechados, como início de verificação, versão
disponível, download concluído e falha genérica. Não são gravados URL, release
notes, caminho do instalador, mensagem bruta do serviço ou dados de clientes.
