import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameOf, LINES, MASCOT_ACTIONS, MASCOT_MOODS, mascotSpec, mascotSvg, roamOf } from '../../../../src/web/lib/mascot.js';

const ALL = [...MASCOT_MOODS, ...MASCOT_ACTIONS];

function rows(grid) {
  return grid.map((row) => row.map((c) => c ?? '.').join(''));
}

function frame(name, index = 0) {
  return frameOf(mascotSpec(name), index);
}

function has(grid, char) {
  return grid.some((row) => row.includes(char));
}

test('every pose is a labelled pixel sprite cycling through its frames, with the dbt logo in view', () => {
  for (const name of ALL) {
    const svg = mascotSvg(name);
    const frames = mascotSpec(name).frames.length;
    assert.match(svg, new RegExp(`aria-label="Pixel dinosaur mascot, ${name}"`));
    assert.match(svg, /shape-rendering="crispEdges"/);
    assert.equal((svg.match(/class="pf"/g) ?? []).length, frames, name);
    assert.match(svg, new RegExp(`animation:pf${frames} `));
    assert.match(svg, /#ff694b/, `${name} shows the dbt logo`);
    assert.ok(LINES[name].length > 10, name);
  }
});

test('the logo floats free while chasing and ends up in the mouth on success', () => {
  assert.ok(has(frame('running').ground, 'A'));
  assert.ok(!has(frame('running').body, 'A'));
  assert.ok(has(frame('success').body, 'A'));
  assert.ok(!has(frame('success').ground, 'A'));
  assert.ok(has(frame('bite').body, 'A'));
});

test('frames change legs, face, arm and motion per pose', () => {
  assert.notDeepEqual(rows(frame('running', 0).body).slice(30), rows(frame('running', 2).body).slice(30));
  assert.ok(rows(frame('success').body).some((r) => r.includes('KKKKKKKKK')));
  assert.notDeepEqual(rows(frame('alarmed').body), rows(frame('gasp').body));
  assert.ok(rows(frame('worried').body)[12].includes('K'));
  assert.ok(rows(frame('shrug').body)[12].includes('KKK'));
  assert.equal(frame('failed').dy, 2);
  assert.equal(frame('rush', 0).flip, true);
  assert.ok(has(frame('worried').body, 'Y'));
  assert.equal(frame('gasp').dx, -2);
  assert.match(mascotSvg('rush'), /scale\(-1 1\)/);
  assert.equal(frame('peek').dy, 12);
  assert.equal(frame('worried', 1).dx, 1);
});

test('roaming and fallbacks', () => {
  assert.equal(roamOf('running'), 'roam');
  assert.equal(roamOf('alarmed'), 'roam-fast');
  assert.equal(roamOf('success'), '');
  assert.equal(mascotSpec('nope'), mascotSpec('waiting'));
  assert.match(mascotSvg('nope'), /Pixel dinosaur mascot, nope/);
});
