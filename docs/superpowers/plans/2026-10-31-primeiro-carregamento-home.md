# Primeiro carregamento da Home

**Objetivo:** reduzir a espera inicial dos indicadores, mapa e gastos por partido, mantendo exatamente o universo de deputados ativos e os valores financeiros existentes.

**Diagnóstico confirmado:** na VPS, as três consultas de agregação disputam leitura de disco sobre 1,3 milhão de despesas (`DataFileRead`/`BufferIO`). Não há índice que contenha também o valor líquido. O panorama ainda pede votos, avaliações e cobertura que não exibe. A versão pública verificada é `83e89785dc64`.

**Abordagem:** uma consulta pública específica entrega panorama, estados e partidos a partir de uma única soma por deputado, no mesmo snapshot. Os três consumidores usam o recurso compartilhado já existente, que deduplica chamadas e isola cancelamento. Um índice com `politico_id INCLUDE (valor_liquido)` permite somar valores sem percorrer os registros completos. Evitar uma tabela de totais persistentes elimina uma nova obrigação de sincronização com ingestões e correções.

**Escopo:** implementação e validação locais. Produção apenas consultada. Preservar alterações paralelas de integridade. Sem mudança visual, de cálculo, filtros existentes ou dados históricos. Sem commit/push/publicação nesta tarefa.

## Execução e aceitação

- [x] Reproduzir primeiro acesso público e registrar tempos de cada API.
- [x] Criar teste PostgreSQL do novo resumo: ativos/null, inativos, ausência de gastos, negativos, siglas vazias, universo vazio e equivalência com rotas atuais. Executar RED antes da implementação.
- [x] Implementar `src/lib/homeSummary.ts`, integrar `/api/home/resumo` e preparar migração aditiva do índice.
- [x] Testar e migrar os três consumidores em `src/components/home/HomePanels.tsx` para a mesma URL; garantir uma chamada, renderização, modos e desmontagem independente.
- [x] Medir no banco local com volume real, comparar consulta antiga/nova e valores; distinguir cache do navegador, cache do banco e latência pública.
- [x] Executar regressões pertinentes, lint/build, navegador desktop/mobile e revisão independente; corrigir achados.

## Compatibilidade e reversão

As rotas anteriores permanecem disponíveis. A API nova precisa ser disponibilizada antes ou junto do frontend quando uma publicação for autorizada. A migração não reescreve linhas; sua criação tem custo de leitura/escrita e deve ocorrer sem ingestão pesada. Se necessário, reverter interface/API para a release anterior, mantendo o índice aditivo. Um eventual DROP INDEX deve ser decidido separadamente, sem restaurar banco.

## Atenção na revisão

- Não multiplicar deputados ao agregar despesas; incluir deputados sem gastos.
- Manter `ativo IS DISTINCT FROM false`, valores negativos e precisão decimal até a soma final.
- Excluir UF/partido vazio somente do agrupamento correspondente, não do panorama.
- Não acoplar panorama a votos, cobertura ou dados judiciais.
- Não substituir evidência de navegador/API por tempo isolado de SQL; produção não recebe a mudança automaticamente.

## Ampliação solicitada: seleção e estado da ingestão

Evidência de 31/10: nenhum worker ativo e nenhum lock de manutenção na VPS; dois checkpoints `deputados` continuam `running` desde 30/10 19:27 UTC. O último arquivo registra `datasets=deputados,partidos`, sem votações. O painel de Logs classifica esses eventos antigos como ativos por consultar somente checkpoints; o resumo principal já distingue execução não confirmada. Não foi encontrada evidência de conversão de um pedido `votacoes` em `deputados`.

- [x] Reutilizar o sinal de execução existente para impedir que Logs marque checkpoint órfão como coleta ativa; preservar histórico e explicar ausência de execução confirmada. Nenhuma escrita corretiva no banco de produção.
- [x] Iniciar seleção vazia, explicitar seleção múltipla, expor `aria-pressed`, mostrar conjuntos escolhidos e os efetivamente aceitos pelo servidor. Isso evita iniciar os sete conjuntos pré-marcados sem intenção; nenhum contrato externo muda.
- [x] Testar evento antigo + checkpoint órfão, manutenção genérica, agente confirmado e envio de somente votações; validar no navegador sem iniciar coleta real.
- [x] Revisão independente do conjunto após implementação, preservando alterações de integridade preexistentes.

## Evidência final

- Produção, consulta apenas: primeiro acesso teve timeout de 30 s nos três painéis; segunda navegação teve 21,6 s em estados/partidos e timeout no resumo. Evidências em `output/playwright/first-load-comparison.json`.
- Banco local com 1.303.072 despesas: consultas antigas em paralelo 4.936 ms antes do índice; consulta compartilhada depois 279 ms. Comparação verificou os mesmos totais por estado/partido e panorama (513 ativos, 1.252 cadastrados, R$ 1.184.341.394,19). `EXPLAIN` mudou de varredura da tabela para `Index Only Scan`; ainda houve heap fetches, portanto o índice não elimina todo acesso à tabela. Evidências `output/diagnostics/first-load-before.json` e `first-load-after.json`. Migração aplicada somente aos bancos locais `app` e `app_test`.
- Navegador, build local, cache do navegador vazio: primeiro conteúdo 512 ms, painéis sem esqueletos em 1.022 ms, uma chamada ao resumo em 426 ms. API/banco possivelmente aquecidos; não representa latência medida na VPS após publicação. Evidências `output/playwright/first-load-local-preview-performance.json` e captura correspondente.
- Interações desktop/mobile de 390 px: modos do mapa/partidos, ausência de overflow, falha 503 distinguida de dados vazios. Admin validado com todas as rotas administrativas simuladas antes de navegar: Votações envia somente `votacoes`; checkpoint órfão não aparece ativo; nenhuma coleta real executada.
- Rodada integrada: 10 arquivos / 105 testes aprovados, incluindo PostgreSQL isolado `app_test`, Home, ranking, recurso compartilhado, Admin, logs e ciclo de ingestão. Houve avisos React `act` no teste da virada do dia, sem falhas. `npm run lint`, `npm run build` e `git diff --check` passaram.
- Revisão independente encontrou confirmação antiga mantida após falha no polling. Corrigida com teste RED/GREEN: erro limpa `logsExecution/currentStatus`, preserva histórico e informa execução não confirmada. Correção reinspecionada sem outro achado.
- Sem commit, push, publicação, limpeza de checkpoints da VPS ou início de ingestão. Publicação continua pendente de autorização por alterar serviço real.
