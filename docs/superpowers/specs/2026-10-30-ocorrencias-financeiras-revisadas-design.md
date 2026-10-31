# Ranking de ocorrências financeiras revisadas — proposta de desenho

Data: 30/10/2026. Estado: proposta para aprovação de escopo; não implementada.

## Objetivo e decisão confirmada

Ordenar parlamentares pela quantidade de fatos financeiros distintos que permanecem pertinentes à análise. Cada posição deve ser explicável pelos casos e documentos que a compõem.

Decisão expressa do usuário: o ranking será **público após revisão dos casos**. Alertas automáticos, rascunhos e notas internas não podem ser consultados publicamente.

A contagem simples é a abordagem recomendada nesta proposta. Pesos de gravidade, probabilidade de corrupção e nota de integridade não fazem parte da primeira versão. A aprovação deste documento concentra a escolha da abordagem e do escopo antes de implementação.

## Alternativas consideradas

1. **Contagem de casos únicos revisados e ainda abertos — recomendada.** Responde diretamente a “quais políticos têm mais casos a analisar”; permite explicar cada unidade e evitar pesos arbitrários. Mede volume documentado de trabalho, não propensão a irregularidades.
2. **Pontuação ponderada.** Responde a uma pergunta diferente, prioridade segundo pesos escolhidos; exige critérios e calibração adicionais. Gravidade e valor podem ser apresentados como contexto, sem somar pontos nesta versão.

## Contexto atual confirmado no código

- `src/ingest-agent.ts` usa a API da Câmara. `src/lib/expensePersistence.ts` preserva fornecedor, documento, valores e dados de origem.
- `src/lib/expenseAggregation.ts` conserva lançamentos financeiros distintos, glosas e estornos, e remove repetições técnicas do mesmo conteúdo.
- `src/lib/expenseQueries.ts` reconstrói lançamentos financeiros; reutilizar esses contratos sem somar novamente linhas consolidadas e originais.
- `src/lib/expenseAnalytics.ts` e `expenseAnalyticsTypes.ts` calculam despesas, fornecedores e cobertura dos checkpoints.
- `src/lib/rankingQueries.ts` já separa métricas, filtros e paginação global.
- O projeto tem autorização administrativa, componentes administrativos e infraestrutura de revisão do catálogo. Reutilizar a infraestrutura compatível, preservando regras específicas de cada domínio.
- Esta inspeção não demonstra completude do banco, funcionamento de integrações futuras ou resultados reais do algoritmo.

## Escopo proposto para a primeira versão

1. Núcleo determinístico para identificar, agrupar e manter ocorrências financeiras com evidências e versões.
2. Detecção inicial de **possível repetição de documento em reembolsos da Câmara**, gerando somente candidatos privados. Resultado do detector não equivale a revisão.
3. Cadastro administrativo de casos sustentados por documentação oficial. Só integra a métrica comparável quando pertence ao mesmo escopo sistematicamente analisado e às mesmas regras aplicadas aos demais parlamentares. Ocorrências de pesquisa avulsa ficam identificadas como complementares e fora dessa ordenação até haver escopo uniforme.
4. Revisão administrativa com aprovação, descarte, esclarecimento, retirada e trilha de alterações.
5. Nova métrica “Ocorrências a analisar” no ranking e lista pública dos casos publicados em cada perfil, com metodologia e cobertura.

Receita, TSE, CEIS/CNEP, Senado, emendas, Transferegov e PNCP continuam como frentes posteriores. Não simular cruzamentos ou assumir disponíveis esses dados. Uma fonte externa pode fundamentar um caso cadastrado e revisado, sem ser apresentada como integração automática.

## Algoritmo de contagem

Para parlamentar `p`, janela temporal `W` e revisão atual do catálogo:

```text
elegiveis(p, W) = casos em que:
  há associação documental revisada com p;
  a versão atual foi aprovada para publicação;
  o caso continua aberto para análise;
  a referência temporal do fato pertence a W;
  o caso integra o escopo uniforme de regras e fontes do ranking,
    sem ser uma ocorrência complementar de pesquisa avulsa;
  nenhuma evidência essencial está invalidada ou pendente de revalidação;
  o caso não foi substituído por outro em uma fusão.

totalPublico(p, W) = COUNT(DISTINCT casoCanonicoId de elegiveis(p, W))
```

Ordenação principal: total decrescente. Empates usam nome e identificador estável, sem desempate por partido, avaliações populares, condenações, gasto total ou quantidade de notícias. A direção inversa respeita a mesma regra para dados não analisados.

A posição representa **casos revisados abertos identificados no escopo analisado**. Não representa todos os fatos existentes sobre o parlamentar. Revisores diferentes e diferentes ritmos de análise podem alterar a quantidade publicada; a comparação tem de explicitar esse limite.

## O que constitui um caso

Um fato ou padrão financeiro delimitado, sustentado por documentos e associado expressamente ao parlamentar. Não é uma notícia, um sinal, uma linha da API nem o simples compartilhamento de fornecedor.

- Vários sinais sobre a mesma cobrança integram um caso.
- Vários lançamentos que compõem uma hipótese de duplicidade integram um caso, preservando todos os documentos.
- Dois fatos independentes podem gerar dois casos, mesmo com o mesmo fornecedor.
- Não usar componentes transitivos de uma rede de fornecedores para fundir automaticamente fatos independentes.
- Caso com vários parlamentares exige associação e fundamento documental por pessoa. Conta uma vez para cada associado aprovado; não atribuir responsabilidade de terceiros ao parlamentar por proximidade política ou destinação de emenda.

O identificador canônico do caso é persistente. A chave de detecção é separada e versionada, formada pelo tipo de regra e referências normalizadas dos documentos que sustentam a hipótese. Reexecutar o detector é idempotente e não recria candidatos descartados sem mudança material das evidências.

Antes de criar ou publicar, procurar sobreposição entre documentos e fatos de casos existentes, inclusive cadastros manuais e saídas de outras regras. Um novo lançamento ligado a um grupo existente deve atualizar esse candidato; não criar automaticamente um caso concorrente. Sobreposição ambígua bloqueia a publicação até decisão de manter fatos independentes ou fundir, sem fusão transitiva por fornecedor.

Fusão e separação de casos são operações administrativas auditadas. Fusão não duplica a contagem. Qualquer mudança material de escopo, evidências ou associações exige aprovação explícita da versão resultante, tanto em fusão quanto em separação. O caso sobrevivente não herda automaticamente aprovações incompatíveis dos casos anteriores.

## Detector inicial: possível repetição de documento

Consome os lançamentos oficiais reconciliados e suas referências originais. Não trata uma nova página de ingestão ou uma cópia idêntica do JSON como nova cobrança.

Para formar um grupo candidato, exigir identificação suficiente do emissor e do documento, incluindo número e referências complementares disponíveis, como série, data e comprovante. Não agrupar apenas por nome ou valor. Campos insuficientes geram pendência de qualidade, não caso público.

Somar o líquido conforme a semântica da origem; não descontar glosas duas vezes. Considerar estornos, correções, parcelas e rateios antes de alegar repetição de reembolso. Valores iguais não bastam para presumir documento igual; documentos iguais não bastam para presumir duplicidade indevida.

O detector apresenta ao revisor os lançamentos, a hipótese e os motivos pelos quais ela pode ser legítima. A aprovação exige explicar a inconsistência ainda não esclarecida. Nunca publicar automaticamente a palavra fraude ou um prejuízo calculado sem sustentação.

## Sinais de contexto

Gasto alto, concentração em um fornecedor, empresa recente, sócios comuns, relação com campanha, notícia ou processo judicial não geram isoladamente um caso nesta primeira versão. Não entram na contagem por composição arbitrária de pistas fracas.

Identidade não pode ser confirmada apenas por nome, e CPF ocultado não será completado. Cadastro societário atual não prova composição histórica. Sanção exige confirmação de identidade, período e alcance aplicável à operação; presença em cadastro de sanções não invalida automaticamente qualquer despesa.

## Revisão e publicação

Estados do fluxo editorial:

| Estado | Visibilidade e contagem |
|---|---|
| Candidato / em revisão | Privado; fora de toda contagem pública. |
| Publicado e aberto | Caso revisado visível; integra a contagem. |
| Revalidação necessária | Evidência essencial mudou; retirado da contagem até nova aprovação. |
| Descartado | Privado se nunca publicado; fora da contagem. |
| Esclarecido / retirado | Fora da contagem; se já foi público, preservar aviso público de correção ou desfecho. |

Aprovar exige: identidade e associação confirmadas, descrição factual, motivo de análise, documentos oficiais, referência temporal, regra/versão quando automática, justificativa de revisão e texto público separado das notas internas.

A aprovação cobre a versão exata do caso e das evidências. Mudança material posterior invalida essa aprovação. Não republicar automaticamente versões corrigidas. Reabertura exige nova revisão, mantendo a identidade do caso e o histórico.

Cada evidência financeira referencia a versão ou impressão digital dos lançamentos oficiais usados. Ao reingerir correção, glosa, rateio ou estorno que possa alterar a hipótese, reavaliar os casos dependentes e suspender sua elegibilidade antes de considerar atualizada a projeção pública. A identificação de dependências e a suspensão pertencem à mesma transação da alteração financeira; o trabalho posterior do detector pode ser assíncrono. Falha na suspensão deve impedir a confirmação daquela alteração, evitando manter uma afirmação antiga sobre dados financeiros já corrigidos.

Atualização concorrente: exigir versão esperada e bloquear a aprovação de uma versão antiga. Alteração do estado, associação, decisão editorial, auditoria e projeção pública devem ocorrer na mesma transação. Após confirmar a transação, invalidar a revisão do catálogo e os consumidores afetados.

Reutilizar a autorização administrativa existente. O registro de auditoria não pode prometer identidade individual de revisor se a autenticação disponível usa token compartilhado. Registrar ator autenticado disponível, horário, versão anterior, nova versão e justificativa; nomes digitados não equivalem a identidade autenticada.

## Dados públicos e privados

A projeção pública usa lista explícita de campos: identificador, título factual, descrição aprovada, motivo, referência temporal, associação ao parlamentar, fontes, valores comprovados com seu significado, data de revisão e estado público.

Excluir por construção notas internas, candidatos não revisados, documentos privados, tokens e identificadores pessoais completos desnecessários. Aplicar o mesmo filtro em ranking, perfil, detalhe, exportação e respostas de erro. Um identificador conhecido não permite consultar um candidato privado por rota pública.

Para caso anteriormente publicado que precise de revalidação, substituir a projeção por um aviso mínimo de suspensão, data e motivo público aprovado ou texto neutro fixo. Retirar descrições e evidências invalidadas, inclusive de detalhes e exportações; não servir a versão pendente nem deixar a versão antiga acessível por identificador. Histórico interno permanece intacto. Invalidar caches e revisão do catálogo após a transação; consumidores devem descartar respostas com revisão antiga ao receber a mudança. Resultados anteriormente baixados por terceiros não podem ser revogados.

Ranking e perfil precisam consultar a mesma regra de elegibilidade. Nenhuma lista pode exibir um número cujo conjunto de casos não possa ser explicado. Contagem, ordenação, filtro e paginação devem ser globais, sem ordenar apenas uma página já carregada.

## Período, cobertura e valores desconhecidos

- Reutilizar o contrato existente de filtros de despesas: `ano` opcional, `mes` ou `mesInicio`/`mesFim` dentro do mesmo ano. Na nova métrica esses filtros selecionam a competência do caso. Não alterar implicitamente o período das métricas judiciais ou populares. Sem filtro anual, considerar todo o escopo financeiro explicitamente analisado.
- O filtro usa a competência do fato, confirmada na revisão. Data de descoberta ou publicação não desloca um fato antigo para o período atual. Casos sem referência temporal ficam privados até definição fundamentada.
- A referência de um padrão que abrange vários meses é o primeiro fato que compõe a hipótese; os demais meses são mostrados no detalhe. Essa convenção evita contar novamente o mesmo padrão em cada mês.
- Comparar a mesma janela e tipo de mandato. A primeira versão cobre deputados da Câmara.
- Distinguir cobertura de extração, execução das regras, qualidade dos campos e revisão editorial. Checkpoint concluído não demonstra qualidade integral nem revisão concluída.
- O estado comparável exige a mesma janela, fontes, versão de regras e conjunto de critérios de inclusão para todos os integrantes. Para cada pessoa: todos os checkpoints esperados concluídos; detector concluído sobre a revisão financeira vigente; zero documentos abrangidos pela regra com campos obrigatórios ausentes; zero candidatos desse escopo com decisão editorial pendente. Documentos fora do escopo seguem exclusões fixadas previamente por regra, com quantidades informadas. Não escolher limites de qualidade por parlamentar.
- Qualquer uma dessas condições ausente torna o escopo parcial; sem execução do detector, o escopo é não analisado. Nova evidência material ou revisão pendente rebaixa cobertura completa para parcial. Pesquisa manual complementar não promove cobertura e fica fora do número comparável. Fontes e regras que nunca foram incluídas não são declaradas cobertas.
- `null`/“Não analisado” para escopo sem processamento suficiente; não converter ausência de análise em zero.
- Zero significa “nenhum caso revisado aberto publicado no escopo analisado”, nunca “nenhuma irregularidade”. A interface também informa se a revisão está em andamento, sem divulgar a quantidade de candidatos privados.
- Resultados parciais apresentam a contagem pública observada com aviso e ficam em grupo separado, sem posição na classificação comparável. Se ainda não existe caso publicado e a revisão não foi concluída, mostrar “Em análise” em vez de zero. Registros não analisados aparecem sem posição, ao final, em ambas as direções.
- A ordem fixa de grupos é comparáveis, parciais, não analisados. Inverter direção altera a ordem numérica somente dentro do grupo comparável, sem promover dados desconhecidos. A lista parcial usa nome e identificador para não criar uma classificação implícita entre coberturas diferentes.
- Número de documentos, meses de exercício e valor total analisado são contexto. Não dividir a contagem por cobertura para inventar casos ausentes e não apresentar taxas de bases pequenas como estimativas confiáveis.

## Contratos de implementação propostos

Criar domínio `financialCases`, sem reutilizar o significado dos registros judiciais. Separar tipos, regras puras, detector, persistência transacional, projeção/consultas públicas e rotas. Uma função comum de elegibilidade sustenta todas as superfícies.

Persistir casos canônicos, associações por parlamentar, versões de evidências, decisões de revisão, auditoria e cobertura por pessoa/período/regra. Valores financeiros usam centavos ou Decimal; entradas não finitas e datas inválidas são recusadas. Reutilizar normalização e reconciliadores compatíveis já existentes.

Integrar a métrica adicional em ranking, perfil e metodologia. Usar sessão e cliente administrativos existentes para a fila de revisão. Preservar métricas populares/judiciais e as alterações atuais do checkout.

## Aceitação e validações necessárias

1. Quatro sinais do mesmo fato produzem um caso; dois fatos independentes do mesmo fornecedor continuam separados.
2. Reingestão, páginas repetidas, correções e estornos não multiplicam casos nem valores.
3. Caso privado, descartado, esclarecido, fundido ou com versão pendente não entra na contagem pública; testar diretamente APIs, detalhe e exportação.
4. Aprovação concorrente com edição ou correção de evidência não publica versão obsoleta; falha de transação não deixa contagem e detalhe divergentes.
5. Aprovar, retirar, reabrir, fundir e esclarecer recalculam ranking e perfil sem alterar nota popular ou contagens judiciais.
6. Ordenação é correta para todo o conjunto antes da paginação; empates são estáveis. Cobertura parcial e ausência de análise não viram zero conclusivo.
7. Navegador: revisão administrativa, acesso não autorizado, filtros, detalhe público, recálculo entre telas, estados vazios/parciais e layout móvel.
8. Antes de disponibilizar resultados reais, revisar amostra dos candidatos e registros sem alerta, por regra e qualidade de dados. Medir falsos alertas, duplicações, concordância da triagem e carga de trabalho. Não prometer precisão ou pesos validados sem medição.

Nenhuma validação de implementação foi executada nesta etapa: o artefato é o desenho proposto.

## Transição e reversão

Migração aditiva; iniciar sem casos públicos. Processamento inicial gera somente candidatos administrativos. Habilitar a nova métrica quando houver cobertura identificável e casos aprovados, ou apresentar estado vazio explícito sem posição.

Reversão: desabilitar as rotas e a métrica financeira, preservando casos, decisões, evidências e auditoria para recuperação. Não apagar dados nem alterar métricas existentes. Commit, push, migração de banco e publicação não estão sendo executados nesta etapa de desenho.
