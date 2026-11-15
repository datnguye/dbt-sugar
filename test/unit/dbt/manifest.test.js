import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createManifestReader, parseManifest } from '../../../src/dbt/manifest.js';
import { FIXTURE, tempDir, writeFile } from '../../helpers/fixture.js';

const REAL = path.join(FIXTURE, 'target', 'manifest.json');

test('parses the real jaffle-shop manifest', () => {
  const m = parseManifest(JSON.parse(fs.readFileSync(REAL, 'utf8')));
  const models = [...m.nodes.values()].filter((n) => n.type === 'model');
  assert.deepEqual([m.project, m.version, models.length, m.sources.length], ['jaffle_shop', '2.0.11', 15, 6]);
  assert.ok(m.sources.every((s) => !s.freshness));
  assert.equal(m.sources[0].name, 'ecom.raw_customers');
  const orders = m.nodes.get('model.jaffle_shop.orders');
  assert.deepEqual(orders.parents.map((p) => p.split('.').pop()).sort(), ['locations', 'order_items', 'stg_orders']);
  assert.equal(m.nodes.get('model.jaffle_shop.locations').file, 'models/marts/locations.sql');
  assert.ok(m.testsOf.get('model.jaffle_shop.stg_orders') > 0);
  assert.equal(m.testsOf.get('model.jaffle_shop.products'), undefined);
  assert.ok([...m.nodes.values()].some((n) => n.type === 'unit_test'));
});

test('falls back when maps, metadata and fields are missing', () => {
  const m = parseManifest({
    nodes: {
      a: { unique_id: 'a', name: 'a', resource_type: 'model', depends_on: { nodes: ['b'] } },
      t: { unique_id: 't', name: 't', resource_type: 'test' }
    },
    sources: {
      s1: { unique_id: 's1', name: 'x', source_name: 'raw', freshness: { warn_after: { count: 1 } } },
      s2: { unique_id: 's2', name: 'y', source_name: 'raw', config: { freshness: { error_after: { count: 2 } } } },
      s3: { unique_id: 's3', name: 'z', source_name: 'raw' }
    }
  });
  assert.deepEqual(m.nodes.get('a'), {
    id: 'a', name: 'a', type: 'model', package: null, file: null, description: '', checksum: null, code: null, columns: {},
    config: { materialized: null, uniqueKey: null, strategy: null, onSchemaChange: null, contract: false }, parents: ['b'], children: []
  });
  assert.deepEqual(m.nodes.get('t').parents, []);
  assert.deepEqual(m.sources.map((s) => s.freshness), [true, true, false]);
  assert.deepEqual([m.project, m.version, m.generatedAt], [null, null, null]);
  const rich = parseManifest({
    metadata: { generated_at: '2026-11-15T10:00:00Z' },
    nodes: { m: { unique_id: 'm', name: 'm', resource_type: 'model', package_name: 'p', checksum: { checksum: 'abc' }, raw_code: 'select 1', contract: { enforced: true }, columns: { id: { name: 'id', data_type: 'int', description: 'key' }, x: { name: 'x' } }, config: { materialized: 'incremental', unique_key: 'id', incremental_strategy: 'merge', on_schema_change: 'fail' } } },
    exposures: { e: { unique_id: 'e', name: 'dash', resource_type: 'exposure' } }
  });
  assert.equal(rich.generatedAt, '2026-11-15T10:00:00Z');
  assert.deepEqual(rich.nodes.get('m').config, { materialized: 'incremental', uniqueKey: 'id', strategy: 'merge', onSchemaChange: 'fail', contract: true });
  assert.deepEqual(rich.nodes.get('m').columns, { id: { type: 'int', description: 'key' }, x: { type: null, description: '' } });
  assert.deepEqual([rich.nodes.get('m').checksum, rich.nodes.get('m').code, rich.nodes.get('m').package], ['abc', 'select 1', 'p']);
  assert.equal(rich.nodes.get('e').type, 'exposure');
  assert.equal(parseManifest({ nodes: { c: { unique_id: 'c', name: 'c', resource_type: 'model', config: { contract: { enforced: false } }, contract: { enforced: true } } } }).nodes.get('c').config.contract, false);
  assert.equal(parseManifest({ unit_tests: { u: { unique_id: 'u', name: 'u' } } }).nodes.get('u').type, 'unit_test');
  assert.equal(parseManifest({}).nodes.size, 0);
});

test('the reader caches by mtime and size, and recovers from bad or missing files', (t) => {
  const file = path.join(tempDir(t), 'target', 'manifest.json');
  const reader = createManifestReader(file);
  assert.equal(reader.read(), null);
  writeFile(file, '{"metadata":{"project_name":"p"}}');
  const first = reader.read();
  assert.equal(first.project, 'p');
  assert.equal(reader.read(), first);
  writeFile(file, '{ broken');
  assert.equal(reader.read(), null);
  writeFile(file, '{"metadata":{"project_name":"again"}}');
  assert.equal(reader.read().project, 'again');
  fs.rmSync(file);
  assert.equal(reader.read(), null);
});
