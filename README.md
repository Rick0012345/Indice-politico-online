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

A visão **Condenações** do ranking (`/ranking?view=judicial`) ordena casos com condenação definitiva verificada, por categoria. Criminal é a categoria inicial; improbidade, eleitoral e contas públicas são apresentadas separadamente. Decisões sujeitas a recurso têm contagem própria; anuladas/revertidas permanecem no histórico e deixam de contar. Prisões efetivamente confirmadas permitem filtrar perfis e consultar motivo, modalidade, fundamento, datas e desfecho; não acrescentam pontos à contagem de condenações. Um mandado pendente não comprova prisão.

No perfil, a aba **Histórico judicial** aceita acesso direto por `/politico/:id?tab=judicial`. Ausência de pesquisa aparece como desconhecida, e pesquisa sem resultados se refere somente ao escopo e às fontes consultadas. Nunca é exibida como prova de que alguém jamais foi preso. Perfil e ranking usam a mesma regra de contagem e acompanham o fluxo de atualização do catálogo.

A alimentação inicial fica em **Admin → Judicial**, com a autenticação administrativa existente: buscar político, cadastrar rascunho, informar documento oficial e evidências privadas de identidade, conferir a situação atual e publicar a revisão. Também é possível editar, anular/reverter a situação ou retirar da publicação voltando a rascunho. Declarações de cobertura exigem fontes e escopo. O histórico administrativo registra antes/depois em transação com a alteração; evidências de identidade e notas de revisão não são expostas nas APIs públicas.

Não há pesquisa automática por nome, assinatura de provedor pago ou carga de acusações nesta funcionalidade. Fontes são links HTTPS oficiais (`.jus.br`, `.gov.br`, `.mp.br`, `.leg.br`) e não são buscadas pelo servidor. Antes de publicar, a identidade e o cumprimento da prisão precisam estar comprovados. Documentos de imprensa podem orientar uma pesquisa externa, mas não substituem a fonte oficial exigida pelo cadastro.

Aplicar a migration aditiva `20261030030000_judicial_history` antes de usar as novas rotas. Ela cria registros, cobertura e auditoria com restrição de exclusão: a limpeza do catálogo não pode apagar políticos que tenham evidências judiciais associadas. Para reversão da funcionalidade, restaurar o código anterior e preservar essas tabelas. Não há transformação dos dados parlamentares anteriores.

Rotas públicas: `GET /api/judicial/ranking` e `GET /api/politicos/:politicoId/judicial`. Administração: `GET /api/admin/judicial/politicos/:politicoId`, `PUT .../records/:recordId`, `PUT .../coverage` e `GET .../audit`. Escritas exigem `expectedVersion` (0 na criação) e retornam 409 para conflito; registros usam UUID estável para impedir duplicação em repetição. A interface bloqueia novas alterações quando o resultado do envio é incerto e permite conferir o resultado ou repetir o mesmo envio, com a mesma versão e identificação.

Testes judiciais: `npx vitest run src/lib/judicialRules.test.ts src/lib/judicialAdminActions.test.ts src/server.judicial.test.ts src/components/judicial/`. Os testes PostgreSQL exigem `TEST_DATABASE_URL` para banco de teste separado; os dados são fictícios em schemas descartáveis, sem publicar registros em políticos reais.
