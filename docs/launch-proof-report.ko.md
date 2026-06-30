# Launch Proof Report

Launch Proof Report는 create-starter의 release, CD, security, instruction-review 감사 프리미티브를 하나의 출시 인계 리포트로 묶습니다.

앱이 이미 동작하지만, README 주장만 믿지 않고 릴리스, 퍼블리시, 유지보수 가능성을 증거로 확인해야 하는 시점에 쓰는 문서입니다.

## 무엇을 확인하나요

| Gate | 원천 명령 | 증명하는 것 |
| --- | --- | --- |
| Release | `create-starter audit` | 버전, changelog, 매칭 starter, publish workflow 구조가 출시 가능한 형태인지 확인합니다. |
| CD | `create-starter audit-cd` | 공개 read API가 있는 registry 또는 release destination에서 로컬 버전과 공개 버전의 드리프트를 확인합니다. |
| Security | `create-starter audit-security` | secret scanning, dependency audit, CodeQL, pinned gitleaks, license check, Dependabot, install-script guard, security-review workflow 등 기본 CI 보안 위생을 확인합니다. |
| Instructions | `create-starter audit-instructions` | agent instruction 파일의 exact duplicate review finding과 cross-file surface overlap을 확인합니다. Keyword risk summary는 advisory일 뿐, exhaustive safety나 semantic drift detection이 아닙니다. |

이 리포트는 법률, 스토어 심사, 개인정보 처리, 보안 인증 상태를 보증하지 않습니다. 기술적인 출시 준비도 인계 문서입니다.

## 실행

```bash
npx -y @starter-series/create proof-report /path/to/repo
```

기본 출력 파일은 다음과 같습니다.

```text
/path/to/repo/launch-proof-report.md
```

다른 에이전트나 CI 단계가 Markdown을 바로 받아야 한다면 `--stdout`을 사용합니다.

```bash
npx -y @starter-series/create proof-report /path/to/repo --stdout
```

인계 폴더에 저장하려면 `--output`을 사용합니다.

```bash
npx -y @starter-series/create proof-report /path/to/repo --output reports/launch-proof.md
```

`--output`은 대상 레포 내부 기준으로 해석됩니다. 레포 밖으로 벗어나는 경로는 거부합니다.

## 종료 코드

| Code | 의미 |
| --- | --- |
| `0` | 리포트를 생성했고 전체 verdict가 `READY`입니다. |
| `1` | 리포트를 생성했지만 하나 이상의 proof gate가 `BLOCKED`이거나 확인이 필요합니다. |
| `2` | 경로 또는 플래그 오류 등으로 명령을 실행하지 못했습니다. |

## 유료 서비스로 포장한다면

템플릿이 아니라 리포트를 파는 것이 맞습니다.

산출물은 다음을 포함해야 합니다.

- `launch-proof-report.md`
- 감사한 정확한 commit SHA
- `npm test` 또는 해당 레포의 공식 테스트 명령 출력
- 필요 시 생성된 package 또는 store asset 증거
- `blocker`, `warning`, `nice-to-have`로 정렬한 짧은 remediation 목록

실제 외부 인증 절차가 없다면 "certified"라고 부르지 마십시오. 정직한 제안은 다음입니다.

> AI로 만든 레포를 출시 인계 가능한 상태로 정리해드립니다. release gate, publish gate, security gate, instruction-review gate, 그리고 출시 전 필요한 다음 수정 사항까지 남깁니다.

## shotkit과의 관계

브라우저 확장처럼 시각 자산이 필요한 출시에서는 proof gate가 통과한 뒤 `shotkit`을 실행합니다. `shotkit`은 스토어/소셜 자산을 만들고, Launch Proof Report는 레포가 기술적으로 출시 가능한지 기록합니다.
