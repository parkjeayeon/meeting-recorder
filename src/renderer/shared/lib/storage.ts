export function store<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key)!) ?? fallback;
  } catch {
    return fallback;
  }
}

export function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
