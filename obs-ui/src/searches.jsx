import { useEffect, useState } from 'react';
import axios from 'axios';
import dayjs from 'dayjs';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Col, ConfigProvider, DatePicker, Flex, Form, Input,
	 InputNumber, List, Modal, Popconfirm, Radio, Row, Space, Table,
	 Tag, TimePicker, Typography } from 'antd';
import { updateSession } from './session.jsx'
import { useAstroBase } from './config.jsx'

/* The user's saved searches. Shared by the dialog, the header and the
   sky view through one ["searches"] cache entry, so invalidating it
   after a change refetches once and updates all three. */
export function useSearches(session) {
    return useQuery({
	queryKey: ["searches"],
	enabled: session != null,
	queryFn: async () => {
	    const response = await axios.get('/api/searches');
	    return response.data;
	},
    });
}

/* Likewise for positions: the evaluation needs the selected position's
   coordinates and observation window. Same key as ObsStage and the
   positions dialog. */
function usePositions(session) {
    return useQuery({
	queryKey: ["positions"],
	enabled: session != null,
	queryFn: async () => {
	    const response = await axios.get('/api/positions');
	    return response.data;
	},
    });
}

const setKindOptions = [
    {value: 'planets', label: 'Planets'},
    {value: 'messier', label: 'Messier objects'},
    {value: 'double_stars', label: 'Double stars'},
    {value: 'names', label: 'Names'},
];
const visibilityOptions = [
    {value: 'window', label: 'In observation window'},
    {value: 'horizon', label: 'Above horizon'},
    {value: 'none', label: 'No criterion'},
];
const brightnessOptions = [
    {value: 'N', label: 'Night'},
    {value: 'AT', label: 'Astronomical twilight'},
    {value: 'NT', label: 'Nautical twilight'},
    {value: 'CT', label: 'Civil twilight'},
    {value: 'D', label: 'Day'},
];

const kindLabel = (kind) =>
      setKindOptions.find((o) => o.value == kind)?.label || kind;

// One-line summary of a search's target set for the list.
export function setSummary(search) {
    if (search.set_kind == 'names') {
	const n = search.names?.length || 0;
	return `${n} name${n == 1 ? "" : "s"}`;
    }
    const label = kindLabel(search.set_kind);
    return search.max_magnitude != null
	? `${label} ≤ mag ${search.max_magnitude}` : label;
}

// "N of M match" for a saved search.
export function matchSummary(search) {
    const all = search.TargetObjects || [];
    const matched = all.filter((o) => o.matched).length;
    return `${matched} of ${all.length} match`;
}

function fmtEvaluated(search) {
    if (!search.evaluated_at) return "not evaluated";
    return `evaluated ${dayjs(search.evaluated_at).format('YYYY-MM-DD HH:mm')}`
	+ (search.evaluated_position ? ` for ${search.evaluated_position}` : "");
}

// The form's names field is free text: one name per line, or commas.
function splitNames(text) {
    return (text || "").split(/[\n,]/).map((n) => n.trim()).filter((n) => n);
}

// Form values -> the search definition the servers understand.
function toDefinition(values) {
    const kind = values.set_kind;
    const hasMagnitude = kind == 'messier' || kind == 'double_stars';
    return {
	name: values.name,
	set_kind: kind,
	max_magnitude: hasMagnitude && values.max_magnitude != null
	    ? values.max_magnitude : null,
	names: kind == 'names' ? splitNames(values.names) : [],
	start_time: values.start_time ? values.start_time.format('HH:mm') : "",
	end_time: values.end_time ? values.end_time.format('HH:mm') : "",
	start_date: values.day_range?.[0]
	    ? values.day_range[0].format('YYYY-MM-DD') : "",
	end_date: values.day_range?.[1]
	    ? values.day_range[1].format('YYYY-MM-DD') : "",
	visibility: values.visibility,
	max_brightness: values.max_brightness,
    };
}

// A saved search -> form values.
function toFormValues(search) {
    return {
	name: search.name,
	set_kind: search.set_kind,
	max_magnitude: search.max_magnitude,
	names: (search.names || []).join("\n"),
	start_time: dayjs(search.start_time, 'HH:mm'),
	end_time: dayjs(search.end_time, 'HH:mm'),
	day_range: search.start_date
	    ? [dayjs(search.start_date), dayjs(search.end_date)] : null,
	visibility: search.visibility,
	max_brightness: search.max_brightness,
    };
}

const newSearchDefaults = {
    name: "", set_kind: 'planets', max_magnitude: null, names: "",
    start_time: dayjs('22:00', 'HH:mm'), end_time: dayjs('02:00', 'HH:mm'),
    day_range: null, visibility: 'window', max_brightness: 'NT',
};

/* The part of a definition the candidates depend on. When it changes
   the candidates are stale and the next evaluation goes back to the
   catalog; changing anything else only re-applies the criteria. */
function setKey(def) {
    return JSON.stringify({kind: def.set_kind, mag: def.max_magnitude,
			   names: def.names});
}

/* The UTC observing windows a definition describes: one per day of the
   day range, or one for the date the app is showing (today when the
   date picker is unset). Times are local wall-clock, like the pickers;
   an end that isn't after the start runs into the next day. */
export function buildWindows(def, shownDate) {
    const dates = [];
    if (def.start_date) {
	let d = dayjs(def.start_date);
	const end = dayjs(def.end_date);
	while (!d.isAfter(end, 'day')) {
	    dates.push(d);
	    d = d.add(1, 'day');
	}
    } else {
	dates.push(shownDate ? dayjs(shownDate) : dayjs());
    }
    const [sh, sm] = def.start_time.split(':').map(Number);
    const [eh, em] = def.end_time.split(':').map(Number);
    return dates.map((d) => {
	const start = d.hour(sh).minute(sm).second(0).millisecond(0);
	let end = d.hour(eh).minute(em).second(0).millisecond(0);
	if (!end.isAfter(start)) end = end.add(1, 'day');
	return {start: start.toDate().toISOString(),
		end: end.toDate().toISOString()};
    });
}

/* The Go server answers 400/409 with a JSON string; the astro server
   with {error, message} or, for schema errors, a field -> messages
   object. Show whichever is there. */
function errorMessage(error) {
    const body = error?.response?.data;
    if (typeof body === "string" && body != "") return body;
    if (body?.message) return body.message;
    if (body && typeof body === "object") {
	return Object.entries(body).map(
	    ([field, msgs]) => `${field}: ${JSON.stringify(msgs)}`).join("; ");
    }
    if (error?.code == 'ECONNABORTED') return "The evaluation timed out";
    if (error?.request && !error?.response) {
	return "The astronomy service could not be reached";
    }
    return error?.message || "The request failed";
}

const candidateColumns = (withMatch) => [
    {title: 'Name', dataIndex: 'name', key: 'name'},
    {title: 'Type', dataIndex: 'object_type', key: 'type',
     render: (t, c) => c.ss_obj ? "Solar system" : (t || "")},
    {title: 'Mag', dataIndex: 'magnitude', key: 'mag', width: 70,
     render: (m) => m == null ? "" : m.toFixed(1)},
    ...(withMatch ? [{title: 'Match', dataIndex: 'matched', key: 'matched',
		      width: 80,
		      render: (m) => m ? <Tag color="green">yes</Tag>
			   : <Tag>no</Tag>}] : []),
];

/* Dialog for managing the user's target searches: lists them, selects
   one into the session, and adds, edits and deletes them. The add/edit
   form has an Evaluate step (resolve the set through the astro server's
   catalog lookup if the candidates are missing or stale, then apply the
   criteria to them for the selected position) and Save is only
   available once the current definition has been evaluated.

   shownDate is the date the app is currently displaying (the date
   picker's value, or null for today); a definition without a day range
   is evaluated for the night that begins on it. */
export function SearchesDialog({open, onClose, session, setSession, shownDate}) {
    // null when listing, "new" while adding, the search's ID while
    // editing that one.
    const [editing, setEditing] = useState(null);
    // The set's candidates: {setKey, list, unresolved}, or null when
    // they have to be (re)resolved.
    const [candidates, setCandidates] = useState(null);
    // The criteria applied to those candidates: {flags, count,
    // position}, or null until evaluated for the current definition.
    const [matches, setMatches] = useState(null);
    const [formError, setFormError] = useState(null);
    const [listError, setListError] = useState(null);
    const [evaluating, setEvaluating] = useState(false);
    const [form] = Form.useForm();
    // Controls which fields the form shows.
    const setKind = Form.useWatch('set_kind', form);

    const queryClient = useQueryClient();
    const astroBase = useAstroBase();
    const searchQ = useSearches(session);
    const posQ = usePositions(session);
    const searches = searchQ.data || [];
    const positions = posQ.data || [];

    const selectSearch = (search) => {
	updateSession(session, setSession, {...session, search: search.name});
    };

    const stopEditing = () => {
	setEditing(null);
	setCandidates(null);
	setMatches(null);
	setFormError(null);
    };

    const onMutationSuccess = () => {
	queryClient.invalidateQueries({queryKey: ["searches"]});
	stopEditing();
    };

    const createMut = useMutation({
	mutationFn: async (body) => (await axios.post('/api/searches', body)).data,
	onSuccess: onMutationSuccess,
	onError: (error) => setFormError(errorMessage(error)),
    });

    const updateMut = useMutation({
	mutationFn: async ({id, body}) =>
	    (await axios.put(`/api/searches/${id}`, body)).data,
	onSuccess: (data, {previousName, body}) => {
	    // The session names the selected search, so renaming the
	    // selected one moves the selection with it.
	    const name = data?.name || body.name;
	    if (previousName == session?.search && name != previousName) {
		updateSession(session, setSession, {...session, search: name});
	    }
	    onMutationSuccess();
	},
	onError: (error) => setFormError(errorMessage(error)),
    });

    const deleteMut = useMutation({
	mutationFn: async (id) => axios.delete(`/api/searches/${id}`),
	onSuccess: () => {
	    setListError(null);
	    queryClient.invalidateQueries({queryKey: ["searches"]});
	},
	onError: (error) => setListError(errorMessage(error)),
    });

    const saving = createMut.isPending || updateMut.isPending;
    const editedSearch = searches.find((s) => s.ID === editing);

    /* The form element is keyed on `editing` so it remounts with the
       right initial values, but the form store from useForm outlives
       it and would otherwise carry the previous form's values into the
       next one. Reset once the new form has mounted. */
    useEffect(() => {
	if (editing != null) form.resetFields();
    }, [editing, form]);

    const startEditing = (target) => {
	setFormError(null);
	setMatches(null);
	if (target == "new") {
	    setCandidates(null);
	} else {
	    // A saved search brings its candidates along, so editing
	    // only its criteria needs no catalog lookup.
	    const search = searches.find((s) => s.ID === target);
	    setCandidates({
		setKey: setKey(search),
		list: (search.TargetObjects || []).map((o) => ({
		    name: o.name, ss_obj: o.ss_obj, ra: o.ra, dec: o.dec,
		    magnitude: o.magnitude, object_type: o.object_type})),
		unresolved: [],
	    });
	}
	setEditing(target);
    };

    const onValuesChange = (changed, all) => {
	setMatches(null);
	setFormError(null);
	if (candidates != null && candidates.setKey != setKey(toDefinition(all))) {
	    setCandidates(null);
	}
    };

    const evaluate = async () => {
	let values;
	try {
	    values = await form.validateFields();
	} catch {
	    return;
	}
	const def = toDefinition(values);
	const pos = positions.find((p) => p.name == session?.position);
	if (pos == null) {
	    setFormError("Select an observation position first");
	    return;
	}
	setFormError(null);
	setEvaluating(true);
	try {
	    let current = candidates;
	    if (current == null || current.setKey != setKey(def)) {
		const resp = await axios.post(
		    `${astroBase}/api/resolve-targets`,
		    {set: {kind: def.set_kind, max_magnitude: def.max_magnitude,
			   names: def.names}},
		    {timeout: 120 * 1000});
		current = {setKey: setKey(def), list: resp.data.candidates,
			   unresolved: resp.data.unresolved};
		setCandidates(current);
	    }
	    const resp = await axios.post(
		`${astroBase}/api/filter-targets`,
		{candidates: current.list.map((c) => ({
		    name: c.name, ss_obj: c.ss_obj, ra: c.ra, dec: c.dec})),
		 lat: pos.lat, lon: pos.lon,
		 obs_window: {min_az: pos.min_az, max_az: pos.max_az,
			      min_alt: pos.min_alt, max_alt: pos.max_alt},
		 windows: buildWindows(def, shownDate),
		 visibility: def.visibility,
		 max_brightness: def.max_brightness},
		{timeout: 120 * 1000});
	    setMatches({flags: resp.data.matched, count: resp.data.count,
			position: pos.name});
	} catch (error) {
	    setFormError(errorMessage(error));
	} finally {
	    setEvaluating(false);
	}
    };

    const onFinish = (values) => {
	if (candidates == null || matches == null) return;
	const def = toDefinition(values);
	const body = {
	    ...def,
	    evaluated_at: new Date().toISOString(),
	    evaluated_position: matches.position,
	    candidates: candidates.list.map((c, i) => ({
		...c, matched: !!matches.flags[i]})),
	};
	setFormError(null);
	if (editing == "new") {
	    createMut.mutate(body);
	} else {
	    updateMut.mutate({id: editing, body,
			      previousName: editedSearch?.name});
	}
    };

    const closeDialog = () => {
	stopEditing();
	setListError(null);
	onClose();
    };

    const searchList =
	  <List bordered dataSource={searches}
		rowKey={(s) => s.ID}
		locale={{emptyText: "No searches yet"}}
		renderItem={(s) =>
		    <List.Item
			actions={[
			    <Button key="select" size="small"
				    disabled={s.name == session?.search}
				    onClick={() => selectSearch(s)}>
				Select
			    </Button>,
			    <Button key="edit" size="small"
				    onClick={() => startEditing(s.ID)}>
				Edit
			    </Button>,
			    <Popconfirm key="delete"
					title="Delete this search?"
					description={`"${s.name}" and its `
						     + `results will be removed.`}
					okText="Delete" cancelText="Cancel"
					onConfirm={() => deleteMut.mutate(s.ID)}>
				<Button size="small" danger
					disabled={deleteMut.isPending}>
				    Delete
				</Button>
			    </Popconfirm>]}>
			<List.Item.Meta
			    title={<Space>
				       {s.name}
				       {s.name == session?.search &&
					<Tag color="blue">Selected</Tag>}
				   </Space>}
			    description={`${setSummary(s)} · ${matchSummary(s)}`
					 + ` · ${fmtEvaluated(s)}`}>
			</List.Item.Meta>
		    </List.Item>}>
	  </List>;

    const initialValues = editing == "new" ? newSearchDefaults
	  : editedSearch ? toFormValues(editedSearch) : null;

    // The candidate table between Evaluate and Save: every candidate,
    // with its match flag once the criteria have been applied, matched
    // ones first.
    let candidateTable = null;
    if (candidates != null) {
	const rows = candidates.list.map((c, i) => ({
	    ...c, key: i, matched: matches ? !!matches.flags[i] : null}));
	if (matches) rows.sort((a, b) => (b.matched ? 1 : 0) - (a.matched ? 1 : 0));
	const heading = matches
	      ? `${matches.count} of ${rows.length} match`
	      : `${rows.length} candidate${rows.length == 1 ? "" : "s"}`
	        + " (criteria not applied yet)";
	candidateTable =
	    <div style={{marginBottom: 16}}>
		<Typography.Text strong>{heading}</Typography.Text>
		{candidates.unresolved.length > 0 &&
		 <Alert type="warning" showIcon style={{marginTop: 8}}
			message={"Not found in the catalog: "
				 + candidates.unresolved.join(", ")}>
		 </Alert>}
		<Table size="small" style={{marginTop: 8}}
		       columns={candidateColumns(matches != null)}
		       dataSource={rows}
		       pagination={{pageSize: 6, size: 'small',
				    hideOnSinglePage: true}}>
		</Table>
	    </div>;
    }

    const searchForm =
	  <Form key={editing} form={form} layout="vertical"
		initialValues={initialValues}
		onValuesChange={onValuesChange} onFinish={onFinish}>
	      <Form.Item label="Name" name="name"
			 rules={[{required: true, message: 'Name is required'}]}>
		  <Input></Input>
	      </Form.Item>
	      <Form.Item label="Target set" name="set_kind">
		  <Radio.Group options={setKindOptions}></Radio.Group>
	      </Form.Item>
	      {(setKind == 'messier' || setKind == 'double_stars') &&
	       <Form.Item label="Maximum magnitude" name="max_magnitude"
			  rules={[{required: setKind == 'double_stars',
				   message: 'Double stars need a magnitude limit'}]}>
		   <InputNumber min={-30} max={30} step={0.5}
				style={{width: 160}}></InputNumber>
	       </Form.Item>}
	      {setKind == 'names' &&
	       <Form.Item label="Names (one per line or comma-separated)"
			  name="names"
			  rules={[{validator: (_, v) => splitNames(v).length > 0
				   ? Promise.resolve()
				   : Promise.reject(new Error('Enter at least one name'))}]}>
		   <Input.TextArea rows={3}></Input.TextArea>
	       </Form.Item>}
	      <Row gutter={16}>
		  <Col span={8}>
		      <Form.Item label="From" name="start_time"
				 rules={[{required: true, message: 'Required'}]}>
			  <TimePicker format="HH:mm" minuteStep={5}
				      style={{width: '100%'}}></TimePicker>
		      </Form.Item>
		  </Col>
		  <Col span={8}>
		      <Form.Item label="To" name="end_time"
				 rules={[{required: true, message: 'Required'}]}>
			  <TimePicker format="HH:mm" minuteStep={5}
				      style={{width: '100%'}}></TimePicker>
		      </Form.Item>
		  </Col>
		  <Col span={8}>
		      <Form.Item label="Days (optional, up to 31)" name="day_range"
				 rules={[{validator: (_, v) =>
				     !v || v[1].diff(v[0], 'day') <= 30
					 ? Promise.resolve()
					 : Promise.reject(new Error('At most 31 days'))}]}>
			  <DatePicker.RangePicker style={{width: '100%'}}>
			  </DatePicker.RangePicker>
		      </Form.Item>
		  </Col>
	      </Row>
	      <Form.Item label="Minimum visibility" name="visibility">
		  <Radio.Group options={visibilityOptions}></Radio.Group>
	      </Form.Item>
	      <Form.Item label="Maximum sky brightness" name="max_brightness">
		  <Radio.Group options={brightnessOptions}></Radio.Group>
	      </Form.Item>
	      {candidateTable}
	      {formError &&
	       <Alert type="error" message={formError} showIcon
		      style={{marginBottom: 16}}>
	       </Alert>}
	      <Flex justify="flex-end" gap="small">
		  <Button onClick={stopEditing} disabled={saving || evaluating}>
		      Cancel
		  </Button>
		  <Button onClick={evaluate} loading={evaluating} disabled={saving}>
		      Evaluate
		  </Button>
		  <Button type="primary" htmlType="submit" loading={saving}
			  disabled={matches == null || evaluating}>
		      Save
		  </Button>
	      </Flex>
	  </Form>;

    const listBody =
	  searchQ.isPending
	  ? <Typography.Text>Loading searches...</Typography.Text>
	  : searchQ.error
	  ? <Typography.Text type="danger">
		Failed to load searches: {`${searchQ.error}`}
	    </Typography.Text>
	  : <>
		{searchList}
		{listError &&
		 <Alert type="error" message={listError} showIcon
			closable onClose={() => setListError(null)}
			style={{marginTop: 16}}>
		 </Alert>}
	    </>;

    const title = editing == null ? "Target searches"
	  : editing == "new" ? "Add search" : "Edit search";

    const footer = editing != null ? null
	  : [<Button key="add" onClick={() => startEditing("new")}>
		 Add search
	     </Button>,
	     <Button key="close" type="primary" onClick={closeDialog}>
		 Close
	     </Button>];

    return (
	<ConfigProvider theme={{token: {colorText: 'black'}}}>
	    <Modal title={title}
		   open={open}
		   onCancel={closeDialog}
		   footer={footer}
		   width={editing != null ? 720 : 600}>
		{editing != null ? searchForm : listBody}
	    </Modal>
	</ConfigProvider>);
}

export default SearchesDialog;
