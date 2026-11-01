/* The per-day observability rules, checked without a browser.
   There is no UI test runner in this project, so this is a plain node
   script: `node test/observability.test.mjs`, wired into `make check`.
   It covers observability.js, which is deliberately free of React,
   Konva and antd so that it can be exercised this way. */
import assert from 'node:assert/strict';
import { targetsForDate, bestPeriods, periodsText, metricValue, cellColor,
         isStale, DAY_INDEX } from '../src/observability.js';

const search = {TargetObjects: [
    {ID: 1, name: "Jupiter", matched: true},
    {ID: 2, name: "Saturn",  matched: true},
    {ID: 3, name: "Mars",    matched: true},
    {ID: 4, name: "Neptune", matched: false},   // never matched
    {ID: 5, name: "Sun",     matched: true},    // drawn on its own
]};
// Range 2026-11-01 .. 2026-11-05 (5 days).
const days = {start_date: "2026-11-01", end_date: "2026-11-05", day_count: 5,
    objects: [
        {id: 1, name: "Jupiter", days: [[0,4,45,-22,120],[1,3.5,44,-21,110],
                                        [4,1,20,-19,30]]},
        {id: 2, name: "Saturn",  days: [[1,2,30,-21,60]]},
        {id: 3, name: "Mars",    days: [[3,2.5,35,-20,90]]},
    ]};
const names = (r) => r.targets.map((t) => t.name).sort();

// Only that date's qualifiers, and never the Sun or an unmatched one.
let r = targetsForDate(search, days, "2026-11-01");
assert.deepEqual(names(r), ["Jupiter"]);
assert.equal(r.byDay, true);

r = targetsForDate(search, days, "2026-11-02");
assert.deepEqual(names(r), ["Jupiter", "Saturn"]);

// Changing the date changes the set.
r = targetsForDate(search, days, "2026-11-04");
assert.deepEqual(names(r), ["Mars"]);

// A night nothing qualifies on draws no search objects at all.
r = targetsForDate(search, days, "2026-11-03");
assert.deepEqual(names(r), []);
assert.equal(r.byDay, true);

// Outside the range: every match, and the caller is told to say so.
for (const date of ["2026-10-31", "2026-11-06", "2027-06-01"]) {
    r = targetsForDate(search, days, date);
    assert.deepEqual(names(r), ["Jupiter", "Mars", "Saturn"], date);
    assert.equal(r.byDay, false, date);
    assert.equal(r.hasDays, true, date);
}

// A search with no records at all behaves exactly as before the change,
// on every date, and asks for no indicator.
for (const empty of [undefined, {objects: []},
                     {start_date: "", day_count: 1, objects: []}]) {
    r = targetsForDate(search, empty, "2026-11-02");
    assert.deepEqual(names(r), ["Jupiter", "Mars", "Saturn"]);
    assert.equal(r.byDay, false);
    assert.equal(r.hasDays, false);
}

// No search selected: nothing to draw, no indicator.
r = targetsForDate(null, days, "2026-11-02");
assert.deepEqual(names(r), []);

// --- best periods -----------------------------------------------------
// Jupiter: days 0-1 form one run, day 4 another. Gaps are not spanned.
let periods = bestPeriods(days.objects[0].days, "2026-11-01", 'hours');
assert.equal(periods.length, 2);
assert.equal(periods[0].from.format('YYYY-MM-DD'), "2026-11-01");
assert.equal(periods[0].to.format('YYYY-MM-DD'), "2026-11-02");
assert.equal(periods[0].bestOn.format('YYYY-MM-DD'), "2026-11-01");  // 4 h
assert.equal(periods[1].from.format('YYYY-MM-DD'), "2026-11-05");
assert.equal(periods[1].days, 1);

// The metric decides which day of a run is "best".
const run = [[0, 4, 20, -22, 0], [1, 2, 50, -19, 0]];
assert.equal(bestPeriods(run, "2026-11-01", 'hours')[0]
             .bestOn.format('MM-DD'), "11-01");       // longer
assert.equal(bestPeriods(run, "2026-11-01", 'altitude')[0]
             .bestOn.format('MM-DD'), "11-02");       // higher
assert.equal(bestPeriods(run, "2026-11-01", 'darkness')[0]
             .bestOn.format('MM-DD'), "11-01");       // darker sky

// Records out of order still group correctly.
const shuffled = [[4,1,20,-19,30],[0,4,45,-22,120],[1,3.5,44,-21,110]];
assert.equal(bestPeriods(shuffled, "2026-11-01", 'hours').length, 2);

// The wording names the span and the best day, and more than one period.
const text = periodsText(periods, 'hours');
assert.match(text, /1 Nov to 2 Nov, best 1 Nov at 4\.0 h/);
assert.match(text, /5 Nov, best 5 Nov/);
assert.equal(periodsText([], 'hours'), "");

// Shading: no record is the empty colour, and the scale is monotone.
assert.equal(cellColor(null, 0, 10), "#f0f0f0");
const light = cellColor(1, 0, 10), dark = cellColor(10, 0, 10);
assert.notEqual(light, dark);
assert.equal(cellColor(5, 5, 5), cellColor(5, 5, 5));   // zero span is safe
assert.equal(metricValue([0,4,45,-22,0], 'darkness'), 22);

// --- staleness --------------------------------------------------------
const helsinki = {name: "Helsinki", lat: 60.17, lon: 24.94,
                  min_az: 0, max_az: 360, min_alt: 10, max_alt: 90};
const evaluated = {evaluated_at: "2026-10-30T12:00:00Z",
                   evaluated_position: "Helsinki",
                   evaluated_lat: 60.17, evaluated_lon: 24.94,
                   evaluated_min_az: 0, evaluated_max_az: 360,
                   evaluated_min_alt: 10, evaluated_max_alt: 90,
                   visibility: 'window'};
// Current for the position it was evaluated for.
assert.equal(isStale(evaluated, [helsinki]), false);
// Coordinates moved since.
assert.equal(isStale(evaluated, [{...helsinki, lat: 61}]), true);
assert.equal(isStale(evaluated, [{...helsinki, lon: 25}]), true);
// The window moved, and this search consults the window.
assert.equal(isStale(evaluated, [{...helsinki, min_alt: 20}]), true);
assert.equal(isStale(evaluated, [{...helsinki, max_az: 350}]), true);
// The window moved but these criteria never looked at it.
for (const visibility of ['horizon', 'none']) {
    const other = {...evaluated, visibility};
    assert.equal(isStale(other, [{...helsinki, min_alt: 20}]), false, visibility);
    // Coordinates still matter for them.
    assert.equal(isStale(other, [{...helsinki, lat: 61}]), true, visibility);
}
// Nothing to compare: saved before the details existed, or never
// evaluated, or the named position is gone.
const legacy = {evaluated_at: "2026-01-01T00:00:00Z",
                evaluated_position: "Helsinki", visibility: 'window',
                evaluated_lat: 0, evaluated_lon: 0, evaluated_min_az: 0,
                evaluated_max_az: 0, evaluated_min_alt: 0,
                evaluated_max_alt: 0};
assert.equal(isStale(legacy, [{...helsinki, lat: 61}]), false);
assert.equal(isStale({visibility: 'window'}, [helsinki]), false);
assert.equal(isStale(evaluated, [{...helsinki, name: "Oulu"}]), false);
assert.equal(isStale(evaluated, []), false);

console.log("all observability logic checks passed");
