helloworld:
	docker build -t hello-world .
	docker run -t -i -p 8080:80 hello-world

# aws ecr create-repository --repository-name hello-repository --region <region>
# docker tag hello-world <repositoryUri>
# aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <aws_account_id>.dkr.ecr.<region>.amazonaws.com
# docker push <aws_account_id>.dkr.ecr.<region>.amazonaws.com/hello-repository
# aws ecr delete-repository --repository-name hello-repository --region <region> --force
