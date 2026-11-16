# Projeto de sincronização e hospedagem gratuita

Desenho elaborado em 16 de novembro de 2026. A implementação posterior do Worker e do emissor está descrita em [CLOUDFLARE.md](CLOUDFLARE.md). A publicação e a validação na conta ainda dependem da autorização do Wrangler. A versão Python continua disponível localmente. As seções abaixo registram o desenho e os critérios de aceitação originais.

## Limites verificados na documentação oficial

| Serviço | Cota relevante |
| --- | --- |
| Pages gratuito | 25 MiB por arquivo, 20000 arquivos por site, 500 builds/mês e um build simultâneo |
| Workers gratuito | 100000 requisições/dia por conta, 10 ms de CPU por invocação, 128 MB de memória |
| D1 gratuito | 10 bancos, 500 MB por banco, 5 GB por conta |
| D1 consultas gratuitas | 5 milhões de linhas lidas/dia, 100000 linhas escritas/dia |
| D1 por linha/BLOB | Até 2 MB |
| D1 recuperação gratuita | Time Travel por sete dias |

O número de linhas por tabela não tem uma cota numérica separada, mas continua limitado pelo armazenamento e pelas operações diárias. Leituras de varredura contam as linhas examinadas. Os limites diários podem interromper consultas até o próximo ciclo, sem apagar os dados.

Pages não documenta nessa página um limite próprio em bytes para o repositório Git. O limite aplicável ao provedor do repositório deve ser verificado quando ele for escolhido. O máximo por arquivo publicado é independente disso. Guarde backups, banco, uploads e segredos fora do repositório e do pacote público.

Fontes consultadas

- [Limites do Pages](https://developers.cloudflare.com/pages/platform/limits/)
- [Limites do Workers](https://developers.cloudflare.com/workers/platform/limits/)
- [Limites do D1](https://developers.cloudflare.com/d1/platform/limits/)
- [Preços e cotas do D1](https://developers.cloudflare.com/d1/platform/pricing/)
- [Aplicação dos limites diários do D1](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)

## Arquitetura proposta

Um processo separado, mantido no repositório da landing, consulta o adaptador de leitura local e envia um snapshot sanitizado por HTTPS para uma rota restrita do Worker. Não é necessário editar o OfertaBot ou publicar sua API inteira na internet. O processo local terá apenas o acesso de leitura que a API existente autorizar.

O frontend estático é publicado no Pages. O Worker disponibiliza conteúdo público e recebe o catálogo assinado. O D1 guarda o conteúdo administrativo, a última versão do catálogo e recibos de sincronização. O snapshot persiste quando o computador local desliga, mas as ofertas deixam de aparecer quando vencem. A interface deve exibir a data da última sincronização.

A credencial de sincronização só autoriza substituir o catálogo derivado de leitura. Ela não autoriza editar convites, senha, configurações administrativas, publicar mensagens ou operar marketplaces.

## Contrato de sincronização

- Rota proposta `POST /api/sync/catalog`, corpo máximo de 512 KiB, até 100 ofertas por snapshot, versão explícita do schema.
- JSON UTF-8, campos permitidos e limites em cada campo. Proibir propriedades desconhecidas, valores não finitos, chaves duplicadas e payloads parcialmente aceitos.
- Publicar somente id de oferta, título, preço, desconto, URL de imagem aprovada, link afiliado aprovado, marketplace, datas e identificador público de grupo. Excluir credenciais, comissão e mensagens.
- Usar identificador estável do destino quando o upstream o disponibilizar. Durante a transição, resolver o nome para um id cadastrado e rejeitar correspondências ambíguas. Não inferir grupo por posição na lista.
- Datas em UTC, `published_at` no passado dentro da tolerância, `expires_at` posterior à publicação e limitado pelas regras da aplicação. O servidor hospedado deve aplicar a validade independentemente do emissor e do navegador.
- Não seguir redirecionamentos ao validar links nem buscar URLs de imagem arbitrárias no servidor. Validar a sintaxe e o host dos links afiliados preservando seus parâmetros.

## Assinatura, repetição e idempotência

Gerar um segredo aleatório de pelo menos 32 bytes por emissor. Mantê-lo em armazenamento local protegido e no mecanismo de secrets do Worker. O frontend, o Git, o SQLite público e os logs não recebem esse segredo. Usar um identificador de chave público para permitir rotação.

Assinar com HMAC-SHA-256 uma representação canônica contendo versão, método HTTP, caminho exato, key id, timestamp UTC, nonce, id de operação e SHA-256 dos bytes exatos do corpo, separados por quebras de linha. Conferir o formato antes de verificar a assinatura e usar comparação de tempo constante.

Aceitar desvio de relógio de até cinco minutos. O nonce deve ter pelo menos 128 bits aleatórios e ser registrado de forma única por chave. Expirar os registros de nonce depois da janela de repetição, mantendo margem de dez minutos. Um relógio muito incorreto gera erro explícito sem publicar dados.

Cada operação recebe UUID e digest do payload. Reenvios usam o mesmo UUID e payload, mas novo timestamp, novo nonce e nova assinatura. Uma operação já aplicada com o mesmo digest retorna sucesso idempotente. O mesmo UUID com outro digest é rejeitado. Um nonce repetido é rejeitado.

Atualizar snapshot, recibo e número sequencial em uma transação atômica. Proteger a atualização contra corridas e snapshots fora de ordem, usando sequência monotônica por emissor e atualização condicionada ao estado anterior. Testar explicitamente duas requisições simultâneas, falha após commit e retry.

Guardar o snapshot inteiro em uma linha com JSON de até 512 KiB, abaixo do limite de linha do D1. Evitar regravar cem linhas por minuto, o que poderia exceder 100000 escritas diárias. Guardar recibos compactos, sem repetir o catálogo em cada recibo, com retenção limitada. Medir as escritas de índices e a limpeza na cota real.

## Limites e recuperação

- Uma sincronização por minuto em operação normal. Limite por credencial de cinco tentativas por minuto e limite global independente antes de trabalho caro.
- Retry com atraso exponencial, jitter e teto de cinco minutos. Preservar a última versão confirmada no emissor e no receptor.
- Resposta de confirmação inclui operação, versão e horário de aplicação. Não tratar timeout como prova de falha antes de consultar ou reenviar idempotentemente.
- Revogação imediata por key id. Na rotação, aceitar duas chaves por período curto, atualizar o emissor e remover a anterior. Invalidar nonces e autorizações da chave revogada.
- Logs registram resultado, id de operação, key id e horário, sem corpo, assinatura ou segredos. Aplicar retenção e acesso administrativo.
- Cache público curto, com expiração que respeite a oferta de vencimento mais próximo. A API sempre remove ofertas vencidas antes de responder. Fallback manual também precisa de validade e origem claramente exibidas.

## Mídia e painel administrativo

O vídeo atual tem aproximadamente 59 MB e excede 25 MiB. A primeira opção é gerar uma cópia otimizada de até 24 MiB, preservando o original e conferindo duração, áudio, legibilidade das legendas, orientação e reprodução em celular. Só trocar o caminho após aprovação visual. Dividir uma requisição em ranges não torna um arquivo grande compatível com a cota por arquivo do Pages.

Se a compressão não mantiver qualidade suficiente, será necessário avaliar armazenamento ou vídeo externo e verificar gratuidade, exigência de pagamento, políticas de uso e preservação da experiência sem controles. Não há serviço de mídia contratado ou configurado nesta revisão.

O hash scrypt, o processamento Pillow e o servidor Python não podem ser transportados diretamente para Workers com garantia de caber em 10 ms. Antes de concluir a migração, escolher uma autenticação administrativa adequada ao runtime e medir seu custo, mantendo proteção forte da senha ou um provedor de identidade confiável. Não enfraquecer o hash para cumprir a cota.

O fluxo de upload do painel hospedado precisa de solução validada de processamento e persistência. Não publicar um endpoint que aceite imagens sem verificação para contornar a cota. D1 tem limite de 2 MB por BLOB e 500 MB por banco, o que também restringe imagens. Armazenamento de objetos externo depende da conta e das condições vigentes. A equivalência completa do painel em uma conta gratuita ainda não foi demonstrada.

## Critérios antes de publicar

1. Medir HMAC, parsing, schema, autenticação administrativa e uploads dentro da cota de CPU e memória real.
2. Confirmar cotas e requisitos da conta escolhida e validar um vídeo abaixo do limite.
3. Testar assinatura errada, nonce repetido, timestamp vencido, retry idempotente, UUID conflitante e reordenação concorrente.
4. Testar key id revogado e comprovar que a chave de sync não modifica conteúdo administrativo.
5. Comprovar ausência de segredos no bundle e nas respostas e filtragem de dados privados do upstream.
6. Desligar o emissor local e verificar que o catálogo permanece acessível, mostra a última atualização e remove ofertas vencidas.
7. Fazer backup antes de importar SQLite no D1, ensaiar restauração e preservar os convites e links afiliados.
8. Medir leituras/escritas e testar comportamento ao atingir a cota gratuita, com mensagem clara e recuperação automática após o ciclo.

Esses critérios descrevem a implementação futura. Nenhuma chave ou rota de sincronização foi criada nesta etapa.
