# Auditoria completa de segurança da informação — SenhaHub

**Data:** 2026-09-10  
**Escopo:** repositório local `inova-supermercado`, aplicação web, APIs, autenticação, Supabase/PostgreSQL, runtime local, PWA, QR Code, Web Push, Realtime e impressão.  
**Tipo:** auditoria defensiva de código e configuração disponível, sem exploração destrutiva e sem acesso administrativo a serviços de terceiros.

## 1. Resultado executivo

O SenhaHub apresenta uma base técnica acima do mínimo para um sistema de filas: sessões em cookies HttpOnly, tokens de sessão armazenados por hash no runtime local, CSRF em mutações, validação de origem para rotas sensíveis, rate limiting, consultas SQL parametrizadas, migrations com RLS, tokens físicos separados para impressão, filas duráveis e testes automatizados de concorrência.

Foram identificados dois problemas de código com correção segura nesta auditoria:

1. A rota local `GET /api/local-postgres/queue` consultava a fila completa sem exigir autenticação, expondo nomes, IDs e tickets ativos quando as flags do backend local estavam ligadas.
2. O runtime standalone acumulava o corpo bruto de algumas requisições sem limite explícito, criando risco de exaustão de memória/CPU em rotas locais, de impressão e do adaptador Supabase.

Os dois pontos foram corrigidos e receberam testes de regressão.

O principal risco aberto é de prioridade alta: o login administrativo Supabase cria a sessão imediatamente após senha válida, embora exista implementação parcial de TOTP/MFA no código. O próprio fluxo registra que o MFA administrativo está temporariamente desativado. Assim, uma senha de `manager` ou `admin` continua sendo suficiente para uma sessão administrativa.

Na linha de base desta auditoria também havia riscos de implantação e hardening: confiança em `x-forwarded-proto` se o origin pudesse ser acessado diretamente, CSP de produção com `unsafe-inline`, possível bloqueio abusivo de contas pelo mecanismo de tentativas, divulgação do nome do cliente atualmente chamado no tracking público, fronteira pouco diferenciada entre `manager` e `admin`, uso centralizado de `service_role` como ponto único de autorização e ausência de evidência de CI/CD com SAST/SCA/secret scanning.

### Atualização de implementação — 2026-09-10

As mudanças solicitadas dos itens 4 a 10 foram implementadas após a linha de base acima:

- **Item 4 / QR público:** removido `currentCustomerName` da resposta pública de acompanhamento.
- **Item 5 / login:** bloqueio definitivo não é aplicado a IP desconhecido; IPs conhecidos têm limitação por janela e os testes de falha continuam registrados.
- **Item 6 / isolamento:** adicionada validação de loja entre perfis, setores e tickets físicos, migration de trigger e preflight de RLS/permissões para banco real.
- **Item 7 / `service_role`:** adicionadas allowlists explícitas de tabelas e RPCs acessíveis pelo runtime Supabase.
- **Item 8 / CI/CD:** adicionados CI com check/test/build/audit, secret scanning, CodeQL e Dependabot.
- **Item 9 / CSP:** removido `unsafe-inline`; páginas usam nonce por resposta e o CSP está coberto por teste de regressão.
- **Item 10 / continuidade:** adicionados manifest/status externo de backup, verificação de idade, criptografia, integridade e restauração em diretório temporário, além de timer systemd de verificação.

O preflight via CLI contra o banco Supabase real inicialmente não conseguiu resolver o hostname do projeto (`ENOTFOUND`); a validação autorizada pelo conector Supabase está registrada abaixo. A verificação offsite e o restore ainda dependem de fornecer um diretório externo e uma chave de backup no ambiente operacional.

### Validação Supabase autorizada — 2026-09-10

Após autorização do proprietário, a validação foi executada pelo conector Supabase no projeto `SenhaHub` (`ACTIVE_HEALTHY`):

- RLS habilitado nas 30 tabelas públicas verificadas.
- `profile_sector_store_boundary` e `tickets_physical_store_boundary` presentes.
- 0 permissões de perfil/setor atravessando lojas.
- Migration `security_isolation_round2` aplicada no projeto.
- Os 122 tickets físicos históricos foram reclassificados para os setores equivalentes da Loja 2; 0 inconsistências físicas permanecem.
- Nove tabelas internas continuam protegidas por RLS sem policies, resultando em deny-by-default; o advisor classifica isso como informativo.
- O advisor ainda aponta a proteção contra senhas vazadas do Supabase Auth desativada; isso requer ativação no painel/configuração do projeto.
- O projeto usa o papel interno `service_role` com `BYPASSRLS`; as RPCs de impressão são `SECURITY INVOKER` e precisam dos grants internos para funcionar, então a redução foi feita nas allowlists do runtime e das RPCs v2. O bypass residual do papel ainda existe.

### Veredito

**Não há evidência de vulnerabilidade Critical no código auditado.**  
**A liberação de telas administrativas para a Internet não deve ser considerada concluída antes de MFA administrativo, confirmação do proxy/TLS e validação externa do ambiente de produção.**  
**O código corrigido passou pelo check, testes, build e auditoria de dependências.**

## 2. Limites, premissas e metodologia

### Evidência analisada

- Código de `app/`, `server/`, `proxy.js`, `next.config.js`, `public/`, `scripts/`, `supabase/migrations/`, `deploy/` e testes.
- Arquivos de configuração de exemplo e documentação operacional.
- Histórico Git e estado de arquivos rastreados para procura de `.env`, chaves e tokens.
- Testes locais sem brute force real, sem phishing, sem DDoS, sem ransomware e sem alteração destrutiva de banco.

### Não foi possível validar somente pelo repositório

- Regras efetivas no projeto Supabase/Vercel em produção, configuração Auth/MFA, logs, domínios e variáveis realmente implantadas.
- Firewall, Cloudflare/WAF, exposição do origin, Nginx real, systemd real, permissões do host e portas externas.
- Backup offsite/imutável, retenção e restauração em ambiente separado.
- Impressoras, totens, tablets, credenciais físicas e fluxo operacional da loja.
- Proteção de branches, CI/CD, secret scanning e permissões do provedor Git.

As conclusões nesses itens estão marcadas como **RISCO ARQUITETURAL**, **HARDENING** ou **INFORMATIONAL**, e não como comprovação de comprometimento.

### Regras de segurança da execução

Não foram enviados payloads destrutivos, não foram tentadas credenciais reais, não houve varredura externa, não foi feito brute force, e nenhum backup, migration ou banco produtivo foi alterado.

## 3. Arquitetura e superfície de ataque

### Arquitetura observada

1. **Frontend:** Next.js 16.3.4, React 19, páginas para cliente, login, atendente, tablet, totem, TV e administração.
2. **Entrada de API:** `app/api/[...path]/route.js` para o runtime Supabase e diversas rotas Next em `app/api/local-postgres/`.
3. **Runtime standalone:** `server/server.js`, que pode servir Next, adaptar requisições para o runtime Supabase ou encaminhar rotas locais.
4. **Backend Supabase:** REST/Auth com `SUPABASE_SERVICE_ROLE_KEY` exclusivamente no servidor; RLS e funções SQL nas migrations.
5. **Backend local:** PostgreSQL local opcional, autenticação local, sessões persistidas e isolamento por setor/loja no repositório local.
6. **Impressão:** totem, tablet, agente local, fila durável, tokens de dispositivo, leases, fencing e Realtime privado.
7. **Clientes especiais:** PWA/Service Worker, QR de acompanhamento, Web Push, TV e telas de operação.
8. **Infraestrutura documentada:** exemplos de Nginx, systemd e timers de backup; não foram encontrados Dockerfiles ou configuração real de Cloudflare no repositório.

### Superfícies expostas

| Superfície | Exposição | Controles encontrados | Observação |
|---|---|---|---|
| Login e recuperação | Internet | cookies HttpOnly, CSRF, rate limit, política de senha | MFA admin ainda desligado |
| Estado do cliente | autenticado | vínculo por `customerId`, sessão e CSRF em mutações | revisar DTO público |
| Tracking por QR | bearer token | token aleatório, TTL, rate limit, somente leitura | nome do cliente atual ainda aparece |
| Atendimento | equipe autenticada | função + setor, transações e testes de concorrência | `manager/admin` têm escopo amplo |
| Administração | manager/admin | proxy de páginas e `requireUser` | fronteira entre os dois papéis é fraca |
| Totem/tablet | dispositivo/sessão | token, cookie assinado, CSRF, vínculo físico | depende da segurança física e do segredo |
| Impressão v2 | agente autorizado | token, lease, fencing, idempotência, Realtime privado | integração PostgreSQL real não rodou neste ambiente |
| Web Push | usuário autenticado | allowlist de endpoint, CSRF, preferências e RLS | chave privada não vai para o cliente |
| Jobs internos | segredo de cron | `CRON_SECRET`, Bearer/header e comparação segura | cron efetivo precisa de validação externa |
| Proxy de Instagram | Internet | hosts, paths e CDNs allowlisted | não foi identificado SSRF confirmado |
| Saúde/configuração | pública | resposta reduzida | validar se não há necessidade de esconder flags operacionais |

## 4. Modelo de ameaça resumido

### Ativos

- Dados de clientes, nomes, e-mails, tickets e histórico.
- Operação de filas, prioridade e chamadas.
- Administração de usuários, setores, lojas e métricas.
- Impressão física, totens, tablets e tokens de dispositivos.
- Chaves Supabase, banco, sessão, VAPID, cron e agente de impressão.
- Disponibilidade da fila durante o horário da loja.

### Adversários considerados

- Usuário cliente tentando acessar outro cliente.
- Atendente tentando operar fora dos setores permitidos.
- Manager tentando obter funções de admin.
- Visitante sem sessão consultando APIs locais.
- Atacante externo com token de QR, endpoint de push ou informação de e-mail.
- Atacante com acesso parcial ao host, backup, logs, proxy ou pipeline.
- Operador malicioso com acesso físico a totem/tablet/agente.

### Caminhos de alto impacto

1. Comprometer uma conta admin sem MFA.
2. Obter `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `AUTH_SECRET` ou token de impressão.
3. Publicar o origin HTTP sem firewall/proxy confiável.
4. Escalar de cliente/atendente para dados ou operações administrativas.
5. Interromper filas com saturação de memória, lockout abusivo ou falha no único host.

## 5. Resumo quantitativo dos achados

| Classificação do achado | Quantidade | Tratamento |
|---|---:|---|
| CONFIRMADO | 4 | 2 corrigidos; 2 abertos |
| PROVÁVEL | 1 | aberto |
| RISCO ARQUITETURAL | 3 | abertos, dependem de decisão/configuração |
| HARDENING | 2 | abertos |
| INFORMATIONAL | 1 | validação externa pendente |
| **Total** | **11** | **2 correções aplicadas** |

| Severidade | Total | Abertos após esta auditoria |
|---|---:|---:|
| CRITICAL | 0 | 0 |
| HIGH | 2 | 1 |
| MEDIUM | 7 | 6 |
| LOW | 2 | 2 |

`INFORMATIONAL` aparece como classificação de status em SEC-011; sua severidade operacional é LOW.

## 6. Achados detalhados

### [SEC-001] Fila local acessível sem autenticação

- **Severidade:** HIGH
- **Status do achado:** CONFIRMADO
- **Estado de tratamento:** CORRIGIDO
- **Categoria:** Broken Access Control / Excessive Data Exposure / isolamento de loja
- **CWE:** CWE-862, CWE-200
- **OWASP:** A01:2021 Broken Access Control; A02:2021 Cryptographic Failures por exposição de dados
- **Componente:** API local PostgreSQL / fila de atendimento
- **Arquivo e linha:** `app/api/local-postgres/queue/route.js:1-22` (correção); implementação anterior consultava `getQueueSnapshot` sem sessão
- **Endpoint:** `GET /api/local-postgres/queue` e mapeamento standalone em `server/server.js`

**Descrição:** antes da correção, a rota verificava apenas `DATA_BACKEND` e `LOCAL_POSTGRES_ROUTES_ENABLED`, aceitava requisição sem cookie e chamava `getQueueSnapshot(sectorId)`. O snapshot retornava todos os setores abertos e tickets de espera, incluindo `customer_id`, `customer_name`, setor, número, código, status e prioridade.

**Causa raiz:** a rota foi criada como consulta técnica e não reutilizou a barreira de autenticação/escopo já presente em `staff/state` e `tablet/status`. O parâmetro `sector` ainda permitia escolher o filtro, mas não constituía autorização.

**Exploração segura:** com as duas flags locais ligadas, uma chamada sem `cookie` para o endpoint não precisava de sessão. A reprodução usada após a correção é a mesma chamada sem cookie e agora retorna HTTP 401 sem consultar o banco.

**Impacto:** visitante anônimo poderia obter a fila ativa de uma ou mais lojas/setores, com nomes de clientes e identificadores internos. Não havia mutação, mas havia violação de confidencialidade e potencial vazamento cross-store.

**Evidência:** a implementação corrigida exige `requireLocalUser(request, ["attendant", "manager", "admin"])`, usa `getLocalStaffState(user.session.user)`, aplica `cache-control: no-store` e não aceita filtro arbitrário como mecanismo de autorização.

**Correção implementada:** autenticação obrigatória, autorização por papel e escopo de setor, resposta sem cache e reaproveitamento do DTO de equipe.

**Teste de regressão:** `tests/security-regression.test.js` verifica HTTP 401 para visitante sem sessão; `npm run test:local-route` também retornou 401.

**Risco residual:** `manager` e `admin` continuam globais por desenho atual. A autorização efetiva do PostgreSQL local e a separação entre lojas precisam ser confirmadas com um banco real antes da liberação.

### [SEC-002] Acúmulo ilimitado de corpo bruto em rotas do servidor standalone

- **Severidade:** MEDIUM
- **Status do achado:** CONFIRMADO
- **Estado de tratamento:** CORRIGIDO
- **Categoria:** Availability / Resource Exhaustion
- **CWE:** CWE-400, CWE-770
- **OWASP:** A04:2021 Insecure Design; API4:2023 Unrestricted Resource Consumption
- **Componente:** adaptador HTTP standalone e rotas locais/Supabase/impressão
- **Arquivo e linha:** `server/server.js:135-136, 796-817, 1618-1652`
- **Endpoint:** qualquer POST/PUT/PATCH encaminhado pelo runtime standalone que usasse `readRawRequestBody`

**Descrição:** o leitor bruto acumulava todos os chunks na memória até `end`. O leitor legado `readBody` já tinha limite, mas o caminho raw usado por rotas locais, Supabase e impressão não tinha limite próprio.

**Causa raiz:** dois leitores de corpo evoluíram separadamente e somente um recebeu limite.

**Exploração segura:** o teste constrói um stream de 1.000.001 bytes sem enviar tráfego à rede. O leitor agora rejeita com `PAYLOAD_TOO_LARGE`; nenhum ataque de volume foi executado.

**Impacto:** um cliente poderia provocar consumo de memória e aumentar latência, especialmente em servidor local exposto diretamente.

**Correção implementada:** limite de 1 MB, drenagem segura do stream, erro tipado e retorno HTTP 413 pelo `handleApi`. O limite cobre o adaptador local, o adaptador Supabase e a API de impressão que passam pelo leitor raw.

**Teste de regressão:** `tests/security-regression.test.js`; `npm test` passou.

**Risco residual:** `server/integrations/supabase-runtime.js:readJson` usa `Request.text()` quando executado diretamente pelo runtime Next. O provedor/servidor Next deve manter limite de body, e o proxy de produção deve impor um limite compatível. Recomenda-se confirmar esse limite no ambiente publicado.

### [SEC-003] MFA administrativo implementado, mas desativado no login

- **Severidade:** HIGH
- **Status do achado:** CONFIRMADO
- **Estado de tratamento:** ABERTO
- **Categoria:** Authentication / Missing MFA
- **CWE:** CWE-308
- **OWASP:** A07:2021 Identification and Authentication Failures; ASVS V2
- **Componente:** login Supabase de `manager` e `admin`
- **Arquivo e linha:** `server/integrations/supabase-runtime.js:293-328`; suporte parcial em `:330-457`
- **Endpoints:** `POST /api/auth/login`, `POST /api/auth/mfa/verify`, `POST /api/auth/mfa/cancel`

**Descrição:** o login valida e-mail/senha, limpa as falhas e chama `createAuthSession(..., false)`. O comentário no código informa que MFA/TOTP administrativo está temporariamente desativado. As funções de enrollment/challenge/verify existem, mas não são chamadas a partir do login administrativo e a UI de login não apresenta uma etapa de código.

**Causa raiz:** a implementação de MFA foi preparada, mas o rollout foi deixado para backlog; a emissão da sessão continua sendo o caminho padrão.

**Exploração segura:** não é necessário tentar senha real: a leitura do fluxo mostra que qualquer credencial válida de perfil administrativo chega à criação de sessão com `mfaVerified: false`. O risco foi avaliado estaticamente, sem autenticar uma conta.

**Impacto:** roubo, reutilização ou phishing da senha de uma conta administrativa leva diretamente a acesso a usuários, setores, dispositivos, métricas e operação. Esta é a principal pendência antes de exposição pública.

**Evidência:** `startAdminMfaChallenge` cria enrollment/challenge; `verifyMfa` só cria a sessão com `mfaVerified: true` após código válido; porém `login` ignora esse fluxo.

**Correção recomendada:** ativar MFA obrigatório para `manager/admin`, criar UI de enrollment e verificação, impedir sessão administrativa completa antes do challenge, revogar enrollment pendente ao cancelar, manter códigos de recuperação armazenados de forma segura e definir procedimento break-glass auditado. Cobrir login sem código, código inválido, expiração, replay e remoção de fator.

**Correção implementada:** não implementada nesta auditoria, pois a UI e a política de enrollment precisam ser fechadas antes de bloquear administradores existentes.

**Teste de regressão necessário:** login administrativo só retorna sessão final após TOTP válido; cliente não pode escolher `mfaVerified` no corpo ou cookie.

**Risco residual:** HIGH até MFA ser ativado e validado em staging/produção.

### [SEC-004] Lockout de login pode permitir negação de serviço por e-mail

- **Severidade:** MEDIUM
- **Status do achado:** PROVÁVEL
- **Estado de tratamento:** MITIGADO NO CÓDIGO; VALIDAR EM PRODUÇÃO
- **Categoria:** Authentication / Account Lockout DoS
- **CWE:** CWE-645, CWE-307
- **OWASP:** A07:2021 Identification and Authentication Failures
- **Componente:** rate limit de login Supabase
- **Arquivo e linha:** `server/integrations/supabase-runtime.js:293-304, 3276-3284`
- **Endpoint:** `POST /api/auth/login`

**Descrição:** a chave de tentativa é `${clientIp}:${email}`. Quando `TRUST_PROXY_HEADERS` não está habilitado no runtime Supabase, `clientIp` retorna `unknown`; nesse cenário, cinco tentativas inválidas para um e-mail podem compartilhar a mesma chave independentemente da origem real.

**Causa raiz:** a proteção mistura lockout por conta e endereço IP e usa um fallback comum quando o proxy confiável não está configurado.

**Exploração segura:** não foi feito brute force. A análise do código e os testes existentes confirmam o limiar de bloqueio; a exploração teórica é enviar tentativas inválidas para um e-mail conhecido até o lockout.

**Impacto:** disponibilidade da conta durante a janela de bloqueio. Não é bypass de autenticação, mas pode interromper uma conta administrativa ou operacional.

**Correção recomendada:** usar atraso exponencial e rate limit combinado por IP confiável, conta e ASN/edge; evitar lockout rígido compartilhado por todos os clientes; manter mensagem uniforme; alertar o dono da conta sem permitir reset abusivo. Validar que `TRUST_PROXY_HEADERS=1` só é usado atrás de proxy que remove headers recebidos do cliente.

**Correção implementada:** IP desconhecido não gera lockout definitivo compartilhado; IPs conhecidos têm rate limit próprio e as falhas continuam registradas para auditoria.

**Teste de regressão necessário:** uma origem não pode bloquear globalmente uma conta; múltiplas falhas devem atrasar e limitar sem permitir enumeração.

**Risco residual:** LOW/MEDIUM, dependente da configuração do proxy confiável e da calibração operacional dos limites.

### [SEC-005] Confiança em `x-forwarded-proto` sem autenticação do proxy

- **Severidade:** MEDIUM
- **Status do achado:** RISCO ARQUITETURAL
- **Estado de tratamento:** ABERTO / DEPENDENTE DE INFRA
- **Categoria:** Transport Security / Trusted Proxy Configuration
- **CWE:** CWE-345
- **OWASP:** A05:2021 Security Misconfiguration
- **Componente:** enforcement HTTPS do runtime Supabase e servidor standalone
- **Arquivo e linha:** `server/integrations/supabase-runtime.js:3292-3298`; `server/server.js:838-842, 4555-4557`
- **Endpoint:** todas as APIs em produção

**Descrição:** o código considera a requisição segura quando a URL é HTTPS ou quando `x-forwarded-proto` é `https`. Isso é correto atrás de Nginx/Vercel/Cloudflare que terminam TLS, removem headers externos e mantêm o origin inacessível; é insuficiente se o origin aceitar HTTP diretamente.

**Causa raiz:** o código não possui allowlist de proxies nem autenticação do salto que injeta o header.

**Exploração segura:** a hipótese é reproduzível em uma instalação que exponha o Node diretamente: um cliente HTTP poderia enviar `x-forwarded-proto: https` e passar o teste de protocolo. Não foi feita tentativa contra um host real.

**Impacto:** APIs poderiam aceitar tráfego HTTP direto e a confiança em cookies/headers de segurança ficaria dependente de configuração externa.

**Correção recomendada:** terminar TLS no proxy, remover headers de forwarding recebidos do cliente, aceitar forwarding somente de proxy confiável ou usar uma variável explícita com allowlist de rede; bloquear o origin por firewall/loopback. Confirmar `Secure`/HSTS após a cadeia real.

**Correção implementada:** o servidor standalone e o runtime Supabase só aceitam `x-forwarded-proto`/`x-forwarded-host` quando `TRUST_PROXY_HEADERS=1`; sem essa flag, usam a conexão direta e ignoram headers forjados.

**Teste de regressão necessário:** origin HTTP direto retorna 426 mesmo com header forjado; proxy aprovado consegue servir HTTPS; acesso à porta de aplicação fora do proxy é bloqueado.

**Risco residual:** LOW/MEDIUM até a cadeia TLS/origin e o bloqueio do origin serem comprovados na infraestrutura.

### [SEC-006] CSP de produção usa `unsafe-inline` — corrigido

- **Severidade:** MEDIUM
- **Status do achado:** HARDENING
- **Estado de tratamento:** CORRIGIDO NO CÓDIGO; VALIDAR EM PRODUÇÃO
- **Categoria:** Browser Security / XSS Mitigation
- **CWE:** CWE-693, CWE-79
- **OWASP:** A05:2021 Security Misconfiguration; A03:2021 Injection
- **Componente:** Next e runtime standalone
- **Arquivo e linha:** `next.config.js:13`; `server/server.js:2952-2958`; `server/integrations/supabase-runtime.js:3336-3340`

**Descrição histórica:** `script-src` em produção permitia `'unsafe-inline'`. A auditoria não encontrou XSS confirmado.

**Causa raiz:** scripts e estilos inline foram mantidos para compatibilidade com as telas atuais.

**Impacto:** maior capacidade de execução caso uma injeção de HTML/JS seja introduzida em feature futura.

**Correção recomendada:** remover inline scripts, usar nonce por resposta para scripts inevitáveis, hashes para blocos estáticos, CSP Report-Only durante migração e depois enforcement; preservar `object-src 'none'`, `base-uri 'self'` e `frame-ancestors 'none'`.

**Correção implementada:** removido `unsafe-inline`; páginas usam nonce por resposta e os estilos não permitem inline. O runtime standalone e o proxy também foram alinhados.

**Teste de regressão necessário:** cabeçalho sem `unsafe-inline`, páginas carregam, CSP report não registra violações e nenhum sink de HTML recebe input do usuário.

**Risco residual:** LOW, condicionado à validação dos headers no proxy de produção.

### [SEC-007] Tracking público expunha o nome do cliente atualmente chamado — corrigido

- **Severidade:** LOW
- **Status do achado:** CORRIGIDO NO CÓDIGO
- **Estado de tratamento:** FECHADO NO CÓDIGO; VALIDAR EM PRODUÇÃO
- **Categoria:** Privacy / Excessive Data Exposure
- **CWE:** CWE-359, CWE-200
- **OWASP:** A01:2021 Broken Access Control; A02:2021 Cryptographic Failures
- **Componente:** acompanhamento por QR Code
- **Arquivo e linha:** `server/integrations/supabase-runtime.js:1018-1067`; DTO equivalente em `server/server.js:4250-4265`
- **Endpoint:** `GET /api/tickets/track` e alias de acompanhamento com token

**Descrição histórica:** o token de QR é bearer e permitia ao portador consultar o estado da senha. O DTO público incluía `currentCustomerName`, que é o nome do cliente cuja senha está atualmente chamada naquele setor, não necessariamente o dono do QR.

**Causa raiz:** o DTO público reutiliza informação de estado usada pela TV/atendente.

**Exploração segura:** qualquer portador de um QR válido pode ler o JSON dentro do TTL. Não foi capturado QR real nem consultado serviço externo.

**Impacto:** divulgação limitada de nome de cliente a terceiros que vejam, fotografem ou obtenham o QR; o token aleatório de 32 bytes, TTL de 24 horas, referrer-policy e rate limit reduzem o risco, mas não eliminam a exposição.

**Correção recomendada:** remover `currentCustomerName` do DTO público e mantê-lo somente em DTO autenticado de staff/TV; avaliar TTL menor, revogação após atendimento e nunca registrar tokens completos em logs.

**Correção implementada:** `currentCustomerName` foi removido de `publicTicketView` no runtime Supabase e no servidor standalone. A informação continua disponível apenas nos DTOs internos/autenticados.

**Teste de regressão necessário:** tracking continua mostrando número/status/posição do próprio ticket, mas não contém `currentCustomerName` nem outros nomes.

**Risco residual:** LOW pelo caráter bearer do QR e pelo TTL; o endpoint deve continuar sem registrar tokens completos em logs.

### [SEC-008] Fronteira entre `manager` e `admin` não é efetivamente diferenciada

- **Severidade:** MEDIUM
- **Status do achado:** RISCO ARQUITETURAL
- **Estado de tratamento:** ABERTO
- **Categoria:** Privilege Separation / Authorization
- **CWE:** CWE-269, CWE-266
- **OWASP:** A01:2021 Broken Access Control; A04:2021 Insecure Design
- **Componente:** papéis administrativos e gerenciamento de usuários
- **Arquivo e linha:** `server/server.js:170, 2844-2889, 2934-2941`; runtime Supabase `:80, 1586-1600, 2276-2300, 3120-3123`
- **Endpoints:** administração de usuários, setores, métricas, totens e operação

**Descrição:** `ADMIN_ROLES` contém `manager` e `admin`; `normalizeRole` converte `admin` em `manager` em vários DTOs; e a criação de usuários aceita o papel `admin` para quem já passa pela barreira `ADMIN_ROLES`. A implementação opera mais como dois nomes para uma faixa administrativa do que como dois níveis independentes.

**Causa raiz:** o modelo de autorização foi centralizado por grupos amplos, enquanto a especificação de negócio descreve manager como operacional e admin como administrativo/sistema.

**Impacto:** um manager autenticado pode obter/atribuir capacidade administrativa equivalente, inclusive criar um perfil admin em fluxos onde esse papel é aceito. Não há escalada a partir de cliente comum, mas há violação potencial de least privilege.

**Correção recomendada:** preservar papéis sem normalização destrutiva, definir permissões por capacidade, restringir atribuição de `admin` a admin/break-glass, aplicar `store_code` e setor em cada operação e registrar mudança de papel com auditoria forte.

**Correção implementada:** não aplicada sem decisão formal de matriz de permissões e compatibilidade com contas atuais.

**Teste de regressão necessário:** manager acessa apenas dashboards/operação definidos; não cria admin, não altera políticas globais e não opera outra loja sem concessão explícita.

**Risco residual:** MEDIUM.

### [SEC-009] `service_role` é ponto único de confiança e contorna RLS no caminho da aplicação

- **Severidade:** MEDIUM
- **Status do achado:** RISCO ARQUITETURAL
- **Estado de tratamento:** ABERTO / DEFESA EM PROFUNDIDADE
- **Categoria:** Database Authorization / Secrets
- **CWE:** CWE-284, CWE-862
- **OWASP:** A01:2021 Broken Access Control; A05:2021 Security Misconfiguration
- **Componente:** runtime Supabase e PostgreSQL
- **Arquivo e linha:** `server/integrations/supabase-runtime.js:45, 3034-3040`; migrations em `supabase/migrations/`

**Descrição:** chamadas REST genéricas do runtime usam `SUPABASE_SERVICE_ROLE_KEY` como `apikey` e Bearer. As migrations habilitam RLS e policies, mas o service role é uma credencial privilegiada; portanto, o isolamento final depende do `requireUser`, `canAccessSector`, `store_code` e filtros aplicados no servidor.

**Evidência positiva:** a chave não foi encontrada em arquivos rastreados; `.env`/`.env.local` são ignorados, chaves não foram exibidas, migrations restringem grants internos e a migration local exige `NOBYPASSRLS` para o papel PostgreSQL do runtime local.

**Causa raiz:** o desenho usa um backend trusted para operações de negócio e não expõe JWT do usuário diretamente ao PostgREST em todas as rotas.

**Impacto:** vazamento do service role ou bug de autorização de uma rota pode permitir leitura/escrita ampla, independentemente das policies de cliente. É impacto potencial, não vazamento confirmado.

**Correção recomendada:** limitar o uso de service role a operações administrativas inevitáveis; usar JWT/RLS para leituras de usuário; mover mutações críticas para RPCs `SECURITY DEFINER` estreitas com `search_path` fixo; separar chaves por serviço, rotação, secret manager e alertas de uso.

**Correção implementada:** tabelas e RPCs mantêm allowlists no runtime e as RPCs de impressão v2 foram incluídas. Os grants internos necessários às RPCs `SECURITY INVOKER` foram preservados para não quebrar emissão, provisionamento e leases; o controle efetivo de superfície permanece no runtime e nos endpoints autenticados.

**Teste de regressão necessário:** matriz de usuário/setor/loja contra todos os endpoints; verificação live de RLS, grants, `NOBYPASSRLS` e funções expostas.

**Risco residual:** MEDIUM em caso de comprometimento do backend, pois `service_role` continua sendo um papel privilegiado com `BYPASSRLS`.

### [SEC-010] Falta de evidência de controles de supply chain e pipeline

- **Severidade:** MEDIUM
- **Status do achado:** HARDENING
- **Estado de tratamento:** IMPLEMENTADO NO REPOSITÓRIO; PROVEDOR GIT PENDENTE
- **Categoria:** Supply Chain / SDLC
- **CWE:** CWE-1357
- **OWASP:** A06:2021 Vulnerable and Outdated Components
- **Componente:** Git, npm e CI/CD
- **Arquivo/evidência:** `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `.github/workflows/security.yml`, `.github/dependabot.yml`

**Descrição:** o lockfile existe e o estado atual do registry não reportou vulnerabilidades npm de produção. O repositório agora fornece pipeline para `npm ci`, check, testes, build, audit, secret scanning, CodeQL, revisão de dependências e Dependabot.

**Causa raiz:** controles de release não estão versionados ou não foram disponibilizados neste workspace.

**Impacto:** dependência comprometida, segredo acidental ou alteração não revisada pode chegar ao deployment sem barreira automatizada.

**Evidência/teste seguro:** `npm audit --omit=dev --json` retornou zero vulnerabilidades conhecidas no snapshot atual; isso não substitui CI nem garante segurança futura. Versões transitivas estão travadas pelo lockfile, enquanto algumas dependências diretas usam semver compatível.

**Correção recomendada:** branch protection, revisão obrigatória, `npm ci`, check, test, build, audit com política, secret scanning, CodeQL/SAST, SBOM, Dependabot/Renovate e pinning de actions por SHA.

**Correção implementada:** workflows e Dependabot adicionados; o CI também executa os checks do agente e do protocolo de impressão v2. Branch protection e aprovação obrigatória ainda dependem do provedor Git.

**Teste de regressão necessário:** pipeline limpo em pull request e bloqueio de merge para segredo, vulnerabilidade acima do limiar ou teste falho.

**Risco residual:** LOW/MEDIUM até branch protection e execução do workflow no repositório remoto serem confirmadas.

### [SEC-011] Postura real de produção, backup e perímetro não comprovada pelo código

- **Severidade:** LOW
- **Status do achado:** INFORMATIONAL
- **Estado de tratamento:** ABERTO / VALIDAÇÃO EXTERNA PENDENTE
- **Categoria:** Infrastructure / Availability / Governance
- **CWE:** CWE-16
- **OWASP:** A05:2021 Security Misconfiguration; A06:2021 Vulnerable and Outdated Components
- **Componente:** Vercel/Supabase, VPS/Nginx/systemd, Cloudflare, backup e dispositivos
- **Evidência:** `deploy/nginx/senhahub.conf.example`, `deploy/systemd/*.example`, scripts de backup/restore e documentação; não há Dockerfile/compose ou configuração real de Cloudflare no repositório

**Descrição:** existem bons modelos de configuração, preflight, backup criptografado e restore, mas não é possível provar que o host definitivo tenha origin fechado, portas corretas, cópia offsite, imutabilidade, rotação de segredos, WAF, alertas ou restore ensaiado.

**Impacto:** comprometimento ou perda do único host pode interromper a operação; uma configuração diferente do exemplo pode invalidar conclusões de TLS, cron, logs e rede.

**Correção recomendada:** validar checklist no ambiente real: TLS e HSTS, firewall, Nginx, Cloudflare/WAF, portas 3000/5432, systemd sandbox, backups criptografados offsite, retenção, restore, monitoramento, rotação e inventário de dispositivos.

**Correção implementada:** somente validação local de preflight; nenhuma alteração externa foi feita.

**Teste de regressão necessário:** restore em ambiente separado, teste de queda/restart, health/readiness, cron autenticado e teste físico de impressão.

**Risco residual:** não classificável com precisão até a comprovação externa.

## 7. Controles verificados sem achado confirmado

- **SQL injection:** não foi encontrado uso de concatenação de input em queries PostgreSQL/SQLite relevantes; consultas usam parâmetros ou encoding de filtros.
- **CSRF:** mutações locais exigem CSRF; runtime Supabase verifica cookie/token e origem em operações sensíveis; cookies são `HttpOnly`, `SameSite=Strict` ou `Lax` conforme o fluxo.
- **Sessões:** tokens locais são aleatórios e armazenados por hash; sessões têm expiração/revogação; logout e reset revogam sessão.
- **IDOR básico:** tickets de cliente são vinculados ao usuário; operações de equipe validam setor; a rota de fila anônima era a exceção corrigida em SEC-001.
- **XSS:** sinks identificados foram revisados; uso de `dangerouslySetInnerHTML` está limitado a template estático sanitizado/sem script. Não foi confirmado fluxo de input de usuário até HTML executável.
- **SSRF:** o proxy de Instagram restringe hosts, paths e CDNs permitidos; recomenda-se manter testes para redirects e DNS rebinding.
- **Service Worker/PWA:** APIs privadas não entram no cache público; push valida URL e tipo; não foram encontrados tokens de autenticação em `localStorage`/`sessionStorage`.
- **QR:** tokens são bearer, mas aleatórios, com expiração, rate limit e sem mutação; o risco remanescente é privacidade do DTO, tratado em SEC-007.
- **Realtime/impressão:** canais privados, tokens de agente, leases, fencing, idempotência e recuperação após queda estão cobertos por testes; o banco PostgreSQL v2 ficou como teste skip por ausência de variáveis/banco de teste.
- **Headers:** X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP e HSTS aparecem no runtime/config; CSP com nonce foi adicionada e requer validação no proxy real.
- **Segredos no Git:** os arquivos `.env` locais existem no workspace e contêm chaves, mas estão ignorados e não apareceram em `git ls-files` nem no histórico consultado. Isso não substitui secret scanning no remoto.
- **Dependências:** `npm audit --omit=dev` retornou zero vulnerabilidades no momento da auditoria.

## 8. Matriz de cobertura

| Categoria solicitada | Cobertura | Resultado | Lacuna/ação |
|---|---|---|---|
| Autenticação, sessões e MFA | código, rotas e testes | sessões/CSRF bons; MFA admin ausente | SEC-003 |
| Autorização, RBAC e IDOR | páginas, APIs e repositórios | fila anônima corrigida; papéis amplos | SEC-001, SEC-008 |
| Multi-loja/setor | migrations e filtros de servidor | RLS/triggers live; 0 permissões cruzadas e 0 tickets físicos inconsistentes | manter preflight |
| Supabase/RLS/PostgreSQL | migrations e preflight disponível | RLS/triggers live; runtime com allowlists e RPCs v2 protegidas | SEC-009; reduzir bypass residual |
| API REST/GraphQL | busca e inventário de rotas | REST; não foi encontrado GraphQL | revisar novos endpoints em CI |
| SQL/NoSQL injection | revisão de queries | nenhum achado confirmado | manter parametrização |
| XSS/HTML | sinks, templates, DOM e CSP | nenhum XSS confirmado; CSP com nonce | SEC-006 |
| CSRF/CORS/origin | cookies, origem e headers | controles presentes; proxy precisa ser comprovado | SEC-005 |
| SSRF | Instagram e fetches externos | allowlists presentes | teste de redirect/DNS externo |
| Uploads | inventário de rotas | não foi encontrado fluxo de upload | revalidar se feature for criada |
| PWA/Service Worker | cache, push e storage | sem cache de API privada e sem tokens locais | confirmar escopo em navegador real |
| QR Code | token, TTL e tracking | bearer forte, somente leitura; nome removido do DTO público | SEC-007 |
| Web Push | endpoint, payload, RLS e CSRF | controles consistentes | validar VAPID/produção |
| Realtime | migrations, agente e testes | tópicos privados e fencing; schema live validado | fluxo físico ainda requer teste operacional |
| Impressão/totem/tablet | API v2, tokens e concorrência | bom desenho defensivo | teste físico e banco real |
| Proxy/headers/TLS | código e exemplos Nginx | forwarded headers condicionados à configuração confiável | SEC-005/SEC-011 |
| Docker/VPS/Cloudflare | inventário de arquivos | apenas exemplos/documentação | SEC-011 |
| Supply chain/Git/CI | lockfile, audit e inventário | audit limpo; pipeline e scans configurados | SEC-010 |
| Logs/observabilidade | módulos e eventos | request ID, cron e alertas implementados | validar retenção/PII |
| DDoS/rate limiting | rate limits e body cap | body cap corrigido; rate limit por IP e conta | SEC-002/SEC-004 |
| Backups/restore/DR | scripts e documentação | verificação, status externo e timer configurados | provar execução, offsite e restore |
| Engenharia social | arquitetura e processo | MFA e treinamento não comprovados | P0/P2 operacional |

## 9. Plano de remediação P0–P3

### P0 — antes da exposição pública

1. **Ativar MFA obrigatório para manager/admin** — SEC-003. Entregar UI de enrollment, recovery e testes de expiração/replay.
2. **Fechar o origin e comprovar a cadeia TLS** — SEC-005/SEC-011. Permitir acesso ao Node apenas pelo proxy confiável; bloquear portas de aplicação e banco; remover/normalizar forwarded headers.
3. **Validar as variáveis de produção e o cron real** — `AUTH_SECRET`, `CRON_SECRET`, service role, VAPID, tokens de dispositivo, `DATA_BACKEND`, flags locais e logs sem segredos.

### P1 — alta prioridade

1. Separar capacidades de manager/admin e impedir manager de atribuir admin — SEC-008.
2. Reduzir o privilégio residual do `service_role` ou manter o runtime isolado e monitorado — SEC-009.
3. Confirmar os limites de lockout/rate limit atrás do proxy de produção — SEC-004.
4. Confirmar o pipeline e as proteções no provedor Git — SEC-010.

### P2 — hardening e continuidade

1. Criar staging com dados sintéticos, janela de restore e teste de failover/restart.
2. Configurar backup criptografado offsite/imutável, retenção e restore periódico — SEC-011.
3. Testar agente, totens, tablet, impressora, Web Push e Realtime em ambiente real controlado.

### P3 — processo contínuo

1. Treinamento anti-phishing, procedimento de break-glass e revisão trimestral de acessos.
2. Rotação documentada de service role, banco, AUTH_SECRET, cron e tokens físicos.
3. Revisão mensal de dependências, findings, logs de administração e canais Realtime.

## 10. Pontuação de segurança

A pontuação é uma heurística de risco, não uma certificação. O critério combina severidade aberta, cobertura de evidência, defesa em profundidade, maturidade operacional e validação live. Uma pendência externa não recebe nota máxima apenas porque existe um arquivo de exemplo no repositório.

| Dimensão | Peso | Antes das correções | Após as correções | Critério resumido |
|---|---:|---:|---:|---|
| Autenticação e identidade | 25% | 4,5 | 4,5 | sessões boas, mas MFA admin ausente e lockout a revisar |
| Autorização/multiloja | 20% | 5,8 | 7,0 | fila anônima removida; papéis e live RLS ainda pendentes |
| Dados, segredos e banco | 15% | 6,8 | 6,8 | migrations e segredo fora do Git; service role é ponto único |
| API e browser | 15% | 6,4 | 7,8 | CSRF/headers/allowlist bons; body cap e CSP corrigidos |
| Infraestrutura e operação | 15% | 4,4 | 4,4 | exemplos bons, ambiente real não comprovado |
| Supply chain/SDLC | 5% | 5,8 | 7,5 | CI, CodeQL, secret scanning, Dependabot e audit configurados |
| Resiliência/observabilidade | 5% | 6,5 | 7,5 | verificação de backup e status externo adicionados; restore real pendente |
| **Resultado ponderado** | **100%** | **5,5/10** | **6,5/10** | melhoria devida às correções de código e controles de entrega |

### Interpretação

- **0–3:** não liberar.
- **3–5:** protótipo ou rede restrita, sem exposição pública.
- **5–7:** controles relevantes, mas há risco alto ou dependência de operação externa.
- **7–8,5:** pode avançar com plano de risco residual e validação live.
- **8,5–10:** postura forte com evidência contínua, não garantia absoluta.

O resultado atual está na faixa **“não liberar sem plano P0”** por causa do MFA administrativo e da infraestrutura ainda não comprovada.

## 11. Validações executadas

| Verificação | Resultado |
|---|---|
| `npm run check` | passou |
| `npm run check:print-agent` | passou |
| `npm run test:print-v2` | 21 passed, 0 failed, 1 skipped |
| `npm test` | 102 passed, 0 failed, 1 skipped |
| Regressão da fila sem sessão | HTTP 401, passou |
| Regressão de body acima de 1 MB | `PAYLOAD_TOO_LARGE`, passou |
| `npm run test:local-route` | HTTP 401, passou |
| `npm run build` | passou; Next compilou e gerou as rotas |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilidades conhecidas |
| `npm run preflight:production` | aprovado para as variáveis/controles locais disponíveis |
| Teste PostgreSQL v2 real | não executado; teste automatizado ficou skip por ausência de banco/variáveis |
| `npm run preflight:security` | preparado, mas bloqueado por `ENOTFOUND` do hostname Supabase |
| `npm run preflight:local-postgres` | preparado, mas PostgreSQL local não estava acessível neste ambiente |
| Banco Supabase real | validado via conector; Vercel/Cloudflare ainda não validados |

O skip do PostgreSQL v2 não é considerado falha de teste; ele reduz a confiança sobre concorrência/RLS no banco real e deve ser resolvido antes do go-live.

## 12. Arquivos alterados nesta auditoria

Arquivos modificados ou adicionados por esta auditoria:

- `app/api/local-postgres/queue/route.js` — autenticação, escopo de equipe e `no-store`.
- `server/server.js` — limite de corpo raw de 1 MB, HTTP 413 e export para teste.
- `scripts/test-local-postgres-route.js` — teste de fail-closed sem sessão.
- `tests/security-regression.test.js` — regressões de autorização e limite de body.
- `proxy.js`, `next.config.js` — CSP sem `unsafe-inline` e nonce por resposta.
- `server/auth/local-auth.js`, `app/api/local-postgres/auth/login/route.js`, `server/integrations/supabase-runtime.js` — lockout/rate limit e allowlists de `service_role`.
- `supabase/migrations/20260910130134_security_isolation_round2.sql`, `supabase/migrations/20260910131734_reclassify_pompeia_physical_tickets_store_2.sql`, `supabase/migrations/20260910132048_restrict_service_role_direct_print_tables.sql`, `supabase/migrations/20260910132719_restore_service_role_rpc_dependencies.sql`, `scripts/preflight-security.js` e `scripts/preflight-local-postgres.js` — isolamento, correção histórica, grants compatíveis com RPCs e preflight de banco.
- `.github/workflows/ci.yml`, `.github/workflows/security.yml`, `.github/dependabot.yml` — controles de CI/CD.
- `scripts/verify-backup.js`, `scripts/backup-postgres.js`, `scripts/backup-supabase.js` e `deploy/systemd/senhahub-backup-verify.*` — verificação e monitoramento de backup.
- `docs/SEGURANCA_OPERACIONAL.md` — checklist operacional e testes de impressão/dispositivos.
- `docs/SECURITY_AUDIT_SENHAHUB.md` — este relatório.

Os itens já presentes no working tree — `android/`, `output/`, `public/assets/mercado-pompeia-logo-hd.png` e o documento DOCX semanal — foram preservados e não fazem parte das correções desta auditoria.

## 13. Decisão final

**Estado:** parcialmente aprovado para continuidade em ambiente controlado; não aprovado para exposição administrativa pública sem P0.

**Pode seguir para staging:** sim, com as duas correções aplicadas, testes verdes e revisão do diff.

**Pode declarar produção pública segura:** não ainda. Ativar MFA administrativo, fechar o origin/proxy, executar preflight e RLS em ambiente real, provar backup/restore e testar os dispositivos físicos.

**Próxima evidência recomendada:** um relatório de go-live contendo captura dos headers/TLS externos, matriz de usuários por loja/setor, teste MFA, restore de backup em ambiente separado, resultado de pipeline e teste real de impressão sem expor segredos.
