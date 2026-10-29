# Atualização automática do catálogo

Objetivo autorizado: ranking e novos parlamentares aparecerem sem recarregar a página, mantendo filtros, rolagem e quantidade carregada.

Abordagem: PostgreSQL NOTIFY por transação nas tabelas politicos, despesas, votos_deputados e avaliacoes; API mantém um único LISTEN por processo e distribui avisos SSE sem dados pessoais. Avisos agrupados, sem executar agregações por cliente continuamente. Reconexão invalida o catálogo para recuperar eventos perdidos. Hook cliente compartilhado por página e uma conexão por aba; eventos disparam recarga suave limitada, com descarte de respostas obsoletas. Sem n8n para esse fluxo.

Contrato: GET /api/catalogo/events envia event: catalogo com data JSON {revision:string}; envia snapshot da revisão ao conectar; heartbeats em comentários. GET /api/catalogo/revision fornece {revision:string} para fallback leve. Header no-cache/no-transform e X-Accel-Buffering:no. Revisão é opaca, muda ao invalidar ou reconectar listener; não representa quantidade de registros. Hook src/hooks/useCatalogUpdates.ts recebe callback e retorna estado 'connecting'|'live'|'reconnecting'|'paused'|'offline'. Retoma ao voltar para aba e mantém fallback leve quando SSE indisponível. Callback agrupado, sem sobreposição de recargas por contexto.

- [x] Backend: migration transacional de triggers, hub SSE testável, listener PostgreSQL com reconexão/limpeza, revisão leve. Testar commit/rollback, esquema correto, múltiplos clientes e desconexão.
- [x] Frontend: hook compartilhado e Ranking; recarregar prefixo inteiro já carregado, manter filtros/scroll, descartar páginas antigas e mostrar status/horário. Aplicar mesmo mecanismo aos destaques/novos da Home se compatível. TDD com eventos, falha, troca de filtro e paginação.
- [x] Integrar migration em Docker local, sem parar importações em andamento nem inserir dados falsos no catálogo real. Nginx suporta streaming.
- [x] Revisão independente, testes, TypeScript/build e navegador: simular respostas/eventos para regressões e conferir evento verdadeiro após commit em schema descartável. Não iniciar importação externa nem avaliar político real.

Compatibilidade: endpoints atuais preservados; notificação é apenas invalidação, consultas continuam autoritativas. Nenhum dado histórico transformado. Trigger reversível por DROP TRIGGER/FUNCTION; versão antiga ignora eventos. DDL usa timeout para falhar sem bloquear importação por tempo indefinido. Estado local do cliente não é substituído por uma resposta de filtro anterior.

Validação em 28/10/2026: 98 testes aprovados em 22 arquivos, incluindo PostgreSQL em banco de teste dedicado e migrado; TypeScript e build aprovados; revisão independente concluída. Navegador: novos registros e alteração de líder simulados, 100 linhas carregadas mantidas, rolagem 1100→1100, filtros preservados, consultas lentas sem interrupção por eventos e responsividade desktop/celular. Catálogo real recebeu eventos da importação em andamento sem dados falsos. Streaming e página retornaram HTTP 200 tanto no proxy de desenvolvimento quanto no Nginx temporário com o build de produção. Container web e banco temporários removidos após validação.
