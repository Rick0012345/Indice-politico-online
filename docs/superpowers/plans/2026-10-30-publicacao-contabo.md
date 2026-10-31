# Publicação do Índice Político na Contabo

> Execução: superpowers:executing-plans, com revisão independente antes de publicar e validação real após a migração.

**Objetivo:** publicar a versão atual do workspace e migrar os dados atuais para a VPS 207.180.239.208, separadamente do PFC/Vínculo, liberando o Docker local.

**Autorização:** usuário autorizou implantação e migração; posteriormente orientou destinar aproximadamente 25% da RAM ao PFC e o restante ao catálogo. Preservar margem para o sistema operacional.

**Arquitetura:** projeto Compose `indice-politico`, PostgreSQL 16 próprio sem porta pública, API e interface de produção. HTTPS inicial em `https://207.180.239.208:9443`, aproveitando o certificado válido para o IP e o nginx existente. PFC permanece em 443. Dados, rede, volumes, configurações e backups separados em `/opt/indice-politico`.

**Decisões:** reutilizar checkout atual com alterações do usuário, sem reset ou commit de trabalho alheio. Empacotar explicitamente o código atual e registrar hashes; não publicar somente o HEAD antigo. Transferir dump novo do banco parado para escrita, acervo judicial e arquivos operacionais necessários. Não levar n8n nem banco de testes. Limites agregados pretendidos: PFC 2 GiB, catálogo até 5 GiB, restante para SO; build temporário limitado e removido após concluir. Credenciais novas fora do repositório. Não executar ingestão externa ou gerar avaliações reais para testar.

## Etapas e validações

- [x] Conferir origem dos dados, configuração VPS, PFC e certificado; capturar estado inicial.
- [x] Preparar Compose, proxy HTTPS, backup e instruções de reversão; revisar isolamento e limites.
- [x] Parar escritores locais, gerar dump atual e manifestos de contagem; preservar volumes e backup local.
- [x] Empacotar código e acervo atual, transferir e compilar na VPS sob limites de CPU/RAM; executar lint/testes relevantes.
- [x] Restaurar banco próprio e conferir contagens/migrations; iniciar catálogo e testar internamente.
- [x] Publicar na porta 9443 após nginx -t; confirmar HTTPS, ranking/perfil/admin/SSE em navegador e continuidade do PFC.
- [x] Configurar backup diário e testar restauração; registrar limites efetivos e consumo; desligar Docker local após migração validada.

## Critérios de aceitação

Dados de origem e destino coincidem por tabela e agregados relevantes; migrations aplicadas sem perda; frontend e API funcionam em HTTPS; admin exige token próprio; PFC segue saudável; limites efetivos conferidos em docker inspect; banco não exposto; dump novo restaurável; acesso e operação documentados sem segredos versionados.

## Transição e reversão

Congelar escritores locais durante exportação. Somente apontar usuário para VPS após validação. Origem local intacta, desligada após sucesso. Para retirada inicial, remover apenas publicação 9443 e parar somente projeto `indice-politico`, mantendo volumes/backups. Se houver novas escritas na VPS, exportá-las antes de qualquer volta à base local; não substituir banco por dump antigo automaticamente. Recarregar nginx somente após teste de configuração; preservar configuração do PFC. Atualização futura exige novo backup e versão identificada.

## Evidências e decisões de execução

- Exportação consistente com escritores locais já parados; apenas PostgreSQL foi ligado para extrair dump novo e depois Docker Desktop foi desligado.
- Dump de 252.156.095 bytes, SHA-256 `ea7abef3a9eed3768d4d2757b6083fee05364716970f51c30ab63e9dbe840f45` validado no destino.
- 42 tabelas, 2.700.599 registros e 18 migrations conferidos; contagens idênticas após restaurar.
- 12.287 arquivos de acervo/cache/logs transferidos e conferidos individualmente por hash. Código identificado em manifesto de 196 arquivos.
- Build e lint aprovados. Suíte inicial: 578 testes aprovados, quatro falhas por fixture financeira sem tabelas judiciais e um worker sem memória (29 testes). Fixture corrigida com as três migrations judiciais, sem alterar regra financeira; repetição de despesas/ranking/proxy: 57 aprovados. Parser STF: 29 aprovados com heap de 1536 MiB. Não houve repetição integral automática.
- Revisão independente detectou e validou correções de confiança em dois proxies, isolamento do limite por visitante e healthcheck com consulta real ao schema usado pela API. Healthcheck validado também com credencial e schema incorretos.
- PFC recebeu teto total de 2 GiB sem reinício; Compose operacional anterior preservado em `/opt/vinculo/resource-policy`. Catálogo limitado a 4992 MiB; margem restante para SO. Builds e testes temporários também limitados.
- Porta inicialmente planejada 8443 descartada: nesta rede, acesso externo apresentou interface OLT e certificado autoassinado `test.org`, diferente do certificado real da VPS. Nenhuma credencial enviada. Site transferido para 9443, verificado externamente sem ignorar TLS, e regra 8443 retirada do firewall.
- HTTPS 9443, rotas públicas, perfil/judicial, admin 401 sem token/200 com token e SSE verificados externamente. PFC segue saudável no endereço original.
- Backup diário instalado às 04:30 America/Sao_Paulo; primeira execução terminou com sucesso. Restauração desse backup em banco temporário aprovada: 42 tabelas, 2.700.599 registros e 12.287 arquivos conferidos. Bancos temporários removidos.
- Origem local preserva dois checkpoints antigos `running` e um `pending`; nenhum worker foi retomado automaticamente e nenhuma nova ingestão foi iniciada nesta migração.
- QA desktop e Pixel7 aprovado nas seis rotas; menu, filtros, comparador e login/logout funcionaram, sem overflow nem erros de console. Sessões de teste encerradas.
- Estado final: cinco containers saudáveis, zero reinícios/OOM; API com usuário PostgreSQL sem superusuário; redes separadas e nenhuma porta pública de banco. Aproximadamente 6,5 GiB disponíveis na VPS na medição final. Docker local desligado.
- Evidências completas em `output/deployment-contabo/verification.json` e `output/playwright/contabo-deploy/resultado-qa.txt`. Credencial administrativa entregue em arquivo privado fora do repositório.
- Escopo concluído. Não houve commit/push ou retomada automática das coletas.
