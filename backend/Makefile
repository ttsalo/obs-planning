runserver:
	docker build -t obs-planner-server .
	docker run -t -i -p 1323:1323 obs-planner-server

runshell:
	docker run -t -i obs-planner-server bash

# aws ecr create-repository --repository-name hello-repository --region <region>
# docker tag hello-world <repositoryUri>
# aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <aws_account_id>.dkr.ecr.<region>.amazonaws.com
# docker push <aws_account_id>.dkr.ecr.<region>.amazonaws.com/hello-repository
# aws ecr delete-repository --repository-name hello-repository --region <region> --force
