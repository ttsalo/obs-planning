# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Graphical astronomical observations planner. Three-tier app: React frontend, Go API + static server, Python (astropy) astronomy calculation server, PostgreSQL database. Runs via `docker compose` locally, deploys to AWS ECS Fargate via CDK.

## Common commands

All top-level commands are Make targets in the root `Makefile`; each subproject has its own `Makefile` (`obs-ui`, `backend`, `astrobackend`) that the root delegates to.

- `make build` — build the React app, copy `obs-ui/dist/*` and the favicon to `backend/static/`, then `docker compose build` all images. The Go server serves the frontend as static files, so this UI copy step is required whenever frontend code changes.
- `make check` — run all three test suites sequentially: UI (`npm run build`, lint is currently commented out), Go (`go test -v`), Python (`pytest` inside `.astrovenv`).
- `make runserver` — `make build` then `docker compose up`. Requires `OBS_DB_PASSWORD` to be exported. Local dev cycle is Ctrl-C then re-run.
- `make aws-push` / `make aws-cleanup` — create/delete ECR repos for both backends, build & tag images, push. Writes `backend/repository.json` and `astrobackend/repository.json` (gitignored); the CDK stack reads these files at synth time, so `aws-push` must run before `cdk synth`.
- `make docker-cleanup` — `docker system prune`.

Running a single test:
- Go: `cd backend && go test -v -run TestPositions`
- Python: `cd astrobackend && source .astrovenv/bin/activate && PYTHONPATH=. pytest tests/test_api.py::test_get_obj`

The Python venv (`astrobackend/.astrovenv`) must be created manually once via `python3 -m venv .astrovenv && source .astrovenv/bin/activate && pip install -r requirements.txt` before `make check` will work. Docker builds set up their own venv.

Ports: 8080 = Go backend + frontend, 8081 = Python astrobackend. Both are exposed directly to the browser (the Go server does not proxy astronomy calls).

## Architecture

### Two-server split
The frontend talks to two separate origins from the browser:
- `/api/*` and `/login` on the same host (Go / Echo) — session, auth, DB-backed positions and searches.
- `//<host>:8081/api/*` (Python / Flask + astropy) — astronomy calculations (`/api/get-obj`, `/api/get-obj-timeseries`). Because these are cross-origin, `astrobackend/server.py` adds CORS headers in `after_request` and handles preflight `OPTIONS` in `before_request`.

The split exists so heavy astropy work doesn't block the primary server and the two can scale independently. In AWS, both run behind a single ALB on different listener ports (80 and 8081), configured in `obs_ecs/obs_ecs/obs_ecs_stack.py`.

### Auth and session
- `POST /login` (unauthenticated) returns a JWT signed with the hard-coded HMAC secret `"secret"` in `backend/api.go`. The token payload is just `{username}`.
- Everything under `/api` is wrapped by `echojwt.JWT` middleware in `backend/server.go`. Per-user filtering is done by looking up the username from JWT claims (`UsernameFromJWT` in `server.go`) and using it to scope DB queries in `api.go`.
- A separate `obs-session` cookie holds `{username, position, search}` as base64-encoded JSON. It's opaque to the frontend: the client reads/writes via `GET/POST /api/get-session` / `/api/update-session`. The server validates that the cookie's username matches the JWT and rebuilds a fresh cookie otherwise. This is the mechanism by which the currently-selected position and search persist across page loads.

### Startup ordering (Go server)
`backend/server.go`'s `main` deliberately decouples HTTP-listener startup from DB readiness:
1. Echo starts in a goroutine so `/health` and static file serving come up immediately.
2. `ConnectDB` runs in another goroutine and reports success or failure via a channel.
3. A 60-second ticker retries DB connection up to 3 times if the DB was slow to start (Postgres reports "system is starting up" as fatal in the driver).
4. `RegisterDBEndpoints` (in `backend/api.go`) is only called once the DB channel yields a non-nil handle — so `/api/positions` etc. simply don't exist until DB is ready. `/health` reflects DB status via the exported `DB_err`.

### Database model (`backend/db.go`)
GORM AutoMigrate runs each startup. Models: `User`, `Position`, `TargetSearch`, `TargetObject`. `TargetSearch` ↔ `TargetObject` is many-to-many via the `search_results` join table. Solar-system objects have `SSObj=true` and are looked up by name; `RA`/`Dec` fields are only meaningful for non-solar-system targets (not yet used).

`InitTestData` seeds a `testuser` (password `aero123`), a `Helsinki` position (60.17, 24.94), and a `Planets` search containing Mercury, Venus, Moon, Mars, Jupiter, Saturn, Uranus, Neptune. This is idempotent and runs on every startup — treat it as the way to bootstrap the demo data, not as migration logic.

### Go tests
`backend/server_test.go` uses in-memory SQLite (`glebarez/sqlite`) via GORM and injects a stub `testUsernameFromJWT` into `Handler` so tests don't need a real JWT. Any new endpoint that reads the username must take it from `h.UsernameFromJWT`, not call `UsernameFromJWT` directly, so the tests can substitute it.

### Frontend structure (`obs-ui/src/`)
- `main.jsx` — wraps `App` in `QueryClientProvider` (TanStack React Query) and `LoginPage` (auth gate).
- `login.jsx` — first calls `GET /api/get-session`; if it succeeds the user is already logged in. Otherwise renders the login form, `POST /login`, stashes the JWT in `axios.defaults.headers.common['Authorization']`.
- `session.jsx` — defines `SessionContext` (server-persisted `{username, position, search}`) and `StageContext` (transient rendering parameters: dimensions, scale, `azToPx`/`altToPx` mappers, `renderts`). `updateSession` posts to `/api/update-session` and mirrors the response back into the local state.
- `App.jsx` — top-level layout, container-resize handling, DatePicker/TimePicker for target time. The Konva `Stage` is a fixed 1000×500 virtual scene scaled to container width; alt/az → pixel mapping is set up in `updateSize` and stored as closures on the `stageMap`.
- `obs.jsx` — the sky rendering. `ObsStage` queries `/api/positions` and `/api/searches`, picks the ones matching the session, and renders one `Target` + one `TargetPath` per object plus the Sun. The Sun path/marker is drawn last so its illumination labels sit on top.

### Sky path rendering (`obs.jsx:TargetPath`)
Non-obvious pieces to preserve when editing:
- The 24-hour timeseries from the astrobackend is chopped into segments on two independent axes: brightness transitions (day → civil → nautical → astronomical twilight → night, keyed off `sun_alt`) and continuity breaks (azimuth wrap at 0/360°, and entering/leaving the observation window defined by the position's `min_alt/max_alt/min_az/max_az`). Sun paths are exempt from the observability check.
- `interpolateTransition` computes the exact fractional position along a segment where sun-altitude crosses one of the brightness thresholds, so the color break in the drawn path lands on the mathematically correct point rather than at a sample boundary.
- The React Query key `['targetPathData', target, Math.floor(renderTS / 1000 / 60 / 30)]` bins to 30-minute granularity — the per-minute `renderts` tick in `App.jsx` refreshes `Target` marker positions but does not re-fetch the day-long path.

### CDK deployment (`obs_ecs/`)
Single stack: VPC, ECS cluster, two Fargate task definitions. Postgres is external — a pre-provisioned Aiven Postgres service whose connection details (host, port, user, password, dbname) live in an AWS Secrets Manager secret named `obs-planning/aiven-pg`. The stack looks the secret up by name (`secretsmanager.Secret.from_secret_name_v2`) and injects each JSON field into the Go container as an ECS secret; `OBS_DB_SSLMODE=require` is set as a plain env var. The Fargate tasks reach Aiven over the internet via the VPC's NAT egress — no security-group rule is needed (unlike the old RDS setup, which required `db_instance.connections.allow_default_port_from(serv1.service)`). The Go service is created via `ApplicationLoadBalancedFargateService` (owns the ALB); the astro service is a plain `FargateService` attached to the same ALB via a second listener on port 8081. The astro container doesn't need DB access. Health checks: `/health` on port 80 for backend, port 8000 for astrobackend (note: astrobackend runs on 8000 inside the container, 8081 externally).

Both `backend/repository.json` and `astrobackend/repository.json` must exist (created by `make aws-push` or `make -C {backend,astrobackend} create-repository`) before running `cdk synth` — the stack reads them to resolve the ECR repository ARNs. The `obs-planning/aiven-pg` secret must also exist before `cdk deploy`; see the README for the `aws secretsmanager create-secret` command.

## Conventions

- Editor backup files (`*~`) are `.gitignore`d but visible in `ls`; ignore them.
- Version bumps live in the top-level `VERSION` file and are mirrored in the README's Versions section.
- Environment variables the code reads: `OBS_DB_HOST`, `OBS_DB_USER`, `OBS_DB_PASSWORD`, `OBS_DB_NAME`, `OBS_DB_PORT`, `OBS_DB_SSLMODE` (Go server; the SSL mode defaults to `disable` locally and is set to `require` in the CDK stack for Aiven); `OBS_SERVER_PORT` (optional override, defaults to 80).
- Container stdout/stderr in AWS is captured to CloudWatch under stream prefixes `obs-backend` (Go) and `obs-astro` (Python) with 14-day retention. Tail live: `aws logs tail /aws/ecs/<generated-name> --follow --since 5m --region eu-north-1`; find the exact log-group name in `cdk synth` output or the ECS console. The astro server has a global Flask `@app.errorhandler(Exception)` that emits `unhandled-exception id=<8-hex> path=... json=... traceback=...`, plus a targeted `astro-timeseries-fail target=... lat=... lon=... time=...` line for `/api/get-obj-timeseries`; grep for those prefixes when a 500 needs diagnosing.
