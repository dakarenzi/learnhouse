# Diopanta LearnHouse release preparation

Status: local preparation only. No VPS or registry changes have been made.

## Source and compatibility target

- Upstream LearnHouse tag: `1.3.6`
- Tag commit: `01c645862451a1d48529fd88e0398176883b15bd`
- Validated optional-reading baseline: `850378222edc6b11972f0a2cbc83154e7e6b830a`
- The Diopanta theme is scoped to `NEXT_PUBLIC_DIOPANTA_ORG_SLUG=default` for
  the local release candidate. The value is public frontend configuration
  compiled into the web bundle.
- The changes in this branch are frontend and image-build configuration only.
  They add no database columns, backend endpoints, or course-content schema.
  Native TipTap Details content continues to use the existing M7 contract.

The VPS public `/api/v1/instance/info` endpoint reports OSS mode, single
tenancy, and default organization slug `default`. It reports
`frontend_domain=localhost:3000` and `top_domain=localhost`, which the operator
must reconcile with the public hostname. The local API reports SaaS mode and
multi-tenancy, so local runtime behavior does not exactly match the VPS mode.
The endpoint does not reveal the running image digest, architecture, database
schema revision, or media mount.

## Local image build and identity

The monolithic root `Dockerfile` pins its three base-image indexes by digest.
These public registry index digests were resolved on 2026-10-09 and contain
both `linux/amd64` and `linux/arm64` manifests:

- `oven/bun:1.4.0-alpine@sha256:07235578f79ef8c6f97d94aee7938e76f5cdba5f21ae5dbfdd3d3d38058437eb`
- `python:3.14.7-alpine3.24@sha256:9e9fde4d32eedce0b661d9ab91e826b62dddf28e928c230ec55f1866cac66b01`
- `ghcr.io/astral-sh/uv:0.10.7@sha256:edd1fd89f3e5b005814cc8f777610445d7b7e3ed05361f9ddfae67bebfe8456a`

For an OSS image, pass `LEARNHOUSE_PUBLIC=true`; the root Dockerfile applies it
to both the frontend and API stages so the separately licensed EE trees are
removed. Confirm the VPS architecture and complete the local browser and API
round-trip gates before producing a deployable image. Use the final full source
SHA in both the tag and OCI label:

```sh
source_sha=$(git rev-parse HEAD)
image_tag="ghcr.io/dakarenzi/learnhouse:diopanta-1.3.6-${source_sha}"
oci_file="/private/tmp/learnhouse-diopanta-${source_sha}.oci.tar"
target_platform="SET_AFTER_VERIFYING_VPS_ARCHITECTURE"
org_slug="default"

docker buildx build \
  --platform "${target_platform}" \
  --build-arg "NEXT_PUBLIC_DIOPANTA_ORG_SLUG=${org_slug}" \
  --build-arg LEARNHOUSE_PUBLIC=true \
  --label "org.opencontainers.image.revision=${source_sha}" \
  --label "org.opencontainers.image.version=diopanta-1.3.6-${source_sha}" \
  --tag "${image_tag}" \
  --output "type=oci,dest=${oci_file}" \
  .
```

Record the OCI manifest digest from the exported artifact (and the archive
SHA-256 separately) in the release record. Do not call the archive checksum an
image digest. Registry publication is a separate owner-approved action; this
preparation does not push an image.

The build is not fully hermetic or bit-for-bit reproducible yet: it runs
`apk upgrade` against mutable Alpine repositories and installs PM2 without an
exact npm version. The application dependency lockfiles and base-image indexes
are pinned, but those remaining build inputs must be fixed before claiming a
fully reproducible artifact.

## Local integration gate

The local API/database stack is available. The ordinary API save/reopen of the
synthetic M2 Details activity was verified in M8; the M9 read-only database
check still finds one Details node with `attrs.open=true` at activity version
2. It was not edited. The Philosophie course has three activities and table
content; no equation markup was found.

In M9, `/login` and API `/api/v1/health` returned HTTP 200, and the local
frontend served the CSS asset containing the Diopanta selectors. Authenticated
reader/editor appearance and interactions remain unverified because the
authorized browser-control environment denied access. Do not count the earlier
M7 component-harness screenshots as full application evidence. The M9 browser
gate remains open.

## Backup, upgrade, and rollback plan

Before any owner-approved VPS release, record the current app image digest,
source/version, schema revision, Compose/config hashes, and target architecture.
Create a restorable PostgreSQL backup and a paired backup of LearnHouse media
and required configuration. Protect `.env` and credentials separately; do not
copy secrets into the repository or release record. Verify a restore in an
isolated environment before scheduling the release.

This branch contains no intended schema migration. The operator must still
review the exact image's startup behavior and confirm no migration is pending
before switching the running image. Keep the prior image digest and paired
database/media backup available. If rollback is needed, restore the prior image
and restore data only when the application or schema changed it; account for
student activity written after the backup before restoring.

## Future upstream update procedure

1. Choose and record a specific upstream release tag and full source SHA.
2. Rebase or replay the Diopanta-only commits onto that release in a separate
   review branch; do not track a moving `main` or `latest` tag for deployment.
3. Review API, migration, auth/access-control, TipTap schema, Dockerfile, and
   third-party dependency changes.
4. Re-run tests, build, local API course round-trip, keyboard checks, and
   desktop/mobile browser review against the new source.
5. Build a new versioned OCI artifact, pin base image digests, and record its
   full source SHA and image digest before deployment review.

## Licensing review checklist

- Review the exact LearnHouse `LICENSE` at the selected source SHA; the current
  repository identifies the upstream code as AGPL-3.0.
- Review obligations for modifying, distributing, and operating the derived
  application as a network service with qualified legal advice.
- Preserve upstream copyright and license notices; track original Diopanta
  changes and third-party libraries/assets separately.
- Confirm that the release contains no private Enterprise Edition code unless
  separately licensed for that use.
- Record the source corresponding to the built image and a process for making
  it available when required by the applicable license.

## Current release gate

Not ready for deployment. See `M9_RELEASE_RUNBOOK.md` for final local
validation, VPS metadata gaps, owner-assisted checks, deployment steps, and
rollback instructions. The Docker base images are pinned, but no OCI image was
built or published and no image digest exists yet.
