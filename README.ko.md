# create-starter

> Starter Series 프로젝트를 스캐폴딩하고 감사 — MCP 서버, Claude Code 스킬, CLI 세 방식을 한 패키지에서 제공합니다.

Part of: **Human-Controlled AI Systems** — 스캐폴딩은 쉬운 절반에 불과합니다. 출시된 레포가 신뢰할 만한 상태를 유지하게 만드는 것은 감사 프리미티브(`audit`, `audit-cd`, `audit-security`)가 알려진 기준선에 대해 릴리스·CD·CI 보안 위생을 검증하며, 사람에게 매번 다시 확인하라고 하는 대신 머지를 게이팅하는 부분입니다.

[🇬🇧 English](README.md)

## Currently implemented (현재 구현된 것)

- **CLI** — `npx @starter-series/create my-bot --template discord-bot`. 11개 템플릿 중 하나를 Zod 검증된 입력, 성공 시 atomic rename, retry + timeout + 50 MB 다운로드 캡으로 스캐폴딩합니다.
- **MCP 서버** — stdio 툴 다섯 개: `list_templates`, `create_project`, `audit_release`, `audit_cd`, `audit_security`. 하나의 바이너리가 argv로 모드를 선택합니다 (positional 인자 → CLI, 없음 → MCP stdio).
- **Claude Desktop 확장** — 모든 릴리스에 `.mcpb` 번들 포함. Claude Desktop 설정 창에 드래그하면 끝.
- **Claude Code 플러그인 + 스킬** — `/plugin install create-starter@starter-series` 한 줄로 MCP 서버와 대화형 `create` 스킬을 함께 설치.
- **MCP Registry 등록** — `io.github.starter-series/create-starter`, OIDC 네임스페이스 검증, npm 타르볼 교차검사.
- **`audit_release`** — 매칭 starter 감지, 버전 vs 마지막 태그 드리프트, 머지된 PR 대비 CHANGELOG 드리프트 (`git log <tag>..HEAD`), publish 워크플로우 종류 (release-please / publish-on-tag / auto-release).
- **`audit_cd`** — npm, PyPI, Open VSX, VS Marketplace, AMO, GitHub Releases의 destination별 publish 드리프트 (in-sync / needs-publish / local-stale / not-found / unsupported) 탐지.
- **`audit_security`** — CI 위생 항목 8개 점검: gitleaks (pin 체크 포함), CodeQL, dependency audit, license check, `--ignore-scripts`, Dependabot grouped, secret-scanning hint, claude-code-security-review Action. 이 레포 자체는 8/8 HARDENED 통과.
- **졸업 가이드** — `docs/graduation-from-vibe-coding.md` (+ 한국어): Lovable/Bolt/v0 export에서 GitHub Actions + 자체 deploy target으로 옮기는 5단계 경로. 세 가지 감사 프리미티브를 사용합니다.

## Planned (계획된 것)

- `audit_cd`의 Chrome Web Store, EAS, Railway, Fly, GHCR 지원. 현재는 인증이 필요하거나 공개 read API가 없어 `unsupported`로 보고됩니다.

## Design intent (설계 의도)

- **하나의 바이너리, 두 개의 표면.** CLI와 MCP stdio가 하나의 스캐폴딩 엔진을 공유합니다. argv가 어느 표면이 응답할지 결정합니다. "사람이 호출하는 것과 에이전트가 호출하는 것"을 위한 중복 로직이 없습니다.
- **실패 시 원자적.** 추출은 sibling `.<name>-incomplete-<rand>` 디렉터리에서 진행되고, 성공한 경우에만 최종 경로로 rename됩니다. 네트워크 실패, 손상된 아카이브, 부분 쓰기 — 어느 것도 절반 스캐폴딩된 디렉터리를 남기지 않습니다.
- **감사는 곁가지가 아니라 일등 시민.** 템플릿은 보안 베이스라인 (gitleaks SHA pin, CodeQL, Dependabot grouped, `--ignore-scripts`, claude-code-security-review)을 함께 제공합니다. 세 가지 감사 명령은 다운스트림 레포가 그 베이스라인을 여전히 충족하는지 확인합니다 — 베이스라인을 일회성 스캐폴딩에서 지속적 게이트로 전환합니다.
- **자체 도그푸딩.** 이 레포는 `audit_security` 8/8 HARDENED를 통과합니다. 다른 레포를 감사하는 도구가 자신의 체크를 통과하지 못한다면 그 기준선은 실재하는 것이 아닙니다.
- **샌드박스 바깥에서는 읽기 전용.** 다운로드는 캡 적용 (50 MB, 30 s timeout, 3회 재시도). 상대 경로 출력은 cwd 바깥으로 벗어날 수 없고, 절대 경로는 명시적 사용자 의도로만 허용됩니다. `git init` 실패는 기록되지만 치명적이지 않습니다.

## Non-goals (의도적으로 거부한 것)

- **`audit_cd`의 모든 벤더 동등 지원.** 공개 read API가 없는 destination은 확실하게 틀린 상태를 보고하기보다 `unsupported`로 남깁니다.
- **앱 코드 재작성.** 졸업 플로우는 매칭 starter에서 CI/CD를 이식할 뿐, 애플리케이션 코드는 절대 건드리지 않습니다.
- **범용 프로젝트 생성기.** 템플릿은 Starter Series 11개로 고정. 새로운 스택은 `create_project`의 플래그가 아니라 새로운 starter로 들어옵니다.

## 빠른 시작 — CLI

```bash
npx @starter-series/create my-bot --template discord-bot
# 또는 clone/build 후 직접:
node dist/index.js my-bot --template discord-bot
```

```
create-starter — scaffold a project from the Starter Series.

Usage
  create-starter <name> --template <id> [options]
  create-starter --list
  create-starter --help

Options
  -t, --template <id>      템플릿 ID (--list로 확인)
  -d, --description <text> 한 줄 설명
  -o, --output-dir <path>  출력 디렉터리 (기본값: ./<name>)
      --no-git             scaffold 후 "git init" 생략
      --list               템플릿 목록 출력 후 종료
  -h, --help               도움말 출력 후 종료
  -v, --version            버전 출력 후 종료

Environment
  CREATE_STARTER_DEBUG=1   상세 stderr 로그 출력
```

## 사용 가능한 템플릿

| ID | 스택 |
|----|-------|
| `mcp-server` | TypeScript + `@modelcontextprotocol/sdk` + Zod |
| `mcp-server-python` | Python + FastMCP |
| `npm-package` | Jest + ESLint + OIDC publish |
| `discord-bot` | discord.js v14 + Docker |
| `telegram-bot` | grammY + Docker |
| `browser-extension` | Chrome/Firefox MV3 |
| `vscode-extension` | VS Marketplace + Open VSX |
| `electron-app` | 크로스 플랫폼 + code signing |
| `react-native` | Expo + EAS |
| `cloudflare-pages` | Wrangler + Pages |
| `docker-deploy` | 언어 무관 + GHCR + SSH |

`create-starter --list` (CLI) 또는 `list_templates` (MCP)로 실시간 목록 확인.

## Lovable / Bolt / v0에서 졸업하기

바이브 코딩 플랫폼에서 동작하는 앱을 GitHub Actions + 자체 deploy target으로 졸업시키고 싶다면 [`docs/graduation-from-vibe-coding.ko.md`](docs/graduation-from-vibe-coding.ko.md) ([English](docs/graduation-from-vibe-coding.md)) 문서를 참고하시기 바랍니다 — `audit`, `audit-cd`, `audit-security`로 레포를 진단하고, 앱 코드는 건드리지 않은 채 매칭 starter에서 CI/CD를 이식하는 5단계 경로입니다.

## 소스에서 설치

```bash
git clone https://github.com/starter-series/create-starter
cd create-starter
npm install
npm run build
```

Node.js ≥22 필요.

## Claude Desktop 원클릭 설치

[릴리스 페이지](https://github.com/starter-series/create-starter/releases/latest)에서 최신 `.mcpb` 파일을 받아 Claude Desktop 설정 창에 드래그하면 설치 완료. Claude Desktop이 번들된 `dist/`와 `node_modules/`를 풀고 `create-starter`를 MCP 서버로 등록합니다 — `npm` 불필요, 설정 파일 편집 불필요, 절대 경로 불필요.

> `.mcpb` (MCP Bundle, 구 `.dxt`)는 MCP 서버를 위한 Anthropic의 패키지 확장 포맷입니다. [Desktop Extensions](https://www.anthropic.com/engineering/desktop-extensions) 참고.

로컬에서 재빌드:

```bash
npm ci
npm run bundle:mcpb   # create-starter-<version>.mcpb 생성
```

## MCP 서버로 사용

빌드된 바이너리를 MCP 클라이언트(Claude Desktop, Cursor 등)에 등록:

```json
{
  "mcpServers": {
    "create-starter": {
      "command": "node",
      "args": ["/absolute/path/to/create-starter/dist/index.js"]
    }
  }
}
```

에이전트에게 요청: *"create-starter로 `my-bot` discord 봇을 스캐폴딩해줘."* 에이전트가 필요시 `list_templates`를 호출하고 `create_project`로 스캐폴딩을 실행합니다.

> 추가 인자 없이 호출하면 **MCP stdio** 모드, positional 인자나 플래그가 있으면 **CLI** 모드로 전환됩니다. 두 모드는 동일 스캐폴딩 엔진을 공유합니다.

## Claude Code 플러그인으로 사용

플러그인 하나를 설치하면 MCP 서버와 `create` 스킬이 함께 활성화됩니다.

Claude Code REPL에서:

```
/plugin marketplace add starter-series/create-starter
/plugin install create-starter@starter-series
```

이후 Claude에게 "`my-bot` 디스코드 봇 스캐폴딩 해줘"처럼 요청하면 `create-starter:create` 스킬이 MCP 툴 호출을 안내합니다.

로컬 개발(마켓플레이스 왕복 없이):

```bash
claude --plugin-dir /path/to/create-starter
```

git clone 경로를 그대로 지정하면 `skills/create/SKILL.md`나 `dist/index.js` 수정이 세션 시작 시 바로 반영됩니다.

## MCP Registry로 사용

이 서버는 [공식 MCP Registry](https://registry.modelcontextprotocol.io/)에 다음 네임스페이스로 게시됩니다:

```
io.github.starter-series/create-starter
```

Registry 디스커버리를 지원하는 MCP 클라이언트는 경로를 수동으로 지정하지 않고 이름만으로 설치할 수 있습니다. Registry 엔트리는 npm 패키지 `@starter-series/create`를 가리키므로, `npx`가 위에서 설명한 동일 stdio 서버를 실행합니다.

소유권 검증: GitHub OIDC 네임스페이스 `io.github.starter-series/*` + npm tarball 검사 (`package.json#mcpName`). 게시 플로우는 [`.github/workflows/publish-mcp-registry.yml`](https://github.com/starter-series/create-starter/blob/main/.github/workflows/publish-mcp-registry.yml) 참고.

## 툴

스캐폴딩:

- **`list_templates`** — 전체 템플릿 테이블 JSON 반환.
- **`create_project`** — 인자:
  - `template` *(필수)* — 위 테이블의 템플릿 ID.
  - `name` *(필수)* — `^[A-Za-z0-9][A-Za-z0-9_-]*$` 매칭되는 프로젝트 이름.
  - `description` *(선택)* — 한 줄 설명.
  - `output_dir` *(선택)* — 기본 `./<name>` (MCP 서버 cwd 기준). 상대 경로는 cwd 밖으로 벗어날 수 없고, 절대 경로는 사용자 의도로 허용.
  - `init_git` *(선택, 기본 `true`)* — scaffold 후 `git init` 실행 여부.

감사 (각각 선택적 `path` 인자, 기본값 = MCP 서버 cwd; 모두 읽기 전용):

- **`audit_release`** — 릴리스 준비 상태 진단. CLI 미러: `create-starter audit [path]`.
- **`audit_cd`** — destination별 publish 드리프트 탐지. CLI 미러: `create-starter audit-cd [path]`.
- **`audit_security`** — CI 보안 위생 베이스라인 점검. CLI 미러: `create-starter audit-security [path]`.

## 안전성 & 신뢰성

- 프로젝트 이름은 파일시스템 조작 전에 regex로 검증, 상대 경로는 working directory를 벗어나면 거부.
- 다운로드는 30초 timeout, 3회 지수 백오프 retry, 50 MB 크기 제한.
- 추출은 sibling `.<name>-incomplete-<rand>` 디렉터리에서 진행. 네트워크/손상 아카이브/추출 실패 등 어느 단계든 실패하면 tmp 디렉터리 제거. 최종 경로는 모든 작업이 성공한 뒤에만 atomic `rename`으로 노출.
- `git init` 실패는 stderr 경고로만 남기고 scaffold 자체는 성공. `.git` 디렉터리 없이도 프로젝트 사용 가능.

## 라이선스

MIT © heznpc
