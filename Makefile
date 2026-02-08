include defines.mk

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

aws-push:
	make -C backend create-repository build aws-push
	make -C astrobackend create-repository build aws-push

aws-cleanup:
	make -C backend delete-repository
	make -C astrobackend delete-repository

docker-cleanup:
	docker system prune
