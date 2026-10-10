"""Authorization tests for course media URL requests, not just course JSON."""

from datetime import datetime
import sys
from types import ModuleType
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from src.core.middleware.content_cache import ContentNoStoreMiddleware
from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.assignments import (
    Assignment,
    GradingTypeEnum,
    SolutionRevealEnum,
)
from src.db.courses.courses import Course
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.trail_runs import TrailRun, StatusEnum
from src.db.trails import Trail
from src.routers import content_files, local_content
from src.security import course_media_access


_CONTENT_ROUTERS = [content_files, local_content]


async def _course_with_activity(db, org, *, public=False, published=True, activity_published=True):
    course = Course(
        name="Media access fixture",
        description="Synthetic",
        public=public,
        published=published,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid="course_media_auth",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(course)
    await db.commit()
    await db.refresh(course)

    activity = Activity(
        name="Synthetic activity",
        activity_type=ActivityTypeEnum.TYPE_DOCUMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DOCUMENT_PDF,
        content={},
        published=activity_published,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_media_auth",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(activity)
    await db.commit()
    return course, activity


def _media_path():
    return (
        "orgs/org_test/courses/course_media_auth/activities/"
        "activity_media_auth/media.png"
    )


@pytest.mark.parametrize("router", _CONTENT_ROUTERS)
@pytest.mark.asyncio
async def test_unpublished_course_media_is_not_anonymous(router, db, org, anonymous_user, mock_request):
    await _course_with_activity(db, org, public=True, published=False)

    with pytest.raises(HTTPException) as exc:
        await router._check_content_access(_media_path(), anonymous_user, db, mock_request)

    assert exc.value.status_code == 401


@pytest.mark.parametrize("router", _CONTENT_ROUTERS)
@pytest.mark.asyncio
async def test_unpublished_activity_media_is_denied_to_non_preview_reader(
    router, db, org, regular_user, mock_request, monkeypatch
):
    await _course_with_activity(db, org, public=True, published=True, activity_published=False)
    monkeypatch.setattr(course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=False))

    with pytest.raises(HTTPException) as exc:
        await router._check_content_access(_media_path(), regular_user, db, mock_request)

    assert exc.value.status_code == 403


@pytest.mark.parametrize("router", _CONTENT_ROUTERS)
@pytest.mark.asyncio
async def test_paid_media_requires_course_specific_paid_enrollment(
    router, db, org, regular_user, mock_request, monkeypatch
):
    course, _ = await _course_with_activity(db, org, public=False, published=True)
    monkeypatch.setattr(course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=True))
    check_entitlement = AsyncMock(return_value=True)
    monkeypatch.setattr(course_media_access, "_has_current_paid_enrollment", check_entitlement)

    await router._check_content_access(_media_path(), regular_user, db, mock_request)

    check_entitlement.assert_awaited_once_with(course.course_uuid, regular_user, db)


@pytest.mark.parametrize("router", _CONTENT_ROUTERS)
@pytest.mark.asyncio
async def test_organization_membership_alone_does_not_unlock_paid_media(
    router, db, org, regular_user, mock_request, monkeypatch
):
    await _course_with_activity(db, org, public=False, published=True)
    monkeypatch.setattr(course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=True))
    monkeypatch.setattr(
        course_media_access, "_has_current_paid_enrollment", AsyncMock(return_value=False)
    )

    with pytest.raises(HTTPException) as exc:
        await router._check_content_access(_media_path(), regular_user, db, mock_request)

    assert exc.value.status_code == 403


@pytest.mark.parametrize("router", _CONTENT_ROUTERS)
@pytest.mark.asyncio
async def test_ordinary_course_enrollment_does_not_unlock_paid_media(
    router, db, org, regular_user, mock_request, monkeypatch
):
    course, _ = await _course_with_activity(db, org, public=False, published=True)
    trail = Trail(
        org_id=org.id,
        user_id=regular_user.id,
        trail_uuid="trail_media_auth",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail)
    await db.commit()
    await db.refresh(trail)
    db.add(TrailRun(
        trail_id=trail.id,
        course_id=course.id,
        org_id=org.id,
        user_id=regular_user.id,
        status=StatusEnum.STATUS_IN_PROGRESS,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    ))
    await db.commit()

    monkeypatch.setattr(course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=True))
    paid_check = AsyncMock(return_value=False)
    monkeypatch.setattr(course_media_access, "_has_current_paid_enrollment", paid_check)

    with pytest.raises(HTTPException) as exc:
        await router._check_content_access(_media_path(), regular_user, db, mock_request)

    assert exc.value.status_code == 403
    paid_check.assert_awaited_once_with(course.course_uuid, regular_user, db)


@pytest.mark.parametrize("router", _CONTENT_ROUTERS)
@pytest.mark.asyncio
async def test_expired_paid_entitlement_is_denied(router, db, org, regular_user, mock_request, monkeypatch):
    await _course_with_activity(db, org, public=False, published=True)
    monkeypatch.setattr(course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=True))
    # The Enterprise verifier returns False for expired/revoked enrollment.
    monkeypatch.setattr(
        course_media_access, "_has_current_paid_enrollment", AsyncMock(return_value=False)
    )

    with pytest.raises(HTTPException) as exc:
        await router._check_content_access(_media_path(), regular_user, db, mock_request)

    assert exc.value.status_code == 403


@pytest.mark.parametrize("router", _CONTENT_ROUTERS)
@pytest.mark.parametrize("principal", ["anonymous", "regular"])
@pytest.mark.asyncio
async def test_model_answer_media_respects_assignment_reveal_policy(
    router, principal, db, org, anonymous_user, regular_user, mock_request, monkeypatch
):
    course, activity = await _course_with_activity(db, org, public=True, published=True)
    assignment = Assignment(
        title="Synthetic assessment",
        description="Synthetic",
        grading_type=GradingTypeEnum.PASS_FAIL,
        org_id=org.id,
        course_id=course.id,
        chapter_id=1,
        activity_id=activity.id,
        assignment_uuid="assignment_media_auth",
        solution_file="solution_key.pdf",
        solution_reveal=SolutionRevealEnum.NEVER,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()
    monkeypatch.setattr(course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=False))

    path = (
        "orgs/org_test/courses/course_media_auth/activities/activity_media_auth/"
        "assignments/assignment_media_auth/solution/solution_key.pdf"
    )
    user = anonymous_user if principal == "anonymous" else regular_user
    with pytest.raises(HTTPException) as exc:
        await router._check_content_access(path, user, db, mock_request)

    assert exc.value.status_code == (401 if principal == "anonymous" else 403)


@pytest.mark.parametrize("router", _CONTENT_ROUTERS)
@pytest.mark.asyncio
async def test_revealed_model_answer_media_is_available_after_policy_grants_access(
    router, db, org, regular_user, mock_request, monkeypatch
):
    course, activity = await _course_with_activity(db, org, public=True, published=True)
    assignment = Assignment(
        title="Synthetic assessment",
        description="Synthetic",
        grading_type=GradingTypeEnum.PASS_FAIL,
        org_id=org.id,
        course_id=course.id,
        chapter_id=1,
        activity_id=activity.id,
        assignment_uuid="assignment_revealed_media",
        solution_file="solution_key.pdf",
        solution_reveal=SolutionRevealEnum.AFTER_GRADING,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()
    monkeypatch.setattr(course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=False))

    from src.services.courses.activities import assignments as assignment_service

    reveal_check = AsyncMock(return_value=True)
    monkeypatch.setattr(assignment_service, "_resolve_solution_visibility", reveal_check)

    path = (
        "orgs/org_test/courses/course_media_auth/activities/activity_media_auth/"
        "assignments/assignment_revealed_media/solution/solution_key.pdf"
    )
    await router._check_content_access(path, regular_user, db, mock_request)

    reveal_check.assert_awaited_once()


@pytest.mark.asyncio
async def test_malformed_model_answer_key_cannot_fall_through_to_course_media(
    db, org, regular_user, mock_request
):
    await _course_with_activity(db, org, public=True, published=True)
    path = (
        "orgs/org_test/courses/course_media_auth/activities/activity_media_auth/"
        "assignments/assignment_media_auth/solution/subdir/solution_key.pdf"
    )
    with pytest.raises(HTTPException) as exc:
        await content_files._check_content_access(path, regular_user, db, mock_request)
    assert exc.value.status_code == 403


@pytest.mark.parametrize("router", _CONTENT_ROUTERS)
@pytest.mark.parametrize("principal", ["author", "administrator"])
@pytest.mark.asyncio
async def test_author_and_administrator_can_preview_unpublished_course(
    router, principal, db, org, admin_user, regular_user, mock_request, monkeypatch
):
    course, _ = await _course_with_activity(db, org, public=False, published=False)
    monkeypatch.setattr(course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=True))
    monkeypatch.setattr(
        course_media_access,
        "_has_current_paid_enrollment",
        AsyncMock(side_effect=AssertionError("preview must not require paid enrollment")),
    )

    user = admin_user
    if principal == "author":
        user = regular_user
        db.add(ResourceAuthor(
            resource_uuid=course.course_uuid,
            user_id=user.id,
            authorship=ResourceAuthorshipEnum.CREATOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        ))
        await db.commit()

    await router._check_content_access(_media_path(), user, db, mock_request)


@pytest.mark.asyncio
async def test_paid_course_access_fails_closed_if_enterprise_model_is_missing(
    db, monkeypatch
):
    monkeypatch.setattr(course_media_access, "is_ee_available", lambda: True)
    # The closed-source EE payment package is intentionally absent in this
    # community source checkout; a configured EE deployment must deny rather
    # than treat a failed import as proof of a free course.
    with pytest.raises(HTTPException) as exc:
        await course_media_access._has_current_paid_enrollment(
            "course_paid", type("User", (), {"id": 7})(), db
        )
    assert exc.value.status_code == 503


def _install_fake_module(monkeypatch, name, module):
    parts = name.split(".")
    for index, part in enumerate(parts[:-1]):
        parent_name = ".".join(parts[: index + 1])
        parent = sys.modules.get(parent_name)
        if parent is None:
            parent = ModuleType(parent_name)
            parent.__path__ = []
            monkeypatch.setitem(sys.modules, parent_name, parent)
        if index + 1 < len(parts) - 1:
            child_name = ".".join(parts[: index + 2])
            child = sys.modules.get(child_name)
            if child is None:
                child = ModuleType(child_name)
                child.__path__ = []
                monkeypatch.setitem(sys.modules, child_name, child)
            monkeypatch.setattr(parent, parts[index + 1], child, raising=False)
    parent = sys.modules[".".join(parts[:-1])]
    monkeypatch.setattr(parent, parts[-1], module, raising=False)
    monkeypatch.setitem(sys.modules, name, module)


@pytest.mark.asyncio
async def test_ee_payment_offer_model_links_course_group_to_paid_resource(
    db, monkeypatch
):
    from sqlalchemy import column
    from types import SimpleNamespace

    module = ModuleType("ee.db.payments.payments_offers")
    module.PaymentsOffer = SimpleNamespace(id=column("id"), usergroup_id=column("usergroup_id"))
    _install_fake_module(monkeypatch, "ee.db.payments.payments_offers", module)
    monkeypatch.setattr(course_media_access, "is_ee_available", lambda: True)

    class ScalarResult:
        def __init__(self, values):
            self.values = values

        def all(self):
            return self.values

        def first(self):
            return self.values[0] if self.values else None

    class QueryResult:
        def __init__(self, values):
            self.values = values

        def scalars(self):
            return ScalarResult(self.values)

    db.execute = AsyncMock(side_effect=[QueryResult([17]), QueryResult([9])])

    assert await course_media_access._resource_has_paid_offer("course_42", db) is True
    assert db.execute.await_count == 2


@pytest.mark.asyncio
async def test_ee_enrollment_verifier_receives_course_user_and_session(monkeypatch, db):
    calls = []
    module = ModuleType("ee.services.payments.payments_access")

    async def check_enrollment_access(resource_uuid, user_id, session):
        calls.append((resource_uuid, user_id, session))
        return False  # expired/revoked payment in the EE implementation

    module.check_enrollment_access = check_enrollment_access
    _install_fake_module(monkeypatch, "ee.services.payments.payments_access", module)
    user = type("PaidUser", (), {"id": 23})()

    allowed = await course_media_access._has_current_paid_enrollment(
        "course_42", user, db
    )

    assert allowed is False
    assert calls == [("course_42", 23, db)]


@pytest.mark.asyncio
async def test_content_no_store_middleware_applies_to_errors_and_successes():
    async def downstream(scope, receive, send):
        await send({
            "type": "http.response.start",
            "status": scope["status_code"],
            "headers": [(b"cache-control", b"public, max-age=86400")],
        })
        await send({"type": "http.response.body", "body": b""})

    async def call(path, status_code):
        messages = []
        app = ContentNoStoreMiddleware(downstream)

        async def send(message):
            messages.append(message)

        await app(
            {"type": "http", "path": path, "status_code": status_code},
            lambda: None,
            send,
        )
        return dict(messages[0]["headers"]).get(b"cache-control")

    assert await call("/api/v1/content/orgs/x/private.pdf", 206) == b"private, no-store"
    assert await call("/api/v1/content/orgs/x/private.pdf", 403) == b"private, no-store"
