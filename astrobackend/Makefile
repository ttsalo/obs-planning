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
	aws ecr describe-repositories --repository-name $(AWS_ASTRO_REPOSITORY) --region $(AWS_REGION) || jq -r .repositories[0] > repository.json
	[ -s repository.json ] || (aws ecr create-repository --repository-name $(AWS_ASTRO_REPOSITORY) --region $(AWS_REGION) | jq -r .repository > repository.json)

delete-repository:
	aws ecr delete-repository --repository-name $(AWS_ASTRO_REPOSITORY) --region $(AWS_REGION) --force

update-reqs:
	(source .astrovenv/bin/activate; pip-compile)

check:
	(source .astrovenv/bin/activate; PYTHONPATH=. pytest)

