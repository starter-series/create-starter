# Anthropic Connector Directory — 제출 도시에

> [Anthropic Connectors Directory](https://claude.ai/settings/plugins/submit)에 `create-starter`를 제출하기 위한 레퍼런스 문서.
> 마지막 검토: 2026-04-24, 기준 문서 `https://claude.com/docs/connectors/building/submission`.

`create-starter`는 **로컬** MCP 서버(stdio 전송)입니다. Anthropic 디렉토리는 Desktop Extensions (`.mcpb`) 경로로 로컬 커넥터를 허용하지만, 로컬 커넥터는 개인정보 처리방침과 문서화가 추가로 요구됩니다. 이 문서는 제출 당일 별도 조사 없이 그대로 복사해 쓸 수 있도록 준비된 도시에(dossier)입니다.

---

## 1. 디렉토리에 노출되는 메타데이터

| 필드 | 값 |
|---|---|
| **Name** | `create-starter` |
| **Display name** | create-starter |
| **Tagline** (≤ 약 80자) | Scaffold production-ready projects from the Starter Series templates. |
| **Category** | Developer Tools / Scaffolding |
| **Author** | heznpc |
| **License** | MIT |
| **제출 시 버전** | 0.3.0 |
| **Homepage URL** | https://github.com/starter-series/create-starter#readme |
| **Documentation URL** | https://github.com/starter-series/create-starter#readme |
| **Source URL** | https://github.com/starter-series/create-starter |
| **Issues / Support URL** | https://github.com/starter-series/create-starter/issues |
| **Privacy policy URL** | https://github.com/starter-series/create-starter/blob/main/docs/PRIVACY.md *(TODO: 리뷰어 요청 시 별도 공개. 현재 입장은 "데이터 미수집"으로 본 문서 §3에 인라인)* |
| **npm 패키지** | https://www.npmjs.com/package/@starter-series/create |
| **MCP Registry 엔트리** | `io.github.starter-series/create-starter` (https://registry.modelcontextprotocol.io/) |

### Short description (≤ 160자)

> Scaffold production-ready projects — Discord bot, Docker deploy, MCP server, Electron, and more — from the Starter Series templates, with CI/CD baked in.

### Long description (폼에 붙여넣기)

> `create-starter` scaffolds projects from the [Starter Series](https://github.com/starter-series) templates: Discord bot, Telegram bot, Docker deploy, MCP server (TS + Python), npm package with OIDC publish, browser extension, VS Code extension, Electron app, React Native, and Cloudflare Pages.
>
> It downloads the selected template tarball from GitHub, substitutes placeholders (project name, description), handles Python package renames (pyproject + `src/` directory), and runs `git init`. Inputs are Zod-validated before any filesystem write. Extraction happens in a sibling tmp directory and the final path only appears after an atomic `rename` — a failed scaffold never leaves half-written state. Downloads have a 30 s timeout, 3-attempt exponential backoff, and a 50 MB size cap. No credentials handled, no telemetry.
>
> One tool per action: `list_templates` enumerates templates, `create_project` scaffolds one. A bundled Claude Code skill (`skills/create/SKILL.md`) guides the conversation. Installs as Claude Code plugin, Claude Desktop `.mcpb`, or plain `npx`.

### 채널별 설치 명령

| 채널 | 명령 |
|---|---|
| Claude Desktop (.mcpb) | [최신 GitHub 릴리스](https://github.com/starter-series/create-starter/releases/latest)의 `create-starter-0.3.0.mcpb`를 Claude Desktop 설정 창에 드래그. |
| Claude Code 플러그인 | `/plugin marketplace add starter-series/create-starter` 후 `/plugin install create-starter@starter-series` |
| npm CLI | `npx @starter-series/create <name> --template <id>` |
| MCP 서버 (수동) | 클라이언트 설정 JSON의 `mcpServers`에 `node /abs/path/dist/index.js` 등록. |
| MCP Registry | `io.github.starter-series/create-starter` (registry discovery 지원 클라이언트) |

---

## 2. 기술적 표면

| 항목 | 값 |
|---|---|
| **Transport** | `stdio` (로컬 전용). **remote endpoint / Streamable-HTTP 서버 없음.** |
| **Authentication** | 없음. OAuth, API key, token 모두 없음. |
| **노출 capabilities** | 툴 2개, Claude Code 스킬 1개. resources 없음, prompts 없음. |
| **툴 목록** | `list_templates` (read-only), `create_project` (디스크 쓰기 수행) |
| **툴 어노테이션** | `list_templates` → `readOnlyHint: true`. `create_project` → `destructiveHint: false` (실패 시 전체 롤백되고 성공 시 atomic rename). |
| **런타임** | Node.js ≥ 20, 크로스 플랫폼 (macOS / Linux / Windows). `.mcpb`에 `node_modules/`까지 번들. |
| **호출하는 호스트 바이너리** | `git` (선택; 없으면 stderr 경고만 남기고 scaffold 성공). 그 외 서브프로세스 없음. |
| **네트워크 egress** | HTTPS GET `github.com/starter-series/<template>/archive/refs/heads/main.tar.gz` 만. 다른 호스트 없음. |
| **파일시스템 쓰기** | 사용자 지정 `output_dir` 하위로만. 추출은 sibling `.<name>-incomplete-<rand>/`, 성공 시 atomic `rename`, 실패 시 재귀 `rm`. |
| **경로 안전성** | 프로젝트 이름 regex `^[A-Za-z0-9][A-Za-z0-9_-]*$`. 상대 `output_dir`가 cwd 벗어나면 거부; 절대 경로는 명시적 사용자 의도로 허용. |
| **다운로드 하드닝** | 시도당 30초 timeout, 3회 지수 백오프, 50 MB 크기 제한. `tar` 라이브러리로 추출 (`child_process` 미사용). |
| **다운로드된 코드 실행** | **절대 없음.** 다운로드 콘텐츠는 `.tar.gz` 아카이브로, 파일로만 추출됨. `eval`, 추출된 코드의 `require()`, 스캐폴드된 프로젝트의 `npm install` 등 일절 수행하지 않음. |
| **Telemetry** | 없음. stderr 로그는 로컬 전용이며 `CREATE_STARTER_DEBUG=1`일 때만 출력. |
| **퍼블리셔 검증** | npm publish에서 GitHub OIDC + MCP Registry 네임스페이스 `io.github.starter-series/*`. |

---

## 3. 보안 & 개인정보 답변

예상 리뷰 질문과 그대로 붙여 쓸 답변:

**Q: 커넥터가 사용자 데이터나 PII, 자격 증명을 다루는가?**
아니요. 처리하는 입력은 (a) 사용자가 고른 템플릿 ID, (b) 사용자가 입력한 프로젝트 이름, (c) 선택적 한 줄 설명 뿐입니다. 어디에도 전송되지 않고 로컬 스캐폴드 파일로만 기록됩니다. 자격 증명, OAuth, API key 모두 사용하지 않습니다.

**Q: 네트워크 호출을 하는가? 어느 호스트로?**
네 — 단 한 종류: `https://github.com/starter-series/<template>/archive/refs/heads/main.tar.gz` (또는 동일한 `codeload.github.com` 리다이렉트)로의 HTTPS GET. 템플릿 tarball 다운로드 용도입니다. 다른 origin과 통신하지 않습니다. 시도당 30초 timeout, 3회 지수 백오프, 50 MB 크기 제한.

**Q: 호스트에서 임의 코드를 실행하는가?**
아니요. 서브프로세스는 선택적 `git init` 하나뿐입니다 (`--no-git` 또는 `git` 미설치 시 스킵). 템플릿 아카이브는 파일로만 추출되며 내용이 평가/require/실행되는 일은 없습니다. 커넥터 자체는 `node dist/index.js`로 실행되는 Node.js ESM 모듈입니다.

**Q: 파일시스템에 파괴적 작업이 있는가?**
쓰기만 수행합니다. 사용자 지정 `output_dir` (기본 `./<name>`) 하위로만 씁니다. 추출은 sibling `.<name>-incomplete-<rand>/` 디렉토리에서 staging되고, 어떤 단계든 실패하면 sibling을 재귀 삭제한 뒤 최종 경로를 생성하지 않습니다. 성공 시에는 단일 atomic `rename`으로 최종 경로로 승격합니다. 이 sibling 바깥의 파일을 삭제하지 않고, 기존 프로젝트 디렉토리를 덮어쓰지 않으며(존재하고 비어있지 않으면 바로 실패), 자신이 만들지 않은 파일에 `chmod`를 하지 않습니다.

**Q: PII / telemetry / 분석?**
없음. 이벤트 방출, 메트릭 수집, 식별자 생성 없음. 상세 stderr 로그는 기본 비활성이며 사용자가 `CREATE_STARTER_DEBUG=1`을 설정해야만 켜집니다. 이 로그도 사용자 머신에만 남고 동작 중인 경로만 기록합니다.

**Q: 서드파티 서비스 또는 데이터 공유?**
서드파티는 GitHub뿐이며, `starter-series` 오거니제이션의 공개 템플릿 tarball을 다운로드하는 용도입니다. 분석 공급사, 에러 리포터, 모델 API 호출 모두 없습니다. 공개 HTTPS 요청에 대해서는 GitHub 자체의 로그 정책이 적용됩니다.

**Q: 저장되는 데이터의 위치?**
사용자 로컬 디스크에 전부. 커넥터는 사용자 로컬 프로세스로 실행되며 파일은 사용자가 지정한 경로에 기록됩니다.

**Q: 커넥터 업데이트 방식?**
사용자가 선택한 채널로 직접 업데이트: `npm install -g @starter-series/create@latest`, 마켓플레이스에서 플러그인 재설치, 또는 새 `.mcpb`를 Claude Desktop에 드래그. 자동 업데이트 메커니즘이나 백그라운드 프로세스는 없습니다.

---

## 4. 알려진 제한사항

- **호스트 의존성.** Node.js ≥ 20 필수. `git`은 선택 — 없어도 scaffold 완료되지만 `.git` 디렉토리가 남지 않습니다.
- **템플릿 `ref` pinning.** 기본 ref는 `main`. 각 scaffold는 그 시점의 템플릿 브랜치 tip을 받습니다. 스캐폴드별 버전 핀이 없으므로 며칠 간격의 두 scaffold 결과가 다를 수 있습니다 (템플릿을 항상 최신으로 유지하려는 의도적 설계).
- **실행 샌드박스 없음.** 커넥터는 호스트 파일시스템 퍼미션을 신뢰합니다. 사용자가 자기 소유 `output_dir`를 주면 거기에 쓰고, 쓰기 권한 있는 시스템 경로를 주면 거기에도 씁니다. OS 이상의 추가 샌드박싱은 없습니다.
- **GitHub 가용성.** 템플릿 다운로드는 `github.com` 도달성을 요구. GitHub을 차단하는 사내 프록시 환경에서는 retry 소진 후 네트워크 에러로 실패합니다.
- **Windows `rename` edge case.** Windows에서 볼륨 간 `rename`은 실패할 수 있습니다. 명확한 에러 메시지로 노출하지만, 볼륨 간 copy-then-delete로 투명하게 fallback 하지는 않습니다.
- **제거 시 부작용 없음.** 커넥터를 제거해도 이전에 스캐폴드된 프로젝트는 삭제되지 않습니다 — 사용자의 작업물이기 때문에 의도적.

---

## 5. 지원 / 연락

| 채널 | URL |
|---|---|
| GitHub Issues (주) | https://github.com/starter-series/create-starter/issues |
| Discussions | https://github.com/starter-series/create-starter/discussions |
| 메인테이너 | heznpc ([github.com/heznpc](https://github.com/heznpc)) |
| 보안 리포트 | https://github.com/starter-series/create-starter/security/advisories/new 에서 비공개 advisory 제출 |

응답 SLA: best-effort, 보통 72시간 이내.

---

## 6. 호환성 매트릭스

| 클라이언트 | 설치 경로 | 상태 |
|---|---|---|
| **Claude Code** | 플러그인 마켓플레이스 (`starter-series/create-starter`) | Tested — 플러그인이 MCP 서버 + `create` 스킬 번들. 주 개발 타겟. |
| **Claude Desktop** | `.mcpb` 드래그 설치 | Tested — 매 GitHub 릴리스마다 `create-starter-0.3.0.mcpb` 첨부. |
| **Cursor** | `mcpServers` JSON 수동 등록 | Untested end-to-end. 표준 stdio MCP 클라이언트이므로 동작 예상. |
| **Windsurf** | `mcpServers` JSON 수동 등록 | Untested end-to-end. 표준 stdio MCP 클라이언트이므로 동작 예상. |
| **MCP Registry 지원 클라이언트** | `io.github.starter-series/create-starter` | Registry 엔트리 활성. 서드파티 클라이언트에서의 클라이언트 측 discovery는 미검증. |

OS 커버리지: macOS (arm64, x64), Linux (x64), Windows (x64). `.github/workflows/ci.yml`의 GitHub Actions 매트릭스로 세 OS 모두 smoke test.

---

## 7. 제출 체크리스트 (제출 직전 확인)

`https://claude.ai/settings/plugins/submit`에서 Submit 누르기 전에:

- [ ] `v0.3.0` (또는 그 이상)이 npm의 **최신 버전**이다 (`npm view @starter-series/create version`).
- [ ] `server.json` 버전이 npm 버전과 일치한다.
- [ ] `io.github.starter-series/create-starter` MCP Registry 엔트리가 **정상 활성**이다.
- [ ] 최신 GitHub 릴리스에 `create-starter-<version>.mcpb`가 첨부되어 있고 Claude Desktop에 드래그 설치 후 `list_templates` 호출이 정상 동작한다.
- [ ] `README.md`와 `README.ko.md`가 제출 버전 내용을 반영한다.
- [ ] `main`의 CI 그린 (`ci.yml`, `publish.yml`, `publish-mcp-registry.yml`).
- [ ] 아이콘 준비 — §9의 `assets/icon.png` 스펙 참고.
- [ ] 3–5장 캐러셀 스크린샷 (≥1000 px 폭, PNG), **사용자 프롬프트는 frame에서 제외**, `assets/screenshots/` 아래 저장.
- [ ] Privacy policy URL 공개 중이거나, 본 문서의 "데이터 미수집" 입장을 폼에서 링크.
- [ ] `tools/list` 응답에 tool annotations (`readOnlyHint`, `destructiveHint`, `title`)가 포함 — 로컬 MCP 클라이언트로 확인.
- [ ] Homepage / Documentation / Source / Support URL 모두 HTTP 200.
- [ ] long description의 템플릿 표가 제출 시점의 `list_templates` 출력과 일치.
- [ ] 데모 영상 URL (선택, 캐러셀 불가. description / homepage에 링크 가능) — 예: `https://github.com/starter-series/create-starter#demo`의 30–60초 asciinema/GIF.
- [ ] 메인테이너 이메일 (`wantcongz@gmail.com`) 모니터링 중.

---

## 8. 폼 답안 초안 (EN, 붙여넣기용)

아래 문자열은 알려진 폼 필드에 맞춰 미리 작성되었습니다. 제출 당일 폼을 열고 각 값을 그대로 복사하면 됩니다. (폼 언어는 영어이므로 본 섹션은 원문 유지.)

```
[Name]
create-starter

[Display name]
create-starter

[Tagline]
Scaffold production-ready projects from the Starter Series templates.

[Category]
Developer Tools

[Short description]
Scaffold production-ready projects — Discord bot, Docker deploy, MCP server, Electron, and more — from the Starter Series templates, with CI/CD baked in.

[Long description]
create-starter scaffolds projects from the Starter Series templates: Discord bot, Telegram bot, Docker deploy, MCP server (TypeScript + Python), npm package with OIDC publish, browser extension, VS Code extension, Electron app, React Native (Expo + EAS), and Cloudflare Pages. It downloads the selected template tarball from GitHub, substitutes placeholders, handles Python package renames, and optionally runs `git init`. Inputs are Zod-validated; extraction is staged in a sibling tmp directory and promoted via atomic `rename`, so a failed scaffold never leaves half-written state. Downloads enforce a 30 s timeout, 3-attempt exponential backoff, and a 50 MB cap. No credentials handled, no telemetry. Ships as a Claude Code plugin (MCP server + skill), a Claude Desktop `.mcpb` Desktop Extension, an npm CLI, and a standalone MCP stdio server.

[Use cases]
- "Scaffold a Discord bot called kudos-bot"
- "Create a new MCP server in TypeScript"
- "Set up a Docker-deployed Go service with GHCR and SSH deploy"
- "List every Starter Series template and pick one for me"

[Homepage URL]
https://github.com/starter-series/create-starter#readme

[Documentation URL]
https://github.com/starter-series/create-starter#readme

[Source URL]
https://github.com/starter-series/create-starter

[Support URL]
https://github.com/starter-series/create-starter/issues

[Privacy policy URL]
https://github.com/starter-series/create-starter/blob/main/docs/CONNECTOR_DIRECTORY_SUBMISSION.md#3-security--privacy-answers

[Transport]
stdio (local Desktop Extension / Claude Code plugin)

[Authentication type]
None

[Read/write capabilities]
Read: HTTPS GET of public template tarballs from github.com/starter-series.
Write: local filesystem writes under the user-supplied output_dir only.

[Tool list]
1. list_templates — read-only; returns the template catalog as JSON.
2. create_project — writes; scaffolds a project from a selected template.

[Tool annotations confirmation]
Both tools set `title` and the appropriate hint. list_templates → readOnlyHint=true.
create_project → readOnlyHint=false; destructive operations confined to an atomic
rename of a fresh sibling directory under the user-specified output_dir.

[Third-party connections]
GitHub only, for public template tarball download. No other external services.

[Data handling]
No PII collected, no telemetry emitted, no data at rest outside the scaffolded
project directory. User inputs (name, description, template id) are written locally
into the scaffold and never transmitted.

[Health data access]
No.

[Test account / setup]
No account required. Reviewer can install the .mcpb, call list_templates, then
create_project with template=mcp-server, name=demo to produce a working scaffold.

[GA date]
2026-04-24 (v0.3.0 currently GA on npm and MCP Registry).

[Surfaces tested]
- Claude Code (plugin) — tested
- Claude Desktop (.mcpb) — tested
- Cursor / Windsurf (manual mcpServers entry) — not formally tested

[Branding / logo]
assets/icon.png (1024x1024 PNG, transparent background). TODO on submission day
if not yet generated.

[Screenshots]
assets/screenshots/01-list-templates.png
assets/screenshots/02-create-project.png
assets/screenshots/03-scaffold-complete.png
(All ≥1000 px wide, PNG, prompt text cropped out per Anthropic MCP App spec.)
```

---

## 9. 아이콘 & 스크린샷 스펙

### 아이콘 (`assets/icon.png`)

Anthropic 제출 문서는 커넥터 로고의 정확한 규격을 공개하지 않고 "server logo (URL or SVG upload), favicon verification"만 명시합니다. 업계 표준 안전값: **1024 × 1024 PNG, 투명 배경, 라이트/다크 양쪽 ≥ 2:1 대비**. 파비콘용으로 512 × 512 변형도 함께 보관 권장.

현재 상태: `assets/icon.png`는 **플레이스홀더 TODO**(아직 생성되지 않음). 제출 당일까지:

- `assets/icon.png` — 1024 × 1024 PNG 투명. 글리프: Starter Series 로고 또는 `{ }` 스캐폴드 마크의 스타일화.
- `assets/icon-512.png` — 512 × 512 PNG (favicon).

### 스크린샷 (캐러셀)

Anthropic MCP App 스펙:

- **개수**: 3–5장
- **포맷**: PNG (GIF, 비디오 불가)
- **최소 폭**: 1000 px
- **종횡비**: 자유. 다만 세트 내에서는 일관되게.
- **내용**: Claude 응답 영역으로만 crop. **사용자 프롬프트는 프레임에서 제외.**

추천 플로우:

1. `01-list-templates.png` — Claude가 `list_templates` JSON을 테이블로 렌더.
2. `02-create-project.png` — Claude가 `create_project` 인자와 생성된 파일 트리를 확인.
3. `03-scaffold-complete.png` — 갓 스캐폴드된 `discord-bot`의 `README.md`가 사용자 에디터에 열린 모습.

---

## 10. 조사 중 발견한 모호한 지점

- support.claude.com의 공식 문서 두 개가 모두 `claude.com/docs/connectors/building/submission`로 리다이렉트되고, support 페이지 자체에는 더 이상 필드가 남아있지 않습니다. 본 문서는 dev docs 원본을 기준으로 작성되었습니다.
- Anthropic이 커넥터 제출용 로고의 정확한 치수를 공개하지 않음 — 1024 × 1024를 안전한 기본값으로 가정.
- 비디오 / GIF 캐러셀 에셋은 **명시적으로 허용되지 않음**. 데모 비디오는 long description이나 homepage에서 링크만 가능.
- `stdio` / 로컬 커넥터가 remote Streamable-HTTP 커넥터와 동일한 디렉토리 뷰에 섞여 노출되는지 여부는 문서에 완전히 명시되지 않음. 로컬 커넥터는 허용되지만 "Desktop extensions" 그룹에 묶일 수 있음.
- Privacy policy URL: Anthropic은 "required for local connectors"라고만 명시. 본 커넥터의 입장은 "데이터 미수집"이며, §3의 답변이 실질적인 정책으로 기능합니다. 리뷰어가 독립 URL을 요구할 경우 `docs/PRIVACY.md`로 §3을 분리 공개할 예정.

---

*문서 오너: heznpc. `package.json#version`, `server.json#version`, `manifest.json#version`과 함께 버전 업데이트 필수.*
