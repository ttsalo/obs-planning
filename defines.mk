AWS_REGION=eu-north-1
AWS_REPOSITORY=obs-planner-repository
AWS_ASTRO_REPOSITORY=obs-planner-astro-repository
SHELL=bash

GCP_REGION=europe-north1
GCP_REPOSITORY=obs-planner
GCP_BACKEND_SERVICE=obs-backend
GCP_ASTRO_SERVICE=obs-astro
# GCP_PROJECT comes from the environment (symmetric with AWS_ACCOUNT_ID).
# Aiven connection params (OBS_DB_HOST/PORT/USER/NAME) come from a
# gitignored gcp-db.env at the repo root; the path is resolved relative
# to this file so the subproject Makefiles work too.
-include $(dir $(lastword $(MAKEFILE_LIST)))gcp-db.env
