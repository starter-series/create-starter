# Lovable, Bolt, v0에서 production으로 졸업하기

> 바이브 코딩 플랫폼에서 작동하는 앱을 만들었다. 이제 *어디에든* — 자체 VPS, 여러 스토어, 여러 registry — 배포할 *선택지*가 필요한 시점. 한 플랫폼 기본값에 갇히는 대신. `create-starter`로 이 핸드오프를 안내한다.
>
> 어떤 플랫폼에서 "탈출"하는 이야기가 아니다. 2026년 5월 기준 Vercel·Cloudflare·Netlify 모두 "Agentic Infrastructure" 제공자로 진화 중이며, 각자의 워크로드에 적합한 훌륭한 선택지다. 졸업은 단지 **vendor 다양성** — 매번 CI/CD를 처음부터 다시 쓰지 않고 앱마다 다른 target을 선택할 자유 — 을 준다.

**Languages**: [English](graduation-from-vibe-coding.md) · 한국어 (이 문서)

---

## 이 가이드가 필요한 경우

- ✅ 현재 플랫폼 기본값과 다른 **deploy target**이 어울리는 앱이 있음 (자체 VPS, GHCR, Cloudflare Workers/Pages, App Store, Chrome Web Store, npm, PyPI…)
- ✅ 플랫폼이 숨기는 CI/CD 단계에 대한 **GitHub Actions 로그**가 필요
- ✅ 빌드별 platform 과금 대신 **예측 가능한 CI minutes** (GitHub Actions: 공개 레포 무료, 비공개 ~$0.30/hr) 원함
- ✅ 코드가 production에 닿기 전 **CI 단계 공급망 보안 게이트** (gitleaks, CodeQL, OIDC publish, supply-chain attestation) 원함
- ✅ 코드가 **이미 GitHub에 있음** (Lovable sync, Bolt export, v0 git panel 결과물)

다음 경우엔 **필요 없음**:

- ❌ 플랫폼의 auto-deploy로 충분하고 GitHub Actions가 굳이 필요 없음
- ❌ 앱이 정확히 한 플랫폼 스택에 딱 맞고 (예: Vercel 위 Next.js) 복잡도를 추가할 이유가 없음

---

## 졸업 경로

5단계. 모두 터미널에서. AI 세션을 떠날 필요 없음 — 모든 CLI 명령은 MCP 도구로도 노출되어 Claude Code에게 시키면 됨.

```
1. 진단        → audit, audit-cd, audit-security
2. target 선택 → docker-deploy / cloudflare-pages / npm-package / …
3. CI/CD 이식   → 매칭 starter의 .github/workflows 복사
4. 시크릿 설정  → gh secret set 으로 repo secret 등록
5. 검증        → audit 재실행; 릴리즈 태깅
```

---

## 1단계 — 진단

플랫폼이 만든 GitHub 레포를 로컬에 clone하고 3개의 audit primitive를 실행한다.

```bash
git clone https://github.com/<you>/<your-app>.git
cd <your-app>
npx -y starter-series audit
npx -y starter-series audit-cd
npx -y starter-series audit-security
```

3개의 리포트가 나온다:

- **audit** — 가장 유사한 Starter Series 템플릿, CHANGELOG vs 머지된 PR drift, version bump 상태, publish workflow 종류. 대부분 바이브 코딩 앱은 `Matched starter: (none)` + `Publish workflow: missing`으로 시작 — 정상.
- **audit-cd** — 각 destination registry의 현재 상태. 처음엔 npm/PyPI/Open VSX/AMO/GitHub Releases 모두 `not-found`로 나옴 (아직 publish 안 했으니).
- **audit-security** — 이 단계에선 `SOFT` 일반적. MISSING/PARTIAL 행 아래 추천사항이 정확히 무엇을 추가해야 할지 알려줌.

> **팁**: Claude Code 안에서 그냥 *"이 레포 starter-series로 audit해줘"* 라고 하면 MCP 도구가 자동 실행됨.

---

## 2단계 — target 선택

각 바이브 코딩 플랫폼은 합리적 기본값을 가짐 (Lovable → Netlify/Vercel, Bolt → Netlify, v0 → Vercel). 졸업은 어떤 앱이 다른 target에 더 적합할 때 그쪽으로 ship할 **선택지**를 준다. 매칭 starter 선택:

| 너의 앱 | 추천 target | Starter |
|---------|-----|---------|
| Next.js / Vite / React 앱을 **자체 VPS에** | Docker + GHCR + SSH | [`docker-deploy`](https://github.com/starter-series/docker-deploy-starter) |
| **정적 사이트** (HTML/CSS + 가벼운 JS) | Cloudflare Pages | [`cloudflare-pages`](https://github.com/starter-series/cloudflare-pages-starter) |
| **Claude / voice agent** (서버사이드 런타임) | Cloudflare Workers + Claude Managed Agents | [`docker-deploy`](https://github.com/starter-series/docker-deploy-starter) (adapter) — 아래 노트 |
| **브라우저 확장** (이미 MV3) | CWS + AMO | [`browser-extension`](https://github.com/starter-series/browser-extension-starter) |
| **크로스 플랫폼 데스크톱** | electron-builder + code signing | [`electron-app`](https://github.com/starter-series/electron-app-starter) |
| **모바일 앱** | Expo + EAS | [`react-native`](https://github.com/starter-series/react-native-starter) |
| **Discord/Telegram 봇** | Docker + Railway/Fly | [`discord-bot`](https://github.com/starter-series/discord-bot-starter) / [`telegram-bot`](https://github.com/starter-series/telegram-bot-starter) |
| **재사용 가능 라이브러리** | npm OIDC trusted publishing | [`npm-package`](https://github.com/starter-series/npm-package-starter) |
| **Python 도구 / 에이전트** | PyPI OIDC trusted publishing | [`python-mcp-server`](https://github.com/starter-series/python-mcp-server-starter) |

> **Cloudflare Workers 위 Claude / voice agent (2026-05 추가)** — Anthropic과 Cloudflare가 Claude Managed Agents on Cloudflare Workers를 발표 (2026-05-19), 일주일 후 `@cloudflare/voice` SDK 출시 (2026-05-26). 현재 두 경로 (둘 다 기존 `docker-deploy` starter 기반):
>
> **(a) Wrangler 빠른 설정** — 다음 `wrangler.toml`을 레포 루트에 복사 (Dockerfile 경로 대체):
> ```toml
> name = "my-claude-agent"
> main = "src/index.ts"
> compatibility_date = "2026-05-27"
>
> [vars]
> # CLAUDE_API_KEY는 wrangler secret put CLAUDE_API_KEY로 설정
>
> [observability]
> enabled = true
> ```
> 그 다음 `docker-deploy-starter`의 `.github/workflows/deploy.yml`에서 SSH-to-VPS 단계를 `wrangler deploy`로 교체. 시크릿: `CLOUDFLARE_API_TOKEN`.
>
> **(b) 컨테이너 경로** — `docker-deploy-starter` 그대로 유지하고 Claude Managed Agents 프로토콜을 지원하는 호스트에서 컨테이너 실행. 트레이드오프: Workers 네이티브 cold start 이점 없음.
>
> Managed Agents API 안정화 시 별도 `cloudflare-workers-agent` starter 로드맵 ([starter-series/cloudflare-pages-starter#1](https://github.com/starter-series/cloudflare-pages-starter/issues) 추적).

**가장 흔한 경로**: 바이브 코딩 React/Next/Vite SPA → `docker-deploy` (자체 소유 VPS) 또는 `cloudflare-pages` (무료, 무제한 대역폭).

---

## 3단계 — CI/CD 이식

새 프로젝트를 scaffold하고 코드를 옮겨담을 필요 **없음**. 매칭 starter의 `.github/workflows/` + 보조 파일만 기존 레포에 끼워넣는다.

### 방법 A — 수동 이식 (첫 회 추천)

```bash
TARGET=docker-deploy

# CI 인프라만 가져오기
git clone --depth=1 https://github.com/starter-series/${TARGET}-starter.git /tmp/starter
cp -r /tmp/starter/.github .
cp /tmp/starter/Dockerfile* .          # 해당시
cp /tmp/starter/.gitleaks.toml . 2>/dev/null || true
cp /tmp/starter/.dockerignore . 2>/dev/null || true
cp /tmp/starter/CHANGELOG.md .         # 같은 릴리즈 노트 포맷 채택

# 워크플로우 파일 열어서 placeholder repo 이름 교체
# YOUR_USERNAME, YOUR_REGISTRY 등 검색해서 수정
```

### 방법 B — 형제 폴더에 scaffold하고 diff

```bash
# 깨끗한 sibling 폴더에 scaffold
npx -y starter-series my-fresh --template ${TARGET}

# 파일 비교 후 필요한 것만 복사
diff -r my-fresh/.github .github
```

### 방법 C — Claude Code 안에서

> *"docker-deploy starter의 `.github/workflows/`와 Dockerfile을 이 레포에 추가해줘. 앱 코드는 건드리지 말고. placeholder owner/repo 참조는 현재 remote에 맞게 갱신해줘."*

에이전트가 MCP 도구로 파일을 가져와서 변경 내역을 보고함.

---

## 4단계 — 시크릿 설정

각 deploy target마다 필요한 시크릿이 다름. 공통:

| Target | 필수 시크릿 | OIDC 가능? |
|--------|-------------|----------|
| docker-deploy | `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY` | 아니오 |
| npm-package | `NPM_TOKEN` (또는 OIDC trusted publishing 사용시 **없음**) | ✅ 예, npmjs.com에서 설정 |
| python-mcp-server | (OIDC 사용시 없음) | ✅ 예, PyPI에서 설정 |
| browser-extension | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | 아니오 |
| vscode-extension | `VSCE_PAT`, `OVSX_PAT` | 아니오 |
| electron-app | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, 서명 인증서 + 비번 | 아니오 |
| react-native | `EXPO_TOKEN` | 아니오 |
| cloudflare-pages | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | 아니오 |

```bash
# 예: docker-deploy 시크릿 설정
gh secret set DEPLOY_SSH_HOST -b "your.vps.example.com"
gh secret set DEPLOY_SSH_USER -b "deploy"
gh secret set DEPLOY_SSH_KEY < ~/.ssh/deploy_id_ed25519

# OIDC 가능 target (npm, PyPI)은 시크릿 필요 없음 — registry 쪽에서
# publisher 설정만 하면 됨. 각 starter README의 링크 참조.
```

---

## 5단계 — 검증

Audit primitive 재실행. 결과가 이렇게 나오면 정상:

```
audit          → Ship-ready: ATTENTION (CHANGELOG drift만 남음, 예상됨)
audit-security → Overall: HARDENED (8/8 present) 또는 NEEDS-ATTENTION (1~2개 missing)
audit-cd       → 모든 destination이 not-found (아직 publish 안 했으니)
```

이제 첫 릴리즈:

```bash
# CHANGELOG.md Unreleased 섹션에 초기 항목 작성
git add . && git commit -m "chore: lift CI/CD from starter-series/${TARGET}-starter"
git push origin main

# 태그 — 대부분 starter는 tag push에서 publish 트리거
git tag v0.1.0
git push --tags
```

워크플로우 실행 지켜본 후 `audit-cd` 재실행:

```bash
npx -y starter-series audit-cd
# → npm/Open VSX/AMO/GH Releases가 이제 in-sync 보고
```

첫 실행에서 실패하면 CI 로그가 어떤 시크릿/설정이 잘못됐는지 정확히 알려줌. Starter는 에러 메시지가 actionable하도록 설계됨 — 불투명한 platform 에러가 아님.

---

## 흔한 함정

### Lovable export가 `@vercel/analytics` 쓰는 경우
코드에서 `@vercel/analytics` 검색해서 제거 (`app.tsx`/`layout.tsx`의 태그도) 또는 Vercel 외 analytics (Plausible, 자체 호스팅 Umami)로 연결.

### Bolt export에 WebContainer 전용 import
WebContainer는 Bolt의 브라우저 샌드박스. `import * from '@webcontainer/api'`는 Bolt 외에서 안 돌아감. 네이티브 Node 등가물 (`fs/promises`, `child_process`)로 교체 또는 브라우저 프리뷰 전용이었다면 제거.

### v0 export가 Vercel path를 하드코딩
v0가 생성한 `app/api/*` 라우트는 Vercel edge runtime 가정. docker-deploy로 옮기면 `export const runtime = 'edge'`를 `'nodejs'`로 바꾸고 DB 드라이버가 Node에서 도는지 확인 (대부분 됨).

### Supabase 백엔드는 문제없음
3개 플랫폼 모두 흔히 Supabase랑 짝지어짐. Supabase는 플랫폼 잠금 없음 — 기존 `NEXT_PUBLIC_SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`가 어느 deploy target에서든 동작. 플랫폼 env vars에서 repo secrets로만 옮기면 됨.

### Export에 `.env` 파일이 포함된 경우
바이브 플랫폼이 가끔 `.env.local`을 GitHub에 커밋함. CI에서 gitleaks가 처음 돌면 이걸 잡음. 누출된 키 **회전 (rebase로 끝내지 말 것)**, `.env*`을 `.gitignore`에 추가, `git filter-repo --path .env.local --invert-paths`로 히스토리에서 제거.

---

## 졸업이 주는 것

5단계 완료 후 얻는 것:

| 역량 | 바이브 플랫폼 | 졸업 후 |
|-----|-------------|--------|
| Deploy target | 플랫폼 잠금 | **어디든** (VPS, Cloudflare, npm, 앱 스토어) |
| CI 로그 | 숨겨짐 | **GitHub Actions** 단계별 풀 가시성 |
| 시크릿 스캐닝 | 제한적 | **gitleaks + GitHub native secret scanning** 매 push |
| 정적 분석 | 없음 | 매 PR **CodeQL** |
| AI 보안 리뷰 | 없음 | 매 PR **`anthropics/claude-code-security-review`** |
| Publish 인증 | 플랫폼 소유 | **OIDC trusted publishing** (장기 토큰 없음) |
| 릴리즈 노트 | 수동 | PR 제목 + CHANGELOG 자동 생성 |
| 롤백 | 플랫폼 UI | `git revert` + re-tag |
| 비용 | 플랫폼 토큰 과금 | **무료** CI minutes (공개 레포), ~$0.30/hr 비공개 |

---

## 다음 단계

- **특정 플랫폼에서 막혔다?** 이슈 등록: [starter-series/create-starter/issues](https://github.com/starter-series/create-starter/issues/new). export 소스 (Lovable/Bolt/v0) + 어느 단계에서 막혔는지 포함.
- **AI에게 전체를 맡기고 싶다?** `create-starter`를 Claude Code 플러그인으로 설치: `/plugin marketplace add starter-series/create-starter && /plugin install create-starter@starter-series`. 그 다음 *"이 Lovable export를 docker-deploy로 졸업시켜줘"*라고 하면 에이전트가 1~4단계 수행.
- **더 많은 starter?** [전체 목록](https://github.com/starter-series) 참조. 만약 케이스가 안 나오면 `docker-deploy` starter는 언어/프레임워크 무관 — 컨테이너화하고 싶은 어떤 앱이든 받아주는 만능 fallback.
