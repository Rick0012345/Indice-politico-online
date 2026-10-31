# Condenações efetivas na ingestão judicial

> Execução autorizada pela correção do usuário: não quer denúncias/processos, quer condenações. Aplicar diagnóstico, TDD, implementação delegada e revisão independente; preservar checkout existente.

**Objetivo:** eliminar da fila de condenações e prisões documentos cuja associação decorre apenas de palavras-chave ou menção do nome.

**Causa confirmada:** `candidate()` aceita qualquer nome completo e qualquer palavra judicial no documento inteiro. O teste anterior aceitava explicitamente pedido de prisão negado. A importação validava estrutura, mas não a correspondência do evento com a evidência armazenada.

**Decisão de produto:** aceitar como candidato somente relato explícito de condenação atribuída ao político, prisão efetivamente cumprida ou reversão de condenação identificada. Denúncia, inquérito, recebimento de acusação, pedido/voto de condenação, mandado não cumprido, absolvição sem condenação anterior e fatos de terceiros não bastam. Evidência textual é seleção conservadora para conferência, não prova automática da identidade ou situação atual. Não inferir trânsito em julgado, data do fato ou vigência. Reversões ficam identificadas e não contam como condenações vigentes.

**Arquitetura:** um classificador determinístico compartilhado retorna trechos positivos por pessoa. Coletor e armazenamento usam a mesma função; listagem apresenta os trechos por associação, sem gravá-los no documento compartilhado. Importação valida o tipo do registro contra o snapshot corrente, após conferir versão e antes de gravar o rascunho. Cadastro manual e publicação revisada permanecem disponíveis. Não haverá classificação externa por IA, novas credenciais ou dependências.

**Compatibilidade:** preservar snapshots e auditoria. Reavaliar o lote local anterior e descartar apenas candidatos pendentes sem evidência positiva, pela operação administrativa versionada, registrando motivo. Registros já importados não serão alterados. Não apagar documentos nem modificar contadores históricos das execuções.

## Contrato

- `assessJudicialEvidence(document: {title: string; text: string}, person: JudicialIngestionPerson): JudicialEvidence[]` em `src/lib/judicialEvidence.ts`.
- `JudicialEvidence`: `{kind: 'CONVICTION' | 'IMPRISONMENT'; excerpt: string; matchedName: string; status: 'REPORTED' | 'REVERSED'}`. REPORTED significa evento relatado, sem presumir situação atual.
- `JudicialCandidate.evidence?: JudicialEvidence[]`: calculada pelo servidor para a associação específica. A interface impede iniciar revisão quando ausente/vazia e mostra o trecho.
- Importação de CONVICTION requer evidência CONVICTION; IMPRISONMENT requer IMPRISONMENT. Se só houver reversão, não aceitar formulário APPEAL/FINAL.

## Execução e aceitação

- [x] Classificador e coletor: testes positivos e negativos reais/sintéticos, inclusive negação, terceiros, hipótese, voto isolado e mandado. Zero inferência de estado atual.
- [x] Repositório: guarda em armazenamento e importação, retorno por pessoa, idempotência intacta, regressões PostgreSQL.
- [x] Interface: trechos e tipo de evento, regra explícita, revisão bloqueada para candidato legado inelegível; validação de comportamento e navegador.
- [x] Reclassificar lote local sem apagar evidências; validar uma nova coleta real, informar resultado e limites.
- [x] Revisão independente focada, testes integrados, tipos/build, documentação e diff check.

## Evidências e ajustes de revisão

- Os testes novos reproduziram quatro falhas no backend anterior. Após integração, testes PostgreSQL passaram. A revisão independente revelou atualização da fonte descartada antes de invalidar candidato, reversão posterior na mesma frase e defaults indevidos ao trocar o tipo no formulário; corrigidos com regressões. Regressão adicional cobre RSS STJ corrigido sem o nome original.
- `observedDocuments` preserva snapshots inelegíveis para associações existentes; backend carrega as chaves existentes uma vez por página e nunca cria candidato novo por essa observação. A mesma transação atualiza snapshot, versão e checkpoint. Conteúdo removido do escopo da fonte não pode ser observado automaticamente.
- Backup antes da reclassificação: `output/judicial-ingestion/strict-before.dump`. Os 34 candidatos anteriores passaram para DISMISSED via API administrativa versionada, com motivo; nenhum documento excluído nem registro público criado.
- Piloto real `c9af0bcc-0342-481b-8771-15dbf48f188b`: COMPLETED, duas pessoas, nove páginas/fonte, nove documentos candidatos, zero erros, limite de páginas atingido em parte do escopo. Os documentos elegíveis descrevem condenação ou prisão de Daniel Silveira explicitamente. Não representam nove condenações e não determinam situação atual. Evidências em `output/judicial-ingestion/strict-evidence.json`.
- Navegador real em 1440 e 360 px: nove candidatos com trechos, nenhum sem evidência; revisão de condenação e prisão mantém data/situação/modalidade sem inferência, DRAFT. Sem gravações no navegador e sem overflow. Capturas em `output/playwright/judicial-evidence-real-positive-*.png` e `judicial-evidence-real-excerpt-360.png`.
- Validação: suíte integrada em `strict-tests.json` (124 aprovados e duas expectativas STJ corrigidas enquanto a execução já carregara módulo anterior); reexecução afetada `strict-final-regressions.json` com classificador/coletor/PostgreSQL atualizados passou. Checagem de tipos e build aprovados. Nenhum erro pendente.

**Validação crítica:** relato de condenação com denúncia no histórico deve passar; notícia apenas de denúncia não. Mesmo documento sobre duas pessoas não transfere condenação de uma à outra. Condenação anulada não vira FINAL/APPEAL. Ausência de candidato não comprova ausência de condenação. Falsos negativos conservadores são aceitáveis para triagem, falsos positivos conhecidos devem ser bloqueados.

Sem commit, push ou produção. Reversão por código preserva dados e notas de descarte; evidências ficam disponíveis para revisão manual.
