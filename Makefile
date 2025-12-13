include defines.mk

build:
	(cd obs-ui && npm run build && cp -a dist/* ../backend/static/ && \
	cp -a src/assets/favicon.ico ../backend/static/)
	docker compose build

check:
	make -C obs-ui check
	make -C backend check
	make -C astrobackend check

runserver: build
	docker compose up

cleanup:
	docker system prune
