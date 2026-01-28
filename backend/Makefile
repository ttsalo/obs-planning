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


