# Commit e publicação do Índice Político

Autorização desta execução: usuário confirmou publicar o site Indice-politico-online incluindo alterações locais de ranking e dados judiciais em https://207.180.239.208:9443/ranking. PFC/Vínculo permanece no mesmo servidor, porta443.

Escopo: commitar código, testes, migrações, documentação e estrutura de deploy; excluir dados, dumps, logs, sessões de navegador, ambientes e credenciais. Não importar dados antigos sobre a base atual.

- [x] Conferir branch, alterações e manifesto da publicação anterior. Os196 arquivos do manifesto anterior coincidem com o workspace antes da correção desta execução.
- [x] Recuperar acesso SSH usado no chat Verificar VPS para Índice Político e consultar produção sem alteração. Cinco serviços saudáveis;18 migrações aplicadas.
- [x] Revisão independente do código e regressão PostgreSQL em app_test separado. Corrigir processo antigo apresentado como ACTIVE sob consulta posterior sem reobservação. Preservar histórico e identidade; estado atual desconhecido e cobertura parcial quando não revalidado.
- [x] Executar testes e build da versão final, incluindo integração no banco app_test separado.
- [ ] Criar commit exato, empacotar seus arquivos sem dados privados e gerar manifesto de hashes.
- [ ] Gerar backup, construir imagens sob limites, validar e publicar somente serviços api/web do Compose indice-politico.
- [ ] Confirmar SHA das imagens, saúde, HTTPS, APIs e navegador; verificar continuidade do PFC e registrar a versão.

Compatibilidade: marcador lastSeenRunId fica no payload privado; não exige migração. Registros legados não revalidados aparecem UNKNOWN/PARTIAL até nova consulta, sem exclusão de observações.

Reversão: preservar release e imagens anteriores; se falhar saúde, restaurar referência da release e imagens api/web. Não restaurar banco automaticamente nem remover volumes. Não alterar limites ou reiniciar PFC. Mesma cadeia nginx e portas já publicadas.

Validação final: suíte completa no container isolado com app_test.catalogo preparado pelas18migrações:63arquivos/615testes passaram. A regressão processual teve RED real de3falhas e GREEN de10casos. Ranking23/23 e parserSTF29/29 passaram isoladamente. Teste de busca espera requisição debounced antes de varrer DOM; teste17MiB recebe orçamento explícito20s após medições de3,90/4,98s. Nenhum limite de produção foi ampliado. Backup anterior à promoção concluído em /opt/indice-politico/backups/20261031T014919Z. Contagens prévias:1252políticos,1303072despesas,7420observações processuais.
