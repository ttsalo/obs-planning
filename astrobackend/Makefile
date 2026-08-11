include ../defines.mk

AWS_REPOSITORY_URI=`jq -r .repositoryUri repository.json`

build: test
	docker build -t obs-planner-astroserver .
	docker tag obs-planner-astroserver $(AWS_REPOSITORY_URI)

test:
	true

aws-push:
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com
	docker push $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com/obs-planner-astro-repository

runserver: test build
	docker run -t -i -p 8081:8000 obs-planner-astroserver

runshell:
	docker run -t -i obs-planner-astroserver bash

create-repository:
	aws ecr describe-repositories --repository-name $(AWS_ASTRO_REPOSITORY) --region $(AWS_REGION) | jq -r .repositories[0] > repository.json || true
	[ -s repository.json ] || (aws ecr create-repository --repository-name $(AWS_ASTRO_REPOSITORY) --region $(AWS_REGION) | jq -r .repository > repository.json)

delete-repository:
	aws ecr delete-repository --repository-name $(AWS_ASTRO_REPOSITORY) --region $(AWS_REGION) --force

GCP_IMAGE=$(GCP_REGION)-docker.pkg.dev/$(GCP_PROJECT)/$(GCP_REPOSITORY)/obs-planner-astroserver

gcp-build: test
	docker build -t obs-planner-astroserver .

gcp-push:
	gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin $(GCP_REGION)-docker.pkg.dev
	docker tag obs-planner-astroserver $(GCP_IMAGE)
	docker push $(GCP_IMAGE)

# --port 8000 matches gunicorn's default bind (the exec-form CMD does
# not expand $PORT). Memory 2Gi per the documented worker sizing;
# --timeout 120 matches the frontend's axios timeout (gunicorn's own
# --timeout 60 remains the effective per-request cap).
gcp-deploy:
	gcloud run deploy $(GCP_ASTRO_SERVICE) \
	  --image $(GCP_IMAGE) --region $(GCP_REGION) \
	  --allow-unauthenticated --port 8000 \
	  --memory 2Gi --cpu 1 --min-instances 0 --max-instances 2 \
	  --timeout 120

gcp-destroy:
	gcloud run services delete $(GCP_ASTRO_SERVICE) --region $(GCP_REGION) --quiet

update-reqs:
	(source .astrovenv/bin/activate; pip-compile)

check:
	(source .astrovenv/bin/activate; PYTHONPATH=. pytest)

