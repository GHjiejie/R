.PHONY: up down status logs test integration frontend-check
up:
	./scripts/lab.sh up
down:
	./scripts/lab.sh down
status:
	./scripts/lab.sh status
logs:
	./scripts/lab.sh logs
test:
	uv run --project backend pytest backend/tests -m 'not integration'
	uv run --project backend ruff check backend/app backend/tests
integration:
	LAB_INTEGRATION=1 uv run --project backend pytest backend/tests -m integration -v
frontend-check:
	cd frontend && npm ci && npm run build
