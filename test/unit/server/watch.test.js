import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';
import { createWatcher } from '../../../src/server/watch.js';

function fakeFs({ throwOn = [] } = {}) {
  const handles = new Map();
  const watch = (dir, listener) => {
    if (throwOn.includes(dir)) throw new Error('ENOENT');
    const handle = Object.assign(new EventEmitter(), { listener, closed: false, close() { this.closed = true; } });
    handles.set(dir, handle);
    return handle;
  };
  return { watch, handles };
}

test('debounces bursts into one change and tracks wanted dirs', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const fs = fakeFs({ throwOn: ['/missing'] });
    let wanted = ['/a', '/b', '/missing'];
    const onChange = mock.fn();
    const watcher = createWatcher({ dirs: () => wanted, onChange, watch: fs.watch, debounceMs: 100, tickMs: 1000 });
    assert.deepEqual(watcher.watching(), ['/a', '/b']);
    fs.handles.get('/a').listener();
    fs.handles.get('/a').listener();
    mock.timers.tick(100);
    assert.equal(onChange.mock.callCount(), 1);
    mock.timers.tick(900);
    assert.equal(onChange.mock.callCount(), 2);
    wanted = ['/b', '/c'];
    watcher.sync();
    assert.deepEqual(watcher.watching(), ['/b', '/c']);
    assert.equal(fs.handles.get('/a').closed, true);
    fs.handles.get('/c').emit('error', new Error('gone'));
    assert.deepEqual(watcher.watching(), ['/b']);
    watcher.close();
    assert.deepEqual(watcher.watching(), []);
  } finally {
    mock.timers.reset();
  }
});

test('uses fs.watch by default', () => {
  const watcher = createWatcher({ dirs: () => ['/definitely/not/here'], onChange() {} });
  assert.deepEqual(watcher.watching(), []);
  watcher.close();
});
