let csrf = "";
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function connect(password = "") {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await response.json();
  if (!response.ok) throw new APIError(data.error, response.status);
  csrf = data.csrf;
  return data;
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new APIError(data.error || "요청에 실패했습니다.", response.status);
  }
  return response.json();
}
export async function apiText(path: string) {
  const response = await fetch("/api" + path);
  if (!response.ok)
    throw new APIError("내보내기에 실패했습니다.", response.status);
  return response.text();
}
export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage may be disabled; the server remains authoritative. */
  }
}
function cacheDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("novel-device-cache", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("snapshots");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function cachePut(key: string, value: unknown) {
  try {
    const db = await cacheDB();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("snapshots", "readwrite");
      t.objectStore("snapshots").put(value, key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    db.close();
  } catch {}
}
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await cacheDB();
    const value = await new Promise<T>((resolve, reject) => {
      const r = db.transaction("snapshots").objectStore("snapshots").get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return value;
  } catch {
    return undefined;
  }
}
