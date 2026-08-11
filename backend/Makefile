include ../defines.mk

AWS_REPOSITORY_URI=`jq -r .repositoryUri repository.json`

build:
	docker build -t obs-planner-server .
	docker tag obs-planner-server $(AWS_REPOSITORY_URI)

check:
	go test -v

aws-push:
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com
	docker push $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com/obs-planner-repository

runserver: test build
	docker run -t -i -p 8080:80 obs-planner-server

runshell:
	docker run -t -i obs-planner-server bash

create-repository:
	aws ecr describe-repositories --repository-name $(AWS_REPOSITORY) --region $(AWS_REGION) | jq -r .repositories[0] > repository.json || true
	[ -s repository.json ] || (aws ecr create-repository --repository-name $(AWS_REPOSITORY) --region $(AWS_REGION) | jq -r .repository > repository.json)

delete-repository:
	aws ecr delete-repository --repository-name $(AWS_REPOSITORY) --region $(AWS_REGION) --force

GCP_IMAGE=$(GCP_REGION)-docker.pkg.dev/$(GCP_PROJECT)/$(GCP_REPOSITORY)/obs-planner-server

gcp-build:
	docker build -t obs-planner-server .

gcp-push:
	gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin $(GCP_REGION)-docker.pkg.dev
	docker tag obs-planner-server $(GCP_IMAGE)
	docker push $(GCP_IMAGE)

# The astro service URL is looked up at deploy time so OBS_ASTRO_URL
# always points at the current astro service; the root gcp-deploy
# deploys astro first so this works on the very first deployment too.
gcp-deploy:
	gcloud run deploy $(GCP_BACKEND_SERVICE) \
	  --image $(GCP_IMAGE) --region $(GCP_REGION) \
	  --allow-unauthenticated --port 80 \
	  --memory 1Gi --cpu 1 --min-instances 0 --max-instances 2 \
	  --set-env-vars "OBS_ASTRO_URL=$$(gcloud run services describe $(GCP_ASTRO_SERVICE) --region $(GCP_REGION) --format 'value(status.url)'),OBS_DB_HOST=$(OBS_DB_HOST),OBS_DB_PORT=$(OBS_DB_PORT),OBS_DB_USER=$(OBS_DB_USER),OBS_DB_NAME=$(OBS_DB_NAME),OBS_DB_SSLMODE=require,OBS_WAIT_DB=1" \
	  --set-secrets "OBS_DB_PASSWORD=obs-db-password:latest"

gcp-destroy:
	gcloud run services delete $(GCP_BACKEND_SERVICE) --region $(GCP_REGION) --quiet


