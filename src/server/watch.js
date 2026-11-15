import fs from 'node:fs';

export function createWatcher({ dirs, onChange, debounceMs = 150, tickMs = 2000, watch = fs.watch }) {
  const handles = new Map();
  let timer = null;

  function fire() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  }

  function drop(dir) {
    handles.get(dir)?.close();
    handles.delete(dir);
  }

  function sync() {
    const wanted = new Set(dirs());
    for (const dir of handles.keys()) {
      if (!wanted.has(dir)) drop(dir);
    }
    for (const dir of wanted) {
      if (handles.has(dir)) continue;
      try {
        const handle = watch(dir, fire);
        handle.on('error', () => drop(dir));
        handles.set(dir, handle);
      } catch {
        continue;
      }
    }
  }

  const tick = setInterval(onChange, tickMs);
  tick.unref();
  sync();

  return {
    sync,
    watching: () => [...handles.keys()],
    close() {
      clearInterval(tick);
      clearTimeout(timer);
      for (const dir of [...handles.keys()]) drop(dir);
    }
  };
}
