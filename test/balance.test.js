// Balance gate (docs/SPEC.md §15): plays the real engine with scripted policies.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../tools/sim.js');

for (const seed of [12345, 777]) {
  test(`greedy player escapes in 90–150 minutes (seed ${seed})`, () => {
    const log = Sim.run('greedy', { seed });
    assert.equal(log.ending, 'escaped', Sim.report(log));
    assert.ok(log.escapeMin >= 90 && log.escapeMin <= 150, Sim.report(log));
    assert.ok(log.ratRaceExitMin >= 10, 'the rat-race exit is a mid-game milestone');
  });
  test(`a pure job grinder dies a wage slave (seed ${seed})`, () => {
    const log = Sim.run('grinder', { seed });
    assert.equal(log.ending, 'wageslave', Sim.report(log));
  });
  test(`an idle player survives the first hour (seed ${seed})`, () => {
    const log = Sim.run('idle', { seed, maxMinutes: 61 });
    assert.ok(!log.deathMin || log.deathMin > 60, Sim.report(log));
  });
}
