# Catálogo Político

Aplicação React com API Express, PostgreSQL e importação dos Dados Abertos da Câmara. Prisma versiona o banco; as consultas da API usam SQL pelo pacote pg.

## Execução local no Windows

Requisitos: Node.js 22, npm e PostgreSQL 16 (ou Docker Desktop).

1. Execute `npm ci`.
2. Copie `.env.example` para `.env` e configure banco e token administrativo.
3. Execute `npx prisma migrate deploy` para preparar o banco configurado.
4. Em terminais separados, execute `npm run api:dev` e `npm run dev`.
5. Abra http://localhost:3000. A API usa a porta 4000.

Em `/admin`, informe o valor de `ADMIN_API_TOKEN` configurado no `.env` usado pela API. O painel valida o token no servidor antes de liberar as operações e guarda o acesso apenas na sessão da aba. Se o token estiver incorreto ou for alterado no servidor, uma resposta `401` encerra esse acesso e apresenta novamente o formulário com uma mensagem. Entre com o token atual e acione a operação desejada; limpeza e ingestão não são repetidas automaticamente após o novo login.

Exemplo de banco local em Docker, somente para desenvolvimento:

```powershell
docker run --detach --name catalogo-db --publish 127.0.0.1:5434:5432 --env POSTGRES_USER=app --env POSTGRES_PASSWORD=app --env POSTGRES_DB=app postgres:16-alpine postgres -c shared_preload_libraries=pg_stat_statements
```

Defina `DATABASE_URL=postgresql://app:app@localhost:5434/app?schema=catalogo&options=-c%20search_path%3Dcatalogo%2Cpublic` no `.env`. Para subir os três serviços de desenvolvimento (`app`, `api` e `db`), use `docker compose up --build`; nesse caso o Compose configura o endereço interno do banco e aplica migrations na API.

## Validação

```powershell
npm run lint
npm test
npm run build
# Use um banco de teste dedicado, com as migrations aplicadas.
$env:TEST_DATABASE_URL='postgresql://app:app@localhost:5434/app_test?schema=catalogo&options=-c%20search_path%3Dcatalogo%2Cpublic'
npm test
```

Com `TEST_DATABASE_URL`, os testes de contrato usam schemas descartáveis em um banco de teste dedicado e já migrado. O banco precisa estar separado da aplicação em uso: os testes também exercitam bloqueios globais do PostgreSQL, que não são isolados apenas por schema. Nunca configure essa variável com um banco de produção. Sem ela, os testes PostgreSQL aparecem como ignorados. O CI sobe um PostgreSQL isolado e executa também esses testes. A URL de teste pode selecionar o schema da aplicação com `schema=catalogo`; as fixtures continuam isoladas em schemas descartáveis.

## Contratos e operação

- Despesas: a API retorna `items`, `total`, `totalValor`, `tiposDisponiveis` e `hasMore`. Os totais refletem todo o resultado filtrado. A competência é mês/ano; não representa data do pagamento.
- As avaliações usam CPF digitado e hash para deduplicação. Não há autenticação Gov.br ou comprovação de titularidade implementada.
- Importação, enriquecimento e limpeza compartilham um bloqueio de sessão no PostgreSQL. Cancelar um checkpoint solicita parada cooperativa; a limpeza aguarda o processo efetivamente terminar.
- IA: chave apenas em `GROQ_API_KEY`; modelo/habilitação são resolvidos a partir de `app_settings`, com fallback de modelo em `GROQ_MODEL`.
- Logs do Admin apresentam uma janela recente limitada por bytes, evitando ler arquivos inteiros a cada atualização.
- O Admin aciona a API, que inicia um subprocesso Node para `src/ingest-agent.ts`. O worker consulta a Câmara e grava dados e checkpoints no PostgreSQL; o painel acompanha checkpoints e logs. Esse fluxo não depende de n8n e não há uma nova agenda automática de importações.
- O arquivo `UPSERT NOTICIAS.json` permanece versionado como integração de notícias preparada e inativa. A inspeção local de 28/10/2026 encontrou zero workflows no n8n. Notícias não são publicadas na interface atual; retirar o serviço ocioso não migra uma funcionalidade ativa.

## Ingestão em lotes e retomada

Despesas novas agrupam até 12 tarefas mensais pendentes do mesmo deputado, ano e legislatura em consultas com `mes` separado por vírgulas, até 100 itens por página. O coletor mantém o limite global de uma requisição por segundo, dois workers e cooldown compartilhado após limitação da fonte. As páginas são consultadas fora da transação; uma única transação curta grava os documentos, os lançamentos originais e a conclusão de cada mês. A resposta precisa informar a competência de cada lançamento e pertencer ao grupo solicitado. Falha ou cancelamento antes da confirmação desfaz o grupo inteiro; a tentativa seguinte começa pela primeira página. O limite é de 200 páginas ou 20 mil lançamentos por grupo, sem concluir silenciosamente uma resposta maior.

Tarefas com páginas mensais já confirmadas continuam pelo caminho mensal: domínio, evidência bruta, contagem e cursor `progress_json` são confirmados juntos em cada página. Se uma página falhar, a retomada começa na primeira página ainda não confirmada. Meses concluídos não entram nos grupos novos. Janeiro e os demais meses de um ano de troca de legislatura são consultados em grupos diferentes. Para usar somente o caminho mensal, execute o worker com `--expense-batch-months=1`; o padrão é 12.

Reabrir tarefas falhadas ou canceladas pelo Admin preserva as páginas confirmadas e reinicia as tentativas. A retomada normal preserva também os períodos concluídos sem itens. Para reconsultá-los, marque explicitamente “Reconsultar períodos já concluídos sem registros” no Admin, envie `reprocessEmpty: true` para a API ou use `--reset-empty` no worker. Um cursor final já confirmado permite concluir uma retomada sem repetir as chamadas HTTP. A retomada pressupõe que a paginação da fonte para aquele parlamentar/período não seja reordenada entre tentativas; não substitui uma coleta futura de reconciliação de períodos alterados na origem.

Despesas e registros brutos idênticos não são regravados; alterações financeiras, estornos e mudanças de metadata continuam sendo persistidos. No arquivo bruto, `fetched_at` e `updated_at` passam a indicar a persistência da versão observada de conteúdo/metadata, e não cada consulta repetida sem alteração. Para despesas, o horário de progresso/consulta confirmada está no `updated_at` do checkpoint. As cópias históricas e os índices existentes são preservados.

As tarefas de despesas são semeadas em lotes de até 1.000, sem atualizar checkpoints que não precisam ser reabertos. Recursos genéricos também são consumidos página por página, sem acumular a coleção inteira antes de gravar. O timeout HTTP de 45 segundos começa depois de obter o slot da fila; o limite de chamadas e os retries continuam ativos. Falhas reais de detalhe deixam a tarefa falhada para retomada, em vez de substituir informações completas por um resumo.

A migration aditiva `20261028173000_ingestion_page_progress` deve ser aplicada antes de executar o worker atualizado. Ela acrescenta o cursor sem reescrever os dados coletados; o Compose aplica migrations no início da API. Para voltar ao worker anterior, mantenha a coluna adicional e restaure a versão do código — a coluna extra é ignorada por essa versão.

A migration `20261029200000_ingestion_ordered_queue` acrescenta um índice parcial para selecionar tarefas pendentes na ordem de execução, sem modificar registros importados. A aplicação local foi precedida por backup do banco e conferência de contagens e valores.

## n8n legado e reversão

O Compose padrão não inicia n8n. A retirada preserva o volume `indice-politico-online_n8n_data`, as tabelas do n8n no schema `public` e o arquivo de notícias. O catálogo usa o schema `catalogo` no banco `app`; o n8n legado usa `public` nesse mesmo banco. Schemas não são bancos separados. Testes usam outro banco, como `app_test`, conforme a seção de validação.

Para recuperar apenas o serviço legado, com o banco original já em execução, use a composição opcional:

```powershell
docker compose -p indice-politico-online -f docker-compose.yml -f docker-compose.n8n-legacy.yml config --services
docker compose -p indice-politico-online -f docker-compose.yml -f docker-compose.n8n-legacy.yml up -d --no-deps n8n
```

Esse comando reutiliza o projeto e o volume existentes, conecta ao banco `app` do serviço `db` e expõe `http://localhost:5679` (ou a porta anterior em `N8N_HOST_PORT`). Preserve a mesma `N8N_ENCRYPTION_KEY` do `.env` anterior para recuperar credenciais; as variáveis legadas podem permanecer no `.env` sem efeito sobre a ingestão nativa. O volume é externo: a reversão falha se ele não existir, evitando iniciar com um volume vazio por engano. Não use `down -v`, exclusão de volume ou limpeza de `public` para essa transição. Caso o workflow seja importado futuramente, configure sua conexão PostgreSQL com `search_path=catalogo,public`; sua ativação é uma etapa separada.

## Produção

O Dockerfile possui os alvos `production` (interface Nginx) e `api-production` (API). Construa-os explicitamente com `--target`. O Nginx usa `nginx.conf`, encaminha `/api/` ao serviço `api:4000` e mantém as rotas React ao atualizar uma URL diretamente. Os dois containers precisam compartilhar uma rede com o nome DNS `api`.

Configure banco, token forte e chaves pelo ambiente. O Compose incluído é de desenvolvimento. A disponibilização pública, domínio/TLS e configurações do provedor são etapas de implantação separadas.

Os scripts shell são versionados com LF. O entrypoint é instalado fora de `/app`, para que a montagem da pasta Windows não substitua o inicializador Linux.

## Atualização automática do catálogo

Ranking e destaques/novos cadastros da página inicial recebem avisos do backend sem recarregar a página. A aplicação usa PostgreSQL LISTEN/NOTIFY e uma conexão SSE compartilhada por aba; as consultas normais continuam sendo a fonte dos dados. Apenas transações confirmadas disparam os eventos. Alterações em políticos, despesas, votos e avaliações atualizam as consultas afetadas.

O card Despesas do ranking soma todos os parlamentares encontrados pelo filtro, usando o campo `totalDespesas` da API antes da paginação. Trocar ordenação ou carregar mais resultados não muda o conjunto somado. Alterar filtros ou importar novos lançamentos pode atualizar o valor; ele representa as despesas já presentes na base local.

O ranking aceita ano e intervalo inclusivo de meses para despesas. O período financeiro não limita as avaliações populares nem as votações. O indicador de cobertura usa consultas mensais concluídas, vazias, pendentes e falhadas; a ausência de consulta não é interpretada como gasto zero. Parlamentares históricos sem consultas no intervalo continuam explicitamente sem cobertura, mesmo quando a fila programada foi concluída.

No perfil, lista, distribuição por categoria/fornecedor, resumo e média mensal compartilham ano, mês, categoria, faixa de valores e fornecedor. A média informa quantos parlamentares possuem registros no filtro em cada mês. Registros agregados com vários fornecedores são apresentados em segmentos derivados dos lançamentos originais, sem regravar o histórico: os IDs da listagem são chaves opacas, podendo incluir o fornecedor. Fornecedores sem documento identificador são agrupados pelo nome informado. Links de documento pertencem ao próprio segmento; a ausência de um link único é preservada. Estornos continuam negativos.

A migration aditiva `20261030010000_expense_source_identity` permite importar lançamentos identificáveis sem código oficial de documento. `cod_documento` permanece nulo e o payload original é preservado. Uma identidade técnica versionada, calculada a partir de referência, emissor, tipo documental e parcela, permite repetir ou corrigir a importação sem duplicar valores. A migration não reescreve os documentos anteriores.

Os avisos são agrupados e as recargas respeitam um intervalo mínimo de 1,6 segundo por página, sem sobreposição. Filtros, extensão carregada e rolagem do ranking são preservados. Abas ocultas pausam as recargas e reconciliam ao voltar. Quedas de conexão provocam reconexão; o fallback consulta somente a revisão do catálogo a cada 30 segundos.

A migration `20261028160000_catalog_live_events` instala os triggers no mesmo schema da aplicação. `nginx.conf` desativa buffering/cache/compressão para `/api/catalogo/events`. Outros proxies precisam permitir streaming e manter a conexão aberta. Os eventos indicam mudanças no banco local; não significam sincronização instantânea com a Câmara antes da importação.

## Condenações e histórico de prisões

Condenações e prisões são atributos de cada político, exibidos junto com os gastos no ranking parlamentar. A opção **Condenações** em **Comparar por** (`/ranking?metrica=condenacoes`) ordena casos com condenação definitiva verificada, por categoria. Criminal é a categoria inicial; improbidade, eleitoral e contas públicas são apresentadas separadamente. Decisões sujeitas a recurso têm contagem própria; anuladas/revertidas permanecem no histórico e deixam de contar. Prisões efetivamente confirmadas permitem filtrar perfis e consultar motivo, modalidade, fundamento, datas e desfecho; não acrescentam pontos à contagem de condenações. Um mandado pendente não comprova prisão. A nota popular mantém sua regra. Links antigos `view=judicial` passam à apresentação integrada.

No perfil, os atributos judiciais ficam visíveis junto aos indicadores, e os detalhes estão na **Visão Geral**, em `/politico/:id#historico-judicial`. Links antigos `?tab=judicial` continuam abrindo esses detalhes. O comparador também apresenta condenações e prisões. Ausência de pesquisa aparece como desconhecida, e pesquisa sem resultados se refere somente ao escopo e às fontes consultadas. Nunca é exibida como prova de que alguém jamais foi preso. Perfil, comparação e ranking usam a mesma regra de contagem e acompanham o fluxo de atualização do catálogo. A categoria selecionada, os recursos, as prisões e a cobertura acompanham a exportação CSV do ranking.

A alimentação fica em **Admin → Judicial**, com a autenticação administrativa existente. A coleta extrai os dados demonstrados nas fontes e publica automaticamente os casos identificados, sem formulário ou revisão obrigatória. Notícias do mesmo político, tribunal, processo e tipo de fato são consolidadas, com fontes reunidas. **Atualizar dados dos documentos coletados** reprocessa o acervo já salvo. Cadastro manual, documentos e diagnóstico permanecem como ferramentas opcionais fechadas inicialmente. O histórico administrativo registra antes/depois em transação; evidências de identidade, notas internas e documentos candidatos não são expostos nas APIs públicas.

A pesquisa automática usa fontes oficiais sem credencial privada: **STF**, acervo WordPress REST em `https://noticias.stf.jus.br/wp-json/wp/v2/posts`, e **STJ**, RSS em `https://res.stj.jus.br/hrestp-c-portalp/RSS.xml`. No STF são consultados nome civil e nome parlamentar compostos; no STJ o feed recente é baixado uma vez por execução. A seleção exige trecho explícito de condenação atribuída ao próprio político, prisão cumprida ou atualização de condenação identificada. Denúncias, pedidos, votos isolados, mandados não cumpridos e fatos de terceiros não viram condenações ou prisões. Processo, tribunal e cargo devem estar vinculados ao fato; trechos de outro processo são rejeitados. A extração é conservadora: fontes ambíguas permanecem no diagnóstico, sem exigir preenchimento pelo usuário. Datas ausentes ficam desconhecidas; a publicação da notícia nunca substitui a data do fato. A implementação funciona sem serviço externo de IA ou chave Groq.

Os perfis apresentam condenações identificadas, definitivas e sujeitas a recurso separadamente. Situação atual desconhecida não significa trânsito em julgado. Anuladas, revertidas e com punibilidade extinta por prescrição ficam no histórico e fora do total identificado; indulto das penas privativas não é tratado como absolvição. Somente definitivas entram na ordenação do ranking existente. O histórico agrupa os fatos pelo tribunal e processo, preservando condenação e prisão como eventos distintos. Execução penal não cria outra condenação. Repetir a consolidação não cria casos ou auditorias idênticas.

Para APs identificadas no STF, o fluxo também consulta as páginas públicas de identificação e andamentos do processo. O adaptador reconhece somente dispositivo colegiado inequívoco de absolvição integral nominal; exige processo exato e nome civil completo. Reversões parciais, pedidos, votos individuais e condenação residual não revertem o caso inteiro. A prova e os hashes dos documentos ficam na auditoria privada. Certidão de trânsito da absolvição não é apresentada como trânsito da condenação. Esse adaptador delimitado não representa acompanhamento processual completo.

Documentos inelegíveis observados novamente só atualizam associações que já existiam; não criam candidatos novos. Uma correção da fonte que retire a evidência preserva novo snapshot, incrementa a versão e impede importar a versão antiga. Isso depende de a fonte voltar a apresentar o documento no escopo consultado; não é monitoramento completo de todos os processos. Na primeira revisão local de 30/10/2026, os 34 candidatos amplos do lote inicial foram descartados com nota, mantendo os documentos originais. Essa primeira revisão antecedeu a carga automática documentada no plano de consolidação.

A API pública DataJud fornece metadados processuais, não descoberta nominal das partes. O BNMP público de mandados pendentes não fornece um histórico nacional completo de prisões cumpridas. Por isso esses portais não são apresentados como conectores de histórico disponíveis. O RSS do STJ cobre somente seu conteúdo atual, e a pesquisa textual do STF não substitui consulta processual/certidão. Não há assinatura de serviço pago, contorno de CAPTCHA ou envio de conteúdo para IA.

**Operação da coleta:** selecionar fontes e situação, iniciar lote (25 políticos e 2 páginas por fonte por padrão; limites 100/5), ou buscar e selecionar um político para coleta individual. A execução guarda seleção, cursor, contadores, falhas, indicação de truncamento e próximo ID do lote. A continuação por ID avança a população; para aprofundar um político com páginas truncadas, pesquisar novamente com limite maior. Não confundir execução concluída com cobertura jurídica completa.

Início usa UUID estável e corpo idêntico para reconciliar resposta incerta. Cancelamento é persistente e conferido antes do checkpoint; retomada explícita reaproveita páginas confirmadas. `PARTIAL` é terminal e informa falhas: iniciar nova coleta para reconsultar as fontes. `FAILED`, `CANCELLED`, `QUEUED` e execução `RUNNING` sem proprietário ativo podem ser retomados. O lock compartilhado com ingestão parlamentar e limpeza impede execução concorrente; perda do lock interrompe o worker e impede que o proprietário antigo sobrescreva a retomada. Paginação do acervo pode mudar entre consultas; repetir a coleta é a forma de reconciliar conteúdo novo.

Documentos são versionados por fonte/identificador/hash, candidatos por pessoa/fonte/identificador. Uma nova versão preserva a evidência anterior. Registros automáticos são reconciliados; se a evidência deixa de sustentá-los, a publicação automática é retirada mantendo a auditoria. Registros explicitamente geridos manualmente são preservados. HTTP usa rotas/hosts fixos, redirects revalidados, limite de 4 MiB por resposta de notícias/RSS e 16 MiB para andamentos, timeout de 20 segundos, até duas tentativas e intervalo mínimo de 1 segundo. RSS rejeita DTD/entidades; HTML vira texto, sem execução. Resposta bloqueada, excessiva, malformada ou incompleta é falha, nunca prova de ausência de antecedentes.

Para uma passagem ampla por todos os políticos cadastrados, execute `docker compose exec -T api npm run ingest:judicial`. O comando coleta as consultas `conden` e `preso` do acervo oficial, associa nomes do catálogo e processa lotes consecutivos de 100 pessoas, incluindo inativos, em ordem numérica. O progresso e os snapshots ficam em `output/judicial-ingestion`; cada conteúdo tem um estado de processamento próprio identificado por SHA-256. Uma nova coleta consulta novamente a fonte. Para retomar páginas já baixadas, use `npm run judicial:collect-archive -- --resume`; para processar o acervo completo salvo, use `npm run judicial:process-archive`. A continuação é automática entre lotes; falha preserva o cursor para retomada. O acervo precisa estar completo antes da publicação. Essas consultas delimitam a cobertura e não representam todo o Judiciário. Não há agendamento automático.

**Processos e cobertura do catálogo:** a ação **Pesquisar todos os deputados** no Admin usa o mesmo worker para consultar a fonte `STF_CASES`, incluindo inativos. A consulta nominal oficial é paginada nas duas partições (em tramitação e fora de tramitação), com até 500 páginas por partição. A busca retorna candidatos amplos; nome civil exato é apenas o primeiro filtro. O vínculo é publicado quando um caso previamente apurado ou contexto nominal parlamentar em fonte oficial confirma a identidade. Associações incertas ficam privadas, sem exigir cadastro manual. Processos publicados apresentam número, CNJ, assunto, participação, situação e fonte no perfil existente.

A opção **Processos** no ranking (`/ranking?metrica=processos&status=todos`) conta casos únicos em que a pessoa figura diretamente como réu/requerido. Autores, testemunhas e posições recursais isoladas não aumentam esse indicador. Investigações e execuções têm contadores próprios e não são condenações. Autuações com o mesmo CNJ são consolidadas; o histórico preserva os números alternativos. Contagem positiva é o mínimo identificado. Zero exige pesquisa concluída no escopo sem vínculos pendentes; falha, truncamento ou ausência de pesquisa não se tornam zero. O CSV e o comparador seguem os mesmos resumos.

Aplicar também `20261030210000_judicial_proceedings`. Ela adiciona observações, tentativas por pessoa/fonte e páginas idempotentes, preservando as tabelas de condenações/prisões. `judicial.proceedings` e `cases` no perfil são aditivos. Estatísticas do catálogo estão em `GET /api/admin/judicial/ingestion/coverage`. A cobertura se refere ao STF público: a busca nominal pode omitir processos sigilosos, inclusive casos acessíveis por número, e não abrange os demais tribunais. A consulta nominal do STJ devolveu desafio HTTP 403 neste ambiente e não é apresentada como conector disponível.

Para executar o mesmo fluxo pela CLI: `docker compose exec -T api npm run judicial:ingest-processes`. Uma execução interrompida usa `-- --resume`. O cursor e o UUID ficam em `output/judicial-ingestion/processes-current-run.json`. Opcionalmente, `npm run judicial:collect-processes -- --nominal-only --resume --interval-ms 1000` prepara cache nominal sem gravar no banco; `judicial:ingest-processes -- --use-cache` permite reutilizá-lo explicitamente. Cache não significa consulta atualizada: os snapshots preservam URL, horário e hash. Por padrão, uma nova pesquisa consulta novamente a fonte. HTTP 403 ou 429 persistente interrompe o lote e preserva o ponto de retomada, sem repetir o bloqueio para todos os deputados. Não há contorno de bloqueios nem agendamento criado por esses comandos.

Aplicar a migration aditiva `20261030030000_judicial_history` antes de usar as novas rotas. Ela cria registros, cobertura e auditoria com restrição de exclusão: a limpeza do catálogo não pode apagar políticos que tenham evidências judiciais associadas. Para reversão da funcionalidade, restaurar o código anterior e preservar essas tabelas. Não há transformação dos dados parlamentares anteriores.

Para coleta, aplicar também `20261030120000_judicial_ingestion`, que acrescenta execuções, documentos, candidatos e vínculos de evidência privados. Antes da aplicação local foram salvos a estrutura e os registros judiciais. Reversão: parar/cancelar as execuções, restaurar o código anterior e preservar as tabelas e os documentos; nenhuma coluna anterior é removida ou reescrita. A ingestão não roda sozinha no início da API e não cria agendamento.

As respostas públicas de ranking, listagem e perfil incluem `judicial: JudicialSummary`, obtido em lote. `GET /api/politicos/ranking` aceita `metric=condenacoes`, `category` e `prisonOnly=true`, com ordenação e filtragem antes da paginação. As rotas `GET /api/judicial/ranking` e `GET /api/politicos/:politicoId/judicial` permanecem compatíveis. Administração: `GET /api/admin/judicial/politicos/:politicoId`, `PUT .../records/:recordId`, `PUT .../coverage` e `GET .../audit`. Escritas exigem `expectedVersion` (0 na criação) e retornam 409 para conflito; registros usam UUID estável para impedir duplicação em repetição. A interface bloqueia novas alterações quando o resultado do envio é incerto e permite conferir o resultado ou repetir o mesmo envio, com a mesma versão e identificação.

Testes judiciais: `npx vitest run src/lib/judicialRules.test.ts src/lib/judicialAdminActions.test.ts src/server.judicial.test.ts src/components/judicial/`. Os testes PostgreSQL exigem `TEST_DATABASE_URL` para banco de teste separado; os dados são fictícios em schemas descartáveis, sem publicar registros em políticos reais.

Rotas de coleta autenticadas em `/api/admin/judicial/ingestion`: `PUT /consolidate` (reprocessamento e publicação automáticos), `GET /sources`, `GET /runs`, `PUT /runs/:id` (configuração), `GET /runs/:id`, `PUT /runs/:id/cancel`, `PUT /runs/:id/resume`, `GET /candidates` (filtros `politicoId`, `status`, `limit`, `offset`), `PUT /candidates/:id/dismiss` (`expectedVersion`, `reviewNote`) e `PUT /candidates/:id/import` (campos do registro mais `candidateVersion`, `recordId`, `expectedVersion`). Importação sempre força `DRAFT`; candidato, registro e auditoria são confirmados na mesma transação. Repetição idêntica é idempotente; operação modificada ou evidência alterada retorna `409`.

Testes de coleta: `npx vitest run src/lib/officialJudicialCollector.test.ts src/lib/judicialIngestion.postgres.test.ts src/components/judicial/JudicialIngestionAdmin.test.tsx --pool=threads`. As fixtures de documentos são fictícias; a validação de perda do lock encerra somente uma conexão da própria suíte no banco de testes.
