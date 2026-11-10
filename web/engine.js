(function attachEngine(root, factory) {
  const engine = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = engine;
  } else {
    root.DistributionEngine = engine;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createModule() {
  "use strict";

  const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);
  const scriptUrl =
    !isNode && typeof document !== "undefined" && document.currentScript
      ? document.currentScript.src
      : null;

  let rules = [];
  let allowedDepartments = new Set();
  let ready = false;

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
      } else if (character === '"') {
        quoted = true;
      } else if (character === ",") {
        row.push(field);
        field = "";
      } else if (character === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += character;
      }
    }

    if (field || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }

    return rows;
  }

  function csvObjects(text) {
    if (!isNode && globalThis.Papa) {
      const result = globalThis.Papa.parse(String(text).replace(/^\uFEFF/, ""), {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (header) => header.trim(),
      });
      if (result.errors.length) throw new Error(`CSV 형식을 확인하세요: ${result.errors[0].message}`);
      return result.data;
    }
    const rows = parseCsv(text.replace(/^\uFEFF/, ""));
    const headers = rows.shift() || [];
    return rows
      .filter((row) => row.some((value) => value.trim() !== ""))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  }

  function normalize(text) {
    return String(text).replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
  }

  function configure(ruleCsv, organizationCsv) {
    const organization = csvObjects(organizationCsv);
    allowedDepartments = new Set(organization.map((row) => row.과.trim()).filter(Boolean));

    rules = csvObjects(ruleCsv).map((row, index) => ({
      order: index,
      과: row.과.trim(),
      키워드: row.키워드.trim(),
      비교키워드: normalize(row.키워드),
      제외어: row.제외어
        .split("|")
        .map((word) => word.trim())
        .filter(Boolean),
      우선순위: Number(row.우선순위),
    }));

    if (allowedDepartments.size === 0) {
      throw new Error("조직도에서 과를 찾지 못했습니다.");
    }
    if (rules.some((rule) => !rule.키워드 || !Number.isFinite(rule.우선순위))) {
      throw new Error("배분기준표의 키워드 또는 우선순위 형식을 확인하세요.");
    }
    ready = true;
  }

  async function init(options = {}) {
    if (isNode) {
      loadNodeFiles(options);
      return api;
    }

    const baseUrl = scriptUrl ? new URL("../", scriptUrl) : new URL("./", document.baseURI);
    const ruleUrl = options.ruleUrl || new URL("data/배분기준표_소관키워드_304건.csv", baseUrl);
    const organizationUrl = options.organizationUrl || new URL("data/A부_조직도_26개과.csv", baseUrl);
    const [ruleResponse, organizationResponse] = await Promise.all([fetch(ruleUrl), fetch(organizationUrl)]);
    if (!ruleResponse.ok || !organizationResponse.ok) {
      throw new Error("배분기준표 또는 조직도 CSV를 불러오지 못했습니다.");
    }
    configure(await ruleResponse.text(), await organizationResponse.text());
    return api;
  }

  function loadNodeFiles(options = {}) {
    const fs = require("node:fs");
    const path = require("node:path");
    const rootDirectory = path.resolve(__dirname, "..");
    const rulePath = options.rulePath || path.join(rootDirectory, "data", "배분기준표_소관키워드_304건.csv");
    const organizationPath =
      options.organizationPath || path.join(rootDirectory, "data", "A부_조직도_26개과.csv");
    configure(fs.readFileSync(rulePath, "utf8"), fs.readFileSync(organizationPath, "utf8"));
  }

  function classify(요구내용) {
    if (!ready) {
      throw new Error("브라우저에서는 먼저 await DistributionEngine.init()을 실행하세요.");
    }
    if (typeof 요구내용 !== "string" || 요구내용.trim() === "") {
      return [];
    }

    const normalizedRequest = normalize(요구내용);
    const byDepartment = new Map();

    for (const rule of rules) {
      if (!allowedDepartments.has(rule.과) || !normalizedRequest.includes(rule.비교키워드)) {
        continue;
      }
      if (rule.제외어.some((word) => normalizedRequest.includes(normalize(word)))) {
        continue;
      }

      const score = rule.우선순위 + rule.키워드.length / 10;
      const current = byDepartment.get(rule.과);
      if (!current || score > current.점수) {
        byDepartment.set(rule.과, {
          과: rule.과,
          점수: score,
          근거키워드: [rule.키워드],
          order: rule.order,
        });
      } else if (score === current.점수 && !current.근거키워드.includes(rule.키워드)) {
        current.근거키워드.push(rule.키워드);
        current.order = Math.min(current.order, rule.order);
      }
    }

    return [...byDepartment.values()]
      .sort((left, right) => right.점수 - left.점수 || left.order - right.order)
      .slice(0, 3)
      .map(({ 과, 점수, 근거키워드 }) => ({ 과, 점수, 근거키워드 }));
  }

  const api = { init, classify };
  if (isNode) {
    loadNodeFiles();
  }
  return api;
});
