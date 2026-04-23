# create-starter

> [Starter Series](https://github.com/starter-series) 템플릿에서 프로젝트를 스캐폴딩 — MCP 서버와 Claude Code 스킬로 제공.

[🇬🇧 English](README.md)

## 무엇을 하나요

`create-starter`는 Starter Series 템플릿을 clone하고, 프로젝트 이름을 리네임하고, 플레이스홀더(name, description)를 치환한 뒤 다음 단계를 출력합니다. 파일시스템 조작은 Zod 검증을 통과한 입력에 대해서만 수행됩니다.

두 가지 모드로 동작:

- **MCP 서버** — MCP 호환 에이전트(Claude Desktop, Cursor 등)가 `list_templates`와 `create_project` 툴을 호출합니다.
- **Claude Code 스킬** — 번들된 `skill/SKILL.md`로 Claude Code가 대화식으로 스캐폴딩을 구동합니다.

## 사용 예시

`create-starter`는 타이핑 기반 프롬프트가 아니라 에이전트(Claude Code, Claude Desktop, Cursor, …)가 구동합니다. MCP 서버를 등록([MCP 서버로 사용](#mcp-서버로-사용) 참고)한 뒤의 호출 흐름:

```
You   › create-starter로 my-bot이라는 discord 봇 스캐폴딩해줘.

Agent › (list_templates 호출 → create_project 호출)
        Project "my-bot" created from Discord Bot
          Path: /Users/you/code/my-bot
          Files customized: 7

        Next steps:
          cd my-bot
          npm install
          npm run dev
```

에이전트가 템플릿 ID와 프로젝트 이름을 확인하고 `create_project`를 호출하면, 사용자는 생성된 디렉터리로 `cd`만 하면 됩니다. 별도 프롬프트 UI 없이 에이전트가 대화를 담당합니다.

> `create-starter` 바이너리 자체는 MCP stdio 프로토콜을 말하므로, MCP 클라이언트 없이 `npx create-starter`처럼 직접 실행하면 인터랙티브 메뉴가 뜨지 않습니다.

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
| `react-native` | Expo SDK 52 + EAS |
| `cloudflare-pages` | Wrangler + Pages |
| `docker-deploy` | 언어 무관 + GHCR + SSH |

실시간 목록은 `list_templates`로 확인.

## 설치

```bash
npm install
npm run build
```

Node.js ≥20 필요.

## MCP 서버로 사용

MCP 클라이언트(Claude Desktop, Cursor 등)에 등록:

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

에이전트에게 요청: *"create-starter로 `my-bot` discord 봇을 스캐폴딩해줘."*

## Claude Code 스킬로 사용

`skill/` 디렉터리를 Claude Code 스킬 디렉터리에 복사하거나 심볼릭 링크:

```bash
ln -s "$(pwd)/skill" ~/.claude/skills/create-starter
```

Claude Code에서: `/create-starter` (또는 자연어로 템플릿 언급).

## 툴

- **`list_templates`** → 전체 템플릿 테이블 반환.
- **`create_project`** → 인자:
  - `template` *(필수)* — 위 테이블의 템플릿 ID.
  - `name` *(필수)* — kebab-case 프로젝트 이름 (`^[a-z0-9][a-z0-9._-]*$`).
  - `description` *(선택)* — 한 줄 설명.
  - `output_dir` *(선택)* — 기본값 `./<name>`.

## 라이선스

MIT © heznpc
