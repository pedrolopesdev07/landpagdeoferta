# Revisão de segurança da landing

Revisão local realizada em 16 de novembro de 2026. O escopo abrange a landing Python, o painel, o build React e o adaptador de leitura. A futura hospedagem é tratada em [SYNC_SECURITY.md](SYNC_SECURITY.md).

Este relatório registra a revisão da versão Python. A implementação posterior do Worker, os testes locais e as etapas de implantação estão em [CLOUDFLARE.md](CLOUDFLARE.md). A credencial de sincronização gerada para essa preparação permanece somente em `data/cloudflare`, fora do Git, até o provisionamento remoto.

## Dados e fronteiras de confiança

| Dado | Local | Quem acessa |
| --- | --- | --- |
| Hash scrypt e salt da senha | `data/content.sqlite3`, chave `password` | Processo Python e operador local |
| Senha fornecida no login | Corpo HTTPS em produção, memória durante a verificação | Administrador e servidor |
| Sessão administrativa | Cookie HttpOnly e dicionário do processo | Navegador do administrador e servidor |
| Token CSRF assinado | Cookie HttpOnly, resposta de `/api/session` e memória do painel | Navegador do administrador e servidor |
| Chave de assinatura CSRF | Memória do processo | Servidor |
| Credencial de leitura do OfertaBot | `AFILIADO_ACCESS_TOKEN`, quando configurada | Adaptador do servidor |
| Conteúdo, convites e imagens aprovadas | SQLite e `data/uploads` | Administrador escreve, visitantes leem |
| Backups com hash da senha e conteúdo | `.backups` | Operador local |
| Credencial de sincronização futura | Ainda inexistente | Definida no projeto futuro |

O navegador anônimo consulta somente o catálogo e o conteúdo público. O painel apresenta sua interface pública, mas suas operações de escrita exigem sessão e token CSRF. O adaptador consulta duas rotas do OfertaBot e publica uma projeção dos dados, sem mensagens privadas, comissões ou credenciais. A sincronização local → hospedagem ainda não existe.

| Rota | Permissão e efeito |
| --- | --- |
| `GET /api/content` | Público, retorna apenas campos previstos pelo schema |
| `GET /api/catalog` | Público, catálogo sanitizado dentro da janela do upstream |
| `GET /api/offers` | Público, até 30 ofertas |
| `GET /api/session` | Público, estado de autenticação e bootstrap CSRF |
| `POST /api/login` | Token CSRF, cookie correspondente, senha e limites de tentativas |
| `POST /api/content` | Sessão, CSRF, validação e gravação transacional |
| `POST /api/upload` | Sessão, CSRF, limites e regravação de imagem |
| `POST /api/logout` | Sessão e CSRF, revoga a sessão corrente |
| `HEAD` | Mesma seleção de recurso do GET, sem corpo |
| Demais métodos implementados de escrita/proxy | Resposta 405 |

## Origem dos achados

### Confirmados no contexto recebido e reencontrados no código

- A VSL usa estado no navegador e o catálogo admite entrada por fragmento. A conclusão do vídeo continua sendo uma regra da experiência comercial.
- As validações administrativas usavam `assert`. A execução com `-O` removeria essas verificações, mas a escrita continuava exigindo sessão. A revisão não demonstrou gravação anônima.
- O JSON original era persistido integralmente após validação parcial, e depois devolvido pela API pública. Isso permitia que um administrador ou sessão comprometida persistisse campos adicionais.
- A identificação de uploads verificava apenas a assinatura inicial do arquivo. A escrita já exigia sessão administrativa.
- Sessões e limites de login eram mantidos em memória. Cookies Secure dependiam de uma variável opcional.
- Faltavam cabeçalhos explícitos de proteção, política de host, cota de armazenamento e limite de conexões simultâneas.
- O build preservava indefinidamente `dist`, incluindo arquivos antigos e imagens persistentes.

### Confirmados pela inspeção adicional

- A senha inicial era impressa no terminal quando o banco ainda não tinha uma senha. O novo fluxo não imprime senhas.
- A verificação de Origin só era executada quando o cabeçalho existia. Isso foi confirmado como lacuna de defesa. A combinação anterior de JSON e SameSite Strict não foi demonstrada como um ataque CSRF funcional em um navegador real nesta revisão.
- O servidor herdava o comportamento de listagem de diretórios e HEAD do `SimpleHTTPRequestHandler`.
- O painel tinha CSS embutido no HTML. Foi extraído para arquivo local para permitir CSP sem estilos de elemento embutidos.
- As ofertas atuais usavam os domínios `meli.la` e `s.shopee.com.br`. Ambos foram preservados pela política de links.
- O conteúdo existente passou pelo novo schema de leitura. Os valores do banco foram comparados com o backup e permaneceram iguais. As sete imagens migradas foram comparadas byte a byte.

### Hipóteses e verificações pendentes

- Não houve exploração em uma implantação pública ou avaliação de um proxy HTTPS real.
- Não houve pentest completo do navegador, de extensões, de dispositivos móveis ou do próprio OfertaBot.
- Não foi verificado o conjunto de permissões de uma credencial real do OfertaBot. Se ela tiver privilégios além da leitura, a landing continuará dependendo dessa permissão upstream. O adaptador usa somente GET.
- O bloqueio de symlinks e junctions foi implementado na resolução de arquivos. A criação de cada tipo de link do Windows não foi explorada nesta máquina.
- A política de domínios cobre as plataformas brasileiras e os encurtadores cadastrados. Novos domínios oficiais devem ser avaliados e incluídos explicitamente.
- A compressão do vídeo e os limites de CPU do futuro backend hospedado precisam ser medidos com a implementação escolhida.
- Não foi executada uma varredura de CVEs das dependências Python. A dependência Pillow foi fixada na versão publicada consultada e os formatos aceitos foram limitados.

## Correções e critérios verificáveis

| Medida | Critério |
| --- | --- |
| CSRF assinado e cookie correspondente | POST sem token, com token forjado ou token de outro bootstrap é rejeitado com 403, mesmo sem Origin |
| Origin e Host | Origem divergente e Host não autorizado são rejeitados com 403 |
| Autorização | Escritas sem sessão retornam 401, logout invalida a sessão |
| Validação explícita | Campos extras, tipos errados e URLs proibidas são rejeitados; verificações permanecem ativas com Python `-O` |
| Projeção pública | Campos extras antigos são omitidos na leitura, sem alterar o banco |
| Imagens | Arquivos malformados são rejeitados; imagens válidas são decodificadas e regravadas em WebP sem metadados e conteúdo anexado |
| Limites de imagens | Até 5 MB de entrada e saída, 6000 pixels por lado, 12 megapixels, 500 arquivos e 100 MB na pasta |
| Publicação de imagens | Escrita temporária seguida de substituição atômica, mantendo URLs públicas em `/uploads/` |
| Limites de acesso | 600 requisições/IP/minuto, 10 logins/IP/5 minutos, 30 logins globais/5 minutos, 10 uploads/IP/minuto |
| Recursos do processo | Até 24 conexões atendidas simultaneamente, timeout de socket de 10 segundos, duas verificações scrypt simultâneas |
| Estado em memória | Limites de acesso com até 4096 chaves, até 128 sessões, remoção de sessões expiradas durante consultas autenticadas |
| Cookies | HttpOnly, SameSite Strict, oito horas; Secure obrigatório quando `APP_ENV=production` |
| Cabeçalhos | CSP, nosniff, frame protection, referrer policy e permissions policy em respostas; HSTS em produção |
| Arquivos | Sem listagem, dotfiles, banco, backups ou extensões fora da lista pública; HEAD respeita as mesmas restrições |
| Vídeo | Range continua retornando 206, ranges inválidos retornam 416 e HEAD não envia corpo |
| Logs | Eventos simbólicos, sem corpo, URL, cookie, token, senha ou conteúdo de exceções |
| Build | Painel vem de `public`, imagens ficam em `data/uploads` e Vite substitui os artefatos gerados |

Os limites são escolhas proporcionais para uma instância pequena. O limite de conexões atua depois de o socket ser aceito e não substitui proteção de rede. O rate limit é por processo, não distribuído. Cabeçalhos encaminhados pelo proxy não são usados para atribuir IP, evitando confiar em valores enviados pelo visitante. Atrás de um proxy todos os visitantes podem compartilhar o mesmo limite, exigindo configuração e medição antes da publicação.

## Arquivos alterados e propósito

| Arquivo | Mudança |
| --- | --- |
| `server.py` | Autenticação, CSRF, cabeçalhos, recursos, arquivos e uploads |
| `security.py` | Schema, política de URLs, imagens e limites de acesso |
| `requirements.txt` | Dependência Pillow isolada no ambiente virtual |
| `marketplace_domains.json` | Lista única de domínios afiliados |
| `affiliate_feed.py` | Aplica a política de links mantendo o adaptador de leitura |
| `src/lib.js`, `src/main.jsx` | Validação de links afiliados no navegador |
| `public/admin*`, `public/style.css`, `public/offers.js`, `public/assets` | Fontes persistentes do painel e imagens estáticas |
| `public/admin.js` | Obtenção e envio do token CSRF |
| `public/admin.css` | CSS extraído do HTML |
| `prepare-build.mjs`, `vite.config.js`, `package.json` | Preservação dos uploads antigos e limpeza dos artefatos gerados |
| `manage_site.py` | Backup, troca de senha e limpeza de imagens órfãs |
| `.gitignore` | Exclui ambientes, dados, segredos, logs e backups |
| `test_security.py`, `verify_funnel.py`, `src/landing.test.jsx`, `src/admin.test.js` | Regressões de segurança e compatibilidade |
| `README.md`, `SECURITY.md`, `SYNC_SECURITY.md` | Operação, achados, rollback e projeto de sincronização |

## Operação local e produção

Use Python 3.12 ou posterior. O ambiente usado nesta revisão foi Python 3.14.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm.cmd install
npm.cmd run build
$env:PORT='8765'
.\.venv\Scripts\python.exe server.py
```

Em um banco novo, execute primeiro a configuração de senha em terminal interativo.

```powershell
.\.venv\Scripts\python.exe manage_site.py password
```

A senha é digitada sem exibição e não aparece na linha de comando. Para trocar uma senha existente, pare a landing, execute o mesmo comando e reinicie. A senha existente não foi alterada nesta revisão. `ADMIN_PASSWORD` só inicializa um banco que ainda não tem senha e não deve ser incluída em scripts versionados ou histórico de comandos.

Em produção, configure `APP_ENV=production` e `PUBLIC_ORIGIN=https://seu-endereco`. O processo exige HTTPS na origem configurada, ativa Secure e HSTS e deve permanecer atrás de um proxy HTTPS que preserve Host, limite corpos, conexões e tempo de leitura. O processo Python não termina TLS. Não exponha o servidor de desenvolvimento do Vite. O CSP permite estilos em atributos para os componentes existentes e imagens HTTPS externas para preservar fotos de produtos e grupos. Essas imagens podem revelar o IP do visitante aos seus provedores.

As sessões expiram após oito horas e são perdidas ao reiniciar. Essa decisão foi mantida para uma instância pequena. A senha continua usando scrypt e o hash antigo permanece compatível. Não foram adicionados MFA, cadastro de usuários ou recuperação por email.

## Backup, limpeza e reversão

O backup anterior à reorganização está em `.backups/security-20261116-110810`. Contém o banco, as sete imagens e os arquivos principais anteriores. A cópia foi feita antes da migração dos uploads. Essa pasta contém dados privados e deve permanecer fora da publicação.

Com o servidor parado, crie novos backups e examine a limpeza.

```powershell
.\.venv\Scripts\python.exe manage_site.py backup
.\.venv\Scripts\python.exe manage_site.py cleanup-uploads
```

`cleanup-uploads --apply` cria backup e remove somente imagens não referenciadas no conteúdo atual e com mais de 24 horas. Execute com o servidor parado e sem edição pendente no painel. A limpeza é explícita para evitar apagar arquivos recém-enviados antes de salvar o formulário.

Para recuperar apenas dados, pare o servidor, copie `content.sqlite3` do backup para `data/content.sqlite3` e as imagens para `data/uploads`, preservando os nomes. Reinicie e confira o painel. A migração não alterou o schema do banco nem seus valores existentes.

Para reverter a reorganização de arquivos, restaure do backup `server.py`, `affiliate_feed.py`, `vite.config.js`, `package.json`, `.gitignore` e os arquivos antigos do painel em `dist`. A versão anterior espera uploads em `dist/uploads`, portanto copie as imagens do backup para esse local. Faça a restauração em um checkout separado quando possível. O backup operacional contém os dados e os principais arquivos anteriores, mas não é um snapshot completo do repositório. Para reversão integral do código, use um checkout completo anterior. Reverter o backend também remove as proteções implementadas nesta revisão.

## Validação

```powershell
npm.cmd test
npm.cmd run build
.\.venv\Scripts\python.exe -m unittest test_security test_affiliate_feed verify_funnel
.\.venv\Scripts\python.exe -O -m unittest test_security test_affiliate_feed verify_funnel
.\.venv\Scripts\python.exe verify_build.py
```

Os testes de escrita e uploads usam uma instância e um banco descartáveis. A comparação dos dados reais foi somente de leitura. O teste de código React inclui texto de XSS renderizado como texto e bloqueio de domínio que imita marketplace. DOM simulado e testes HTTP não demonstram a aplicação do CSP em todos os navegadores.

Resultados da execução final desta revisão

- 17 testes de frontend e painel aprovados.
- 23 testes Python aprovados em execução normal. A suíte foi ampliada com a limpeza de órfãos e os 24 testes passaram com `-O`; o teste de limpeza também foi executado isoladamente após o ajuste de fechamento das conexões do backup.
- Build de produção aprovado, com as imagens fora de `dist` e o painel presente.
- Consulta `npm audit` retornou zero avisos conhecidos no momento da execução. Isso não demonstra ausência de vulnerabilidades desconhecidas.
- Servidor local respondeu à página, painel, CSS, JavaScript e imagens. Requisições a diretórios, `.env` e banco foram bloqueadas. A integração voltou a responder `connected` com 36 ofertas válidas na verificação local.
- O teste inicial do painel precisou de ajuste na resolução dos arquivos dentro do ambiente de testes. A execução posterior passou.
- Uma consulta inicial após reiniciar retornou o catálogo indisponível. A consulta isolada ao upstream funcionou e, após novo início e consulta, o servidor retornou o catálogo conectado. A causa daquela falha transitória não foi demonstrada. O adaptador agora registra somente o nome da classe da falha para diagnóstico, sem mensagens ou dados privados.

## Etapas de publicação

1. Concluir as verificações locais e conferir manualmente VSL, modal e painel no celular.
2. Para publicar Python, provisionar armazenamento persistente e proxy HTTPS, testar os limites do proxy e a origem configurada. Não foi configurada hospedagem Python gratuita nesta revisão.
3. Para Cloudflare, implementar e medir o desenho de [SYNC_SECURITY.md](SYNC_SECURITY.md), incluindo autenticação administrativa e uploads dentro das cotas. Não há endpoint de sincronização publicado.
4. Só então migrar os dados com backup, configurar os segredos na plataforma e validar revogação, reenvio e expiração com o computador desligado.
