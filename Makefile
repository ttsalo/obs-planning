include defines.mk

build:
	(cd obs-ui && npm run build && cp -a dist/* ../backend/static/)
	make -C backend build

runserver: build
	make -C backend runserver
