(function attachCommon(root) {
  "use strict";

  const STORAGE_KEY = "a부-국회요구자료-cases-v1";
  const API_MODE = /\.vercel\.app$/i.test(location.hostname);
  const API_URL = "/api/app";

  function csvObjects(text) {
    if (!root.Papa) throw new Error("CSV 라이브러리(Papa Parse)를 불러오지 못했습니다.");
    const result = root.Papa.parse(String(text).replace(/^\uFEFF/, ""), {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim(),
    });
    if (result.errors.length) {
      const first = result.errors[0];
      throw new Error(`CSV 형식을 확인하세요: ${first.message}${Number.isInteger(first.row) ? ` (${first.row + 2}행)` : ""}`);
    }
    return result.data;
  }

  async function fetchCsv(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`자료를 읽지 못했습니다: ${url}`);
    }
    return csvObjects(await response.text());
  }

  async function readFileText(file) {
    return new TextDecoder("utf-8").decode(await file.arrayBuffer());
  }

  function loadCases() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(value)) return value;
      return value && Array.isArray(value.cases) ? value.cases : [];
    } catch {
      return [];
    }
  }

  async function loadDb() {
    if (API_MODE) {
      const response = await fetch(API_URL, { headers: { Accept: "application/json" } });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || "서버 자료를 읽지 못했습니다.");
      return { cases: Array.isArray(value.cases) ? value.cases : [], log: Array.isArray(value.log) ? value.log : [] };
    }
    return readDb();
  }

  async function getCases() {
    return (await loadDb()).cases;
  }

  function readDb() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? { cases: value, log: [] } : {
        cases: value && Array.isArray(value.cases) ? value.cases : [],
        log: value && Array.isArray(value.log) ? value.log : [],
      };
    } catch {
      return { cases: [], log: [] };
    }
  }

  function saveCases(cases) {
    if (API_MODE) throw new Error("운영 서버 자료는 상태 요청으로만 저장합니다.");
    const db = readDb();
    db.cases = cases;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    window.dispatchEvent(new CustomEvent("cases-saved", { detail: { count: cases.length } }));
  }

  async function applyFlow(cases, request, departments) {
    if (API_MODE) {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(result.error || "요청을 처리하지 못했습니다.");
        error.status = response.status;
        throw error;
      }
      const db = await loadDb();
      window.dispatchEvent(new CustomEvent("cases-saved", { detail: { count: db.cases.length } }));
      return { db, result };
    }
    if (!root.Flow || typeof root.Flow.apply !== "function") throw new Error("공통 상태 규칙(flow.js)을 불러오지 못했습니다.");
    const current = readDb();
    current.cases = cases;
    const changed = root.Flow.apply(current, request, departments);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changed.db));
    window.dispatchEvent(new CustomEvent("cases-saved", { detail: { count: changed.db.cases.length } }));
    return changed;
  }

  async function recommendAI(requirement) {
    if (!API_MODE) throw new Error("AI 추천은 서버 배포 화면에서 사용할 수 있습니다.");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ 작업: "AI추천", 요구내용: String(requirement || "") }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "AI 추천을 받지 못했습니다.");
    return result;
  }

  function clearCases() {
    if (API_MODE) throw new Error("운영 서버 자료 초기화는 이 화면에서 사용할 수 없습니다.");
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("cases-saved", { detail: { count: 0 } }));
  }

  function makeId(row) {
    return `${row.파일명}::${row.문항번호}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function initNav(active) {
    if (API_MODE) {
      const reset = document.querySelector("#reset-data");
      if (reset) reset.hidden = true;
    }
    const target = document.querySelector("[data-app-nav]");
    if (!target) return;
    const items = [
      ["index", "시작 화면", "index.html", false],
      ["assign", "배분", "assign.html", false],
      ["dept", "현업 회신", "dept.html", false],
      ["collect", "취합", "collect.html", false],
    ];
    target.innerHTML = `
      <nav class="app-nav" aria-label="주요 화면">
        <a class="brand" href="index.html" aria-label="A부 국회 요구자료 시작 화면">
          <span class="brand-mark">A</span><span>A부 국회 요구자료</span>
        </a>
        <div class="nav-links">
          ${items
            .map(([key, label, href, disabled]) =>
              disabled
                ? `<button type="button" class="nav-link is-future" disabled title="후속 단계에서 제공됩니다">${label}<small>준비 중</small></button>`
                : `<a class="nav-link ${active === key ? "is-active" : ""}" href="${href}" ${active === key ? 'aria-current="page"' : ""}>${label}</a>`,
            )
            .join("")}
        </div>
        <span class="storage-badge ${API_MODE ? "server" : "local"}" role="status">${API_MODE ? "서버 저장 · /api/app" : "이 브라우저에 저장"}</span>
      </nav>`;
  }

  let historyPromise;
  function loadHistory() {
    if (!historyPromise) historyPromise = fetchCsv("data/접수대장.csv");
    return historyPromise;
  }

  function findHistory(keywords, rows) {
    const terms = (keywords || []).map((word) => String(word || "").trim()).filter(Boolean);
    const matches = terms.length ? rows.filter((row) => terms.some((term) => String(row.요구내용 || "").includes(term))) : [];
    const counts = new Map();
    for (const row of matches) {
      const department = String(row.배분과 || "").trim();
      if (department) counts.set(department, (counts.get(department) || 0) + 1);
    }
    const department = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))[0]?.[0] || "이력 없음";
    const recent = [...matches].sort((a, b) => String(b.접수일 || "").localeCompare(String(a.접수일 || ""))).slice(0, 5);
    return { count: matches.length, department, recent };
  }

  function setMessage(element, message, kind = "info") {
    if (!element) return;
    element.textContent = message;
    element.dataset.kind = kind;
    element.hidden = !message;
  }

  function updateView(callback) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !document.startViewTransition) {
      callback();
      return;
    }
    document.startViewTransition(callback);
  }

  root.AppCommon = {
    STORAGE_KEY,
    API_MODE,
    modeLabel: API_MODE ? "서버 저장 · /api/app" : "이 브라우저에 저장",
    csvObjects,
    fetchCsv,
    readFileText,
    loadCases,
    loadDb,
    getCases,
    saveCases,
    applyFlow,
    recommendAI,
    clearCases,
    makeId,
    loadHistory,
    findHistory,
    escapeHtml,
    initNav,
    setMessage,
    updateView,
  };
})(globalThis);
