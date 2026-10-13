# M22.41 — Same-origin protected course media

Agent B. Local, uncommitted repair based on
`f475b03607fd7939ea5e47a37d8dd051675c9c2f`.

## Problem and behavior

In single tenancy the frontend auth proxy writes host-only HTTP-only session
cookies on the application hostname. An image, PDF or native media element
loading a protected API-host URL cannot attach the lesson reader's in-memory
bearer credential. The API therefore receives no eligible application cookie.

Course activity media helpers now return `/api/protected-media/...` URLs. The
Next route reads only the existing `LH_access` cookie through `next/headers`,
then forwards its value as a bearer credential to the configured backend origin.
It does not trust a client Authorization header, forward other cookies, refresh
tokens, change session policy or implement an independent permission policy.
The API validates the credential and applies its existing authorization decision.

An anonymous request still reaches the API without a credential. This preserves
published public activity media while retaining API denials for private media.

## Scope and security

- Allowed upstream families: course activity `/content/orgs/{org}/courses/{course}/activities/{activity}/...`
  and course video/audio/HLS/caption endpoints below `/api/v1/stream/`.
- Resource prefixes and UUIDs are validated; empty, dot, traversal, encoded,
  slash, backslash, control and URL-delimiter segments are rejected. Query
  strings and arbitrary upstream URLs are not accepted.
- The server configuration supplies the fixed HTTP(S) upstream origin. No
  credential-bearing base URL, query, fragment or base-path override is allowed.
- GET and HEAD only. Range and If-Range are relayed. Successful bytes are
  streamed; the request's cancellation signal is forwarded. HEAD has no body.
- API 401, 403, 404, 416 and server-error status codes are retained. Error bodies
  are replaced with a generic message; transport failures return generic 502.
- Responses use `private, no-store`, `Vary: Cookie`, nosniff, no-referrer and a
  sandbox CSP. Only media/content headers are forwarded; Set-Cookie and debug
  headers are dropped. Active document types are forced to attachment/octet-stream.
- Identity transfer encoding is requested. Decoded responses lose compressed
  lengths; compressed partial responses fail closed rather than corrupt ranges.
- Existing API-authorized storage redirects are passed to the browser only for
  absolute HTTPS destinations without userinfo or the session credential. They
  are never followed server-side with the user's bearer credential. Existing
  presigned storage access remains API-owned; no new share tokens are minted.

Updated helpers cover image/video/audio/PDF blocks, activity video/PDF files,
HLS masters/thumbnails, captions and course assignment files. Relative HLS
children resolve under the same proxy. Branding, avatars, course thumbnails,
external images, SCORM and podcast/Library delivery are unchanged. Podcast and
Library direct-host helpers have an equivalent cookie-scope concern; extending
this course-only route to those resource families requires separate review.

## Validation

Focused tests use fixture credentials and mocked API policy decisions; they do
not prove live account roles or session revocation. Next-route integration tests
exercise the HTTP-only access-cookie wiring and reject client-header substitution.

`bun test tests/protected-media.test.mjs tests/protected-media-route.test.mjs tests/video-source.test.mjs tests/scorm-proxy-compression.test.mjs tests/url-security.test.mjs`
passed: **122 tests, zero failures**. Coverage includes denied anonymous private
access, author/admin forwarding, learner/expired/revoked denials, public-media
access, status preservation, streaming, HEAD, Range/416, caching, unsafe paths,
destinations, redirects and active content.

Changed-source ESLint and a bounded TypeScript check of the route, helpers and
their imports pass. The ordinary full typecheck reports missing static-image
declarations in this fresh checkout, which has not generated `next-env.d.ts`.
Full frontend checking also passes when Next's static-image declarations are
explicitly supplied in a temporary TypeScript configuration, without generating
files or starting/building Next. The temporary configuration extends the
frontend tsconfig, disables incremental output, adds the installed
`next/image-types/global.d.ts` to `files`, and resolves `node`/`react` types from
the frontend dependency directory.

No build, startup, restart, deployment, push, database/media operation or live
browser test was performed. The patch is in an isolated checkout because the
original checkout is mounted by the running web service. The original source
was not edited.

## Course 6961: separate diagnostic evidence

Do not infer an author-permission defect from the historical anonymous curl 401.
Under an already authorized administrator browser session, capture a fresh
Course 6961 navigation and correlate these operations by time and path:

1. Session validation and the exact principal/role classification (no secrets).
2. Client activity JSON and server-generated activity metadata, separately.
3. Destination origin, whether a proxy was used, and booleans indicating bearer
   or access-cookie presence, never their values.
4. API status and safe error classification, including whether identity resolved
   and which authorization decision denied access.

This distinguishes an old error surface, unresolved server session, missing
credential, expired/revoked session, malformed activity identifier and an actual
authenticated permission denial. Course 6961 reader authorization and archives
are untouched.

## Gates

GO for separately authorized local commit/PR publication review and eventual
isolated runtime testing. No action is
authorized by this recommendation. NO-GO for course/media acceptance or
production release until an existing admin renders the real SVT image and
representative PDF/audio/video assets, anonymous/learner denials remain intact,
and both courses remain private and unpublished.
