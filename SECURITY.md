# Revisão de segurança — 16/11/2026

Escopo: repositório publicado, histórico Git disponível, frontend React, painel, servidor Python local, Worker Cloudflare, uploads e sincronização assinada. O site está hospedado na Cloudflare com o Worker de `cloudflare/worker.js`, assets gerados em `dist` e o banco vinculado em `wrangler.jsonc`. Este documento substitui o relatório anterior à implantação.

## Resultado e correções

- A comparação dos arquivos públicos e dos blobs do histórico com as credenciais privadas atuais não encontrou correspondências. Também foram pesquisados formatos reconhecíveis de tokens GitHub, IDs de acesso AWS e chaves privadas. Nenhuma varredura demonstra ausência de todo segredo possível.
- A sincronização passou a verificar formato, validade temporal e assinatura HMAC antes de usar o limitador persistido no D1. Pedidos sem autenticação não consomem gravações desse limitador.
- Quando uma cota de tentativas está esgotada, a atualização condicional não incrementa mais a linha do contador. A janela expirada permite o reinício normal da contagem. Isso reduz gravações repetidas; não elimina custos de leitura nem substitui proteção de rede.
- O `.gitignore` exclui dados, arquivos de ambiente, configurações privadas de ferramentas, credenciais, bancos, logs, backups, certificados e arquivos de exportação. Não se ignora `cloudflare/schema.sql`, necessário ao projeto, nem `src/data`, que contém exemplos públicos.
- `scripts/check-publication.mjs` bloqueia caminhos privados e padrões de credenciais conhecidos no índice Git e nos assets. A verificação acontece antes/depois do build; o hook de pré-commit verifica o índice Git. A saída contém somente caminhos e motivos, nunca os valores encontrados.
- `public/.assetsignore`, copiado para o diretório de assets, adiciona exclusões na publicação do Wrangler como defesa adicional. Referência: [Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/binding/).

## Proteções verificadas

- Escrita administrativa exige sessão válida, token CSRF assinado e cookie correspondente. Origens divergentes e requisições cross-site são rejeitadas.
- Senhas são verificadas com scrypt; o hash de produção fica em secret do Worker. Tokens de sessão são armazenados como hashes no D1, expiram em oito horas e são revogados no logout. Cookies têm HttpOnly, Secure em HTTPS e SameSite Strict.
- Autenticação, administração, uploads e sincronização têm limites de tentativas. A aplicação local limita conexões, sessões e verificações simultâneas de senha.
- Schemas rejeitam campos extras, tipos inadequados, chaves JSON duplicadas e URLs não autorizadas. SQL usa parâmetros. A saída do frontend renderiza títulos como texto, sem HTML fornecido pelo catálogo.
- Imagens exigem autenticação e CSRF, são decodificadas e regravadas sem metadados, com limites de dimensões, tamanho, quantidade e armazenamento. O Worker limita também a descompressão antes de decodificar PNG.
- Sincronização exige HMAC SHA-256 sobre os bytes exatos, timestamp, nonce e identificação da operação. Replays e operações conflitantes são rejeitados; versões antigas não substituem novas. Reenvios idempotentes são suportados. A chave de catálogo não autoriza alteração de conteúdo administrativo.
- O adaptador usa somente GET no OfertaBot e publica uma projeção: dados de produto/oferta e classificação, sem comissões, mensagens privadas, descrições internas ou credenciais.
- CSP, HSTS, nosniff, bloqueio de frames, política de referência e restrições de recursos estão configurados. O Python bloqueia diretórios, travessia de caminhos, dotfiles e arquivos fora da lista pública.
- A obrigatoriedade da VSL é um fluxo da interface, não um controle de acesso a informações privadas. As ofertas e os convites aprovados são intencionalmente públicos.

## Verificações desta revisão

- 51 testes React/painel; 12 testes Worker; 3 testes da barreira de publicação.
- 29 testes Python com dados descartáveis, executados normalmente e também com `-O`.
- Build de produção e inspeção dos diretórios `public` e `dist`.
- `npm audit`: zero vulnerabilidades conhecidas no momento da consulta.
- Consulta OSV para Pillow 13.0.0: zero avisos conhecidos no momento da consulta.
- Os testes HTTP Python tiveram interrupções WinError 10053 na primeira execução. Os casos isolados e as suítes completas posteriores passaram sem remover ou afrouxar verificações.

## Publicação segura

```powershell
npm.cmd run test:publication
npm.cmd run check:publication
npm.cmd run build
git config core.hooksPath .githooks
```

`check:publication` verifica o índice Git; execute no checkout que será enviado, depois de selecionar os arquivos com `git add`. O hook foi ativado no checkout usado para publicar este projeto. Em novos clones é necessário executar novamente `git config core.hooksPath .githooks`. Hooks podem ser ignorados deliberadamente e não substituem revisão.

Não use `git add -f` para incluir dados privados. `.gitignore` não remove arquivos que já estejam no histórico. Se uma credencial real for publicada, revogue-a primeiro; apagar o arquivo em um commit posterior não revoga o segredo. Não foi identificada necessidade de reescrever o histórico nesta revisão.

A configuração pública do Wrangler contém nomes e identificador do D1; eles identificam recursos, mas não concedem acesso à conta. Os valores `ADMIN_PASSWORD_HASH`, `CSRF_SECRET` e `SYNC_KEY` permanecem fora do repositório, em secrets do Worker e arquivos privados locais ignorados. Backups, SQLite, uploads administrativos, configuração da integração e credenciais OAuth não foram incluídos.

## Limites da revisão

Esta foi uma revisão de código, dependências, arquivos e regressões automatizadas, não um pentest completo. A detecção automática é limitada aos caminhos, padrões e valores examinados. Não foram auditados toda a conta Cloudflare, extensões do navegador, dispositivos móveis ou todo o OfertaBot. Não foram alteradas as configurações de segurança do Windows nem ativados serviços pagos. As chaves atuais foram preservadas, pois não houve evidência de exposição. Imagens externas podem informar o IP do visitante ao provedor da imagem. O servidor Python é local e deve permanecer em loopback; o site público usa o Worker HTTPS.
