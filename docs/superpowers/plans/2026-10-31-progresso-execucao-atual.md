# Progresso do planejamento da ingestão atual

**Objetivo:** destacar o estimado, concluído, restante, porcentagem e tipos de dados da execução atual; manter o acumulado da base como contexto secundário.

**Causa:** o resumo anterior só agregava checkpoints históricos. O worker cria as tarefas de cada conjunto quando chega à etapa, de modo que conjuntos futuros não entravam no denominador.

**Abordagem:** compartilhar a definição de janelas, legislaturas e escopo dos políticos com o planejamento. Registrar metadados pequenos da execução no diretório de logs persistente, por escrita atômica. Consultar os checkpoints do mesmo escopo que o worker pode consumir, incluindo tarefas previstas ainda não criadas. Identificar reaproveitamento de tarefas prontas, distinguir estimativa provisória durante descoberta de deputados e congelar o resultado ao terminar. A leitura do painel não executa ingestão nem altera checkpoints.

Não é necessário introduzir tabelas ou migrações. O volume de logs já persiste na VPS. Uma execução antiga sem esses metadados deve ser identificada como sem planejamento registrado, sem reconstruir um progresso fictício.

## Contrato

Campo aditivo `currentRun: IngestionRunProgress | null` no resumo administrativo. Tipo compartilhado em `src/lib/ingestionRunTypes.ts`. Inclui seleção/período reais, estado, etapa atual, estimativa consolidada ou provisória, total estimado, concluídas, reaproveitadas, restantes, percentual e os mesmos números por conjunto.

Restantes = estimado - concluídas. Concluídas incluem tarefas prontas reaproveitadas dentro deste planejamento; o reaproveitamento é identificado separadamente. Falhas e cancelamentos não viram conclusão. Não estimar quantidade de registros ou duração com a quantidade de tarefas.

## Tarefas e propriedade

- [ ] Principal: testes de planejamento e registro de execução, executar RED; extrair cálculos existentes sem mudar as janelas ou regras dos coletores.
- [ ] Principal: acompanhamento no worker CLI e no caminho iniciado pelo admin; estimar fases futuras, revisar despesas após deputados, capturar etapa e congelar o resultado final; confirmar atividade pelo PID do lock no banco atual.
- [ ] Especialista frontend: componente de execução atual e testes comportamentais, consumindo o contrato estabilizado; não alterar Admin.tsx nem outros arquivos compartilhados.
- [ ] Principal: integrar campo no endpoint e no Admin preservando alterações concorrentes de seleção/logs, integridade e Home.
- [ ] Revisão independente e QA no navegador: comparar números e percentuais por execução/conjunto, recarga, falhas, cancelamento, reaproveitamento e etapas ainda não criadas; TypeScript/build e testes pertinentes.
- [ ] Publicação: continuar a autorização vigente para corrigir o mesmo painel online. Commit seletivo e pacote da revisão exata; backup, testes PostgreSQL isolados, promoção API/web, conferência pública/autenticada. Preservar banco e PFC/Vínculo e permitir reversão de imagens.

## Riscos e critérios de aceitação

- Alterar datas ou seleção do formulário não muda o planejamento já iniciado.
- Futuras despesas entram na estimativa antes de serem criadas; catálogo vazio ou em descoberta mantém rótulo de estimativa provisória.
- Incluir a união dos checkpoints elegíveis já existentes e das chaves planejadas faltantes, sem contar duas vezes nem ignorar janelas históricas retomáveis.
- Duas execuções não compartilham a identidade. Falta do lock correspondente marca interrupção, sem aproveitar um lock de outra operação.
- Resultados encerrados ficam congelados: uma coleta posterior não reescreve os totais da anterior.
- Execução antiga sem metadados permanece distinguível do acumulado. Sem iniciar coleta real apenas para produzir evidência.
- Sem mudanças em pagamentos, dados judiciais, integridade, Home ou semântica de cancelamento/retomada.

## Evidência inicial

Checkout `codex/judicial-integrado`, HEAD `83e8978`. Existem alterações paralelas em Admin/Logs, Home e Integridade; não pertencem a esta correção. A inspeção confirmou que `runCheckpointWorkers` escolhe checkpoints pelo conjunto e intervalo inclusivo, e que a semeadura de despesas depende dos políticos conhecidos após a etapa de deputados.
