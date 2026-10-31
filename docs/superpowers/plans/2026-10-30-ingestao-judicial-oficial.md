# Ingestão judicial de fontes oficiais

> Execução com superpowers:subagent-driven-development. Implementação autorizada pelo usuário em 30/10/2026.

**Objetivo:** coletar documentos oficiais sobre condenações e prisões, manter sua origem e permitir revisão/importação para os atributos judiciais já existentes.

**Arquitetura:** conectores STF REST e STJ RSS -> execução durável e documentos deduplicados -> candidatos privados por possível político -> formulário judicial e validação existentes -> publicação revisada. Sem pontuação por menção nominal ou mandado.

**Fontes verificadas:** STF `https://noticias.stf.jus.br/wp-json/wp/v2/posts` (acervo paginado por nome, HTML no JSON), STJ `https://res.stj.jus.br/hrestp-c-portalp/RSS.xml` (feed recente, HTML em content:encoded). CNJ DataJud não permite descoberta nominal e BNMP público de mandados pendentes não fornece histórico de cumprimento. CNCIAI cobre improbidade/inelegibilidade, não será confundido com criminal.

**Decisões:** coletar somente hosts/rotas fixos, sem URL arbitrária; parser HTML/XML Cheerio compartilhado pelos dois conectores e validação XML estrita com Saxes, rejeitando DTD; nenhuma IA atribui fatos. Correspondência textual de nome é indício, explicitamente não identidade confirmada nem culpa. Data de publicação não vira data do fato. Não marcar cobertura como pesquisada sem revisão humana.

## Contratos

- Tipos em `src/lib/judicialIngestionTypes.ts`.
- `createOfficialJudicialCollector()` retorna `JudicialPageCollector`; um coletor por execução permite baixar RSS uma vez.
- Rotas autenticadas em `/api/admin/judicial/ingestion`: `GET /sources`, `PUT /runs/:id` inicia/reconcilia config, `GET /runs` (recentes), `GET /runs/:id`, `PUT /runs/:id/cancel`, `PUT /runs/:id/resume`, `GET /candidates?politicoId=&status=&limit=&offset=`, `PUT /candidates/:id/dismiss`, `PUT /candidates/:id/import`.
- Run escolhido por UUID estável. Repetir início não cria job novo; conflitos não são retentados cegamente. Lotes com status/afterId/maxPoliticians ou IDs explícitos. Padrão 25 políticos e 2 páginas/fonte; limites100 políticos e5 páginas. Informar truncamento/continuação, nunca cobertura nacional completa.
- Importação exige dados completos e `candidateVersion`, `recordId`, `expectedVersion`; força DRAFT e reutiliza validação/save/auditoria. Publicação posterior segue confirmação atual. Importar novamente mesmo candidato/UUID retorna registro existente; concorrência ou conteúdo alterado gera409.
- HTTP limitado por tempo, bytes e tentativas; respeitar429/Retry-After com limite de espera; validar redirects; texto renderizado como texto, jamais HTML executável.
- Cancelamento persistente, lock compartilhado com ingestão/limpeza; checkpoint e evidência atômicos, HTTP fora da transação. Retomada explícita do cursor após interrupção, sem inferir conclusão por heartbeat.
- Mudança do documento preserva versão/evidência e sinaliza necessidade de nova conferência. Fonte indisponível gera erro/partial, jamais ausência de antecedentes.

## Tarefas e validação

- [x] Conectores/HTTP: testes nome exato delimitado, assunto, conteúdo HTML/XML, data portuguesa STJ, paginação, corpo/redirect/timeout429 e formato inválido.
- [x] Backend: migration aditiva, jobs/checkpoint/cancel/resume/dedupe/auditoria; endpoints protegidos; importação atômica com lógica atual. Testes PostgreSQL isolados, idempotência e privacidade.
- [x] Admin: seleção de fontes/lote/político, progresso recuperável, candidatos e documento/fonte, descarte/revisão no formulário existente; testes e navegador360px.
- [x] Aplicar migration local após backup, executar coleta real limitada e reconciliar resultado; nenhum registro automaticamente publicado.
- [x] Revisão independente, testes integrados, tipos/build, documentação de operação/limites e reversão preservando tabelas.

## Evidências da execução local

- Migration `20261030120000_judicial_ingestion` aplicada após backup da estrutura e dos dados judiciais/migrações. Backups em `output/judicial-ingestion/before-schema.dump` e `before-records.dump`; não representam backup integral nem ensaio de restauração.
- Piloto `067e3c63-9cd4-4bd4-ba12-806f0e63c4cd`: COMPLETED, 25 políticos, 58 checkpoints de páginas/fonte, 34 candidatos associados a 33 documentos, nenhum erro. Todos os candidatos vieram do STF; STJ foi consultado sem correspondências neste lote. Limite de duas páginas atingido em parte das buscas; há continuação de políticos após ID `141459`.
- Reconciliação por HTTP e banco: uma execução, 34 candidatos PENDING, zero registros judiciais e zero publicados. Repetir PUT com mesmo UUID/configuração preservou execução e contadores; endpoint sem autenticação respondeu 401. Relatório agregado em `output/judicial-ingestion/validation.json`.
- 74 testes integrados passaram, incluindo PostgreSQL real isolado, perda da conexão/lock com retomada, idempotência, importação, cancelamento e interface. Relatório `output/judicial-ingestion/tests.json`. `npm run lint` e `npm run build` passaram.
- Navegador: fluxo simulado de iniciar/cancelar/retomar/revisar/importar como DRAFT; consulta real autenticada somente leitura em desktop e 360 px, sem overflow e sem operações de escrita. Capturas `output/judicial-ingestion-real-desktop.png` e `output/judicial-ingestion-real-mobile.png`.
- Revisão independente: corrigidos perda de lock, XML truncado, cancelamento no fechamento, divergência de payload no replay e retomada indevida de PARTIAL. Revisão dos deltas sem novos achados acionáveis.

Os documentos ainda exigem triagem humana: notícia que menciona alguém ou relata audiência pública não comprova condenação/prisão. Nenhum candidato real foi importado nem publicado na validação. Cobertura limitada a estes veículos oficiais, sem alegação de histórico judicial completo.

Sem commit, push, publicação externa ou assinatura de provedor. Preservar integralmente as alterações locais anteriores.
