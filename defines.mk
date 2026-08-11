AWS_REGION=eu-north-1
AWS_REPOSITORY=obs-planner-repository
AWS_ASTRO_REPOSITORY=obs-planner-astro-repository
SHELL=bash

GCP_REGION=europe-north1
GCP_REPOSITORY=obs-planner
GCP_BACKEND_SERVICE=obs-backend
GCP_ASTRO_SERVICE=obs-astro
# GCP_PROJECT defaults to the project configured in gcloud
# (`gcloud config set project`); export GCP_PROJECT to override it.
# Recursively expanded, so the gcloud lookup (and the error) only
# happen when a gcp-* target actually references the project — plain
# `make build` and `make check` never pay for it.
ifeq ($(strip $(GCP_PROJECT)),)
GCP_PROJECT = $(or $(shell gcloud config get-value project 2>/dev/null),$(error GCP_PROJECT is not set and gcloud has no default project. Run 'gcloud config set project <project-id>' or export GCP_PROJECT=<project-id>))
endif

# Aiven connection params (OBS_DB_HOST/PORT/USER/NAME) come from a
# gitignored gcp-db.env at the repo root; the path is resolved relative
# to this file so the subproject Makefiles work too.
-include $(dir $(lastword $(MAKEFILE_LIST)))gcp-db.env
