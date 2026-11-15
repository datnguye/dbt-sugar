import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { sugarHome } from '../../../src/core/home.js';

test('sugarHome prefers DBT_SUGAR_HOME, else ~/.dbt-sugar', () => {
  assert.equal(sugarHome({ DBT_SUGAR_HOME: '/x' }, '/home/u'), '/x');
  assert.equal(sugarHome({}, '/home/u'), path.join('/home/u', '.dbt-sugar'));
  assert.ok(sugarHome().length);
});
