# M9 release candidate and deployment runbook

Status as of 2026-10-09: **not ready to deploy**. No VPS setting, database,
course, image, or registry was changed. No image was built or published.

## Final local evidence

- Source authority before this preparation: `fde2f43566b8a6d644d721701781aafdb40f42a3`.
- Local frontend `/login`: HTTP 200; API `/api/v1/health`: HTTP 200.
- The frontend's same-origin `/api/v1/health` proxy also returns HTTP 200 and
  its runtime config points to the existing local API on port 1348. An
  unauthenticated direct GET of the organization courses route returns 404;
  this was not treated as authenticated course validation.
- The running standalone frontend serves the Diopanta CSS bundle with the
  `diopanta` marker. This verifies the asset is present and served; it does not
  prove an authenticated lesson rendered it.
- The local production build refreshed `.next/standalone` without copying
  `.next/static` or retaining `runtime-config.json`. The static assets were
  restored and the frontend was restarted through `server-wrapper.js` with the
  saved public settings; future local standalone rebuilds need the same step.
- `bun run test`: 269 passed, 0 failed. The Details cases cover keyboard
  activation, accessible button state, closed-by-default insertion, and JSON
  save/reopen behavior.
- `NEXT_PUBLIC_DIOPANTA_ORG_SLUG=default bun run build`: production compile,
  TypeScript, and all 33 static pages completed. Next emitted four existing
  dynamic-filesystem tracing warnings in Sentry/runtime-config code; these
  warnings can cause the whole project to be traced into standalone output.
- `docker buildx build --check` with the OSS and `default` organization build
  args completed with no warnings. It checked the Dockerfile without building
  an image.
- The actual local synthetic M2 activity is still at `current_version=2` and
  has one native Details node with `attrs.open=true`. The check was read-only;
  its saved content was not changed.
- The local Philosophie course has three activities and table content. No
  mathematical equation markup was found in those activities.
- The local API metadata, reached through the frontend proxy, reports
  `default_org_slug=default`, `mode=saas`, `tenancy=multi`, and
  `multi_org_enabled=true`; its configured frontend domain is `lvh.me:3010`.
  This confirms the local frontend is connected to the existing local API,
  but the local tenancy mode differs from the VPS target.
- The VPS public LearnHouse metadata endpoint reports `default_org_slug=default`,
  `mode=oss`, `tenancy=single`, and `multi_org_enabled=false`. It also reports
  `frontend_domain=localhost:3000` and `top_domain=localhost`, which conflicts
  with the public `https://learnhouse.orbanti.com` hostname. The operator must
  confirm the intended runtime environment before deployment.
- The public endpoint does not disclose the VPS image/tag/digest, CPU
  architecture, PostgreSQL version/schema revision, container mounts, or media
  storage backend. No SSH host or authorized remote inspection session was
  supplied, and no SSH access was attempted.
- Browser automation was denied with `privileged native pipe bridge is not
  available; browser-client is not trusted`. No alternate browser-control path
  was used. Current authenticated reader/editor screenshots, responsive
  rendering, ToC interaction, and assistive-technology behavior are unverified.

Historical screenshots in the M7 validation folder show the local component
harness and are not current full-application evidence.

## Image inputs and outstanding build work

The monolithic root Dockerfile pins the Bun, Python, and uv multi-platform
indexes by digest. The indexes provide `linux/amd64` and `linux/arm64`; the
VPS architecture remains unknown. `LEARNHOUSE_PUBLIC=true` removes the EE
folders from both frontend and API stages. Set
`NEXT_PUBLIC_DIOPANTA_ORG_SLUG=default` for this deployment candidate.

No OCI image or digest exists yet. The local Docker host is `linux/arm64` with
about 13 GiB free on its backing filesystem; Docker reports 80.9 GB of images
and 18.7 GB of build cache. Do not prune existing images/cache or start a
multi-platform build until there is sufficient free space and a verified
target platform. Base-image digest pins alone do not make the build fully
hermetic: `apk upgrade` uses mutable Alpine repositories and PM2 is installed
without an exact npm version.

The branch has no API or collab source changes and introduces no schema or
course-content migration. `docker/start.sh` starts the web, API, collab, and
nginx services; it does not invoke the migration script. This does not establish
the live database's current schema revision.

## Owner-assisted checks before producing the release image

1. In the VPS deployment project, record the running app image reference,
   immutable image ID/digest, CPU architecture, Compose/config revision, and
   container restart policy. Redact all environment values except public
   non-secret settings; never attach `.env` or credential output.
2. Confirm whether `frontend_domain=localhost:3000` is intentional and verify
   the configured frontend/API public origins, cookie domain, and CORS origin.
3. Record PostgreSQL major version and schema/migration head, Redis version,
   and media mount type/path. Confirm these are compatible with the exact
   LearnHouse 1.3.6 source tag.
4. Review the AGPL-3.0 obligations and confirm the public build contains no EE
   source that is not separately licensed. Retain notices and the corresponding
   source for the deployed commit.
5. Complete the normal Brave checks listed below. Then build for the verified
   architecture and record the final source SHA, OCI image digest, and archive
   SHA-256 separately. Keep the image local until publication is authorized.

## Deployment runbook for a later owner-approved change

### 1. Backup and freeze the inputs

- Record the current image digest, runtime architecture, Compose/config hashes,
  public URL settings, PostgreSQL schema head, Redis configuration, and media
  mount metadata. Keep secrets in the existing secure configuration store.
- Create a transaction-consistent PostgreSQL backup using the existing
  deployment's database service and credentials. Back up the LearnHouse media
  store and required configuration as a matched set.
- Restore both backups into an isolated environment and verify course media and
  account/course metadata before scheduling the change.
- Preserve the current image digest and do not alter database, Redis, or media
  volumes during the app image switch.

### 2. Load and deploy the reviewed image

- Use only the locally verified image built from the recorded source SHA and
  pinned base indexes. Verify the OCI image digest before loading it on the
  VPS. Do not deploy a mutable `latest` tag.
- Change only the LearnHouse app image reference in the existing deployment
  configuration. Preserve its current environment, published ports, health
  checks, network, database/Redis services, and media mounts.
- Start the app services without invoking a migration command. If the operator
  identifies a required schema migration, stop and review it separately before
  switching images.

### 3. Health and smoke checks

- Confirm the frontend responds on the public hostname and
  `/api/v1/health` returns HTTP 200.
- Sign in with an existing authorized account through the normal browser flow.
- Read the existing Philosophie course and verify its lesson navigation,
  tables, typography, sidebar contrast, and mobile layout. Do not save or edit
  any existing VPS activity during the smoke test.
- Verify ordinary non-Details lessons render unchanged. If an existing course
  already contains a Details node, verify its stored open/closed state without
  saving it. Do not create a test activity on the VPS.
- Confirm no migration ran and that existing publication, roles, entitlements,
  media, and course access remain intact.

### 4. Rollback

- If health, login, access control, lesson rendering, or media checks fail,
  restore the previous immutable app image digest and the prior app-only
  configuration. Keep the existing database, Redis, and media volumes intact.
- Do not restore the database backup as a routine image rollback. Restore data
  only under a separate recovery decision after accounting for learner writes
  made since the backup.
- Recheck health, login, course access, and media after rollback.

## Future upstream updates

For every LearnHouse update, pin an upstream release tag and full commit SHA;
rebase the Diopanta-only commits on a review branch; inspect changes to
authorization, migrations, TipTap schema, Dockerfiles, and dependencies; repeat
local API persistence, browser, keyboard, mobile, and ordinary-lesson checks;
then build and record a new versioned OCI image. Keep the prior source SHA,
image digest, and matching data/media backup available until the new release is
accepted.

## Required normal-browser checks

Using the owner's normal Brave session, capture fresh desktop and mobile
screenshots of the authenticated M2 reader and editor. Confirm Details opens
and closes with pointer and keyboard, inspect `aria-expanded` and focus order,
click a ToC heading nested under a collapsed Details node and confirm its
ancestors open before navigation, then open a Philosophie lesson to review its
tables and typography. Leave the existing M2 activity at `attrs.open=true`;
do not save content changes during these visual checks.
