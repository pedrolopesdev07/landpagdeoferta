# Implantação na Cloudflare

O erro observado no painel foi `Asset too large`. O vídeo original tem 55,9 MiB, acima do limite de 25 MiB por asset. A versão `media/vsl-web.mp4` tem 4,6 MB, resolução 720 × 1280, áudio e duração de aproximadamente 188,7 segundos. O original foi preservado. O frontend já usa a cópia otimizada e o pacote passou na validação local do Wrangler.

## Componentes

- `wrangler.jsonc` configura o Worker `landpagdeoferta`, assets e binding D1 `DB`.
- `cloudflare/worker.js` implementa conteúdo, catálogo, autenticação, sessões, CSRF, uploads e sincronização assinada.
- `cloudflare/validation.js` valida schemas, campos extras, URLs, duplicação de chaves JSON e profundidade.
- `cloudflare/schema.sql` cria as tabelas com operações idempotentes.
- `cloudflare/manage_deploy.py` prepara o material privado de migração, grava secrets pela ferramenta oficial e migra o conteúdo aprovado do painel.
- `sync_catalog.py` consulta somente as APIs locais de leitura e envia snapshots por HTTPS. A credencial fica em `data/cloudflare-sync.json`, ignorada pelo Git.
- `cloudflare/install_sync_task.ps1` instala a execução a cada minuto no Windows após a sincronização real ter sido validada.

O painel hospedado preserva o formato scrypt da senha existente usando a API criptográfica nativa do Worker. O hash é configurado como secret do Worker, sem entrar no código público ou no D1. Sessões são persistidas no D1 como hashes de tokens, com validade de oito horas e revogação no logout.

Os uploads do painel hospedado aceitam arquivos selecionados de até 5 MB. O navegador prepara uma cópia PNG de até 512 pixels por lado. O Worker limita o fluxo descomprimido, decodifica, verifica CRC e regrava somente os pixels. O PNG resultante fica no D1, com cota de 500 arquivos e 100 MB. A API Python local mantém seu processamento Pillow. Imagens de 512 pixels priorizam os cards e fotos do grupo dentro do orçamento gratuito.

## Autorização e provisionamento

Use a conta proprietária já selecionada no painel da Cloudflare. A autenticação do GitHub não autentica o Wrangler. O login do Wrangler exige concluir a autorização oficial no navegador.

```powershell
npm.cmd ci
npx.cmd wrangler login
npx.cmd wrangler whoami
```

Antes de alterar dados, faça backup com `.\.venv\Scripts\python.exe manage_site.py backup`. Confira se já existe um D1 destinado a esta landing. Se existir, confirme o identificador e exporte um backup antes de reutilizá-lo. Se não existir, crie o banco e use o identificador retornado pela plataforma, sem substituir um banco de outro projeto.

```powershell
npx.cmd wrangler d1 list
npx.cmd wrangler d1 create landpagdeoferta --binding DB --update-config
npx.cmd wrangler d1 execute landpagdeoferta --remote --file cloudflare/schema.sql
.\.venv\Scripts\python.exe cloudflare/manage_deploy.py prepare
npm.cmd run deploy
.\.venv\Scripts\python.exe cloudflare/manage_deploy.py secrets
```

`prepare` grava o material sensível somente em `data/cloudflare`. O comando `secrets` envia os valores por stdin ao Wrangler e suprime sua saída. Não copie essa pasta para o Git, para assets ou para conversas. O login administrativo usa a senha já existente, sem exigir que ela apareça em comandos.

O deploy imprime o endereço HTTPS efetivamente publicado. Use esse endereço confirmado na migração, em vez de adivinhar um subdomínio.

```powershell
.\.venv\Scripts\python.exe cloudflare/manage_deploy.py seed --url https://ENDERECO-CONFIRMADO
.\.venv\Scripts\python.exe sync_catalog.py
```

`seed` migra conteúdo somente se ainda não houver conteúdo remoto. As imagens referenciadas são enviadas pela API autenticada, os caminhos são ajustados e a sessão temporária de migração é revogada. As imagens locais permanecem preservadas. Mapeamentos de migração ficam em `data/cloudflare` para permitir retomada. Não reutilize esses mapeamentos para um banco diferente.

Depois de confirmar o catálogo remoto e testar uma atualização real, instale a tarefa do Windows.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File cloudflare/install_sync_task.ps1
```

O processo usa o usuário conectado e `pythonw.exe`, sem janela e sem armazenar senha do Windows. O status local fica em `data/cloudflare-sync-status.json`. Com o computador ou OfertaBot desligado, o site mantém o último snapshot e remove ofertas vencidas. A interface mostra o horário do snapshot quando a atualização fica antiga.

## Verificação

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:cloudflare
.\.venv\Scripts\python.exe -m unittest test_security test_affiliate_feed verify_funnel test_sync_catalog
```

Os testes do Worker usam o runtime local da Cloudflare e D1 descartável. Cobrem autenticação, cookies, CSRF, imagens, cota, assinaturas, replay, idempotência, conflitos concorrentes e expiração. Eles não demonstram o tempo de CPU real no plano gratuito. Após publicar, confirme o login e o processamento de imagens na conta real e examine as métricas de CPU antes de considerar a migração concluída.

O limite gratuito continua dependendo das cotas da conta. Não altere o plano para pago sem uma nova autorização do proprietário.

## Implantação verificada

Publicado em 16 de novembro de 2026 em [landpagdeoferta.pedrolopesdev07.workers.dev](https://landpagdeoferta.pedrolopesdev07.workers.dev). O painel fica em `/admin` e usa a mesma senha administrativa local. O banco D1 está associado ao binding `DB` em `wrangler.jsonc`. A senha não está no repositório e os secrets permanecem no armazenamento protegido do Worker.

- Dois grupos, sete ofertas manuais e sete imagens foram migrados. O banco e as imagens locais foram preservados.
- O primeiro catálogo assinado e as execuções seguintes responderam com sucesso. O catálogo tinha 52 ofertas na verificação.
- A tarefa `LopesPromocao-CatalogSync` foi instalada no Windows. Sua execução terminou com resultado 0 e o número sequencial do catálogo avançou automaticamente.
- Página, painel, conteúdo, catálogo e imagem migrada responderam com HTTP 200. O cookie CSRF apresentou Secure. Login sem CSRF retornou 403, senha deliberadamente incorreta com CSRF retornou 401 e tentativa de escrita sem sessão retornou 401.
- Dezessete testes de interface, nove testes do Worker e 27 testes Python passaram. O empacotamento do Wrangler foi aprovado e o vídeo publicado está abaixo de 25 MiB.
- A leitura de acessibilidade no Edge confirmou a VSL, as logos e a vitrine com os grupos e links diretos corretos. A ferramenta de captura de tela e clique falhou por falta de geometria, portanto a reprodução completa da VSL e a inspeção visual mobile não foram confirmadas por essa automação. A conclusão do vídeo e os cliques são cobertos pelos testes de interface.
- O identificador padrão de requisições do Python recebeu 403 neste endereço. Os processos de implantação e sincronização usam identificadores próprios da aplicação, verificados com HTTP 200.

Nenhum plano pago foi ativado. As cotas gratuitas da Cloudflare continuam se aplicando. Com o computador desligado, a página e o painel permanecem hospedados, enquanto novas ofertas aguardam a próxima execução local. As ofertas vencidas são filtradas pelo Worker.
