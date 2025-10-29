include ../defines.mk

AWS_REPOSITORY_URI=`jq -r .repository.repositoryUri repository.json`

build: test
	docker build -t obs-planner-server .
	docker tag obs-planner-server $(AWS_REPOSITORY_URI)

test:
	go test

push:
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com
	docker push $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com/obs-planner-repository

runserver: test build
	docker run -t -i -p 8080:80 obs-planner-server

runshell:
	docker run -t -i obs-planner-server bash

createrepository:
	aws ecr create-repository --repository-name $(AWS_REPOSITORY) --region $(AWS_REGION) > repository.json

deleterepository:
	aws ecr delete-repository --repository-name $(AWS_REPOSITORY) --region $(AWS_REGION) --force


