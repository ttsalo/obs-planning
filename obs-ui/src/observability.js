import dayjs from 'dayjs';

/* The per-day observability logic, kept free of React, Konva and antd
   so both the sky view and the calendar can share it and so it can be
   exercised on its own, the way transitions.jsx already is. */

/* The fields of a per-day record, which is a fixed-order array to keep
   a year of an object list's records down to a sendable size. Mirrors
   the constants in backend/db.go. */
export const DAY_INDEX = 0;
export const DAY_HOURS = 1;
export const DAY_MAX_ALT = 2;
export const DAY_DARK_SUN = 3;
export const DAY_PEAK_MINUTES = 4;

/* Which of the selected search's candidates belong on the sky for the
   date the application is showing.

   With records and a date inside the evaluated range, only the
   candidates qualifying on that date are drawn. Outside the range, and
   for a search with no records at all, every matched candidate is
   drawn instead. That fallback is what makes the whole thing safe: a
   definition with no day range was evaluated for a single night that
   is not recorded anywhere, so without it, moving the date would empty
   the sky for every search saved before this version.

   A record's day field is the offset from the range's start date,
   which is also its window's position in the evaluation, because
   buildWindows emits one window per day in order from that date.

   Returns {targets, byDay, hasDays}: `byDay` false means the fallback
   applied, `hasDays` whether there were any records to apply. Note the
   casing: a listed candidate carries `ID`, a record's object `id`. */
export function targetsForDate(search, days, shownDate) {
    const matched = (search?.TargetObjects || []).filter(
	(obj) => obj.matched && obj.name != "Sun");
    const objects = days?.objects || [];
    if (!days?.start_date || objects.length == 0) {
	return {targets: matched, byDay: false, hasDays: objects.length > 0};
    }
    const index = dayjs(shownDate || undefined).startOf('day').diff(
	dayjs(days.start_date).startOf('day'), 'day');
    if (index < 0 || index >= days.day_count) {
	return {targets: matched, byDay: false, hasDays: true};
    }
    const qualifying = new Set();
    for (const obj of objects) {
	if ((obj.days || []).some((r) => r[DAY_INDEX] === index)) {
	    qualifying.add(obj.id);
	}
    }
    return {targets: matched.filter((obj) => qualifying.has(obj.ID)),
	    byDay: true, hasDays: true};
}

// Higher is better for all three, so the shading and the ranking can
// share one scale; a darker sky is a smaller Sun altitude, hence the
// sign.
export const metricOptions = [
    {value: 'hours', label: 'Observable hours'},
    {value: 'altitude', label: 'Peak altitude'},
    {value: 'darkness', label: 'Darkest sky'},
];

export function metricValue(record, metric) {
    if (metric == 'altitude') return record[DAY_MAX_ALT];
    if (metric == 'darkness') return -record[DAY_DARK_SUN];
    return record[DAY_HOURS];
}

export function metricText(record, metric) {
    if (metric == 'altitude') return `${record[DAY_MAX_ALT].toFixed(1)}°`;
    if (metric == 'darkness') return `sun ${record[DAY_DARK_SUN].toFixed(1)}°`;
    return `${record[DAY_HOURS].toFixed(1)} h`;
}

/* Runs of consecutive days a candidate has a record for, each with the
   day it is at its best on by the chosen metric. Gaps are not spanned:
   a candidate observable in autumn and again in spring gets two
   periods, not one running through the months it is unobservable. */
export function bestPeriods(records, startDate, metric) {
    const sorted = [...(records || [])].sort(
	(a, b) => a[DAY_INDEX] - b[DAY_INDEX]);
    const runs = [];
    for (const record of sorted) {
	const last = runs[runs.length - 1];
	if (last && record[DAY_INDEX] == last.endDay + 1) {
	    last.endDay = record[DAY_INDEX];
	    last.records.push(record);
	} else {
	    runs.push({startDay: record[DAY_INDEX], endDay: record[DAY_INDEX],
		       records: [record]});
	}
    }
    const start = dayjs(startDate);
    return runs.map((run) => {
	let best = run.records[0];
	for (const record of run.records) {
	    if (metricValue(record, metric) > metricValue(best, metric)) {
		best = record;
	    }
	}
	return {from: start.add(run.startDay, 'day'),
		to: start.add(run.endDay, 'day'),
		bestOn: start.add(best[DAY_INDEX], 'day'),
		best: best,
		days: run.endDay - run.startDay + 1};
    });
}

const fmtDay = (d) => d.format('D MMM');

export function periodsText(periods, metric) {
    if (periods.length == 0) return "";
    // The longest runs first: those are the periods worth planning
    // around, and a long range can have many one-night slivers.
    const ranked = [...periods].sort((a, b) => b.days - a.days);
    const shown = ranked.slice(0, 3).map((p) => {
	const span = p.from.isSame(p.to, 'day') ? fmtDay(p.from)
	      : `${fmtDay(p.from)} to ${fmtDay(p.to)}`;
	return `${span}, best ${fmtDay(p.bestOn)}`
	    + ` at ${metricText(p.best, metric)}`;
    });
    const rest = ranked.length - shown.length;
    return shown.join("; ") + (rest > 0 ? `; and ${rest} more` : "");
}

// A light-to-strong ramp over the metric's range. A day with no record
// is left visibly empty rather than shaded at the bottom of the scale.
export function cellColor(value, low, high) {
    if (value == null) return "#f0f0f0";
    const span = high - low;
    const t = span > 1e-9 ? (value - low) / span : 1;
    const lightness = 88 - Math.round(t * 56);
    return `hsl(222 55% ${lightness}%)`;
}

/* A search is stale when its stored evaluation no longer describes the
   position it was evaluated for: that position's coordinates have
   moved since, or - only when the visibility criterion consults it -
   its observation window has changed. The window is excluded for
   `horizon` and `none` because the evaluation never looked at it, so
   changing it cannot have invalidated the result. The same
   distinction the path query key in obs.jsx already makes.

   A search saved before the evaluation details existed has all six of
   them at zero, which no real evaluation produces: an azimuth window
   from 0 to 0 admits nothing. Such a search is never called stale,
   because there is nothing to compare it against. */
export function isStale(search, positions) {
    if (!search.evaluated_at) return false;
    const recorded = ['evaluated_lat', 'evaluated_lon', 'evaluated_min_az',
		      'evaluated_max_az', 'evaluated_min_alt',
		      'evaluated_max_alt'].some((k) => search[k]);
    if (!recorded) return false;
    const pos = (positions || []).find(
	(p) => p.name == search.evaluated_position);
    if (pos == null) return false;
    if (pos.lat != search.evaluated_lat || pos.lon != search.evaluated_lon) {
	return true;
    }
    if (search.visibility != 'window') return false;
    return pos.min_az != search.evaluated_min_az
	|| pos.max_az != search.evaluated_max_az
	|| pos.min_alt != search.evaluated_min_alt
	|| pos.max_alt != search.evaluated_max_alt;
}
