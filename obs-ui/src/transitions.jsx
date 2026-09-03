// Sky-brightness and visibility-window classification shared between
// TargetPath's path rendering and Target's hover tooltip, so both
// classify a timeseries sample identically.

export function altToBrightness(elem) {
    const alt = elem.sun_alt;
    if (alt >= 0) return 4;
    if (alt >= -6) return 3;
    if (alt >= -12) return 2;
    if (alt >= -18) return 1;
    return 0;
};

export function brightnessChangeToAlt(b1, b2) {
    if (b1 == 0 || b2 == 0) return -18;
    if (b1 == 1 || b2 == 1) return -12;
    if (b1 == 4 || b2 == 4) return 0;
    return -6;
}

// Is the azimuth inside the position's azimuth limits? Azimuth is
// circular, so a maximum below the minimum means the window wraps
// through north: 125 -> 45 covers south-east round to north-east.
// Equal limits match nothing. Strict on both ends, like the altitude.
export function azInWindow(pos, az) {
    if (pos.min_az <= pos.max_az) {
	return az > pos.min_az && az < pos.max_az;
    }
    return az > pos.min_az || az < pos.max_az;
};

export function checkObsWindow(pos, alt, az) {
    return (alt > pos.min_alt && alt < pos.max_alt && azInWindow(pos, az));
};

// Raw-value analogue of TargetPath's pixel-space interpolateTransition:
// finds the timestamp where sun_alt crosses the threshold between two
// samples, via the same linear-ratio math, without needing stageSize.
function interpolateBrightnessTs(s1, s2, b1, b2) {
    const threshold = brightnessChangeToAlt(b1, b2);
    const d = (s1.sun_alt - threshold) / (s1.sun_alt - s2.sun_alt);
    const t1 = new Date(s1.ts).getTime();
    const t2 = new Date(s2.ts).getTime();
    return new Date(t1 + (t2 - t1) * d);
}

// Scans a target's day-long timeseries (the `series` field of
// /api/get-obj-timeseries) for the first brightness-level change and
// first visibility-window change, returning at most one of each.
export function findUpcomingTransitions(series, pos, target) {
    let brightness = null;
    let vis = null;
    let prev = null;
    let nextBrightness = null;
    let nextVisibility = null;

    for (const sample of series) {
	const b = altToBrightness(sample);
	const v = (target == "Sun") || checkObsWindow(pos, sample.alt, sample.az);

	if (brightness != null && b != brightness && nextBrightness == null) {
	    nextBrightness = {ts: interpolateBrightnessTs(prev, sample, brightness, b),
			       alt: sample.alt, az: sample.az, b: b};
	}
	if (vis != null && v != vis && nextVisibility == null) {
	    nextVisibility = {ts: new Date(sample.ts), alt: sample.alt,
			       az: sample.az, vis: v};
	}
	if (nextBrightness && nextVisibility) break;

	brightness = b;
	vis = v;
	prev = sample;
    }

    return {brightness: nextBrightness, visibility: nextVisibility};
}

// Like findUpcomingTransitions, but starting from a given point along the
// series rather than its start, and collapsed to the single next
// transition (brightness or visibility, whichever happens sooner).
export function findNextTransition(series, pos, target, fromIndex = 0) {
    const {brightness, visibility} =
	  findUpcomingTransitions(series.slice(fromIndex), pos, target);
    if (brightness && (!visibility || brightness.ts <= visibility.ts)) {
	return {kind: 'brightness', ...brightness};
    }
    if (visibility) {
	return {kind: 'visibility', ...visibility};
    }
    return null;
}
