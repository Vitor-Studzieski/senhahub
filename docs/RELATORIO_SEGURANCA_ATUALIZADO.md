# Relatório atualizado de segurança da informação — SenhaHub

**Data da auditoria:** 22/09/2026  
**Escopo:** projeto completo `inova-supermercado`, incluindo aplicação web, APIs, autenticação, autorização, Supabase/PostgreSQL, armazenamento de mídia, runtime local, CI/CD e dependências.  
**Tipo:** auditoria defensiva de código, configuração e controles disponíveis, sem exploração destrutiva e sem alteração de dados.

## 1. Resultado executivo

Não foi encontrada vulnerabilidade crítica ou bypass de autenticação confirmado. Porém, o ambiente ainda não deve ser considerado 100% protegido enquanto o MFA administrativo permanecer desativado, os limites de requisição não forem uniformes e a separação entre gestor e administrador não estiver definida.

O risco mais importante é o login administrativo sem segundo fator: uma senha válida de `manager` ou `admin` é suficiente para criar uma sessão administrativa.

## 2. Vulnerabilidades e riscos encontrados

### 2.1 Alto — MFA administrativo desativado

O código possui estrutura parcial para TOTP/MFA, mas o fluxo de login cria a sessão imediatamente após a validação da senha. Contas administrativas não exigem segundo fator.

**Impacto:** uma senha administrativa comprometida permite acesso direto às funções de gestão.

**Arquivo principal:** `server/integrations/supabase-runtime.js`.

**Correção recomendada:** reativar o desafio MFA antes da criação da sessão administrativa e validar o fluxo com recuperação segura, expiração e proteção contra tentativas.

### 2.2 Médio — bloqueio de conta por tentativas de login

O limite de tentativas é aplicado por e-mail. Uma pessoa que conheça um e-mail válido pode provocar indisponibilidade temporária dessa conta por meio de tentativas inválidas.

**Impacto:** negação de serviço direcionada contra usuários conhecidos.

**Correção recomendada:** combinar limitação por IP, conta e dispositivo, usando atraso progressivo e evitando bloqueio global rígido baseado somente no e-mail.

### 2.3 Médio — limite de corpo de requisição não uniforme

O servidor standalone possui limite explícito de corpo, mas a rota direta do adaptador Next.js pode entregar o corpo à camada de backend sem uma proteção equivalente antes da leitura completa.

**Impacto:** consumo excessivo de memória e recursos em requisições grandes.

**Arquivos principais:** `app/api/[...path]/route.js` e `server/integrations/supabase-runtime.js`.

**Correção recomendada:** aplicar limite de bytes também no Route Handler e manter limites específicos para autenticação, metadados e upload de mídia.

### 2.4 Médio — separação insuficiente entre gestor e administrador

Os papéis `manager` e `admin` compartilham o grupo de autorização para várias operações. Um gestor pode executar operações administrativas e criar uma conta com perfil de administrador.

**Impacto:** violação do princípio do menor privilégio caso o gestor deva ter somente permissões operacionais.

**Correção recomendada:** separar capacidades por operação e restringir a criação/alteração de administradores ao perfil realmente autorizado, com escopo de loja.

### 2.5 Médio — confiança na configuração de proxy

A identificação do IP e parte da validação de HTTPS dependem de headers encaminhados pelo proxy quando `TRUST_PROXY_HEADERS=1` está configurado.

**Impacto:** se o origin puder ser acessado diretamente, headers como `x-forwarded-proto` poderão ser falsificados, afetando controles de IP, HTTPS e cookies.

**Correção recomendada:** manter o origin protegido por firewall/WAF, garantir que o proxy remova headers recebidos do cliente e validar a configuração real de produção.

**Arquivos principais:** `proxy.js`, `server/server.js` e `server/integrations/supabase-runtime.js`.

### 2.6 Médio — uso centralizado de `service_role`

O backend usa a chave `service_role` para consultas e mutações no Supabase. Existem allowlists de tabelas e RPCs, e o RLS está habilitado, mas `service_role` possui bypass de RLS.

**Impacto:** uma falha no backend ou vazamento da chave pode ampliar muito o alcance de leitura e escrita.

**Correção recomendada:** usar JWT do usuário e RLS para leituras possíveis, reduzir as operações com `service_role`, manter RPCs estreitas e rotacionar a chave em caso de suspeita.

### 2.7 Baixo/Médio — proxy público de vídeos do Instagram

`GET /api/instagram/video` valida corretamente o domínio permitido, mas não possui uma limitação específica por IP, cache ou limite de resposta suficiente para impedir abuso repetitivo.

**Impacto:** consumo indevido de banda, conexões e recursos do servidor. Não foi confirmado SSRF, pois existe validação de host e caminho.

**Correção recomendada:** adicionar rate limit, cache, limite de bytes e permitir somente URLs previamente cadastradas na playlist.

**Arquivo principal:** `server/integrations/instagram-video.js`.

### 2.8 Baixo — páginas estáticas legadas sem redirecionamento

As páginas `/marketing-tv.html` e `/tablet.html` não estão incluídas no mapa de redirects legado. Podem ser abertas diretamente como cascas estáticas, embora as APIs correspondentes continuem protegidas.

**Impacto:** exposição de interface antiga e aumento da superfície pública; não foi identificado acesso direto a dados protegido por esse caminho.

**Correção recomendada:** redirecionar as páginas para as rotas oficiais ou removê-las do conjunto publicado.

**Arquivos principais:** `proxy.js` e `server/server.js`.

### 2.9 Baixo — bucket de mídia da TV público

O bucket público é necessário para a reprodução dos conteúdos na TV. Entretanto, vídeos inativos ou em rascunho continuam potencialmente acessíveis se a URL for conhecida, e o bucket não possui limites próprios de tamanho e MIME configurados no Supabase.

**Impacto:** exposição de conteúdos não publicados e falta de defesa em profundidade contra arquivos inadequados.

**Correção recomendada:** separar publicação de rascunho, restringir o acesso de objetos não publicados e configurar limites de tamanho/MIME no Storage, além da validação existente no backend.

### 2.10 Baixo — proteção contra senhas vazadas desativada no Supabase Auth

O Security Advisor do Supabase indica que a proteção contra senhas comprometidas está desativada. O projeto possui validações próprias em alguns fluxos, mas elas não substituem a proteção global do provedor.

**Correção recomendada:** ativar a proteção contra senhas vazadas no Supabase Auth e testar criação, alteração e recuperação de senha.

### 2.11 Baixo — ações de CI/CD sem fixação por SHA

Os workflows usam versões móveis como `@v2`, `@v3` e `@v4` para ações de terceiros. O pipeline possui secret scanning, CodeQL, auditoria de dependências e revisão de dependências, mas as ações não estão fixadas em commits imutáveis.

**Impacto:** risco de cadeia de suprimentos caso uma tag de ação seja comprometida ou alterada.

**Correção recomendada:** fixar ações por SHA completo e revisar periodicamente os commits aprovados.

**Arquivo principal:** `.github/workflows/security.yml`.

## 3. Controles positivos confirmados

- `npm audit --omit=dev`: 0 vulnerabilidades de produção.
- `npm run check`: passou.
- `npm test`: 125 testes passaram, 0 falharam e 1 foi ignorado por depender de PostgreSQL real.
- `npm run preflight:production`: passou.
- RLS ativo nas tabelas principais do Supabase.
- Políticas de dados usando `auth.uid()` para restringir registros do usuário.
- Cookies de sessão com `HttpOnly`, `Secure` em produção e `SameSite=Strict`.
- Proteção CSRF nas operações mutáveis autenticadas.
- Validação de origem nas rotas sensíveis de MFA e push.
- Allowlist de tabelas e RPCs usadas pelo runtime Supabase.
- Validação de domínio para o proxy de vídeos do Instagram; nenhum SSRF confirmado.
- Nenhuma chave real encontrada no histórico versionado durante a busca realizada.
- Nenhum XSS confirmado na revisão dos principais fluxos dinâmicos.

## 4. Verificações no Supabase

O Security Advisor retornou:

- **Aviso:** proteção contra senhas vazadas desativada.
- **Informativo:** dez tabelas internas com RLS sem policies públicas. Essas tabelas são acessadas pelo backend com credenciais internas e permanecem deny-by-default para `anon` e `authenticated`; não foi classificado como vulnerabilidade confirmada.

Também foi confirmado que as tabelas de perfis, permissões, tickets, sessões e notificações possuem RLS e policies ativas. Não foram encontradas permissões públicas de execução nas RPCs sensíveis verificadas.

## 5. Conclusão e ordem de correção

Prioridade recomendada:

1. Reativar e validar MFA para `admin` e `manager`.
2. Corrigir a separação de permissões entre gestor e administrador.
3. Aplicar limite uniforme de corpo e rate limiting nas rotas públicas.
4. Confirmar firewall/WAF, HTTPS, proxy confiável e proteção do origin em produção.
5. Ativar proteção contra senhas vazadas no Supabase Auth.
6. Restringir rascunhos de mídia e configurar limites do Storage.
7. Corrigir redirects das páginas legadas e fixar actions do CI por SHA.

Até que os itens 1, 2 e 4 sejam validados, a aplicação deve ser classificada como protegida parcialmente, e não como totalmente protegida para exposição administrativa na Internet.

## 6. Limitações da auditoria

Não foram validados diretamente: firewall e WAF reais, exposição do origin, configuração efetiva do domínio de produção, variáveis implantadas, logs, permissões do provedor Git, backups externos, restauração, dispositivos físicos e configurações fora do repositório.

Esta auditoria não executou brute force, DDoS, phishing, payloads destrutivos, exploração contra produção ou alteração de banco.
