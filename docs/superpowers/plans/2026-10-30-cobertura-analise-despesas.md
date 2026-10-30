# Cobertura, retomada e análise das despesas

> Pacote autorizado pelo usuário em “faça isso”, após a proposta de cinco melhorias. Usar diagnóstico, TDD, execução delegada e revisão independente. Preservar as alterações existentes, inclusive Home/App/CommandPalette de outra frente.

**Objetivo:** concluir as 42 tarefas de despesas rejeitadas, informar o período/cobertura dos valores, distinguir ausência de dados de zero, expor fornecedores/documentos no desktop e fornecer distribuição financeira e comparação mensal com universo explícito.

## Contratos e decisões

- Identidade: manter `cod_documento` oficial nulo quando a Câmara o omitir. Acrescentar coluna técnica nullable e índice único somente para documentos sem código; sem reescrever os 1,3 milhão de registros existentes. Referência de documento e emissor identificam o grupo, sem usar valor monetário na chave. Preservar o payload original e estornos; repetir páginas ou a recuperação não duplica os registros. Rejeitar explicitamente registros que não possuam identificação suficiente, sem descartá-los ou concluir falsamente a tarefa.
- Antes da aplicação local, backup do catálogo e baseline de IDs/valores/checkpoints concluídos. Após revisão/testes, aplicar migration aditiva e retomar somente tarefas falhadas no período original 2020-01-01..2026-10-29. Não reabrir vazios concluídos, não aumentar limite de uma requisição/segundo e dois workers. Não iniciar ingestão de votações nem criar avaliações.
- `expenseAnalyticsTypes.ts` define o contrato compartilhado de cobertura e análise. Cobertura é calculada por competências de checkpoints de despesas, com contagens de concluídos/vazios/pendentes/falhas e parlamentares sem consulta. Ausência de checkpoints nunca significa gasto zero. Consultas sobrepostas não multiplicam competências; a janela mais ampla prevalece, usando a atualização mais recente como desempate.
- Ranking: aceitar `ano` e `mesInicio`/`mesFim` (intervalo inclusivo, requer ano). O filtro aplica-se às despesas; votos e avaliações continuam identificados como seus universos disponíveis. Todos os totais financeiros/ordenação por gastos usam o mesmo período, antes da paginação. Retornar `cobertura`, `totalAvaliacoes`, `notaMedia`, `totalVotacoes`, `votacoesDisponiveis` no topo. `GET /api/despesas/anos` retorna `{items:number[]}` para os seletores.
- Perfil: lista, análise, resumo mensal e média compartilham filtros validados de ano/mês/categoria/faixa de valor e `fornecedorId` opcional. `GET /api/politicos/:id/despesas/analise` retorna `ExpenseAnalysis`, com todas as categorias e dez principais fornecedores + outros. Fornecedor identificado por documento quando disponível; agrupamento somente pelo nome é explicitado. O identificador público para filtro é um hash da identidade, sem expor CPF.
- Distribuição calculada no servidor sobre todo o filtro, sem somar somente linhas carregadas. Percentual no total líquido só quando o denominador for positivo, preservando grupos negativos. Soma de fornecedores principais + outros confere com o total.
- Média: manter média apenas de parlamentares com despesas registradas no mesmo filtro e mês, devolvendo `participantes` por ponto e corrigindo a legenda; não preencher parlamentares sem dados com zero. Gráfico e análise usam o mesmo filtro da lista.
- Ausência: “Sem avaliações” quando a quantidade for zero, “Dados ainda não importados” para votações indisponíveis. Despesa zero com consulta concluída é distinguida de ausência/falha de coleta. Fornecedor e documento aparecem também na tabela desktop, preservando estados de campos ausentes.

## Responsabilidades

- Agente ingestão: agregação, validação, persistência, identidade raw, migration/Prisma e testes associados. Sem executar dados reais ou alterar servidor/telas.
- Agente backend: helpers de filtros/cobertura/análise, rotas em `server.ts` e testes de API. Sem alterar ingestão ou telas.
- Agente perfil: `PoliticoProfile.tsx`, `SpendingChart.tsx` e respectivos testes. Sem editar rotas/helpers/Ranking.
- Principal: Ranking e testes, integração, backups/migration/retomada autorizada e verificações finais.

## Execução e aceitação

- [x] Identidade sem código oficial: TDD com caso real sanitizado, estornos, páginas repetidas, payload distinto, correção e códigos oficiais preservados; PostgreSQL isolado.
- [x] Backend: mesmos filtros/totais/cobertura em ordenações e páginas, janela de meses válida, vazio/pendência, checkpoints sobrepostos, fornecedores sem ID, estornos, soma de grupos e média/participantes.
- [x] Ranking: período, cobertura, ausência de avaliações/votos, paginação e catálogo sem regressão do total global.
- [x] Perfil: análise integral e drill-down, fornecedor/documento desktop, gráfico com mesmo filtro e universo explícito, cancelamento/respostas antigas.
- [x] Revisão independente, testes afetados integrados, lint/build/Prisma e navegador desktop/móvel.
- [x] Backup/baseline, migration, recuperação das tarefas falhadas, reconciliação domínio/raw e preservação de IDs/valores já existentes.

**Reversão:** manter a coluna técnica aditiva e os dados novos ao reverter apresentação/worker; não apagar registros nem restaurar backup por cima de dados válidos. A alteração não modifica contratos antigos de campos financeiros, apenas os amplia. Nenhum commit, push ou publicação está incluído.

## Integração e evidências finais

- Backup completo de `catalogo` antes da migration: `D:/sistema politico/backups/indice-politico/20261030-analise/before-analysis.dump`, 250.913.796 bytes. Baseline comprimida dos IDs/valores de todos os registros anteriores e dos checkpoints concluídos no mesmo diretório. Local escolhido no D: para preservar o espaço livre do C:.
- Migration `20261030010000_expense_source_identity` aplicada localmente após revisão independente e testes. Nenhum backfill e nenhum código oficial inventado.
- Recuperação apenas de despesas na janela original 2020-01-01..2026-10-29, sem `reset-empty`, mantendo dois workers e uma requisição/segundo. Primeiro passo agrupado recuperou 22 tarefas; erros 504 da Câmara motivaram cancelamento cooperativo das 20 restantes e retomada no caminho mensal já testado. Ambas as execuções drenaram; a mensal encerrou com código 0 às 04:12:29 UTC de 30/10. Logs em `logs/ingest-recovery[-monthly]-20261030.log`.
- Fila final: 76.998 tarefas de despesas concluídas, zero pendentes/em execução/falhadas/canceladas. As 42 competências alvo concluíram com 356 lançamentos originais, 336 registros agregados e R$774.397,97 líquidos. Domínio e raw reconciliaram sem divergência.
- Baseline final: todos os 1.302.736 IDs e valores anteriores preservados; zero ausências ou mudanças financeiras. Todos os 76.956 checkpoints previamente concluídos mantiveram status/contagem/xmin. IDs dos 1.252 parlamentares preservados. Catálogo final: 1.303.072 registros e R$1.535.941.070,83 líquidos. Relatórios `baseline-after.json` e `recovery-reconciliation.json` no diretório de backup.
- Verificação independente de resposta vazia da Câmara para janeiro/2026 dos IDs 160527 e 214694, com e sem filtro de legislatura: quatro respostas 200 com `dados: []`, sem tratar payload malformado como ausência. Evidência em `monthly-empty-source-proof.json`.
- Cobertura dos 513 ativos: 42.066/42.066 consultas concluídas. O conjunto de 1.252 cadastros possui 313 políticos históricos sem consultas no intervalo; por isso o filtro Todos mantém indicação parcial (76.998/102.664), sem apresentar sua ausência de consulta como gasto zero. Isso não corresponde a falha na fila programada de 939 parlamentares.
- Revisão encontrou e corrigiu gasto zero em linhas/cards quando não havia importação, URL de outro fornecedor e sobreposição da legenda móvel. Todos os achados foram revisados novamente. Pequeno ajuste de flex no cabeçalho preservou busca, menu e tema e eliminou transbordamento em 320px, sem reverter as funcionalidades da outra frente.
- Consulta de cobertura global: SQL medido de 4.157ms para 435ms ao retirar progresso JSON, rescan por parlamentar e expansão mensal redundante/JIT. GET global observado 2.029ms, filtro 2024 em 922ms. Sem aumentar pool/timeout ou alterar PostgreSQL. Navegador reproduziu dois ciclos com todos os cinco GETs do perfil em 200 e console sem erros; duração ponta a ponta inclui assets e não é inferida desses tempos SQL.
- Distribuição por fornecedor: 27 registros de código zero possuíam originais de fornecedores diferentes (82 originais; R$12.832,07). A projeção financeira agora segmenta por registro/fornecedor e compartilha os filtros entre lista/análise/resumo/média. Um fornecedor mantém ID original; múltiplos usam `id:hash`. Caminho rápido de resumo/média sem fornecedor/faixa de valor mantém a soma sem expandir JSON. Nenhum registro histórico foi alterado.
- Prova real: registro `bae2a155-b043-4cfc-a340-bb2becb79312`, janeiro/2020, parlamentar 204379, conserva R$120,47 no domínio; seus fornecedores recebem R$80,31 e R$40,16 na lista e análise. Links são derivados dos originais do próprio fornecedor e ficam nulos se não houver URL única representativa.
- Validação integrada final: 42 arquivos/301 testes aprovados com PostgreSQL real em schemas isolados. TypeScript, build e Prisma validate concluídos com sucesso. Testes adicionais usam relógio/HTTP simulados; prova real da recuperação e navegador foi feita separadamente.
- Navegador real: Jan–Out/2024 no ranking R$177.397.419,33 estável em ordenação e paginação 50→100. Perfil 160592/2024: 498 registros, R$510.135,02, oito categorias e fornecedores/outros conciliados. Drill-down envia os mesmos filtros aos quatro endpoints. Estornos permanecem negativos. Desktop 1366 e celulares 390/320 inspecionados; legenda fica no fluxo abaixo do SVG, com 12px de separação em 320px.
- Última conferência visual do resumo em 320/1366px confirmou despesas exatas de R$1.535.941.070,83 sem cortar o número/centavos, “Sem avaliações” sem letra isolada e média inteira. As alterações de tipografia preservaram as funcionalidades paralelas e seus cálculos. Evidências desta tarefa foram preservadas em `C:/Users/po442/.codex/visualizations/2026/10/29/01a1880f-7a42-7cd0-b59b-c1c3be16b0e8/coverage-analysis-20261030/`; artefatos de outras frentes foram mantidos no checkout.

As funcionalidades paralelas de Home, comparação e novos indicadores presentes no checkout foram preservadas; não integram a autoria deste pacote. Não houve commit, push ou publicação.
