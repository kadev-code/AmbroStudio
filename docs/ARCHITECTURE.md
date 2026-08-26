# Arquitetura do Ambro Studio

## Direção

O projeto é um aplicativo desktop local, construído como monólito modular. A
interface React é executada pelo Electron, mas não recebe acesso direto ao Node,
ao banco ou ao sistema de arquivos.

## Camadas

- `domain` contém regras puras, schemas e tipos.
- `modules` contém os casos de uso de Produção, Precificação e Clientes.
- `infrastructure` contém persistência, logging e a definição da ponte desktop.
- `desktop` contém o processo principal, preload e SQLite.
- `app`/shell contém a composição das telas.

O renderer acessa somente uma API pequena exposta pelo preload com
`contextIsolation`. O processo principal valida chaves, tamanho e formato antes
de gravar qualquer conteúdo.

## Persistência

SQLite é a fonte oficial no aplicativo instalado. Os documentos são validados
pelos schemas do domínio no renderer e armazenados em uma tabela de documentos
versionados. O formato permite migrar a aplicação atual sem perder os códigos e
vínculos existentes.

Os arquivos anexados não ficam soltos em pastas: o conteúdo binário é gravado
em uma tabela própria do SQLite. A interface recebe apenas identificador,
nome, tipo, tamanho e data. Para abrir um arquivo, o processo principal cria uma
cópia temporária com nome técnico, sem revelar caminhos internos ao renderer.

A versão web permanece apenas para desenvolvimento e usa `localStorage`. Ao
rodar no Electron, dados encontrados no armazenamento do renderer são copiados
para o SQLite quando ainda não existe documento correspondente.

## Dinheiro e percentuais

- Valores monetários são inteiros em centavos.
- Percentuais são inteiros em pontos-base: 10.000 representa 100%.
- A margem é calculada sobre o preço de venda.
- Arredondamentos são explícitos e testados.

## Backup

O backup contém os documentos funcionais e os anexos em JSON versionado. O banco
gera cópias rotativas a cada 15 minutos e ao fechar. A restauração valida o
formato completo antes de iniciar uma transação que substitui os documentos.
