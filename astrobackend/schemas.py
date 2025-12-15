from flasgger import Schema, fields
from marshmallow import validate


class GetObjPostSchema(Schema):
    lat = fields.Float(required=True, metadata={
        "description": "Observation point's latitude in degrees"})
    lon = fields.Float(required=True, metadata={
        "description": "Observation point's longitude in degrees"})
    time = fields.DateTime(required=True, metadata={
        "description": "Observation time"})
    target = fields.String(required=True, metadata={
        "description": "Observation target (sun, moon or a planet)"})


class GetObjTSPostSchema(Schema):
    lat = fields.Float(required=True, metadata={
        "description": "Observation point's latitude in degrees"})
    lon = fields.Float(required=True, metadata={
        "description": "Observation point's longitude in degrees"})
    time = fields.DateTime(required=True, metadata={
        "description": "Observation time"})
    target = fields.String(required=True, metadata={
        "description": "Observation target (sun, moon or a planet)"})
    timespan = fields.String(required=True,
                             validate=validate.OneOf(["day"]),
                             metadata={
                                 "description": "Choice of a timespan"})


class GetObjResultSchema(Schema):
    alt = fields.Float(required=True, metadata={
        "description": "Target object's altitude in degrees"})
    az = fields.Float(required=True, metadata={
        "description": "Target object's azimuth in degrees"})
    radius = fields.Float(required=True, metadata={
        "description": "Target object's apparent radius in degrees"})
    

class GetObjTSPointSchema(Schema):
    alt = fields.Float(required=True, metadata={
        "description": "Target object's altitude in degrees"})
    az = fields.Float(required=True, metadata={
        "description": "Target object's azimuth in degrees"})
    sun_alt = fields.Float(required=True, metadata={
        "description": "Sun's altitude at the time of observation (degrees "
        "between sun's upper edge and the horizon)"})
    ts = fields.DateTime(required=True, metadata={
        "description": "Timestamp of the datapoint"})


class GetObjTSResultSchema(Schema):
    series = fields.List(
        fields.Nested(GetObjTSPointSchema))
