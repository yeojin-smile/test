(function attachCommon(root) {
  "use strict";

  const STORAGE_KEY = "a부-국회요구자료-cases-v1";

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
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveCases(cases) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
    window.dispatchEvent(new CustomEvent("cases-saved", { detail: { count: cases.length } }));
  }

  function clearCases() {
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
    const target = document.querySelector("[data-app-nav]");
    if (!target) return;
    const items = [
      ["index", "시작 화면", "index.html", false],
      ["assign", "배분", "assign.html", false],
      ["dept", "현업 회신", "dept.html", true],
      ["collect", "취합", "collect.html", true],
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
      </nav>`;
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
    csvObjects,
    fetchCsv,
    readFileText,
    loadCases,
    saveCases,
    clearCases,
    makeId,
    escapeHtml,
    initNav,
    setMessage,
    updateView,
  };
})(globalThis);
