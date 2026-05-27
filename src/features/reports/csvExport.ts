/** Tiny CSV writer — quotes any field containing comma/quote/newline. */
export function toCsv(rows: Array<Record<string, string | number>>, headers: string[]): string {
  const head = headers.join(',');
  const body = rows
    .map((r) =>
      headers
        .map((h) => {
          const v = r[h] ?? '';
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
  return `${head}\n${body}\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
