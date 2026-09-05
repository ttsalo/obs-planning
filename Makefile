include defines.mk

COMPOSE_DEV=docker compose -f compose.yaml -f compose.dev.yaml

build:
	(cd obs-ui && npm run build && mkdir -p ../backend/static/ && \
	cp -a dist/* ../backend/static/ && \
	cp -a src/assets/favicon.ico ../backend/static/)
	docker compose build

check:
	make -C obs-ui check
	make -C backend check
	make -C astrobackend check

runserver: build
	docker compose up

# Live-reload development stack (compose.dev.yaml): the UI is served by
# a Vite dev server with HMR at http://localhost:5173/, Go sources are
# synced into the backend container and restart it, and Python sources
# reload in gunicorn. Needs OBS_DB_PASSWORD exported, like runserver.
# Ctrl-C stops the stack; no rebuild/restart cycle for code changes.
dev:
	$(COMPOSE_DEV) up --build --watch

# Ctrl-C already stops `make dev`; this also removes the containers.
dev-down:
	$(COMPOSE_DEV) down

aws-push:
	make -C backend create-repository build aws-push
	make -C astrobackend create-repository build aws-push

aws-cleanup:
	make -C backend delete-repository
	make -C astrobackend delete-repository

gcp-push: build
	make -C backend gcp-build gcp-push
	make -C astrobackend gcp-build gcp-push

# Astro first: the backend deploy looks up the astro service URL for
# OBS_ASTRO_URL, so the astro service must exist before the backend
# is (re)deployed.
gcp-deploy:
	make -C astrobackend gcp-deploy
	make -C backend gcp-deploy

gcp-destroy:
	-make -C backend gcp-destroy
	-make -C astrobackend gcp-destroy

# Deletes the Artifact Registry repo (billable storage); symmetric
# with aws-cleanup.
gcp-cleanup:
	gcloud artifacts repositories delete $(GCP_REPOSITORY) --project $(GCP_PROJECT) --location $(GCP_REGION) --quiet

docker-cleanup:
	docker system prune

docker-full-cleanup: docker-cleanup
	docker builder prune -a
