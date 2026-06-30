const translations = {
  en: {
    "nav.workflow": "Workflow",
    "nav.audits": "Audits",
    "nav.handoff": "Handoff",
    "nav.install": "Install",
    "hero.body":
      "Scaffold Starter Series projects, audit release/CD/security/instruction hygiene, and produce evidence-first Launch Proof Reports without rewriting app code.",
    "hero.primary": "View on GitHub",
    "hero.secondary": "Install locally",
    "preview.release": "release",
    "preview.cd": "cd",
    "preview.security": "security",
    "preview.instructions": "instructions",
    "preview.ready": "ready",
    "preview.review": "review",
    "preview.hardened": "hardened",
    "preview.attention": "attention",
    "workflow.scaffold.title": "Scaffold",
    "workflow.scaffold.body": "Start from one of the maintained Starter Series templates.",
    "workflow.audit.title": "Audit",
    "workflow.audit.body": "Check release, CD, security, and agent-instruction hygiene.",
    "workflow.handoff.title": "Handoff",
    "workflow.handoff.body": "Generate a Launch Proof Report with evidence and blockers.",
    "audits.title": "Audits stay narrow and inspectable.",
    "audits.body":
      "The audit tools are read-only checks for launch hygiene. They avoid unsupported vendor claims and keep advisory instruction-risk reminders separate from hard duplicate or overlap findings.",
    "audits.release": "Version/tag drift, changelog drift, and publish workflow detection.",
    "audits.cd": "Public registry drift for supported destinations; unsupported destinations stay explicit.",
    "audits.security":
      "Core CI hardening checks such as gitleaks, CodeQL, audits, and least-privilege workflow habits.",
    "audits.instructions": "Exact duplicates, cross-file overlap, and keyword reminders for human review.",
    "handoff.title": "Launch Proof Reports are evidence, not certification.",
    "handoff.body":
      "The report combines release, CD, security, and instruction review into one handoff document. It exits non-zero when the repository is not actually launch-ready.",
    "install.title": "Use it as CLI, MCP server, plugin, or Desktop extension.",
    "install.body":
      "One binary switches between CLI and MCP stdio. The package also ships Claude Code plugin metadata, skills, and the release-built Desktop extension bundle.",
    "footer.status": "Read-only launch hygiene tools for Starter Series projects.",
    "footer.ko": "Korean README",
  },
  ko: {
    "nav.workflow": "흐름",
    "nav.audits": "감사",
    "nav.handoff": "인계",
    "nav.install": "설치",
    "hero.body":
      "Starter Series 프로젝트를 스캐폴딩하고 release/CD/security/instruction 위생을 감사하며, 앱 코드를 다시 쓰지 않고 근거 우선 Launch Proof Report를 만듭니다.",
    "hero.primary": "GitHub에서 보기",
    "hero.secondary": "로컬 설치",
    "preview.release": "release",
    "preview.cd": "cd",
    "preview.security": "security",
    "preview.instructions": "instructions",
    "preview.ready": "ready",
    "preview.review": "review",
    "preview.hardened": "hardened",
    "preview.attention": "attention",
    "workflow.scaffold.title": "스캐폴딩",
    "workflow.scaffold.body": "관리되는 Starter Series 템플릿 중 하나에서 시작합니다.",
    "workflow.audit.title": "감사",
    "workflow.audit.body": "release, CD, security, agent-instruction 위생을 확인합니다.",
    "workflow.handoff.title": "인계",
    "workflow.handoff.body": "근거와 blocker가 포함된 Launch Proof Report를 생성합니다.",
    "audits.title": "감사는 좁고 검토 가능하게 유지됩니다.",
    "audits.body":
      "감사 도구는 launch hygiene을 위한 읽기 전용 체크입니다. 지원하지 않는 vendor 상태를 과장하지 않고, advisory instruction-risk reminder를 duplicate/overlap finding과 분리합니다.",
    "audits.release": "버전/태그 drift, changelog drift, publish workflow 감지.",
    "audits.cd": "지원 destination의 public registry drift를 확인하고, 미지원 destination은 명시적으로 남깁니다.",
    "audits.security": "gitleaks, CodeQL, audit, least-privilege workflow 습관 같은 core CI hardening 체크.",
    "audits.instructions": "정확한 중복, cross-file overlap, 사람 검토용 키워드 reminder.",
    "handoff.title": "Launch Proof Report는 certification이 아니라 evidence입니다.",
    "handoff.body":
      "report는 release, CD, security, instruction review를 하나의 인계 문서로 묶습니다. 레포가 실제 launch-ready가 아니면 non-zero로 종료합니다.",
    "install.title": "CLI, MCP server, plugin, Desktop extension으로 사용합니다.",
    "install.body":
      "하나의 binary가 CLI와 MCP stdio를 전환합니다. 패키지는 Claude Code plugin metadata, skills, release-built Desktop extension bundle도 함께 제공합니다.",
    "footer.status": "Starter Series 프로젝트를 위한 read-only launch hygiene 도구입니다.",
    "footer.ko": "한국어 README",
  },
  ja: {
    "nav.workflow": "流れ",
    "nav.audits": "監査",
    "nav.handoff": "引き継ぎ",
    "nav.install": "導入",
    "hero.body":
      "Starter Series プロジェクトを scaffold し、release/CD/security/instruction hygiene を監査し、アプリコードを書き換えずに evidence-first な Launch Proof Report を作成します。",
    "hero.primary": "GitHub を見る",
    "hero.secondary": "ローカル導入",
    "preview.release": "release",
    "preview.cd": "cd",
    "preview.security": "security",
    "preview.instructions": "instructions",
    "preview.ready": "ready",
    "preview.review": "review",
    "preview.hardened": "hardened",
    "preview.attention": "attention",
    "workflow.scaffold.title": "Scaffold",
    "workflow.scaffold.body": "管理された Starter Series template のひとつから始めます。",
    "workflow.audit.title": "Audit",
    "workflow.audit.body": "release、CD、security、agent-instruction hygiene を確認します。",
    "workflow.handoff.title": "Handoff",
    "workflow.handoff.body": "evidence と blocker を含む Launch Proof Report を生成します。",
    "audits.title": "監査は狭く、検査可能に保ちます。",
    "audits.body":
      "audit tools は launch hygiene のための read-only checks です。unsupported vendor claims を避け、advisory instruction-risk reminders を hard duplicate/overlap findings から分離します。",
    "audits.release": "version/tag drift、changelog drift、publish workflow detection。",
    "audits.cd": "supported destinations の public registry drift を確認し、unsupported destinations は明示します。",
    "audits.security": "gitleaks、CodeQL、audit、least-privilege workflow habits などの core CI hardening checks。",
    "audits.instructions": "exact duplicates、cross-file overlap、人間レビュー用の keyword reminders。",
    "handoff.title": "Launch Proof Reports は certification ではなく evidence です。",
    "handoff.body":
      "report は release、CD、security、instruction review をひとつの handoff document にまとめます。repository が実際に launch-ready でなければ non-zero で終了します。",
    "install.title": "CLI、MCP server、plugin、Desktop extension として使えます。",
    "install.body":
      "ひとつの binary が CLI と MCP stdio を切り替えます。package には Claude Code plugin metadata、skills、release-built Desktop extension bundle も含まれます。",
    "footer.status": "Starter Series projects のための read-only launch hygiene tools です。",
    "footer.ko": "Korean README",
  },
};

const supportedLanguages = Object.keys(translations);
const languageButtons = document.querySelectorAll("[data-lang]");
const translatableNodes = document.querySelectorAll("[data-i18n]");

function preferredLanguage() {
  const params = new URLSearchParams(window.location.search);
  const queryLanguage = params.get("lang");
  if (queryLanguage && supportedLanguages.includes(queryLanguage)) return queryLanguage;

  const storedLanguage = window.localStorage.getItem("create-starter-language");
  if (storedLanguage && supportedLanguages.includes(storedLanguage)) return storedLanguage;

  const browserLanguage = navigator.language.slice(0, 2);
  return supportedLanguages.includes(browserLanguage) ? browserLanguage : "en";
}

function setLanguage(language) {
  const dictionary = translations[language] ?? translations.en;
  document.documentElement.lang = language;
  translatableNodes.forEach((node) => {
    const key = node.dataset.i18n;
    if (dictionary[key]) node.textContent = dictionary[key];
  });
  languageButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.lang === language));
  });
  window.localStorage.setItem("create-starter-language", language);
}

languageButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const language = button.dataset.lang;
    if (supportedLanguages.includes(language)) setLanguage(language);
  });
});

setLanguage(preferredLanguage());
