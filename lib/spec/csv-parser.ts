/**
 * RFC 4180 호환 CSV 파서.
 * 빈 줄은 무시하고, 따옴표 이스케이프("") 처리.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQ = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQ = true; }
        else if (ch === ',') { cells.push(cur); cur = ""; }
        else { cur += ch; }
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}
