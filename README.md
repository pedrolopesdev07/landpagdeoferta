# lopesdapromoção

Funil em React + Tailwind CSS: VSL em vídeo na entrada e vitrine de ofertas depois. O servidor Python mantém o painel, os uploads e a integração com OfertaBot.

## Fluxo VSL → vitrine

A página principal começa com `media/vsl-web.mp4`, a cópia otimizada para publicação com aproximadamente 4,6 MB, resolução 720 × 1280 e duração de 188,7 segundos. O arquivo original `criativo-pedro-e-lucas-4k-legendado.mp4` foi preservado. O servidor Python suporta HTTP Range. O player não apresenta controles para avançar e acompanha o progresso antes de liberar o botão final.

O vídeo tenta iniciar com som. Se o navegador bloquear o autoplay, o visitante toca em **Assistir com som**. Ao receber o evento real de término do vídeo, uma tela preta ocupa todo o navegador e exibe somente **CLICA AQUI**. Pausar o vídeo não exibe esse botão.

Ao clicar, o visitante entra na vitrine em `/#loja`, com busca, filtros por marketplace, ordenação e carregamento de mais produtos. Cada produto abre as opções de compra na loja e entrada direta no grupo vinculado à oferta. É possível voltar à apresentação pelo botão Ver vídeo. Atualizar a página em `/#loja` mantém a vitrine; a entrada sem fragmento abre a VSL.

`/api/catalog` entrega todas as ofertas válidas disponíveis na janela da API do OfertaBot, sem o antigo corte de 30. O upstream atual fornece os últimos 100 registros da fila: a vitrine ainda não recupera publicações anteriores a essa janela. Os produtos são carregados em grupos de 12 na interface. As atualizações ocorrem a cada minuto, não por transmissão instantânea. `/api/offers` mantém o limite de 30 para compatibilidade.

Se o vídeo não carregar, aparece uma opção de tentar novamente. Os componentes dos carrosséis anteriores continuam disponíveis no código e nos testes, mas a entrada atual é a VSL e o catálogo usa uma grade. As regras da VSL são de interface e o catálogo público admite acesso direto.

## Executar

Ao baixar o repositório, banco, uploads, backups e configurações locais precisam ser criados na própria máquina. Para conectar o OfertaBot local, copie `integration.example.json` para `integration.json` e ajuste a URL. Esse arquivo local é ignorado pelo Git. Sem configuração, a integração permanece desativada e o painel permite cadastrar o conteúdo manualmente.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm.cmd install
npm.cmd run build
$env:PORT='8765'
.\.venv\Scripts\python.exe server.py
```

Página: http://localhost:8765 — admin: http://localhost:8765/admin.

A senha existente é preservada. Em um banco novo, configure a senha em terminal interativo com `.\.venv\Scripts\python.exe manage_site.py password`. `ADMIN_PASSWORD` também permite inicializar um banco novo, mas não altera uma senha já cadastrada. Senhas não são impressas. Sessões duram oito horas e terminam ao reiniciar o processo.

Para desenvolver, mantenha o servidor Python na porta 8765 e execute `npm.cmd run dev`. O Vite encaminha API e imagens ao Python. Execute `npm.cmd run build` após mudanças para atualizar a versão servida pelo Python.

## Arquivos

- `src/main.jsx`: componentes React, carrosséis, filtros e janela de ofertas.
- `src/styles.css`: Tailwind, fonte local, componentes e layout responsivo.
- `src/lib.js`: validação de links e limite de cards.
- `src/data/hero.json`: três produtos fixos da abertura; fotos em `dist/assets`.
- `src/data/offers.json`: ofertas manuais de exemplo.
- `public/admin.html`, `public/admin.js`, `public/admin-extras.js`, `public/admin-groups.js`, `public/admin.css`, `public/style.css`: fontes do painel, copiadas ao build.
- `dist/index.html` e `dist/ui`: resultado do build; não edite manualmente.
- `data/content.sqlite3`: configurações, grupos, ofertas, avaliações e hash da senha.
- `data/uploads`: prints enviados pelo admin e os sete prints originais, servidos em `/uploads/`.

O build copia o painel de `public` e substitui os artefatos gerados. O prebuild preserva uploads antigos em `data/uploads` antes dessa substituição. Faça backup do banco e das imagens. Grave textos em UTF-8; evite enviar textos acentuados por pipelines de terminal que usem outra codificação.

Os comandos de backup, troca de senha, limpeza de imagens e os critérios de produção estão em [SECURITY.md](SECURITY.md). O desenho da hospedagem gratuita e da sincronização está em [SYNC_SECURITY.md](SYNC_SECURITY.md). A implementação do Worker e a preparação da implantação estão em [CLOUDFLARE.md](CLOUDFLARE.md). A publicação depende da autenticação na conta e da validação do banco e da migração remota.

## Carrosséis

Ambos começam automaticamente por temporizadores explícitos (abertura: 3,6 segundos; principal: 3,8 segundos), aceitam arraste com toque ou mouse e clique nos produtos. A vitrine inicial não tem botões de navegação. O movimento pausa durante o arraste, a janela de ofertas ou quando a vitrine está fora da tela. Com movimento reduzido, a troca automática continua a cada seis segundos, sem transição animada. As setas do teclado também permitem explorar.

A abertura mostra as cinco primeiras ofertas da mesma lista usada pelo carrossel principal. Seus preços, fotos e links são renovados junto com o feed. As mini-ofertas flutuantes usam essa mesma seleção. O arquivo `src/data/hero.json` permanece apenas como referência histórica e dados de testes.

O carrossel principal mostra no máximo 30 ofertas válidas, sem duplicatas. As mais recentes substituem as antigas. O visitante escolhe entre abrir o link afiliado e conhecer os grupos. Quando um destaque histórico não tem link válido, a primeira opção leva às ofertas recentes.

O admin gerencia grupos, textos, ofertas manuais, prints e avaliações reais. A seção de avaliações só aparece quando há comentários cadastrados.

### Prévia dos grupos e ocupação

Em cada grupo no admin, envie uma foto real (ou informe sua URL) e preencha participantes atuais e capacidade. O nome cadastrado e a foto aparecem no card. Sem foto, usa-se a inicial do nome. A barra mostra porcentagem ocupada, porcentagem livre e vagas restantes somente quando os dois números são válidos. O aviso de poucas vagas aparece a partir de 90% de ocupação, enquanto ainda existem vagas. Esses dados são informados manualmente pela administração; não há sincronização automática da quantidade de membros com o WhatsApp. Não são inventados números de participantes nem escassez.

## Integração com OfertaBot

`integration.json` aponta para `http://127.0.0.1:8000/api/v1`. Deixe `api_url` vazio para desativar; `AFILIADO_API_URL` pode sobrescrever esse valor.

O adaptador apenas consulta `/offers` e `/whatsapp/queue`, cruza registros `sent` e preserva os links afiliados. A API atual retorna os últimos 100 registros da fila. Não há captura de conversas nem de mensagens manuais fora do bot. O registro de envio não é confirmação independente de recebimento no aparelho.

As consultas ocorrem a cada minuto. Em falhas breves, o cache dura até cinco minutos; depois entram as ofertas manuais. Dados privados, comissões e credenciais não são retornados na API pública. Links fora do prazo são excluídos; sem data de geração disponível, o prazo usa o envio como aproximação. Confira preço e estoque na loja.

Em produção autenticada, configure `AFILIADO_ACCESS_TOKEN` no ambiente do servidor com uma sessão autorizada. Ele não chega ao navegador. Para hospedar fora do computador, o backend precisa de endereço HTTPS acessível ao servidor. Não exponha o backend em modo de desenvolvimento.

O servidor da landing precisa de disco persistente e proxy HTTPS em produção. Configure `HOST`, `PORT` e `COOKIE_SECURE=1` conforme a hospedagem. A pasta `data` deve permanecer privada. A publicação externa ainda não foi configurada.

## Verificar

```powershell
npm.cmd test
npm.cmd run build
.\.venv\Scripts\python.exe -m unittest test_security test_affiliate_feed verify_funnel
.\.venv\Scripts\python.exe -O -m unittest test_security test_affiliate_feed verify_funnel
.\.venv\Scripts\python.exe verify_build.py
```

Os testes React usam Embla real, com medidas de layout simuladas no DOM de testes. Verificam reprodução, exploração, clique, retomada e renovação dos cards, sem substituir a inspeção visual. Os testes Python do painel usam banco temporário e preservam os grupos reais.
