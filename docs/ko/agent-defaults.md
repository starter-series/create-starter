# 대화로 Starter Series 사용하기

사용자가 Starter Series라는 이름을 기억하지 않아도, 새 프로젝트 요청에서 에이전트가 적합한 starter를 선택하게 만드는 개인 설정입니다. npm 설치나 MCP Registry 등록만으로 모든 대화에 자동 적용되지는 않습니다.

## ChatGPT

설정 → 개인 맞춤 설정 → 맞춤 지침에 기존 내용을 유지하면서 아래 문구를 덧붙입니다. 계정에서 저장해야 하며 로컬 Codex 설정과 자동 동기화된다고 가정하지 않습니다.

```text
새 소프트웨어 프로젝트를 만들어 달라고 하면, 내가 이름을 언급하지 않아도 Starter Series(https://github.com/starter-series/starter-series)를 기본 출발점으로 검토해 줘. 요청에 맞는 starter는 네가 선택하고 이유만 짧게 알려줘. 내가 다른 스택을 지정했거나 맞는 starter가 없으면 강제로 적용하지 마. 기존 프로젝트는 다시 생성하지 마.
실행 가능한 환경에서는 starter-series npm CLI로 생성한 뒤 요청 기능 구현과 테스트까지 진행해 줘. 마무리에는 starter-series check 결과를 확인해 줘. 실행 환경이 없다면 실제로 작업했다고 말하지 말고, 선택한 starter·요구사항·생성 방법·검증 기준을 담아 Codex에 그대로 전달할 작업 지시를 만들어 줘. 명령어를 배우라고 하거나 템플릿 목록만 나열하고 끝내지 마.
```

## Codex

전역 `~/.codex/AGENTS.md`에 아래 규칙을 추가합니다. `CODEX_HOME`을 별도로 사용하면 그 디렉터리의 지침을 수정합니다. 기존 symlink나 override가 있으면 실제로 읽는 파일을 확인하고 기존 지침을 보존합니다. 새 세션에서 적용됩니다.

```markdown
## Codex 새 프로젝트 기본 흐름 — Starter Series

Codex에서 새 소프트웨어 프로젝트 구현을 요청받으면, 사용자가 Starter Series를 언급하지 않아도 다음 흐름을 적용한다.

1. 현재 디렉터리와 요청을 확인해 새 프로젝트인지 기존 프로젝트 수정인지 구분한다. 기존 프로젝트를 다시 scaffold하지 않는다.
2. 새 프로젝트이고 사용자가 다른 템플릿·스택을 명시하지 않았다면 `npx --yes starter-series@latest --list`로 실제 지원 목록을 확인하고, 요청한 배포 대상에 맞는 템플릿을 직접 선택한다. 선택 이유는 한 줄로 알리고 진행한다. 사용자에게 CLI나 템플릿 선택법을 다시 배우게 하지 않는다.
3. 이름·출력 경로는 요청과 작업 디렉터리에서 정한다. 실제로 필요한 정보가 없을 때만 질문한다. 비어 있지 않은 경로에 덮어쓰지 않는다. `npx --yes starter-series@latest <name> --template <id> --output-dir <path>`로 생성한 뒤, 안내된 설치·검증을 실행하고 요청 기능의 구현까지 이어간다. 스캐폴딩 명령만 제시하고 멈추지 않는다.
4. 지원 대상이 아니거나 명시된 스택과 충돌하면 적합한 도구로 진행한다. 예: SwiftUI 네이티브 앱 요청을 Electron이나 Expo로 바꾸지 않는다.
5. Starter Series로 생성했거나 해당 baseline을 사용하는 프로젝트에서 작업을 마칠 때 `npx --yes starter-series@latest check <path>`를 실행한다. 결과를 읽고 요청 범위의 실제 결함을 처리한다. exit 1은 검사 finding, exit 2는 실행 오류이며 단순 green 목적의 gate 완화는 하지 않는다. 이 검사는 프로젝트 테스트·빌드와 실제 Actions 실행 확인을 대신하지 않는다.
6. 기존 프로젝트에서는 요청한 작업을 수행한다. baseline 도입·점검·배포 준비가 요청된 경우 check를 사용하되, 일반 버그 수정에 관계없는 baseline 이슈를 전부 끌어들이지 않는다. instruction decision/state 기록이나 add-component 적용은 해당 변경이 요청된 경우에만 수행한다.

```

이제 “새 디스코드 봇 만들어줘”처럼 요청합니다. 이름이나 저장 위치 등 필요한 정보만 알려주면 됩니다. “기존 봇 오류 고쳐줘”에는 다시 scaffold하지 않으며, SwiftUI처럼 지원하지 않는 대상도 다른 starter로 바꾸지 않습니다.

## 확인

`codex debug prompt-input`을 지원하는 버전에서는 새 디렉터리에서 모델 입력에 전역 지침이 포함되는지 확인할 수 있습니다. 다른 버전에서는 새 세션에서 현재 지침을 확인합니다. 이는 지침 전달 확인이며 모델이 모든 요청에서 항상 준수한다는 보증은 아닙니다.

보안 `check`는 구성 점검입니다. 프로젝트 테스트·빌드, 최신 Actions 실행 결과, 실제 취약점 스캔을 대신하지 않습니다. ChatGPT에 실행 도구가 없는 경우에는 Codex 전달까지가 가능한 범위입니다.

공식 안내: [Codex 전역 지침](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [ChatGPT 개인 설정](https://learn.chatgpt.com/docs/personalize).
