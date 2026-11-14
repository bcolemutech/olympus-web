'use strict';

/**
 * Journeys across country (planning/off-road-travel.md §4.4, MD2, TR1, TR6;
 * L-363 / #837), pure, under both built-in systems on The Weald
 * (./fixtures/wilds-world.js): a failed navigation check loses part of the
 * day, camps off the path and plans the rest again from there, and still
 * arrives; a leg on a road the whole way rolls nothing, and ends outside a
 * closed town; a save in the wilds reads as `wild` in the frame and back;
 * the planner gives the hours at each point of its path; and the GM's
 * WHERE line is the camp's.
 *
 * Run: cd tests && npx jest loom-wild-journeys --verbose
 */

jest.mock('../functions/gemini', () => ({ callGemini: jest.fn() }));
jest.mock('../functions/loom-turn/retrieval', () => ({
  retrieveContextForEntities: jest.fn(),
}));

const { BUILT_IN } = require('../functions/loom-canon/systems');
const frames = require('../functions/loom-canon/frames');
const clock = require('../functions/loom-canon/clock');
const wildPlan = require('../functions/loom-canon/wild-plan');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { applyStateMutations } = require('../functions/loom-models');
const { buildWhereSection } = require('../functions/loom-turn/narrate');
const { wildsWorld } = require('./fixtures/wilds-world');

const H = clock.HOUR;
const ASHBY = [{ mapId: 'weald', placeId: 'pl_ashby' }];
const ok = (sides) => sides; // every die its best face
const bad = () => 1; // every die its worst

describe.each([
  ['d20-fantasy', BUILT_IN['d20-fantasy']],
  ['pool-scifi', BUILT_IN['pool-scifi']],
])('under %s', (id, system) => {
  const play = frames.playWorld({ ...wildsWorld('weald-' + id), system });
  const start = (fields = {}) =>
    frames.frameOf(play, {
      at: ASHBY,
      time: clock.START,
      discovered: ['pl_ashby', 'pl_carrow', 'pl_dunsmouth'],
      visited: ['pl_ashby'],
      character: { name: 'Ash' },
      ...fields,
    });
  // One turn, and the save after it (as COMMIT leaves it).
  function turn(framed, proposedAction, dice) {
    const resolution = evaluate(proposedAction, {}, framed.save, dice, framed.view, null, null);
    const save = JSON.parse(JSON.stringify(framed.save));
    applyStateMutations(
      save,
      resolution.mutations.filter((m) => m.target === 'save')
    );
    frames.settle(
      framed.view,
      save,
      resolution.mutations.some((m) => m.path === 'at')
    );
    return { resolution, framed: frames.frameOf(play, save) };
  }
  const travel = (to) => ({ verb: 'travel', targets: [to], params: { offRoad: true } });
  const ON = { verb: 'travel', targets: [], params: { go: 'on' } };

  test('a failed navigation check loses part of the day, camps off the path, and plans again', () => {
    const kept = turn(start(), travel('pl_carrow'), ok);
    const lost = turn(start(), travel('pl_carrow'), bad);
    // The check, rolled off the road and shown as a roll card.
    expect(kept.resolution.roll).toMatchObject({ success: true });
    expect(lost.resolution.roll).toMatchObject({ success: false });
    expect(lost.resolution.roll.verdict).toEqual(expect.any(String));
    expect(lost.resolution.constraints.join(' ')).toMatch(/You lose your way/);
    // The same day and night spent either way.
    expect(lost.framed.save.time).toBe(clock.START + 24 * H);
    expect(lost.resolution.journey.lost).toBeGreaterThan(0);
    // Off the way the plan went: off the line from Ashby to Carrow, and
    // not as far on.
    const camp = lost.framed.save.wild;
    expect(Math.abs(camp.y - 10)).toBeGreaterThan(0.5);
    expect(camp.x).toBeLessThan(kept.framed.save.wild.x);
    // The rest planned again from the camp: a new path, none of it walked.
    const j = lost.framed.save.journey;
    expect(j).toMatchObject({ leg: 1, done: 0, to: { placeId: 'pl_carrow' } });
    expect(j.path[0].x).toBeCloseTo(camp.x, 6);
    expect(j.path[0].y).toBeCloseTo(camp.y, 6);
    expect(j.path[j.path.length - 1]).toEqual({ x: 22, y: 10 });
    // And it still gets there.
    let framed = lost.framed;
    for (let i = 0; i < 6 && framed.save.journey; i++) framed = turn(framed, ON, ok).framed;
    expect(framed.save.location).toBe('pl_carrow');
    expect(framed.save.time).toBeGreaterThan(kept.framed.save.time + 24 * H);
  });

  test('a leg on the road the whole way rolls nothing, and a closed town is stood outside', () => {
    const { resolution, framed } = turn(start(), travel('pl_dunsmouth'), bad);
    expect(resolution.roll).toBeUndefined();
    expect(resolution.constraints.join(' ')).toContain(
      'You come to Dunsmouth, but its way is closed to you'
    );
    expect(framed.save.location).toBeNull();
    expect(framed.save.journey).toBeNull();
    expect(framed.save.wild.y).toBeLessThan(20);
    // Entering is refused.
    const again = turn(framed, travel('pl_dunsmouth'), ok).resolution;
    expect(again).toMatchObject({
      outcome: 'blocked',
      constraints: ['Dunsmouth is closed to you: you can go no further in.'],
    });
  });

  test('setting out: only from the map, to a place known on it or a point on it', () => {
    const refused = (framed, action) => turn(framed, action, ok).resolution.constraints[0];
    expect(refused(start(), travel('pl_gorse'))).toBe("You don't know where that is.");
    expect(refused(start(), travel('pl_ashby'))).toBe("You're already there.");
    expect(
      refused(start(), {
        verb: 'travel',
        targets: [],
        params: { offRoad: true, to: { mapId: 'weald', point: { x: 50, y: 5 } } },
      })
    ).toBe("That's off the map.");
    expect(refused(start(), ON)).toBe("You aren't on a journey. Choose where to head.");
  });
});

describe('in the wilds', () => {
  const play = frames.playWorld({ ...wildsWorld(), system: BUILT_IN['d20-fantasy'] });
  const AT = [{ mapId: 'weald', point: { x: 10, y: 4 } }];

  test('a point on a region map reads as `wild`, with no place, and back', () => {
    const framed = frames.frameOf(play, { at: AT });
    expect(framed.view.frame).toEqual({ mapId: 'weald', prefix: [] });
    expect(framed.save).toMatchObject({ location: null, placeId: null, wild: { x: 10, y: 4 } });
    expect(frames.atOf(framed.view, framed.save)).toEqual(AT);
    // Arriving at a place leaves the wilds behind.
    expect(frames.atOf(framed.view, { ...framed.save, location: 'pl_ashby', wild: null })).toEqual(
      ASHBY
    );
  });

  test('the GM’s WHERE line is the camp’s', () => {
    const framed = frames.frameOf(play, { at: AT });
    expect(
      buildWhereSection(framed.view, { location: null, wild: { x: 10, y: 4 } }, framed.save)
    ).toBe('WHERE: terrain: Forest; region: The Greenwood — Old oaks and older paths.');
  });

  test('the planner gives the hours from the start at each point of its path', () => {
    const view = frames.viewFor(play, 'weald');
    const plan = wildPlan.planOn(view, [2, 10], [22, 10], { pace: 1.5 });
    expect(plan.times).toHaveLength(plan.path.length);
    expect(plan.times[0]).toBe(0);
    expect(plan.times[plan.times.length - 1]).toBeCloseTo(plan.hours, 9);
    for (let i = 1; i < plan.times.length; i++) {
      expect(plan.times[i]).toBeGreaterThanOrEqual(plan.times[i - 1]);
    }
    expect(wildPlan.groundAt(view, [10, 4])).toEqual({ speed: 0.5, danger: 1, material: 'forest' });
  });
});
