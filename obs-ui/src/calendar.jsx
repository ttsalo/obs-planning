import { useState } from 'react';
import { Modal, Select, Space, Typography, Alert, Flex } from 'antd';
import dayjs from 'dayjs';
import { useSearches } from './searches.jsx'
import { useSearchDays } from './obs.jsx'
import { DAY_INDEX, DAY_HOURS, DAY_MAX_ALT, DAY_DARK_SUN, DAY_PEAK_MINUTES,
	 metricOptions, metricValue, bestPeriods, periodsText,
	 cellColor } from './observability.js'

/* The observability calendar: one row per matched candidate of the
   selected search, one cell per day of the evaluated range, shaded by
   a metric the user picks. It opens as a dialog from the top bar,
   alongside the positions and searches dialogs. Activating a day sets
   the date the application is showing and closes the dialog, because
   the point of the click is to see that night in the sky and a dialog
   stands in front of it.

   Deliberately plain HTML rather than part of the Konva stage: the
   stage is a fixed 1000x500 scene scaled to the container, which would
   make a few hundred day columns and their labels unreadable, and
   hover, scroll and click are what the browser already does well. */

function CalendarGrid({days, metric, onPickDate}) {
    const [hover, setHover] = useState(null);
    const start = dayjs(days.start_date);
    const dayCount = days.day_count;

    // One pass for the scale and one for the row order, so the shading
    // and the ranking both follow the chosen metric.
    let low = Infinity, high = -Infinity;
    for (const obj of days.objects) {
	for (const record of obj.days) {
	    const value = metricValue(record, metric);
	    if (value < low) low = value;
	    if (value > high) high = value;
	}
    }
    const rows = [...days.objects].map((obj) => {
	let best = -Infinity;
	for (const record of obj.days) {
	    best = Math.max(best, metricValue(record, metric));
	}
	return {obj: obj, best: best};
    }).sort((a, b) => b.best - a.best);

    const cellWidth = dayCount > 180 ? 4 : dayCount > 60 ? 7 : 14;
    const trackWidth = cellWidth * dayCount;

    // A tick at the first of each month the range covers.
    const ticks = [];
    for (let i = 0; i < dayCount; i++) {
	const date = start.add(i, 'day');
	if (i == 0 || date.date() == 1) {
	    ticks.push({left: i * cellWidth, label: date.format('MMM')});
	}
    }

    const readout = hover
	  ? `${hover.name} on ${start.add(hover.record[DAY_INDEX], 'day')
				      .format('YYYY-MM-DD')}: `
	    + `${hover.record[DAY_HOURS].toFixed(2)} h observable, `
	    + `peak ${hover.record[DAY_MAX_ALT].toFixed(1)}° `
	    + `${Math.round(hover.record[DAY_PEAK_MINUTES])} min into the `
	    + `window, darkest sun ${hover.record[DAY_DARK_SUN].toFixed(1)}°`
	  : "Point at a day for its numbers, or activate it to show that night.";

    return <div className="obs-calendar">
	       <Typography.Text type="secondary" style={{fontSize: 12}}
				className="obs-calendar-readout">
		   {readout}
	       </Typography.Text>
	       <div className="obs-calendar-scroll"
		    style={{overflowX: 'auto', marginTop: 8}}>
		   <div style={{display: 'flex', marginBottom: 2}}>
		       <div style={{width: 110, flex: '0 0 110px'}}></div>
		       <div style={{position: 'relative', height: 14,
				    width: trackWidth}}>
			   {ticks.map((t) =>
			       <span key={t.left}
				     style={{position: 'absolute', left: t.left,
					     fontSize: 10, color: '#888'}}>
				   {t.label}
			       </span>)}
		       </div>
		   </div>
		   {rows.map(({obj}) => {
		       const byDay = new Map(
			   obj.days.map((r) => [r[DAY_INDEX], r]));
		       const periods = bestPeriods(obj.days, days.start_date,
						   metric);
		       return <div key={obj.id} className="obs-calendar-row"
				   data-target={obj.name}
				   style={{display: 'flex', alignItems: 'center',
					   marginBottom: 1}}>
				  <div className="obs-calendar-name"
				       style={{width: 110, flex: '0 0 110px',
					       fontSize: 12,
					       whiteSpace: 'nowrap',
					       overflow: 'hidden',
					       textOverflow: 'ellipsis'}}
				       title={obj.name}>
				      {obj.name}
				  </div>
				  <div className="obs-calendar-track"
				       style={{display: 'flex',
					       width: trackWidth,
					       flex: `0 0 ${trackWidth}px`}}>
				      {Array.from({length: dayCount}, (_, i) => {
					  const record = byDay.get(i);
					  const value = record
						? metricValue(record, metric)
						: null;
					  return <div
					      key={i}
					      className={"obs-calendar-cell"
						  + (record ? " has-record" : "")}
					      data-day={i}
					      onMouseEnter={record ? () => setHover(
						  {name: obj.name, record: record})
						  : undefined}
					      onMouseLeave={record
						  ? () => setHover(null)
						  : undefined}
					      onClick={() => {
						  if (record) {
						      setHover({name: obj.name,
								record: record});
						  }
						  onPickDate(start.add(i, 'day'));
					      }}
					      style={{width: cellWidth,
						      height: 14,
						      background: cellColor(
							  value, low, high),
						      cursor: 'pointer'}}>
					  </div>;
				      })}
				  </div>
				  <div className="obs-calendar-periods"
				       style={{marginLeft: 10, fontSize: 11,
					       color: '#666',
					       whiteSpace: 'nowrap'}}>
				      {periodsText(periods, metric)}
				  </div>
			      </div>;
		   })}
	       </div>
	   </div>;
}

export default function ObservabilityCalendar({open, onClose, session,
					      onPickDate}) {
    const [metric, setMetric] = useState('hours');
    const searchQ = useSearches(session);
    const search = (searchQ.data || []).find((s) => s.name == session?.search);
    const daysQ = useSearchDays(search);
    const days = daysQ.data;

    let body;
    if (search == null) {
	body = <Alert type="info" message="No search is selected."></Alert>;
    } else if (daysQ.isPending) {
	body = <Typography.Text type="secondary">Loading…</Typography.Text>;
    } else if (!days?.start_date || !days?.objects?.length) {
	/* Either nothing qualified, or the definition has no day
	   range: such a search was evaluated for a single night that
	   is not recorded anywhere, so there is no range to lay a
	   calendar out over. Give the search a day range and evaluate
	   it to get one. */
	body = <Alert type="info" showIcon className="obs-calendar-empty"
		      message="This search has no per-day results."
		      description={"Give it a day range in the searches "
				   + "dialog and evaluate it to see when each "
				   + "target is best observed."}>
	       </Alert>;
    } else {
	body = <Space direction="vertical" style={{width: '100%'}} size={4}>
		   <Flex align="center" gap={8}>
		       <Typography.Text strong>Shade by</Typography.Text>
		       <Select size="small" value={metric} onChange={setMetric}
			       options={metricOptions}
			       style={{width: 190}}>
		       </Select>
		       <Typography.Text type="secondary"
					style={{fontSize: 12}}>
			   {days.start_date} to {days.end_date},
			   {" "}{days.objects.length} observable
			   {" "}{days.objects.length == 1 ? "target" : "targets"}
		       </Typography.Text>
		   </Flex>
		   <CalendarGrid days={days} metric={metric}
				 onPickDate={(date) => {
				     onPickDate(date);
				     onClose();
				 }}>
		   </CalendarGrid>
	       </Space>;
    }

    return <Modal title="Observability calendar" open={open} onCancel={onClose}
		  footer={null} width="90vw"
		  style={{top: 40, maxWidth: 1600}}
		  styles={{body: {maxHeight: '70vh', overflowY: 'auto'}}}
		  destroyOnHidden>
	       {body}
	   </Modal>;
}
