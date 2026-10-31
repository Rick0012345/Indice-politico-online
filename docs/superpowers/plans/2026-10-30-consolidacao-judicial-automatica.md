# Consolidação judicial automática

> Execução autorizada: usuário exige dados prontos, sem pesquisa, revisão ou preenchimento manual; autoriza IA/Codex. Preservar mudanças existentes, dados e fontes. Usar implementação delegada e revisão independente.

**Objetivo:** ampliar pessoas pesquisadas e transformar documentos oficiais em atributos públicos estruturados e sem repetição por processo, sem exigir trabalho do usuário.

**Diagnóstico:** somente 27/1252 pessoas pesquisadas; filtro não reconhece “é condenada” e cargo “licenciada”; ordenação de seleção usa alias textual id enquanto continuação usa bigint. Nove notícias sobre Daniel não equivalem a nove casos. Groq está integrado no projeto, mas sem chave neste ambiente; não depender de contratação/credencial para completar a automação local.

**Fluxo:** fontes oficiais -> evidência de evento atribuída à pessoa -> extração de processo/tribunal/motivo/datas disponíveis -> consolidação por político, tribunal, processo e tipo de evento -> publicação automática com fontes e auditoria -> perfil/ranking/comparador existentes. O Codex confere os resultados reais nesta execução. Eventos sem elementos suficientes permanecem informativos no diagnóstico administrativo, sem formulário obrigatório e sem alegação pública inventada.

**Contratos:**
- `JudicialRecordInput.eventDate` aceita `string|null`; `convictionStatuses.UNKNOWN` indica condenação relatada sem situação atual identificada; `custodyTypes.UNKNOWN` não presume modalidade.
- `JudicialRecordInput.sources?` contém URLs/rótulos oficiais de apoio; `automation?` guarda versão e vínculo às evidências de origem, sem expor notas internas. Registros manuais mantêm comportamento compatível.
- `extractJudicialFacts(document, person): JudicialExtraction` em `src/lib/judicialAutoExtract.ts`. Tipos em `judicialAutomationTypes.ts` fornecidos pelo principal. Retorna fatos com trechos e processo verificável; sem número inventado, sem data de publicação como data do fato, sem trânsito deduzido da prisão.
- Consolidação automática em módulo próprio reaproveita transação/save/auditoria e candidatos existentes; une fontes do mesmo processo, escolhe informação temporal compatível, evita repetição e preserva correções posteriores. Uma execução repetida não cria novos casos nem auditoria desnecessária.
- Coleta ampla percorre população neutra em ordem numérica. Modificações não podem reiniciar API durante execução ativa; estabilizar código antes de coletar.

## Etapas

- [x] Contratos compatíveis, ordenação numérica e testes de continuação.
- [x] Extração automática e correções conservadoras do filtro, testes de positivos/negativos/datas/processos/reversões.
- [x] Persistência consolidada, deduplicação, publicação automática e auditoria; integração no trabalhador e reprocessamento dos documentos já existentes.
- [x] Interface com casos e fatos prontos, fontes reunidas e estados desconhecidos claros; coleta sem etapa manual obrigatória; navegador desktop/celular.
- [x] Coleta ampliada, conferência real por Codex, registros públicos de mais pessoas e prova de ausência de duplicação.
- [x] Revisão independente, testes de contrato/integração, tipos/build e documentação das limitações reais.

**Limites de afirmação:** ausência de correspondência significa “não identificado nas fontes”, nunca “nunca foi preso/condenado”. Documento incompleto não autoriza inventar processo ou data. Anulação/reversão não conta como condenação vigente. Fontes são reutilizadas e acessadas com limites HTTP existentes. Não publicar em produção, fazer commit/push, instalar serviços ou usar credenciais inexistentes.

**Reversão:** código anterior pode ser restaurado preservando evidências e auditoria. Antes de publicação local automatizada, backup das tabelas judiciais; eventos automáticos identificáveis por metadados permitem retirar publicação sem apagar fontes.

## Resultado local verificado

- Acervo oficial: 12.267 notícias únicas das consultas `conden` e `preso`; 1.181 documentos correspondentes a nomes do catálogo. Processamento completo em 13 lotes, cobrindo 1.252 políticos.
- 13 registros publicados em 9 pessoas: 12 registros históricos de condenação e 1 de prisão. O total identificado é 10, pois a reversão de Paulinho e a prescrição total de Roberto Góes não contam. Dois casos têm situação definitiva extraída explicitamente; os demais não são presumidos definitivos.
- Consulta adicional aos andamentos públicos do STF confirma absolvição posterior na AP 965, incorporada automaticamente com prova e hashes privados. Indulto de Maluf não foi tratado como absolvição, e Aníbal recebe o fundamento remanescente informado na decisão posterior.
- Repetição real: 0 criados, 0 atualizados, 13 inalterados; 0 duplicatas e 0 novas auditorias. As APIs públicas não expuseram campos privados. Há 18 documentos sem elementos suficientes para extração automática, mantidos no diagnóstico.
- Testes: suíte final de 197 testes aprovada; depois do ajuste de tamanho do documento processual, 36 testes de retomada/adaptador aprovados. Tipos e build aprovados. Revisão independente concluiu correções de atribuição entre processos.
- Navegador: Daniel, Carla, Paulinho e Maluf conferidos em 1440×1000 e 390×844, sem overflow nem fontes duplicadas por caso. Administração sem formulário obrigatório. Evidências em `output/playwright/judicial-auto-*.png`.
- Fonte AP 1044 tem aproximadamente 9,6 MB: limite do adaptador processual ajustado para 16 MiB, preservando 4 MiB nos coletores de notícias. O lote interrompido foi retomado com o mesmo UUID e terminou COMPLETED.
- Prova consolidada: `output/judicial-ingestion/automatic-local-result.json`; backup anterior válido: `output/judicial-ingestion/before-automatic.dump`. A carga não representa todo o Judiciário e não criou agenda recorrente.
- Código e dados aplicados somente no ambiente local. Sem commit, push ou publicação em produção.