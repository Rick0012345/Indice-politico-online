# Histórico judicial — plano de implementação

> Execução autorizada pelo usuário em 30/10/2026. Usar superpowers:subagent-driven-development, com contratos compartilhados e revisão independente. Preservar alterações preexistentes no checkout atual.

**Objetivo:** oferecer ranking por condenações definitivas por categoria, filtro de prisão confirmada e histórico de condenações/prisões com fonte, motivo, modalidade e desfecho.

**Arquitetura:** domínio judicial separado de avaliações e despesas, tabelas aditivas, rotas próprias com autorização administrativa existente. Publicação somente de registros revisados com fonte oficial e evidência de identidade; nada de alegações automáticas baseadas em nome. Tipos públicos em `src/lib/judicialTypes.ts` são o contrato entre interfaces e servidor.

**Tecnologias:** React/TypeScript, Express, PostgreSQL via pg, migrations Prisma, Vitest e navegador Playwright.

**Especificação aprovada:** conversa deste chat: condenações definitivas como ordenação principal; recurso separado; anuladas/revertidas excluídas da contagem; prisão efetivamente cumprida como histórico e filtro, sem pontos adicionais; ausência de dados não significa nunca preso. Criminal é categoria inicial; improbidade, eleitoral e contas públicas separadas. A lista será rotulada como registros encontrados, sem promessa de cobertura nacional completa.

## Contrato
- `GET /api/politicos/:politicoId/judicial` retorna JudicialProfile, apenas VERIFIED; 404 para pessoa ausente.
- `GET /api/judicial/ranking?category=CRIMINAL&prisonOnly=false&status=ativo&search=&direction=desc&limit=50&offset=0` retorna JudicialRankingResponse. Valores desconhecidos ficam ao final nas duas direções; empate por nome/id; sem peso de avaliação popular. Cobertura e total calculados antes da paginação.
- `GET /api/admin/judicial/politicos/:politicoId` retorna JudicialAdminProfile.
- `PUT /api/admin/judicial/politicos/:politicoId/records/:recordId` recebe JudicialRecordInput + expectedVersion (0 para criação); id UUID gerado pelo cliente. Retorna registro salvo. 409 em conflito de versão ou duplicidade de caso. Atualização e auditoria atômicas. Rascunho retira registro da publicação.
- `PUT /api/admin/judicial/politicos/:politicoId/coverage` recebe status/scope/sources + expectedVersion e retorna cobertura atualizada.
- `GET /api/admin/judicial/politicos/:politicoId/audit` retorna {items:[{id,recordId,action,createdAt,before,after}]}, últimos 100 eventos; nunca público.
- Fontes publicadas devem ser HTTPS em domínio oficial `.jus.br`, `.gov.br`, `.mp.br` ou `.leg.br`, sem credenciais. Não buscar URLs no servidor. Não retornar observações de identidade ou revisão publicamente.
- Um caso normalizado por pessoa/categoria conta uma vez; prisões deduplicadas por pessoa/caso/data/modalidade. Datas válidas não futuras, trânsito >= decisão, soltura >= prisão. FINAL exige trânsito e prisão publicada exige confirmação de cumprimento e motivo/fundamento.
- Perfil soma definitivas criminais como indicador principal e expõe counts por categoria. Sem cobertura ou evidência pública: contagens null. Registros verificados sem pesquisa declarada tornam cobertura PARTIAL.

## Tarefas
- [x] Banco, regras, rotas e testes: `prisma/schema.prisma`, migration `20261030030000_judicial_history`, `src/lib/judicialRules.ts`, `judicialRepository.ts`, `judicialRoutes.ts`, testes correspondentes e registro mínimo em `src/server.ts`.
- [x] UI pública: componentes em `src/components/judicial/`, integração no Ranking e PoliticoProfile, metodologia e testes. Visão judicial própria dentro do ranking, URL compartilhável, preservando notas/gastos/votações. Falhas não se tornam ausência de registros.
- [x] Gestão: componente JudicialAdmin na seção Judicial de Admin, seleção de político, cadastro/edição/revisão, cobertura e trilha de revisão. Reutilizar adminFetch; impedir envios concorrentes, timeout com resultado incerto e reconciliação por leitura antes de repetir.
- [x] Integração: migration no banco local após backup; testes PostgreSQL em app_test separado, testes frontend e regressões afetadas, lint/build. Sem inserir acusações fictícias em políticos reais.
- [x] Revisão independente e navegador desktop/mobile: filtros, navegação, vazio/erro/desconhecido, fonte, cadastro/revisão e correção. Dados fictícios apenas em banco de teste isolado ou mocks de navegador claramente identificados.

## Foco de revisão
- Rascunhos e evidências privadas nunca públicos; rotas admin protegidas.
- Anulação, retirada de revisão e alteração de categoria atualizam contagens; recursos não duplicam casos.
- Troca de político/filtro descarta resposta antiga; erro não mostra selo sem registros.
- Conflitos de edição/repetição preservam evidências e auditoria; links oficiais validados sem SSRF.
- Não confundir mandado pendente, prisão efetiva, soltura e absolvição; zero pesquisado difere de desconhecido.

## Compatibilidade e reversão
Mudança aditiva; avaliações, despesas e votos mantêm os contratos anteriores. Registros judiciais não são preenchidos a partir de notícias automaticamente. Alimentação inicial por gestão revisada com fontes oficiais; integração automatizada de descoberta exige fonte com acesso confirmado e não é simulada. Reverter código preservando tabelas, sem apagar evidências. Sem publicação externa, push ou commit implícitos.

## Evidências de execução
Baseline dos arquivos com alterações anteriores salvo em `output/judicial-review/baseline` para revisão do delta desta tarefa. Registrar resultados de testes e limitações ao concluir.

### Resultado em 30/10/2026
- Migration aplicada ao banco local `app` e ao banco separado `app_test`. Cadastro parlamentar permaneceu com 1.252 políticos; novas tabelas judiciais sem casos fictícios. Backup anterior completo em `output/judicial-review/before-judicial-20261030.dump` (251.734.548 bytes).
- Rodada integrada final: **114/114 testes aprovados**, 9 arquivos, nenhum ignorado. Evidência estruturada: `output/judicial-review/test-results.json`. Inclui PostgreSQL real em schemas descartáveis, HTTP, regras, concorrência, privacidade e interfaces.
- Na primeira rodada integrada, 113/114 passaram: um teste anterior de atualização Partidos→Parlamentares não encontrou o nome atualizado no prazo do teste. Passou isolado com e sem o wrapper judicial, e na repetição integrada final. Nenhuma alteração especulativa foi aplicada a essa lógica; mudanças paralelas em seus helpers foram preservadas.
- Build Vite aprovado. TypeScript aprovado após corrigir tipagem de componentes e tirar snapshots de extensão compilável. Prisma validado.
- Revisão independente identificou consulta administrativa sem timeout; corrigida com prazo de 20 s e teste de recuperação, confirmado pelo revisor. Unificada também a validação de URLs oficiais entre servidor e links públicos.
- Browser real: HTTP 200, 513 ativos entre 1.252 cadastrados, desconhecidos sem classificação, filtro de prisão, categorias, perfil e retorno ao ranking anterior. Desktop e viewport de 360 px verificados sem overflow. Cenários públicos preenchidos e quatro escritas administrativas foram inteiramente simulados no navegador; as verificações de persistência aconteceram separadamente no PostgreSQL de teste.
- APIs administrativas retornam 401 sem autenticação. Evidências privadas não são retornadas publicamente. Relatórios de backend, revisão e UI em `output/judicial-review/`.
- Limite explícito: nenhuma coleta externa automática ou carga editorial de condenações/prisões reais foi executada. A alimentação inicial está disponível em Admin → Judicial, por fontes oficiais e revisão. Sem commit, push ou publicação externa.
