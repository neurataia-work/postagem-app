# Postagem — agendamento e publicação automática em redes sociais

App própria para escrever um post uma vez, escolher as contas, marcar dia e hora, e deixar o servidor publicar sozinho. Inclui calendário, fila de publicações, métricas e "melhores horas para publicar".

| Funcionalidade | Estado |
|---|---|
| Ligar contas por OAuth (Facebook, Instagram, LinkedIn, X, TikTok) | ✅ |
| Conta **Demo** para testar tudo sem credenciais | ✅ |
| Compositor com várias contas, texto diferente por rede, contador de caracteres e pré-visualização | ✅ |
| Upload de imagens e vídeos (arrastar e largar) | ✅ |
| Calendário mensal: clicar num dia para criar, arrastar para reagendar | ✅ |
| Publicação automática à hora marcada (verifica a cada 30 s) | ✅ |
| Rascunhos, "publicar agora", repetir publicações falhadas | ✅ |
| Análises: impressões, interações, por rede, top posts, mapa de melhores horas | ✅ |
| Tokens cifrados (AES-256-GCM) e renovação automática (X, TikTok) | ✅ |
| Proteção por palavra-passe | ✅ |

## Como correr

Precisa de **Node.js 22.13 ou mais recente** (a base de dados SQLite já vem incluída no Node, não há nada para instalar).

```bash
npm install
cp .env.example .env      # preencha pelo menos APP_SECRET
npm start                 # abre em http://localhost:3000
```

Sem credenciais nenhumas já pode experimentar: vá a **Contas → Demo → Adicionar**, crie um post e agende-o para daqui a 1 minuto. (Escreva `#falhar` no texto para ver como a app trata um erro.)

## O que precisa para ligar as redes reais

Todas as redes exigem que registe uma "app de developer" em seu nome e que a app esteja num **endereço HTTPS público** (para o OAuth e para o Instagram/TikTok irem buscar as imagens). Para testar no seu computador use o [ngrok](https://ngrok.com): `ngrok http 3000` e ponha o endereço que ele der em `PUBLIC_URL`.

O endereço de retorno (redirect URI) a registar em cada consola é:

| Rede | Redirect URI |
|---|---|
| Facebook + Instagram | `PUBLIC_URL/auth/meta/callback` |
| LinkedIn | `PUBLIC_URL/auth/linkedin/callback` |
| X | `PUBLIC_URL/auth/x/callback` |
| TikTok | `PUBLIC_URL/auth/tiktok/callback` |

### Facebook e Instagram (Meta)
1. Em [developers.facebook.com](https://developers.facebook.com) crie uma app do tipo **Business**.
2. Adicione os produtos **Facebook Login for Business** e **Instagram** (API com login do Facebook).
3. Em *Configurações do Login*, adicione o redirect URI acima.
4. Copie o **App ID** e o **App Secret** para `META_APP_ID` e `META_APP_SECRET`.
5. A conta Instagram tem de ser **profissional** (Empresa ou Criador) e estar **associada a uma Página do Facebook** que gere.
6. Em modo de desenvolvimento só funciona com contas que sejam admin/tester da app. Para outros utilizadores, peça **App Review** das permissões `pages_manage_posts`, `pages_read_engagement`, `instagram_content_publish`, `instagram_basic`, `read_insights`, `instagram_manage_insights` e faça a **verificação da empresa**.
7. Limite do Instagram: 100 publicações por conta a cada 24 h. Formatos: imagem JPEG, carrossel até 10, Reels.

### LinkedIn
1. Em [linkedin.com/developers](https://www.linkedin.com/developers/apps) crie uma app (precisa de associar uma Página de empresa).
2. No separador *Products* ative **Sign In with LinkedIn using OpenID Connect** e **Share on LinkedIn**.
3. Em *Auth* adicione o redirect URI e copie Client ID/Secret.
4. Publica no **perfil pessoal**, com texto e imagens. Publicar em Páginas de empresa e ler métricas exige a *Community Management API*, que o LinkedIn aprova caso a caso.

### X (Twitter)
1. Em [developer.x.com](https://developer.x.com) crie um projeto e uma app.
2. Em *User authentication settings*: OAuth 2.0, tipo **Web App**, permissões **Read and write**, redirect URI acima.
3. Copie o **OAuth 2.0 Client ID** e **Client Secret**.
4. A API do X é paga por utilização/plano: confirme no portal os limites de publicação e de leitura de métricas do seu plano.

### TikTok
1. Em [developers.tiktok.com](https://developers.tiktok.com) crie uma app, adicione **Login Kit** e **Content Posting API** (com *Direct Post* ativo).
2. Scopes: `user.info.basic` e `video.publish`. Registe o redirect URI.
3. Copie Client Key/Secret.
4. **Importante:** até a app passar a auditoria do TikTok, os vídeos só podem ser publicados como **privados** (`SELF_ONLY`). Depois da aprovação mude `TIKTOK_PRIVACY=PUBLIC_TO_EVERYONE`.
5. Vídeos são enviados diretamente. Fotos usam "pull from URL", o que exige verificar o domínio de `PUBLIC_URL` na consola do TikTok.

## Pôr online

Funciona em qualquer servidor com Node 22 e disco persistente (Railway, Render, Fly.io, um VPS, etc.):
- defina as variáveis do `.env` no painel do serviço;
- garanta que as pastas `data/` (base de dados) e `uploads/` (ficheiros) ficam num **volume persistente**;
- defina `APP_PASSWORD` para proteger o acesso;
- o processo tem de estar sempre ligado, porque é ele que publica à hora marcada.

## Estrutura

```
server.js              rotas da API, OAuth, upload
src/db.js              esquema SQLite
src/scheduler.js       agendador + recolha de métricas
src/accounts.js        guardar contas e renovar tokens
src/crypto.js          cifra dos tokens
src/providers/         uma integração por rede (meta, linkedin, x, tiktok, demo)
public/                interface (HTML/CSS/JS sem build)
```

Para acrescentar uma rede (ex.: YouTube, Pinterest, Threads, Bluesky) basta criar um ficheiro em `src/providers/` com `authUrl`, `handleCallback`, `publish` e `metrics`, e registá-lo em `src/providers/index.js`.

## Limitações conhecidas do MVP
- Um só utilizador (sem equipas nem aprovações).
- X: só texto e imagens (vídeo exige upload por partes). LinkedIn: só texto e imagens.
- Métricas do LinkedIn e TikTok não estão disponíveis com as permissões básicas.
- Os nomes de versão das APIs (`META_GRAPH_VERSION`, `LINKEDIN_VERSION`) mudam com o tempo; se uma rede responder "version not supported", atualize no `.env`.
