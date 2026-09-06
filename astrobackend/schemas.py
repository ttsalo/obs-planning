from datetime import timedelta, timezone

from flasgger import Schema, fields
from marshmallow import validate, validates_schema, ValidationError


SET_KINDS = ["planets", "messier", "double_stars", "names"]
VISIBILITIES = ["window", "horizon", "none"]
BRIGHTNESSES = ["N", "AT", "NT", "CT", "D"]

# Sizing limits shared with the Go server and the frontend.
MAX_CANDIDATES = 2000
MAX_WINDOWS = 31


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
        "description": "Observation target (sun, moon or a planet), or a "
        "label when ra and dec are given"})
    ra = fields.Float(required=False, allow_none=True,
                      validate=validate.Range(0, 360), metadata={
        "description": "Right ascension in degrees of a fixed target; "
        "with dec, makes target a label only"})
    dec = fields.Float(required=False, allow_none=True,
                       validate=validate.Range(-90, 90), metadata={
        "description": "Declination in degrees of a fixed target"})
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
    illumination = fields.Float(required=False, metadata={
        "description": "Fraction of the disc illuminated, 0..1 "
        "(moon target only)"})
    waxing = fields.Boolean(required=False, metadata={
        "description": "True if the moon is waxing (moon target only)"})
    bright_limb_angle = fields.Float(required=False, metadata={
        "description": "Bearing from the moon toward the sun in the "
        "observer's alt/az frame, degrees clockwise from zenith-up, "
        "0..360 (moon target only)"})


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


# --- Target searches --------------------------------------------------------

class TargetSetSchema(Schema):
    kind = fields.String(required=True, validate=validate.OneOf(SET_KINDS),
                         metadata={"description": "Which objects to resolve"})
    max_magnitude = fields.Float(required=False, allow_none=True,
                                 validate=validate.Range(-30, 30), metadata={
        "description": "Keep objects at or brighter than this visual "
        "magnitude (required for double_stars, optional for messier)"})
    names = fields.List(fields.String(), required=False, load_default=list,
                        metadata={"description": "Object names for the "
                                  "names kind"})


class ResolveTargetsPostSchema(Schema):
    set = fields.Nested(TargetSetSchema, required=True)


class CandidateSchema(Schema):
    name = fields.String(required=True)
    ss_obj = fields.Boolean(required=True, metadata={
        "description": "True for a solar-system body computed by name"})
    ra = fields.Float(allow_none=True, validate=validate.Range(0, 360),
                      metadata={"description": "Degrees; fixed objects only"})
    dec = fields.Float(allow_none=True, validate=validate.Range(-90, 90),
                       metadata={"description": "Degrees; fixed objects only"})
    magnitude = fields.Float(allow_none=True)
    object_type = fields.String(allow_none=True)


class ResolveTargetsResultSchema(Schema):
    candidates = fields.List(fields.Nested(CandidateSchema))
    count = fields.Integer()
    unresolved = fields.List(fields.String(), metadata={
        "description": "Names the catalog did not know"})


class FilterCandidateSchema(Schema):
    name = fields.String(required=True)
    ss_obj = fields.Boolean(required=True)
    ra = fields.Float(allow_none=True, validate=validate.Range(0, 360))
    dec = fields.Float(allow_none=True, validate=validate.Range(-90, 90))


class ObsWindowSchema(Schema):
    # The azimuth limits may come in either order: a maximum below the
    # minimum is a window wrapping through north, not an error.
    min_az = fields.Float(required=True, validate=validate.Range(0, 360))
    max_az = fields.Float(required=True, validate=validate.Range(0, 360))
    min_alt = fields.Float(required=True, validate=validate.Range(-90, 90))
    max_alt = fields.Float(required=True, validate=validate.Range(-90, 90))

    @validates_schema
    def check_altitude_order(self, data, **kwargs):
        if data["min_alt"] > data["max_alt"]:
            raise ValidationError("must not be below min_alt", "max_alt")


def as_utc(dt):
    """Naive UTC datetime for astropy; a naive input is taken as UTC."""
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


class TimeWindowSchema(Schema):
    start = fields.DateTime(required=True)
    end = fields.DateTime(required=True)

    @validates_schema
    def check_order(self, data, **kwargs):
        start, end = as_utc(data["start"]), as_utc(data["end"])
        if end <= start:
            raise ValidationError("must be after start", "end")
        if end - start > timedelta(hours=24):
            raise ValidationError("a window can be at most 24 hours", "end")


class FilterTargetsPostSchema(Schema):
    candidates = fields.List(fields.Nested(FilterCandidateSchema),
                             required=True,
                             validate=validate.Length(max=MAX_CANDIDATES))
    lat = fields.Float(required=True)
    lon = fields.Float(required=True)
    obs_window = fields.Nested(ObsWindowSchema, required=False,
                               allow_none=True, metadata={
        "description": "The position's alt/az window; needed for "
        "visibility 'window'"})
    windows = fields.List(fields.Nested(TimeWindowSchema), required=True,
                          validate=validate.Length(max=MAX_WINDOWS),
                          metadata={"description": "UTC observing windows, "
                                    "sampled every 30 minutes"})
    visibility = fields.String(required=True,
                               validate=validate.OneOf(VISIBILITIES))
    max_brightness = fields.String(required=True,
                                   validate=validate.OneOf(BRIGHTNESSES))


class FilterTargetsResultSchema(Schema):
    matched = fields.List(fields.Boolean(), metadata={
        "description": "One flag per candidate, in request order"})
    count = fields.Integer()


class GetObjsTargetSchema(Schema):
    name = fields.String(required=True)
    ss_obj = fields.Boolean(required=True)
    ra = fields.Float(allow_none=True, validate=validate.Range(0, 360))
    dec = fields.Float(allow_none=True, validate=validate.Range(-90, 90))


class GetObjsPostSchema(Schema):
    lat = fields.Float(required=True)
    lon = fields.Float(required=True)
    time = fields.DateTime(required=True)
    targets = fields.List(fields.Nested(GetObjsTargetSchema), required=True,
                          validate=validate.Length(max=MAX_CANDIDATES))


class GetObjsResultItemSchema(Schema):
    name = fields.String(required=True)
    alt = fields.Float(required=True)
    az = fields.Float(required=True)
    radius = fields.Float(required=False, metadata={
        "description": "Apparent radius in degrees (solar-system bodies)"})
    illumination = fields.Float(required=False)
    waxing = fields.Boolean(required=False)
    bright_limb_angle = fields.Float(required=False)


class GetObjsResultSchema(Schema):
    results = fields.List(fields.Nested(GetObjsResultItemSchema), metadata={
        "description": "In request order"})
