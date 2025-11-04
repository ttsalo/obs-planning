include ../defines.mk

AWS_REPOSITORY_URI=`jq -r .repository.repositoryUri repository.json`

build: test
	docker build -t obs-planner-astroserver .
	docker tag obs-planner-astroserver $(AWS_REPOSITORY_URI)

test:
	true

push:
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com
	docker push $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com/obs-planner-astro-repository

runserver: test build
	docker run -t -i -p 8081:8000 obs-planner-astroserver

runshell:
	docker run -t -i obs-planner-astroserver bash

createrepository:
	aws ecr create-repository --repository-name $(AWS_ASTRO_REPOSITORY) --region $(AWS_REGION) > repository.json

deleterepository:
	aws ecr delete-repository --repository-name $(AWS_ASTRO_REPOSITORY) --region $(AWS_REGION) --force


