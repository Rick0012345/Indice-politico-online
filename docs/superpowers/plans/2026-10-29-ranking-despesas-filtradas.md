# Total de despesas de todos os parlamentares do filtro

> Execução autorizada pelo pedido do usuário. Aplicar diagnóstico, TDD, execução delegada e revisão independente de forma proporcional; preservar as alterações anteriores e a ingestão em andamento.

**Objetivo:** o card Despesas representa a soma já importada de todos os parlamentares que correspondem ao filtro. Ordenação, limite e página não alteram o conjunto somado. Filtros e mudanças reais nos dados podem atualizar o total.

**Contrato:** `GET /api/politicos/ranking` acrescenta `totalDespesas: number`, incluindo zero em filtros vazios e valores negativos de estornos. O agregado SQL usa os mesmos IDs de `filtrados`, sem multiplicação por avaliações ou votos. Reutilizar o agregado por parlamentar na listagem; não criar endpoint nem consulta do navegador para carregar todos os registros.

**Interface:** consumir somente o total global da resposta, sem fallback para a soma parcial. Guardar o resultado associado ao filtro (pesquisa, status e cargo), preservando-o durante mudanças de ordenação. Respostas canceladas ou de filtros antigos não atualizam o card. Filtro novo sem resposta mostra indisponibilidade; cargo não suportado e filtro vazio mostram zero. Atualizações do catálogo continuam atualizando o total. Texto: “Todos os parlamentares do filtro”. Os outros cards mantêm seus significados atuais.

**Arquivos e responsabilidades:** agente de backend modifica somente o endpoint em `src/server.ts` e `src/server.ranking.test.ts`; principal modifica `src/pages/Ranking.tsx` e seu teste. Validador de UI inspeciona navegador; revisor independente confere o conjunto, sem edições concorrentes.

- [x] Backend: RED/GREEN PostgreSQL isolado para ordenação, paginação, pesquisa, status, vazio, estornos e ausência de multiplicação.
- [x] Frontend: RED/GREEN para 50→100 itens, Nota/Gastos/Maior/Menor, filtros, estado sem metadados, respostas antigas e atualização do catálogo.
- [x] Integração: testes afetados, TypeScript/build, revisão independente, navegação desktop/móvel e conferência da API real com o banco.

**Risco e reversão:** alteração aditiva no contrato, sem migration ou transformação dos dados. Reverter apenas o novo campo e consumo se necessário, preservando todas as mudanças anteriores. Não alterar as regras da ingestão ou reabrir períodos concluídos; valores podem variar legitimamente com novos lançamentos durante a verificação real.

## Evidências

- Backend: 13 falhas RED reproduzidas pela ausência do total global; 22 testes GREEN em PostgreSQL real com schema isolado.
- Interface: cinco testes RED exibiam a soma parcial; os dez testes da tela passaram após consumir o total da API. Execução integrada principal: 32/32 testes (tela e servidor), TypeScript e build sem falhas.
- Revisão independente do SQL, metadados e controle de concorrência: sem achados acionáveis. Navegador com dados controlados confirmou total constante em 50→100, Nota→Gastos→Menor; filtros, vazio, ausência de metadados e cargo não suportado conferiram.
- API real e card: R$67.478.429,81 com 50 de 513 ativos, confirmado por leituras antes e depois do navegador. São valores já importados, sujeitos ao avanço da coleta.
- API real com filtro de um parlamentar: R$479.363,95 em Nota/desc, Gastos/desc, Gastos/asc e offset fora da coleção. O PostgreSQL confirmou 169 documentos e o mesmo valor.
- Após a recarga local da API às 19:37:58 UTC, o coletor anterior estava inativo e sete tarefas continuavam `running`. A conferência preservou os 79.947 documentos da baseline e seus valores, todos os 1.252 parlamentares e os 5.864 checkpoints concluídos da baseline; 4.844 competências conferiram com os originais sem divergência. As sete tarefas órfãs foram liberadas e a mesma fila retomada às 19:40:40 UTC, sem reabrir meses concluídos, mantendo janela e datasets originais. O novo log confirmou avanço normal e nenhuma falha/retry na observação inicial.
- A validação visual encontrou centavos quebrando em outra linha no celular. Ajuste localizado separa o prefixo “R$” do número indivisível, com fonte 14px abaixo de 360px, 16px a partir de 360px e 24px a partir de 640px. Reteste com R$135.061.611,85 em 320/390/1366px: nenhum transbordamento, número e centavos juntos, tamanho desktop preservado. Dez testes da tela, TypeScript e build repetidos após o ajuste: aprovados.
- Evidências do navegador preservadas fora do repositório em `C:/Users/po442/.codex/visualizations/2026/10/29/01a1880f-7a42-7cd0-b59b-c1c3be16b0e8/ranking-global-total-ui/`.
