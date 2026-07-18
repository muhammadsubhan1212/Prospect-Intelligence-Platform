/** Browser-side CSV workspace so preview works without shared /tmp on Vercel. */

const DB_NAME = "prospect_csv_workspace";
const STORE = "files";
const DB_VERSION = 1;

export type StoredCsv = {
  id: string;
  filename: string;
  text: string;
  savedAt: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

export async function saveCsvText(id: string, filename: string, text: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ id, filename, text, savedAt: new Date().toISOString() } satisfies StoredCsv);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
  });
  db.close();
}

export async function loadCsvText(id: string): Promise<StoredCsv | null> {
  const db = await openDb();
  const row = await new Promise<StoredCsv | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as StoredCsv) || null);
    req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
  });
  db.close();
  return row;
}

export async function deleteCsvText(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
  });
  db.close();
}

/** Minimal CSV line split (handles quoted commas). */
export function parseCsvText(text: string): { headers: string[]; records: Record<string, string>[] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      if (row.some((x) => x.trim().length)) rows.push(row);
      row = [];
    } else if (c === "\r") {
      /* skip */
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((x) => x.trim().length)) rows.push(row);

  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    return obj;
  });
  return { headers, records };
}

function pick(row: Record<string, string>, names: string[]) {
  for (const n of names) {
    const hit = Object.keys(row).find((k) => k.toLowerCase() === n.toLowerCase());
    if (hit && row[hit]) return row[hit];
  }
  return "";
}

export function mapRowClient(row: Record<string, string>, index: number) {
  const first = pick(row, ["First Name", "first_name", "firstName"]);
  const last = pick(row, ["Last Name", "last_name", "lastName"]);
  const full =
    pick(row, ["Full Name", "Name", "full_name"]) || [first, last].filter(Boolean).join(" ").trim();
  return {
    _rowIndex: index,
    fullName: full,
    firstName: first,
    lastName: last,
    title: pick(row, ["Title", "Job Title"]),
    company: pick(row, ["Company Name", "Company", "Company Name for Emails"]),
    email: pick(row, ["Email", "Work Email", "Email Address"]),
    website: pick(row, ["Website", "Company Website", "URL"]),
    phone: pick(row, ["Corporate Phone", "Work Direct Phone", "Mobile Phone", "Phone"]).replace(/^'/, ""),
  };
}

export function paginateClient(
  text: string,
  opts: { page: number; pageSize: number; q: string }
) {
  const { records } = parseCsvText(text);
  const q = opts.q.trim().toLowerCase();
  const mapped = records.map((r, i) => mapRowClient(r, i + 1));
  const filtered = q
    ? mapped.filter((m) =>
        [m.fullName, m.company, m.email, m.title, m.website, m.phone].join(" ").toLowerCase().includes(q)
      )
    : mapped;
  const totalRows = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / opts.pageSize));
  const page = Math.min(Math.max(1, opts.page), totalPages);
  const start = (page - 1) * opts.pageSize;
  return {
    mappedPreview: filtered.slice(start, start + opts.pageSize),
    page,
    pageSize: opts.pageSize,
    totalRows,
    totalPages,
    q: opts.q,
  };
}
