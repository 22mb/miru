import { watch, type FSWatcher } from "node:fs";

/**
 * Watch a path (file or directory) and invoke `onChange` (debounced) on each event.
 * When watching a directory, the changed filename (basename, relative to `path`) is
 * passed to the callback so the caller can filter — required for sidecars whose
 * atomic write-then-rename swaps the inode, breaking single-file watches.
 * Returns a function that stops watching.
 */
export function watchFile(path: string, onChange: (filename?: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | undefined;
  let watcher: FSWatcher;
  try {
    watcher = watch(path, (_event, filename) => {
      if (filename) pending = filename;
      if (timer) clearTimeout(timer);
      // Debounce: editors often emit several events for one save.
      timer = setTimeout(() => {
        const name = pending;
        pending = undefined;
        onChange(name);
      }, 80);
    });
  } catch {
    return () => {};
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
