# Carregamento progressivo e consultas leves

**Objetivo:** mostrar conteúdo útil de Início, Ranking e Comparador sem aguardar blocos independentes, reduzir consultas repetidas e preservar os totais e a classificação exatos.

**Autorização e desenho:** proposta apresentada na análise deste chat e autorizada pelo usuário com “aplica isso”. Implementação local no checkout atual, preservando alterações anteriores. Sem publicação, migração ou alteração de dados históricos.

**Arquitetura:** manter o endpoint legado e acrescentar modos `view=cards`, `view=items` e `view=summary` em `/api/politicos/ranking`. Cards usam identidade/notas; items preservam campos das linhas e calculam a ordenação global antes de paginar; summary devolve totais/cobertura sem bloquear as linhas. Respostas incluem `revision` capturada antes da consulta. Reaproveitar SSE e invalidar cache por revisão, sem remover a reconciliação inicial.

**Contrato compartilhado:** `fetchCatalogJson<T>(url, {signal?, force?}?)` em `src/lib/catalogResource.ts`, para GETs públicos de catálogo. Chave normalizada por URL e parâmetros; deduplicação de requisições em andamento; cancelamento por consumidor; limite de retenção e validade de 30 segundos; timeout explícito. `setCatalogRevision(revision)` invalida resultados antigos; `clearCatalogResources()` isola testes. Recursos administrativos/autenticados não usam este cache.

**Compatibilidade:** modo completo permanece padrão. Sem dependências novas. Ranking por gastos/votos mantém cálculo global e desempates antes do LIMIT. Valor desconhecido não vira zero. Filtros e revisão acompanham resumos; divergências mostram atualização pendente e reconciliam. Dados anteriores permanecem apenas no mesmo contexto. Reversão por restauração dos arquivos desta tarefa; cópias anteriores em `%TEMP%/codex-loading-baseline-20261030`.

## Tarefas e responsáveis

- [x] Backend: modos aditivos da consulta, testes PostgreSQL de equivalência, ordenação e totais; consulta de anos sem varredura integral quando índice disponível. Responsável delegado, arquivos server.ts, server.ranking.test.ts e novo módulo de consultas/testes.
- [x] Infraestrutura compartilhada: cache/deduplicação/cancelamento/timeout e integração SSE; testes de concorrência, expiração, revisão e isolamento. Responsável principal.
- [x] Ranking: itens e resumo independentes, sem consulta da visão escondida, debounce somente de texto, preservar conteúdo e paginação; testes de resposta lenta, erro parcial e troca de contexto. Responsável delegado.
- [x] Início/Comparador: listas e perfis independentes, erro e repetição por bloco; usar contrato compartilhado e separar indicadores. Remover atraso artificial inicial em Câmara/Partidos onde compatível. Responsável principal após infraestrutura.
- [x] Revisão independente e navegador: abrir telas com respostas reais e atrasadas, filtros rápidos, navegação, responsividade e recuperação parcial; corrigir achados e medir tempo até dados principais. Delegar validação de interface.

## Validação

- Testes de comportamento antes da implementação correspondente.
- Testes de integração em banco separado `app_test`; nunca apontar TEST_DATABASE_URL para app.
- Suite relevante, TypeScript, build e suíte completa ao integrar.
- Comparar tempos com a base local: antes, Início 9,8–13,2 s e Ranking 6 s por requisição; não confundir SQL isolado com tempo de tela.
- Confirmar que chamadas repetidas de StrictMode/SSE compartilham trabalho, sem perder mudanças durante requisição.

## Registro

- Branch inicial: codex/otimizacoes-confiabilidade, com alterações preexistentes em 26 arquivos rastreados e vários não rastreados. Sem reset, stash ou commit abrangente.
- Não há worktree anexado ao chat; reutilizado checkout adequado conforme instruções do aplicativo.
- Revisão prévia do plano: manter correção de ranking global, distinguir erro/vazio/carregamento, preservar cancelamento independente e cache limitado.
- Backend: 38 testes passaram em app_test; cache/SSE: 9; Home/Câmara/Partidos/cache: 15; Comparador: 3; Ranking delegado: 19. Duas regressões adicionais confirmaram e corrigiram zeros desconhecidos e callback da aba antiga; 2 testes passaram. Esses números são rodadas focadas, não somar como suíte distinta.
- Revisão independente de backend/cache sem bloqueantes; achados frontend corrigidos e reconferidos. Uma terceira regressão cobriu aviso do catálogo recebido na aba Partidos: voltar à lista parlamentar agora verifica a revisão e atualiza as linhas mesmo se o resumo estiver pendente. A exportação CSV também preserva valores desconhecidos como vazios.
- Suíte ampla: 358 testes passaram e 3 testes de perfil excederam o limite de tempo durante carga concorrente. Os 14 testes desse arquivo passaram na repetição isolada. Não houve uma segunda execução da suíte ampla. TypeScript de todas as fontes e configurações reais passou; build final passou em 35,75 s; git diff --check passou.
- Rodada final após todas as correções: 35/35 testes de Ranking, Início, Comparador e cache passaram em 68,08 s.
- Trabalho paralelo criou módulos judiciais e cópias de fontes em output/judicial-review/baseline. Essas alterações foram preservadas. Validações excluem cópias em output; TypeScript também foi limitado às fontes/configurações reais. Reinícios automáticos da API interromperam cenários iniciais do navegador; os fluxos afetados foram repetidos após estabilização.
- Navegador: listas independentes no Início, 50 políticos utilizáveis com falha do resumo, repetição somente do bloco com erro, busca, troca de abas e cache na navegação Ranking → Início → Ranking confirmados. Comparador recuperou indicadores sem novas consultas de perfis/concordância. Larguras 1366 e 390 px verificadas, sem transbordamento da página. Evidências em output/playwright/loading-progressive-report.md e imagens associadas.
- Medições de tela nesta execução: primeira lista do Início em 1,728 s e do Ranking em 8,711 s, ambas sem esperar o resumo. A medição do Ranking não demonstra redução absoluta de latência frente à referência anterior; o ganho validado é a independência dos blocos e o reaproveitamento das consultas. Tempos de SQL isolado não foram tratados como tempos de tela.
- Sessão de navegador e preview temporários encerrados. Sem commit, push ou publicação nesta tarefa.
