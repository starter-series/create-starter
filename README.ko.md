# create-starter

> [Starter Series](https://github.com/starter-series) 템플릿에서 프로젝트를 스캐폴딩 — MCP 서버, Claude Code 스킬, CLI 세 방식 지원.

[🇬🇧 English](README.md)

## 무엇을 하나요

`create-starter`는 Starter Series 템플릿을 다운로드하고, 플레이스홀더(name, description)를 치환하며, Python 패키지 리네임(pyproject + src 디렉터리)을 처리하고 `git init`까지 수행합니다. 파일시스템 조작 전에 Zod로 입력을 검증하고, 추출은 sibling tmp 디렉터리에서 진행되어 실패해도 중간 결과물이 남지 않으며, 다운로드는 retry + timeout + 크기 제한을 가집니다.

세 가지 모드로 동작 — 워크플로우에 맞게 선택:

- **CLI** — 아무 터미널에서 `npx @starter-series/create my-bot --template discord-bot`.
- **MCP 서버** — MCP 호환 에이전트(Claude Desktop, Claude Code, Cursor, Windsurf 등)가 `list_templates`, `create_project` 툴 호출.
- **Claude Code 스킬** — 번들된 `skill/SKILL.md`로 Claude Code가 대화식 스캐폴딩.

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

## 소스에서 설치

```bash
git clone https://github.com/starter-series/create-starter
cd create-starter
npm install
npm run build
```

Node.js ≥20 필요.

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

## Claude Code 스킬로 사용

```bash
ln -s "$(pwd)/skill" ~/.claude/skills/create-starter
```

Claude Code에서 템플릿을 자연어로 언급하거나 스킬 이름을 직접 부르면, Claude가 `curl`/`tar` 대신 MCP 툴을 호출하도록 유도됩니다.

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
