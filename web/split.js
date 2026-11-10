(function attachSplitter(root) {
  "use strict";

  const FIELDS = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"];

  function appendText(row, field, text) {
    const separator = field === "세부항목" && row[field] ? " / " : row[field] ? " " : "";
    row[field] += separator + text.trim();
  }

  function expectedCount(filename) {
    const match = filename.match(/_(\d+)문항\.pdf$/i);
    return match ? Number(match[1]) : null;
  }

  function splitDocument(filename, extractedText) {
    const text = String(extractedText).replaceAll("\r", "");
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) throw new Error(`${filename}: PDF에서 글자를 찾지 못했습니다.`);

    const header = lines[0].match(/^(.+위원회)\s+(.+?)\s+의원실\s+자료요구서$/);
    if (!header) throw new Error(`${filename}: 첫 줄의 위원회·의원 형식을 확인하세요.`);
    const [, committee, lawmaker] = header;

    const deadlineMatch = text.match(/제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
    if (!deadlineMatch) throw new Error(`${filename}: 제출기한을 찾지 못했습니다.`);
    const deadline = `${deadlineMatch[1]}-${deadlineMatch[2].padStart(2, "0")}-${deadlineMatch[3].padStart(2, "0")}`;

    const bodyLines = lines.slice(1).flatMap((line) => {
      if (line.startsWith("수신:") || line.startsWith("담당 보좌관:")) return [];
      const cleaned = line.replace(/끝\.\s*$/, "").trim();
      return cleaned ? [cleaned] : [];
    });

    let body = bodyLines.join("\n");
    body = body.replace(/(?<![\n\d])(?=(?:\d{1,2})\.\s)/g, "\n");
    body = body.replace(/(?<!\n)(?=[가-힣]\.\s)/g, "\n");
    body = body.replace(/(?<!\n)(?=※\s*)/g, "\n");

    const rows = [];
    let current = null;
    let currentField = "요구내용";

    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const item = line.match(/^(\d{1,2})\.\s*(.*)$/);
      const detail = line.match(/^([가-힣])\.\s*(.*)$/);
      const note = line.match(/^※\s*(.*)$/);

      if (item) {
        current = {
          파일명: filename,
          위원회: committee,
          의원: lawmaker,
          제출기한: deadline,
          문항번호: item[1],
          요구내용: item[2].trim(),
          세부항목: "",
          비고: "",
        };
        rows.push(current);
        currentField = "요구내용";
      } else if (detail && current) {
        appendText(current, "세부항목", `${detail[1]}. ${detail[2].trim()}`);
        currentField = "세부항목";
      } else if (note && current) {
        appendText(current, "비고", note[1].trim());
        currentField = "비고";
      } else if (current) {
        appendText(current, currentField, line);
      }
    }

    const numbers = rows.map((row) => Number(row.문항번호));
    const continuous = numbers.every((number, index) => number === index + 1);
    const expected = expectedCount(filename);
    return {
      rows,
      check: {
        파일명: filename,
        파일명의문항수: expected,
        뽑은문항수: rows.length,
        마지막번호: numbers.at(-1) || 0,
        번호연속: continuous,
        일치: expected === null ? continuous : expected === rows.length && continuous,
      },
    };
  }

  function parseQuestionCsv(text) {
    const rows = root.AppCommon.csvObjects(text);
    const missing = FIELDS.filter((field) => !Object.hasOwn(rows[0] || {}, field));
    if (missing.length) throw new Error(`문항목록 CSV에 필요한 열이 없습니다: ${missing.join(", ")}`);
    return rows.map((row) => Object.fromEntries(FIELDS.map((field) => [field, row[field] ?? ""])));
  }

  root.SplitRequest = { FIELDS, splitDocument, parseQuestionCsv, expectedCount };
})(globalThis);
