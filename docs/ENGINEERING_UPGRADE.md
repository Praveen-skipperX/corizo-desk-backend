# Corizo Desk engineering upgrade

Release candidate, 15 October 2026. Coordinate release with the frontend's `security-performance-upgrade` branch. Production deployment and external integration changes have not been performed.

## Verified findings and fixes

- **Critical — refresh-token replay:** `authController.js` accepted refresh JWTs even when their persisted token record was absent. Refresh now requires a live session and atomically consumes the unexpired MongoDB token record. Locked accounts cannot refresh. Tests cover replay, revocation and simultaneous consumption.
- **High — revoked sessions across serverless instances:** instance-local memory could retain a remotely revoked session. Without hosted Redis, MongoDB is now authoritative; sliding expiration cannot upsert a deleted session.
- **High — authorization overrides:** employee lead filters could replace assignment constraints, and audit `userId` could replace ownership. Mandatory scopes are now conjoined. Employee exports and reassignment follow the documented RBAC matrix. Empty, disabled and `none` grants no longer regain default permissions. Assignment payloads receive server-side checks.
- **High — replacement import data loss:** full replacement deleted prior leads before successful writes. Retirement now occurs only after complete, nonempty, valid processing; recently synchronized and newly created leads remain active. Partial validation failures are counted. Expired/consumed previews cannot replay; durable connector leases reject overlapping imports. Integration tests exercise failed and successful replacement against isolated MongoDB.
- **High — cross-origin handling:** Vercel bootstrap accepted arbitrary Vercel origins and reflected origins on failures. Bootstrap and Express now use the explicit allowlist; mutation origins are checked. Production defaults exclude localhost. API responses are private/no-store.
- **Medium — injection and resource limits:** structured/operator query parameters, unsafe sort fields, invalid pagination and reversed date ranges are rejected. Regex searches are escaped. Exports are limited to 5,000 records with a clear error; previews fetch three sample rows rather than every record. Expensive export/report requests are rate-limited.
- **Medium — CSV and disclosure:** CSV formula prefixes and quotes are escaped. Unexpected errors return generic messages with request IDs; audit payloads redact credentials. Request logging omits query strings. OTPs use cryptographic randomness.

## Loading and database performance

The original dashboard cache miss issued 19 operations, including repeated counts of the same status groups. The final implementation reuses grouped counts and combines date, course, follow-up and trend calculations: at most 10 operations, eight against leads. Definitions retain sheet-date fallback, IST boundaries, existing open/closed statuses and conversion calculations.

`scripts/benchmarkDashboard.mjs` reproduces the original lead-query workload and the final workload on 10,000 synthetic records in an isolated MongoDB instance, with a five-connection pool and 30 paired warm samples. Both workloads use the current declared indexes. This is not production API latency or a browser measurement. Nine tested metric values matched.

- Lead operations: 17 to 8.
- Median workload duration: 310.00 ms to 283.61 ms.
- p95 workload duration: 348.48 ms to 303.38 ms.

See `dashboard-benchmark.json`. An initial single-facet implementation measured slower and was replaced before delivery.

Follow-up dashboard paging/search now happens on the server and preserves priority ordering. Lead pagination has stable sorting, bounded limits and lean reads. New compound indexes cover active records with department, assignment, creator, connector and follow-up predicates. Actual production query plans still require verification.

## Changed modules and validation

Changes cover authentication/session services, RBAC, lead/dashboard/follow-up controllers, Sheets imports, export/report handlers, validation, error handling, audit logging, schema indexes, Vercel bootstrap, dependency locks, CI and regression tests. `CHANGED_FILES.txt` lists the committed paths.

Validated before push: backend unit/API tests, frontend client tests, frontend production build and both lint commands. API tests use disposable MongoDB and synthetic data, with production service configuration explicitly overridden. No production records are used. The workbook round-trip also verifies the ExcelJS UUID override.

Production dependency audits reached zero advisories in both repositories. Development-only advisories remain; backend Jest was upgraded and Nodemon replaced with Node's built-in watcher. Frontend compiler-adoption diagnostics are warnings because React Compiler is not enabled; hook correctness and ordinary JavaScript errors remain blocking. This is not a claim that all warnings or all development advisories are resolved.

## Release requirements and remaining verification

1. Use Node 22 and `npm ci` in each repository. CI now gates lint, tests, build where applicable and production dependency audit.
2. Configure separate preview MongoDB, Redis, JWT secrets, email and Sheets identities. Only after verifying isolation, set preview `PREVIEW_DATA_ISOLATED=true`; otherwise the API refuses preview traffic before connecting to MongoDB. Add the exact preview frontend origin to `FRONTEND_URLS`.
3. Review index definitions and existing TTL indexes. Build declared indexes against the intended preview database with `node scripts/createIndexes.mjs --confirm-index-build`. Production auto-indexing is disabled. Provision approved production indexes separately; no destructive schema/data migration is included.
4. Deploy backend and frontend previews together. Verify all roles, MFA, password setup, login/logout, remote session revocation, lead creation/edit/delete, assignments, enrollment, follow-up scheduling/completion, exports, users, courses and settings. Confirm sensitive requests return private/no-store headers.
5. Test real Sheets permissions, non-first header rows, worksheet apostrophes, failures/timeouts, cancellation, retries, overlapping syncs and replacement recovery against a disposable sheet. Google API calls have bounded timeouts/retries. No live Google account call was made during this work.
6. Measure authenticated LCP, INP, CLS, navigation, HTTP p50/p95 and database explain plans using representative preview data. Only login rendering was visually checked locally at desktop and 375-pixel mobile width. Authenticated visual/browser coverage, production logs and external monitoring remain unverified.
7. Use hosted Redis for shared production rate limits and job queues; the memory fallback is not a distributed rate limiter. Bulk imports and cross-collection lead/enrollment writes are not fully transactional. The existing Excel import queue's serverless temporary-file lifecycle still needs deployment-specific verification. Large summary endpoints and duplicate-index construction merit further profiling.
8. Promote only after preview checks pass; retain the previous deployment for rollback. Do not change production DNS, credentials or data as part of an unverified rollout.

Source scans found no high-confidence embedded private-key/AWS/GitHub-token patterns in inspected code. Ignored local environment and bootstrap-credential files exist and are excluded from commits. Their historical exposure has not been established. If history review finds them committed or shared, revoke the affected bootstrap credentials and rotate the database, JWT, Redis, email and Google credentials that were exposed; never paste values into an issue or log.
