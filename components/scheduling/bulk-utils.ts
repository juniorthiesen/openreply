export type BulkCadence = "daily" | "mon-wed-fri" | "tue-thu-sat" | "weekdays";

export function buildScheduleSlots(
  count: number,
  startDate: string,
  time: string,
  cadence: BulkCadence,
  skipWeekends: boolean
): string[] {
  if (count <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{2}:\d{2}$/.test(time)) return [];
  const [year, month, day] = startDate.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const cursor = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(cursor.getTime())) return [];

  const allowedDays: Record<BulkCadence, number[]> = {
    daily: [0, 1, 2, 3, 4, 5, 6],
    "mon-wed-fri": [1, 3, 5],
    "tue-thu-sat": [2, 4, 6],
    weekdays: [1, 2, 3, 4, 5],
  };
  const days = allowedDays[cadence];
  const slots: string[] = [];

  while (slots.length < count) {
    const weekday = cursor.getDay();
    if (days.includes(weekday) && (!skipWeekends || (weekday !== 0 && weekday !== 6))) {
      slots.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}

function parseCsvRows(source: string): string[][] {
  const delimiter = source.split(/\r?\n/, 1)[0]?.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export function parseCaptionCsv(source: string): Map<string, string> {
  const rows = parseCsvRows(source.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return new Map();
  const headers = rows[0].map((value) => value.trim().toLocaleLowerCase("pt-BR"));
  const fileIndex = headers.findIndex((value) => ["arquivo", "filename", "file", "nome do arquivo"].includes(value));
  const captionIndex = headers.findIndex((value) => ["legenda", "caption", "texto"].includes(value));
  if (fileIndex < 0 || captionIndex < 0) return new Map();

  const captions = new Map<string, string>();
  for (const row of rows.slice(1)) {
    const filename = row[fileIndex]?.trim().split(/[\\/]/).pop()?.toLocaleLowerCase("pt-BR");
    const caption = row[captionIndex]?.trim();
    if (filename && caption) captions.set(filename, caption.slice(0, 2_200));
  }
  return captions;
}

export function normalizeFilename(filename: string): string {
  return filename.trim().split(/[\\/]/).pop()?.toLocaleLowerCase("pt-BR") ?? "";
}
