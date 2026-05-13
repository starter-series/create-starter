# create-starter

> [Starter Series](https://github.com/starter-series) 템플릿에서 프로젝트를 스캐폴딩 — MCP 서버, Claude Code 스킬, CLI 세 방식 지원.

[🇬🇧 English](README.md)

## 무엇을 하나요

`create-starter`는 Starter Series 템플릿을 다운로드하고, 플레이스홀더(name, description)를 치환하며, Python 패키지 리네임(pyproject + src 디렉터리)을 처리하고 `git init`까지 수행합니다. 파일시스템 조작 전에 Zod로 입력을 검증하고, 추출은 sibling tmp 디렉터리에서 진행되어 실패해도 중간 결과물이 남지 않으며, 다운로드는 retry + timeout + 크기 제한을 가집니다.

다섯 가지 모드로 동작 — 워크플로우에 맞게 선택:

- **Claude Code 플러그인** — `/plugin marketplace add starter-series/create-starter` 후 `/plugin install create-starter@starter-series`. MCP 서버 + 스킬 한 방에 설치.
- **Claude Desktop 확장** — [최신 릴리스](https://github.com/starter-series/create-starter/releases/latest)의 `.mcpb` 파일을 Claude Desktop 설정 창에 드래그. `npm`도, JSON 편집도 필요 없음.
- **CLI** — 아무 터미널에서 `npx @starter-series/create my-bot --template discord-bot`.
- **MCP 서버** — MCP 호환 에이전트(Claude Desktop, Claude Code, Cursor, Windsurf 등)가 `list_templates`, `create_project` 툴 호출.
- **Claude Code 스킬** — 번들된 `skills/create/SKILL.md`로 Claude Code가 대화식 스캐폴딩 (플러그인 설치 시 자동 포함).

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

바이브 코딩 플랫폼에서 동작하는 앱을 GitHub Actions + 자체 deploy target으로 졸업시키고 싶나? [`docs/graduation-from-vibe-coding.ko.md`](docs/graduation-from-vibe-coding.ko.md) ([English](docs/graduation-from-vibe-coding.md)) — `audit`, `audit-cd`, `audit-security`로 레포를 진단하고, 앱 코드는 건드리지 않은 채 매칭 starter에서 CI/CD를 이식하는 5단계 경로.

## 소스에서 설치

```bash
git clone https://github.com/starter-series/create-starter
cd create-starter
npm install
npm run build
```

Node.js ≥20 필요.

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

> 추가 인자 없이 호출하면 **MCP stdio** 모드, positional 인자나 플래그가 있으면 **CLI** 모드로 전환됩니다. 두 모드는 동일 스캐폴딩 엔진을 공유.

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

- **`list_templates`** — 전체 템플릿 테이블 JSON 반환.
- **`create_project`** — 인자:
  - `template` *(필수)* — 위 테이블의 템플릿 ID.
  - `name` *(필수)* — `^[A-Za-z0-9][A-Za-z0-9_-]*$` 매칭되는 프로젝트 이름.
  - `description` *(선택)* — 한 줄 설명.
  - `output_dir` *(선택)* — 기본 `./<name>` (MCP 서버 cwd 기준). 상대 경로는 cwd 밖으로 벗어날 수 없고, 절대 경로는 사용자 의도로 허용.
  - `init_git` *(선택, 기본 `true`)* — scaffold 후 `git init` 실행 여부.

## 안전성 & 신뢰성

- 프로젝트 이름은 파일시스템 조작 전에 regex로 검증, 상대 경로는 working directory를 벗어나면 거부.
- 다운로드는 30초 timeout, 3회 지수 백오프 retry, 50 MB 크기 제한.
- 추출은 sibling `.<name>-incomplete-<rand>` 디렉터리에서 진행. 네트워크/손상 아카이브/추출 실패 등 어느 단계든 실패하면 tmp 디렉터리 제거. 최종 경로는 모든 작업이 성공한 뒤에만 atomic `rename`으로 노출.
- `git init` 실패는 stderr 경고로만 남기고 scaffold 자체는 성공. `.git` 디렉터리 없이도 프로젝트 사용 가능.

## 라이선스

MIT © heznpc
