# Diopanta LearnHouse release preparation

Status: local preparation only. No VPS or registry changes have been made.

## Source and compatibility target

- Upstream LearnHouse tag: `1.3.6`
- Tag commit: `01c645862451a1d48529fd88e0398176883b15bd`
- Validated optional-reading baseline: `850378222edc6b11972f0a2cbc83154e7e6b830a`
- The Diopanta theme is scoped to the organization slug supplied by
  `NEXT_PUBLIC_DIOPANTA_ORG_SLUG`. It stays disabled until an owner confirms
  the slug. The value is public frontend configuration compiled into the
  web bundle.
- The changes in this branch are frontend and image-build configuration only.
  They add no database columns, backend endpoints, or course-content schema.
  Native TipTap Details content continues to use the existing M7 contract.

The running VPS release and API identity have not been independently read back
from the host. Treat `1.3.6` as the owner-stated target until the deployment
operator records the running image digest and schema revision.

## Local image build and identity

Build only after the application build, test suite, local API/database course
round-trip, and browser review pass. Confirm the target CPU architecture before
building. Use the final full source SHA in both the tag and OCI label:

```sh
source_sha=$(git rev-parse HEAD)
image_tag="ghcr.io/dakarenzi/learnhouse:diopanta-1.3.6-${source_sha}"
oci_file="/private/tmp/learnhouse-diopanta-${source_sha}.oci.tar"
target_platform="SET_AFTER_VERIFYING_VPS_ARCHITECTURE"
org_slug="SET_AFTER_CONFIRMING_DIOPANTA_ORG_SLUG"

docker buildx build \
  --platform "${target_platform}" \
  --build-arg "NEXT_PUBLIC_DIOPANTA_ORG_SLUG=${org_slug}" \
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

The repository Dockerfile still uses version tags for its build-stage base
images. Before calling the build fully reproducible, resolve and pin those
base-image digests for each target platform, then rebuild and record the exact
OCI manifest digest.

## Local integration gate

The expected disposable test is a new local-only course created through the
LearnHouse API and database. It should include ordinary content and a native
TipTap `details` node, then verify editor save, reload, reader rendering,
ordinary-course rendering, keyboard use, and desktop/mobile layout. Keep it in
the synthetic local organization; do not seed or import it on the VPS.

The local API/database stack was not available during this preparation, so
this gate is still open. Docker Desktop is absent, the demo Compose directory
and local demo secrets are absent, and no local API or database process was
listening. No mock or harness is counted as API validation.

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

Not ready for deployment. The frontend changes are locally reviewable, but the
real local API/database course test, actual browser screenshots, OCI build,
base-image digest pinning, and resulting image digest remain outstanding.
