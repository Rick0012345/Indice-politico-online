# Cobertura processual dos deputados

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Preservar o checkout existente; não fazer commit, push ou publicação.

**Goal:** pesquisar todos os deputados cadastrados e integrar processos identificados ao perfil, comparador e ranking existentes.

**Architecture:** ampliar o worker judicial durável com a fonte STF_CASES, usando a mesma trava, cancelamento e retomada. Armazenar processos e vínculos em estruturas aditivas, com identidade canônica por CNJ/tribunal e evidência privada da associação à pessoa. Registrar consultas por pessoa/fonte, inclusive vazios e falhas; preservar a apuração independente de condenações e prisões.

**Tech Stack:** TypeScript, PostgreSQL, React, Cheerio, HTTP oficial existente, Vitest e Playwright.

**Spec:** pedido nesta conversa: cobertura de todos os deputados cadastrados, todos os processos identificados e ordenação por mais processados, mantendo os atributos integrados. A automação não pode tratar homônimo, autor ou notícia repetida como processo contra o deputado.

## Restrições e decisões

- Consulta nominal STF exige as duas partições: em tramitação e fora de tramitação. Paginar ambas integralmente, com limites explícitos e marcação de truncamento.
- A busca nominal é ampla; filtrar o nome civil exato e exigir âncora oficial para publicação. Nome isolado não identifica a pessoa.
- Âncoras: caso previamente verificado, contexto nominal parlamentar em fonte oficial, ou vínculo oficial pelo mesmo identificador de pessoa e processo. Não transferir confirmação entre IDs apenas pelo nome.
- CNJ idêntico consolida reautuações/recursos; números distintos só são unidos por vínculo oficial inequívoco. Guardar aliases.
- Métrica `processos`: casos únicos com posição direta de réu/requerido. Investigações e execuções ficam em contadores próprios; posições recursais isoladas, autor, paciente e testemunha não entram nessa métrica.
- Todos os casos com identidade confirmada podem aparecer no histórico, com papel explícito, assunto, número, situação e fonte.
- STF nominal não é exaustivo: sigilosos podem ser omitidos. STJ retornou HTTP403/desafio; sem contorno ou promessa de cobertura nacional.
- Cobertura de processos é separada da cobertura de condenações. Consulta concluída sem vínculo confirmado não implica ausência universal; homônimos pendentes impedem zero conclusivo.
- Nenhuma coleta de processos cria condenações ou prisões por inferência.
- Alterações locais autorizadas; migração aditiva com backup antes da carga. Não alterar fontes enquanto worker local estiver executando.

## Revisão prioritária

1. Homônimos e nomes parciais não publicados (exemplo real Paulo Pereira da Silva com processo de 1960).
2. AP971/Pet6341 com mesmo CNJ contados uma vez; autores/recorrentes e inquéritos separados.
3. Paginação nas duas partições, erro/truncamento não transformado em zero.
4. Retomada idempotente e perda da trava sem sobreposição de checkpoint.
5. SQL, resumo, CSV, perfil e comparação concordam; preservar condenações/prisões.

## Tarefa 1 — fonte e identidade

**Files:** `src/lib/judicialProceedingsTypes.ts`, `src/lib/officialJudicialHttp.ts`, `src/lib/judicialStfProceedings.ts`, respectivos testes e coletor/cache de evidências.

- [x] Definir contrato aditivo de observações e cobertura.
- [x] Testar parser nominal, paginação, papéis, CNJ, âncoras e homônimos.
- [x] Implementar consulta oficial com limitação de requisições, timeout, cancelamento e cache verificável.
- [ ] Consultar a população inteira e guardar resultados sem publicar vínculos incertos.

## Tarefa 2 — persistência e fluxo compartilhado

**Files:** migração aditiva, `prisma/schema.prisma`, `judicialProceedingsRepository.ts`, `judicialIngestionTypes.ts`, `judicialIngestionRepository.ts`, `judicialIngestionWorker.ts`, rotas/CLI.

- [x] Testar deduplicação, papéis, sucesso/vazio/falha, idempotência e retomada.
- [x] Integrar STF_CASES ao worker e persistir resultados e cobertura no mesmo checkpoint.
- [x] Disponibilizar pesquisa de todos os cadastrados no Admin usando o mesmo fluxo da CLI.
- [ ] Backup, migração e carga local; conferir cobertura real por pessoa.

## Tarefa 3 — leitura pública e interface

**Files:** `judicialTypes.ts`, `judicialRepository.ts`, `judicialQueries.ts`, `rankingQueries.ts`, `server.ts`, componentes judiciais, Ranking, Comparador, Methodology e testes.

- [x] Integrar resumos, histórico e ordenação SQL antes de paginação, nos dois caminhos do ranking.
- [x] Acrescentar processos aos atributos/CSV, explicando o recorte de cada contagem e a cobertura.
- [x] Corrigir renderização do comparador por identificadores estáveis em lugar de índices.
- [x] Validar navegador desktop/mobile, filtros, perfil, comparação e Admin.

## Tarefa 4 — fechamento

- [x] Revisão independente dos contratos e implementações; corrigir achados.
- [x] Executar testes afetados, TypeScript, build e comparação das APIs com o banco.
- [ ] Reexecutar carga/amostra para comprovar idempotência; medir população consultada, confirmada, incerta e falhas.
- [ ] Documentar comandos, fonte, limites reais e resultado, sem afirmar cobertura nacional completa.

**Reversão:** interromper cooperativamente a coleta, preservar evidências/backup e desabilitar a nova fonte/metric. Tabelas aditivas podem permanecer sem afetar os registros anteriores; não apagar históricos para reexecutar.

## Evidências e andamento local

- Migração aditiva aplicada no banco local `app/catalogo` após backup `output/judicial-ingestion/before-process-coverage.dump` (221652 bytes, 44 entradas validadas com pg_restore).
- Pesquisa nominal: 191 pessoas concluídas, 2217 associações nominais; HTTP403 interrompeu a próxima pessoa. Consulta mínima posterior também recebeu403. Fonte STJ nominal e catálogo Corte Aberta igualmente indisponíveis; sem contorno de bloqueios.
- Cache nominal e manifesto: `output/process-discovery/cache`. São candidatos, não 2217 processos confirmados nem cobertura de1252.
- Revisão corrigiu coocorrência de notícia, cancelamento da CLI na inicialização, zero indevido de ativos UNKNOWN e perda de CNJ/data em atualização incompleta. Todos receberam validação proporcional.
- Replay offline de documentos oficiais confirmou AP615/Inq2813(Sílvio) e AP883(Izalci), com zero HTTP; Inq3885/4161/4163 permaneceram indeterminados. Atos de citação/notificação exigem gramáticas fechadas e nome/partes/caso verificados.
- Validações: 79 testes de UI;116 testes backend/integrados na rodada consolidada anterior à ampliação das três gramáticas;21 testes do coletor ampliado, TypeScript e build passaram. Testes usam app_test/schema UUID; navegador separou fixtures de GET real.
- Carga está aplicando cache e preservando contagens de condenações/prisões. Concluir/registrar resultado efetivo abaixo antes de afirmar cobertura integral.
- Recuperação real da fonte em 30/10/2026 às 20:05 UTC: resposta 200/JSON válido; busca nominal retomada com 1000 ms. Após correção de bloqueio temporário de arquivo no Windows, voltou a avançar sem erros. Às 20:11 UTC: 262 deputados consultados nominalmente e 39 com processamento detalhado registrado; carga em andamento, com cinco vínculos confirmados com processos.
- `writeFileAtomic`, compartilhado por cache, manifesto e estado da CLI, preserva o destino em falha; repetição limitada apenas para EPERM/EACCES/EBUSY. Sete testes com arquivos reais passaram; TypeScript final passou. A CLI confere cancelamento persistente a cada dois segundos.
- QA com dados reais: Sílvio (AP 615 + Inq 2813) apresenta uma ação e uma investigação; Izalci (AP 883), uma ação. Ranking, perfil, comparador e Admin foram verificados em desktop/mobile sem escritas. Outras numerações excluem o próprio número principal após achado visual; teste e build posteriores passaram.
- A execução atual `d041124b-0de8-41b6-a0be-e4d46411da97` percorre os 1252 deputados. A execução `bc292f8a-1605-4d92-acf5-fde601e0dfd9` foi cancelada cooperativamente em 16 para ampliar gramáticas e reprocessar o cache. Os registros não foram apagados. Snapshot atual em `output/process-discovery/local-coverage-snapshot.json`; manifesto nominal em `output/process-discovery/cache/manifest.json`.
- A cobertura total permanece pendente enquanto os coletores executam. Não existe agendamento ou promessa de acompanhamento fora desses processos locais.

## Acompanhamento factual solicitado posteriormente

O acompanhamento neste chat está ativo pela automação `concluir-coleta-e-conferir-perfis`. Seu escopo é integridade técnica da coleta e dos perfis individuais; exclui classificações, comparações e avaliações de políticos.

Para a recuperação após o término da passagem geral, foi preparado `output/diagnosis-completion/recover-detailed.ts`. Executar no container `api` com `--inspect` faz somente leitura dos alvos. Sem essa opção, o script exige passagem geral terminal e inativa; reutiliza o worker, a trava e o cache, registra UUIDs próprios em `detailed-recovery-state.json`, preserva tentativas anteriores e limita a duas passagens direcionadas. Não seleciona vínculos UNRESOLVED por si só nem erros exclusivamente cronológicos. Uma recuperação já ativa é apenas observada, sem iniciar concorrência. Após as recuperações, executar `output/process-discovery/audit-public-profiles.ts --all` e conferir as falhas restantes antes de relatar encerramento.

Após as duas recuperações, as quatro pendências foram diagnosticadas: três documentos públicos tinham 23,2–31,4 MB de HTML decodificado e excediam o teto de 16 MiB; uma consulta por número exigia `classe=Pet`, enquanto `classe=PET` retornava uma página sem identificadores. O conector processual passou a aceitar até 40 MiB, mantendo a LRU em oito entradas/32 MiB e os limites independentes dos outros conectores. O lookup normaliza somente PET para a sigla oficial Pet e mantém a conferência exata de processo/incidente. As 29 regressões do coletor e TypeScript passaram; revisão independente não encontrou bloqueio. Verificação dirigida após essas correções: `output/diagnosis-completion/verify-corrected-sources.ts`, com estado próprio em `corrected-sources-state.json`, sem apagar as duas tentativas de recuperação anteriores.

Encerramento factual em 30/10/2026 às 23:30 UTC: 1252 buscas nominais concluídas e 1252 pessoas com tentativa detalhada registrada; nenhuma falha técnica pendente na seleção de recuperação. A auditoria HTTP verificou os 1252 perfis e 53 vínculos canônicos publicados, sem problemas de duplicação ou campos privados. Há 55 observações confirmadas agrupadas nesses 53 vínculos, todas com evidência de identidade. A cobertura é completa no escopo para 361 cadastros e parcial para 891; 7365 associações sem identidade comprovada permanecem privadas. Preservados os 12 registros de condenação e um de prisão anteriores. Não há ingestão ativa. Relatório: `output/diagnosis-completion/completion-report.json`. A conclusão é operacional e de integridade dos perfis, sem alegação de cobertura nacional ou confirmação de todas as correspondências nominais.
