# Ingestão com menos consultas e retomada preservada

> Execução autorizada pelo usuário: otimizar a ingestão sem perder dados nem sobrecarregar a Câmara. Usar diagnóstico, TDD, subagent-driven-development e revisão independente.

**Objetivo:** reduzir o número de requisições e o custo de selecionar tarefas; manter os limites de HTTP, os dados existentes e os contratos financeiros já corrigidos.

**Diagnóstico:** fila original de 76.998 meses/parlamentares. Limite global de 1 GET/s e concorrência 2. Às 16h08, cerca de 45% das tarefas concluídas estavam vazias. Persistência média de despesas de 1,742ms; claim histórico de 83,461ms. Na medição final com a fila parada, EXPLAIN da seleção varreu 71.325 candidatos, ordenou a fila e levou 30,991ms.

**Escolha:** agrupar meses pendentes, por deputado/ano/legislatura, na API já usada (`mes` CSV suportado pela fonte). A amostra Jan+Fev/2020 retornou os mesmos 140 lançamentos e R$42.147,24 em duas páginas. Arquivos anuais oficiais são alternativa para carga massiva, mas exigem outro mapeamento e reconciliação; não entram nesta rodada. Não aumentar a frequência HTTP.

## Contratos e transição

- Preservar todas as alterações anteriores, IDs de parlamentares, documentos, lançamentos originais, estornos e chave composta financeira.
- Continuar com 1 requisição/s, até 2 workers, 100 itens por página e cooldown compartilhado/retry. Corrigir reavaliação do cooldown enquanto outro worker já espera.
- Lote de até 12 meses existentes, do mesmo deputado/ano/legislatura e dentro de from/to; apenas tarefas sem cursor/itens. Meses concluídos e cursores parciais seguem preservados.
- Janeiro/fevereiro nos anos de transição ficam em lotes de legislaturas diferentes. Não inferir ausência por último status ou descartar parlamentares.
- Congelar e reivindicar membros com locks, SKIP LOCKED e teto de tentativas; requisições fora da transação, até 200 páginas/20 mil originais. Exigir ano/mês explícitos e pertencentes ao lote.
- Uma transação confirma domínio, raw e conclusão de todos os membros; cancelamento/erro faz rollback. Falha antes da confirmação repete o lote desde a página 1, sem perder páginas mensais anteriormente confirmadas. Não criar cursor anual compartilhado.
- Handler finalizado informa os IDs completos, limpa falhas anteriores dos membros e emite conclusão por mês depois do COMMIT. Caminho mensal atual continua para cursores existentes.
- Retomada normal não reabre vazios já concluídos. Reprocessamento de vazios continua disponível explicitamente na API/Admin.
- Índice parcial alinhado à ordenação da fila, sem modificar dados. Backup e baseline antes da aplicação; worker antigo encerra cooperativamente antes da retomada.
- Reversão operacional: `--expense-batch-months=1` conserva caminho mensal; não é necessário apagar dados ou desfazer a chave financeira.

## Tarefas

- [x] Agente de limitador: módulo compartilhado e testes de relógio para cooldown durante espera, espaçamento e recuperação da fila.
- [x] Agente de ingestão: claim/grupo, consulta CSV, partição e conclusão atômica, fallback mensal e testes de concorrência/cancelamento/retry/integridade.
- [x] Principal: índice de fila medido; retomada sem reset-empty por padrão e opção explícita no Admin; testes de comportamento.
- [x] Revisão e validação: comparar mesmas despesas e somas no modo mensal e agrupado, medir GETs e duração mantendo taxa; TypeScript/build/Prisma e suíte PostgreSQL isolada.
- [x] Operação: aplicar índice após revisão e testes, retomar período e datasets atuais sem reabrir concluídos, verificar avanço, filas, erros, domínios/raw e IDs preservados.

## Aceitação

Contagens e somas iguais nos cenários comparados; ausência de duplicação, perda e HTTP acima do limite; cursores existentes retomáveis; menos GETs e/ou menos tempo medidos no mesmo trabalho. Relatar separadamente ganho medido no piloto e observação da execução real, sem extrapolar percentuais para toda a coleta.

## Evidências de validação

- Backup local completo de `catalogo` antes do índice e da retomada: `C:/Users/po442/.codex/backups/indice-politico/20261029-optimization/before-optimization.dump` (22.549.795 bytes).
- Baseline parada: 1.252 parlamentares, 79.947 documentos, R$82.456.007,57; 5.864 tarefas de despesas concluídas. Após o índice, IDs, hash financeiro, valores e versões das tarefas concluídas permaneceram iguais. Reconciliação de 3.246 competências com os lançamentos originais: zero divergências.
- Mesma consulta de seleção, antes/depois do índice: 30,991ms / 0,128ms; Seq Scan e ordenação / Index Scan; aproximadamente 1.599 / 4 buffers. Essa medição não representa o tempo total do claim ou da ingestão.
- Piloto com fonte real e esquemas PostgreSQL isolados: deputado 160592, janeiro a dezembro de 2020, dois workers, intervalo global de 1 segundo. Caminho mensal: 12 GETs, 12.199ms, menor intervalo observado 1.003ms. Agrupado: 5 GETs, 5.981ms, menor intervalo 1.001ms. Ambos: 12 tarefas concluídas, 412 lançamentos originais, 407 documentos agregados, R$463.238,94 e hash financeiro idêntico. Redução de 7 GETs (58,3%) e de aproximadamente 51% do tempo nesse piloto; não é uma previsão para toda a fila.
- Revisão independente corrigiu concorrência na seleção de membros, finalização duplicada após cleanup e tratamento fatal de falha no próprio cleanup. Testes reproduziram os três defeitos antes das correções. Falha fatal drena os workers em andamento e encerra com código 1, preservando o estado recuperável.
- Admin validado em navegador a 1366×900 e 390×844: opção desmarcada por padrão, teclado, nome/descrição acessíveis e sem transbordamento ou erros de console. Testes de interface bloquearam ações reais.
- Candidata integrada: 39 arquivos e 245 testes aprovados, incluindo PostgreSQL real em schemas isolados; `npm run lint`, `npm run build`, `prisma validate` e `git diff --check` concluídos sem falhas.
- Retomada local via Admin/API às 19:25:29 UTC, mesma janela `2020-01-01..2026-10-29` e datasets deputados/despesas/partidos, sem `--reset-empty`. Às 19:26:36 UTC: 216 competências novas concluídas, 4.071 documentos novos, 84.018 documentos totais e R$87.512.222,49. Zero falhas/retries no log observado; fila continua ativa, com 6.080 tarefas concluídas, 70.912 pendentes e 6 em execução.
- Auditoria após a retomada: os 79.947 documentos anteriores continuam com os mesmos valores, os 1.252 IDs de parlamentares permanecem iguais e os 5.864 checkpoints já concluídos conservam status/contagem/xmin. Agora 3.429 competências com despesas conferem com os originais, sem divergências. Essa observação demonstra o início saudável da execução, não a conclusão de toda a carga histórica.
