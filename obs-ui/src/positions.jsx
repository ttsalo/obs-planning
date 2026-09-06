import { useState } from 'react';
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Col, ConfigProvider, Flex, Form, Input, InputNumber,
	 List, Modal, Popconfirm, Row, Space, Tag,
	 Typography } from 'antd';
import { updateSession } from './session.jsx'

// One-line summary of a position's coordinates for the list.
function fmtCoords(pos) {
    return `Lat ${pos.lat}°  Lon ${pos.lon}°`;
}

// The observation window a new position starts with: the whole sky.
const newPositionDefaults = {name: "", min_az: 0, max_az: 360,
			     min_alt: 0, max_alt: 90};

/* The server rejects invalid input with 400 and a duplicate name with
   409, in both cases with the message as a JSON string body. That's
   what the user needs to see, so prefer it over axios' own wording. */
function errorMessage(error) {
    const body = error?.response?.data;
    if (typeof body === "string" && body != "") return body;
    return error?.message || "The request failed";
}

/* Dialog for managing the user's observation positions: lists them
   with their coordinates, marks the one the session has selected, and
   adds, edits and selects them.

   The positions query uses the same ["positions"] key as ObsStage, so
   the dialog and the sky view share a single cache entry: invalidating
   it after a change refetches once and updates both.

   The ConfigProvider is inherited from the dialog this replaced: the
   header sets a light colorText for the dark header background, and
   the modal renders on white, so it needs black text back.
*/
export function PositionsDialog({open, onClose, session, setSession}) {
    // null when listing, "new" while adding, the position's ID while
    // editing that one.
    const [editing, setEditing] = useState(null);
    // Server-side rejection of the last submit, shown in the form.
    const [formError, setFormError] = useState(null);

    const queryClient = useQueryClient();

    const posQ = useQuery({
	queryKey: ["positions"],
	enabled: session != null,
	queryFn: async () => {
	    const response = await axios.get('/api/positions');
	    return response.data;
	},
    });

    const positions = posQ.data || [];

    /* Persist the selection. The whole session goes in the body
       because the server's update-session overwrites all of its fields
       from what it's given, so posting only the position would blank
       the username and the search. */
    const selectPosition = (pos) => {
	updateSession(session, setSession, {...session, position: pos.name});
    };

    const stopEditing = () => {
	setEditing(null);
	setFormError(null);
    };

    // Both mutations refetch the shared positions query, so the list
    // and the sky view pick the change up together.
    const onMutationSuccess = () => {
	queryClient.invalidateQueries({queryKey: ["positions"]});
	stopEditing();
    };

    const createMut = useMutation({
	mutationFn: async (values) =>
	    (await axios.post('/api/positions', values)).data,
	onSuccess: onMutationSuccess,
	onError: (error) => setFormError(errorMessage(error)),
    });

    const updateMut = useMutation({
	mutationFn: async ({id, values}) =>
	    (await axios.put(`/api/positions/${id}`, values)).data,
	onSuccess: (data, {previousName, values}) => {
	    /* The session identifies the selected position by name, so
	       renaming the selected one has to move the selection with
	       it or the sky view would lose its position. */
	    const name = data?.name || values.name;
	    if (previousName == session?.position && name != previousName) {
		updateSession(session, setSession,
			      {...session, position: name});
	    }
	    onMutationSuccess();
	},
	onError: (error) => setFormError(errorMessage(error)),
    });

    /* Deleting doesn't go through the form, so its failures (the
       server refuses the last position with a 409) surface next to the
       list instead. */
    const [listError, setListError] = useState(null);

    const deleteMut = useMutation({
	mutationFn: async (id) => axios.delete(`/api/positions/${id}`),
	onSuccess: () => {
	    setListError(null);
	    queryClient.invalidateQueries({queryKey: ["positions"]});
	},
	onError: (error) => setListError(errorMessage(error)),
    });

    const saving = createMut.isPending || updateMut.isPending;

    const editedPosition = positions.find((pos) => pos.ID === editing);

    // Only read at mount; the form is keyed on `editing` so switching
    // between adding and editing remounts it with the right values.
    const initialValues = editing == "new" ? newPositionDefaults
	  : editedPosition ? {name: editedPosition.name,
			      lat: editedPosition.lat,
			      lon: editedPosition.lon,
			      min_az: editedPosition.min_az,
			      max_az: editedPosition.max_az,
			      min_alt: editedPosition.min_alt,
			      max_alt: editedPosition.max_alt}
	  : null;

    const startEditing = (target) => {
	setFormError(null);
	setEditing(target);
    };

    const onFinish = (values) => {
	setFormError(null);
	if (editing == "new") {
	    createMut.mutate(values);
	} else {
	    updateMut.mutate({id: editing, values,
			      previousName: editedPosition?.name});
	}
    };

    const closeDialog = () => {
	stopEditing();
	setListError(null);
	onClose();
    };

    const positionList =
	  <List bordered dataSource={positions}
		rowKey={(pos) => pos.ID}
		locale={{emptyText: "No positions yet"}}
		renderItem={(pos) =>
		    <List.Item
			actions={[
			    <Button key="select" size="small"
				    disabled={pos.name == session?.position}
				    onClick={() => selectPosition(pos)}>
				Select
			    </Button>,
			    <Button key="edit" size="small"
				    onClick={() => startEditing(pos.ID)}>
				Edit
			    </Button>,
			    <Popconfirm key="delete"
					title="Delete this position?"
					description={`"${pos.name}" will be `
						     + `permanently removed.`}
					okText="Delete" cancelText="Cancel"
					onConfirm={() =>
					    deleteMut.mutate(pos.ID)}>
				<Button size="small" danger
					disabled={positions.length <= 1 ||
						  deleteMut.isPending}>
				    Delete
				</Button>
			    </Popconfirm>]}>
			<List.Item.Meta
			    title={<Space>
				       {pos.name}
				       {pos.name == session?.position &&
					<Tag color="blue">Selected</Tag>}
				   </Space>}
			    description={fmtCoords(pos)}>
			</List.Item.Meta>
		    </List.Item>}>
	  </List>;

    // A numeric field of the position form. The min/max match the
    // server's validation, but they only clamp the spinner and the
    // blurred value, so the server stays the real check.
    const numberField = (label, name, min, max, extra = null) =>
	  <Col span={12}>
	      <Form.Item label={label} name={name} extra={extra}
			 rules={[{required: true,
				  message: `${label} is required`}]}>
		  <InputNumber min={min} max={max} style={{width: '100%'}}>
		  </InputNumber>
	      </Form.Item>
	  </Col>;

    const positionForm =
	  <Form key={editing} layout="vertical" initialValues={initialValues}
		onFinish={onFinish}>
	      <Form.Item label="Name" name="name"
			 rules={[{required: true,
				  message: 'Name is required'}]}>
		  <Input></Input>
	      </Form.Item>
	      <Row gutter={16}>
		  {numberField("Latitude", "lat", -90, 90)}
		  {numberField("Longitude", "lon", -180, 180)}
	      </Row>
	      <Row gutter={16}>
		  {numberField("Min azimuth", "min_az", 0, 360)}
		  {numberField("Max azimuth", "max_az", 0, 360,
			       "Smaller than the minimum wraps through north, e.g. 125 → 45")}
	      </Row>
	      <Row gutter={16}>
		  {numberField("Min altitude", "min_alt", -90, 90)}
		  {numberField("Max altitude", "max_alt", -90, 90)}
	      </Row>
	      {formError &&
	       <Alert type="error" message={formError} showIcon
		      style={{marginBottom: 16}}>
	       </Alert>}
	      <Flex justify="flex-end" gap="small">
		  <Button onClick={stopEditing} disabled={saving}>
		      Cancel
		  </Button>
		  <Button type="primary" htmlType="submit" loading={saving}>
		      Save
		  </Button>
	      </Flex>
	  </Form>;

    const listBody =
	  posQ.isPending
	  ? <Typography.Text>Loading positions...</Typography.Text>
	  : posQ.error
	  ? <Typography.Text type="danger">
		Failed to load positions: {`${posQ.error}`}
	    </Typography.Text>
	  : <>
		{positionList}
		{listError &&
		 <Alert type="error" message={listError} showIcon
			closable onClose={() => setListError(null)}
			style={{marginTop: 16}}>
		 </Alert>}
	    </>;

    const title = editing == null ? "Observation positions"
	  : editing == "new" ? "Add position" : "Edit position";

    const footer = editing != null ? null
	  : [<Button key="add" onClick={() => startEditing("new")}>
		 Add position
	     </Button>,
	     <Button key="close" type="primary" onClick={closeDialog}>
		 Close
	     </Button>];

    return (
	<ConfigProvider theme={{token: {colorText: 'black'}}}>
	    <Modal title={title}
		   open={open}
		   onCancel={closeDialog}
		   footer={footer}>
		{editing != null ? positionForm : listBody}
	    </Modal>
	</ConfigProvider>);
}

export default PositionsDialog;
