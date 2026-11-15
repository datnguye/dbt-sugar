import fs from 'node:fs';

const TEST_TYPES = new Set(['test', 'unit_test']);

function hasFreshness(source) {
  const freshness = source.freshness ?? source.config?.freshness;
  return Boolean(freshness?.warn_after?.count || freshness?.error_after?.count);
}

function columnsOf(node) {
  return Object.fromEntries(Object.values(node.columns ?? {}).map((c) => [c.name, { type: c.data_type ?? null, description: c.description ?? '' }]));
}

function configOf(node) {
  const config = node.config ?? {};
  return {
    materialized: config.materialized ?? null,
    uniqueKey: config.unique_key ?? null,
    strategy: config.incremental_strategy ?? null,
    onSchemaChange: config.on_schema_change ?? null,
    contract: Boolean(config.contract?.enforced ?? node.contract?.enforced)
  };
}

export function parseManifest(json) {
  const parents = json.parent_map ?? {};
  const children = json.child_map ?? {};
  const nodes = new Map();
  const all = [json.nodes, json.unit_tests, json.sources, json.exposures].flatMap((group) => Object.values(group ?? {}));
  for (const node of all) {
    const config = configOf(node);
    nodes.set(node.unique_id, {
      id: node.unique_id,
      name: node.name,
      type: node.resource_type ?? 'unit_test',
      package: node.package_name ?? null,
      file: node.original_file_path ?? null,
      config,
      description: node.description ?? '',
      checksum: node.checksum?.checksum ?? null,
      code: node.raw_code ?? null,
      columns: columnsOf(node),
      parents: parents[node.unique_id] ?? node.depends_on?.nodes ?? [],
      children: children[node.unique_id] ?? []
    });
  }
  const testsOf = new Map();
  for (const node of nodes.values()) {
    if (!TEST_TYPES.has(node.type)) continue;
    for (const parent of node.parents) testsOf.set(parent, (testsOf.get(parent) ?? 0) + 1);
  }
  const sources = Object.values(json.sources ?? {}).map((s) => ({ id: s.unique_id, name: `${s.source_name}.${s.name}`, freshness: hasFreshness(s) }));
  return { project: json.metadata?.project_name ?? null, version: json.metadata?.dbt_version ?? null, generatedAt: json.metadata?.generated_at ?? null, nodes, testsOf, sources };
}

export function createManifestReader(file) {
  let stamp = null;
  let parsed = null;
  return {
    read() {
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        stamp = null;
        parsed = null;
        return null;
      }
      const next = `${stat.mtimeMs}:${stat.size}`;
      if (next === stamp) return parsed;
      try {
        parsed = parseManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
        stamp = next;
      } catch {
        parsed = null;
      }
      return parsed;
    }
  };
}
