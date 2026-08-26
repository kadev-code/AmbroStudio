# Logging e diagnóstico

## Regra central

O log é uma linha do tempo técnica, não uma cópia dos dados do sistema.

## Permitido

- Código do evento e do incidente.
- Módulo, operação, resultado e severidade.
- Versão e build.
- Identificadores técnicos aleatórios.
- Família do navegador e condição de rede.
- Código de erro conhecido.
- Fingerprint irreversível da stack.

## Proibido

- Nome, telefone, e-mail ou endereço.
- Observações, pesquisas e conteúdo de formulários.
- Produtos, valores, margens e pagamentos.
- Pedidos, nomes ou conteúdo de anexos e caminhos de arquivos.
- Tokens, cookies, senhas e cabeçalhos.
- Mensagens de exceção brutas.

## Fluxo desktop

1. A aplicação cria um evento usando um schema fechado.
2. Campos desconhecidos são recusados.
3. A stack é transformada em fingerprint; seu conteúdo não é armazenado.
4. O processo principal valida novamente a lista fechada de campos.
5. O evento técnico é gravado no SQLite separado dos documentos funcionais.
6. A pessoa usuária recebe um código no formato `AMB-XXXXX`.
7. A tela Diagnóstico exporta até os 5.000 eventos mais recentes em JSON.

Erros de renderização, erros globais da janela e rejeições de Promise não
tratadas passam pelo mesmo logger seguro. O logger nunca impede a operação do
aplicativo caso a gravação do evento falhe.
