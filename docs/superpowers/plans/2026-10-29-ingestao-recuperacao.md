# Correção e recuperação da ingestão

> Executar com superpowers:subagent-driven-development, diagnóstico, TDD e revisão independente. Escopo e recuperação autorizados pelo usuário em 29/10/2026 após demonstração A/B da API da Câmara.

**Objetivo:** importar as despesas disponíveis, reprocessar tarefas vazias e atualizar as telas sem perder os dados cadastrados.

**Arquitetura:** preservar a API Câmara e a persistência atômica por página; acrescentar a legislatura correta à identidade da consulta de despesas. Usar a atualização compartilhada do catálogo nas telas existentes. Manter os datasets e o período da execução interrompida (2020-01-01 a 2026-10-29; deputados, despesas, partidos).

**Escolha:** corrigir o parâmetro da API existente, que já retornou 52 itens em 01/2020 e 54 em 01/2025 para o deputado 160592 com a legislatura explícita. A alternativa de importar arquivos anuais aumenta o escopo e não é necessária diante da resposta positiva da API.

## Restrições e transição

- Preservar as alterações locais preexistentes de Ranking, README e autenticação Admin.
- Nenhum DELETE/TRUNCATE de dados de negócio; backup local antes da retomada.
- Encerrar cooperativamente o worker antigo antes de trocar código/retomar; verificar processo e bloqueio.
- Resolver legislatura pelo período mensal, tratando janeiro/fevereiro nos anos de transição. Não usar somente o último status do deputado.
- Migrar somente cursores legados de despesas cuja consulta mudou; reiniciar página 1 e reaplicar upserts. Não relaxar validação genérica de cursores.
- Reabrir concluídos vazios com resetEmpty já existente; preservar concluídos preexistentes com dados. Exceção comprovada: reabrir os 153 checkpoints com dados da primeira retomada afetada pela chave global, identificados e salvos em backup; no baseline inicial não havia despesas. Não apagar documentos para reprocessar.
- Não adicionar datasets à execução real nem iniciar processos concorrentes. Não realizar commit, push ou publicação.

## Tarefas e responsabilidades

- [x] Principal: parada cooperativa, baseline e backup; observabilidade do Admin/servidor com totais de tarefas vazias visíveis e progresso atual sem acumular janelas concluídas.
- [x] Agente ingestão: helper de legislatura mensal e cursores legados, integração em ingest-agent.ts e testes de calendário, retomada, atomicidade e idempotência. Avaliar resultado final com checkpoints falhos.
- [x] Integridade financeira descoberta no piloto: agregar por documento os componentes e estornos distintos, somando em centavos e preservando `sourceEntries` no domínio e raw. Acumulador versionado no cursor mensal mantém consistência entre páginas; cursores sem esse estado reiniciam a consulta, mantendo upserts e sem exclusão de dados. Validar 54 lançamentos de 01/2025 como 49 documentos com soma de R$ 68.570,86, incluindo replay.
- [x] Identidade financeira descoberta na execução real: chave por deputado/competência/código/categoria no banco, Prisma, agregação e raw. Cursor v2 reconstrói agrupamentos anteriores. Migração preservou os 4.133 registros existentes, com hash dos dados idêntico antes/depois; teste real confirmou coexistência do código 0 em dois parlamentares.
- [x] Agente frontend: atualização via catálogo em Partidos, Câmara e Perfil; preservar filtros, extensão paginada, resultados válidos, cancelamento e contexto. Testar eventos durante requisição e troca de contexto.
- [x] Revisão independente e integração: testes focados e suíte com banco isolado, TypeScript/build, revisão dos pontos de recuperação. Validar consulta real controlada antes de retomada ampla.
- [x] Principal: retomar período/datasets originais, reprocessando vazios; confirmar despesas e valores na API/tela, ausência de duplicação no caso controlado e preservação dos IDs de parlamentares anteriores. Entregar estado real e informar que a coleta completa continua se ainda estiver em execução.

## Validação e reversão

Testes novos devem falhar antes da correção. PostgreSQL de teste usa schema isolado. Execução real só após validações; conferir banco, API e navegador separadamente. Backup e baseline preservados fora do repositório. Se a retomada apresentar erro, cancelar cooperativamente e preservar páginas já confirmadas; não restaurar backup indiscriminadamente sobre dados mais novos.

**Transição financeira adicional:** preservar os códigos originais e uma linha por documento/categoria/competência/deputado. A migration `20261029193000_scope_expense_document_identity` cria a unicidade composta antes de retirar a global, em transação e sem modificar linhas. O cursor v2 carrega os componentes confirmados; uma falha na página seguinte não pode dobrar nem descartar valores. Falta de identificador é erro explícito, sem identidade inventada; código 0 é aceito dentro do contexto completo. Raw legado é preservado e novas entradas usam competência/código/categoria sob o deputado. O cadastro curto de partidos foi concluído antes da retomada longa.

## Evidências de validação

- Backup do schema catalogo preservado e validado por pg_restore --list em `C:/Users/po442/.codex/backups/indice-politico/20261029-recovery/before-recovery.dump`.
- Baseline: 1.252 parlamentares; hash dos IDs `29160e708786d536dbe935fd81c774b0`; despesas zeradas. Nenhuma exclusão de dados de negócio.
- Suíte integrada final no Docker, com PostgreSQL de teste em schemas isolados: **213 testes aprovados em 38 arquivos**, sem testes pulados.
- TypeScript/lint e build aprovados; revisão independente sem achados pendentes, incluindo soma financeira e preservação da interface em HTTP 500.
- Worker corrigido contra HTTP real em schema temporário: 01/2020 = 52 documentos / R$ 21.825,46; 01/2025 = 49 documentos / 54 lançamentos / R$ 68.570,86. Replay legado de cada caso manteve quantidade e soma. Resultado salvo em `probe-result.json` junto ao backup.
- Teste real entre parlamentares: código 0 de TELEFONIA/01-2020 manteve R$ 174,63 para 160592 e R$ 303,55 para 178922, sem sobrescrita. Segundo backup `before-scoped-key.dump`; migração manteve assinatura `4133:7ec2ee8c35ed6d1aaa0d6d40eb95365b`. Reabertura dos 153 checkpoints preservou os mesmos 4.133 registros e soma anterior.
- Conferência final às 14h37: todos os 153 checkpoints reabertos estavam concluídos, sem divergência entre somas de despesas e `sourceEntries` originais do raw: ambas R$ 4.236.424,56 no trecho recuperado. A base total tinha 4.430 documentos e R$ 4.304.535,13, continuando a crescer; 21 partidos detalhados e 1.252 IDs de parlamentares com hash inicial preservado.
- API em uso confirmou 52 documentos/R$ 21.825,46 para 160592 em 01/2020; navegador mostrou os 52 resultados. Worker ativo no log `ingest-1793295230144.log`, período 2020-01-01 a 2026-10-29 e datasets deputados/despesas/partidos. A retomada foi verificada; a coleta completa permanece em segundo plano.
