from flasgger import Schema, fields

class GetObjPostSchema(Schema):
    lat = fields.Float(required=True)
    lon = fields.Float(required=True)
    time = fields.DateTime(required=True)
    target = fields.String(required=True)


class GetObjTSPostSchema(Schema):
    lat = fields.Float(required=True)
    lon = fields.Float(required=True)
    time = fields.DateTime(required=True)
    timespan = fields.String(required=True)
    target = fields.String(required=True)


class GetObjResultSchema(Schema):
    alt = fields.Float(required=True)
    az = fields.Float(required=True)
    radius = fields.Float(required=True)
    

class GetObjTSPointSchema(Schema):
    alt = fields.Float(required=True)
    az = fields.Float(required=True)
    sun_alt = fields.Float(required=True)
    ts = fields.DateTime(required=True)


class GetObjTSResultSchema(Schema):
    series = fields.List(
        fields.Nested(GetObjTSPointSchema))
