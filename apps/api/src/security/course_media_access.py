"""Authorization for files stored below a course activity's content key."""

import logging

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import check_ee_activity_paid_access, is_ee_available
from src.db.courses.activities import Activity, ActivityRead
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.users import AnonymousUser, APITokenUser, PublicUser

logger = logging.getLogger(__name__)


async def _resource_has_paid_offer(resource_uuid: str, db_session: AsyncSession) -> bool:
    """Return whether an EE payment offer is attached to this resource.

    LearnHouse links paid offers to the UserGroup that protects a resource.
    The payment models are deliberately optional in the community edition. In
    an EE deployment, failure to load/query those models is an authorization
    failure rather than evidence that the resource is free.
    """
    if not is_ee_available():
        return False

    from src.db.usergroup_resources import UserGroupResource

    group_ids = (await db_session.execute(
        select(UserGroupResource.usergroup_id).where(
            UserGroupResource.resource_uuid == resource_uuid
        )
    )).scalars().all()
    if not group_ids:
        return False

    try:
        from ee.db.payments.payments_offers import PaymentsOffer
    except Exception as exc:
        logger.error("EE payment offer model unavailable; denying course media access")
        raise HTTPException(status_code=503, detail="Payment authorization unavailable") from exc

    try:
        offer_id = (await db_session.execute(
            select(PaymentsOffer.id).where(PaymentsOffer.usergroup_id.in_(group_ids))
        )).scalars().first()
    except Exception as exc:
        logger.error("EE payment offer lookup failed; denying course media access")
        raise HTTPException(status_code=503, detail="Payment authorization unavailable") from exc
    return offer_id is not None


async def _has_current_paid_enrollment(
    course_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> bool:
    """Ask the EE payment service for current, course-specific entitlement.

    A TrailRun (the ordinary course enrollment/progress row), organization
    membership, and UserGroup membership are not paid-entitlement evidence.
    The EE implementation owns status, expiration, refund, and revocation
    semantics; missing or failing payment code fails closed.
    """
    try:
        from ee.services.payments.payments_access import check_enrollment_access
    except Exception as exc:
        logger.error("EE enrollment verifier unavailable; denying paid media access")
        raise HTTPException(status_code=503, detail="Payment authorization unavailable") from exc

    try:
        return bool(await check_enrollment_access(course_uuid, current_user.id, db_session))
    except Exception as exc:
        logger.error("EE enrollment verification failed; denying paid media access")
        raise HTTPException(status_code=503, detail="Payment authorization unavailable") from exc


async def _is_course_preview_authorized(
    request: Request | None,
    course_uuid: str,
    current_user,
    db_session: AsyncSession,
) -> bool:
    """Only course authors and administrators get unpublished-course preview."""
    if request is None or isinstance(current_user, (AnonymousUser, APITokenUser)):
        return False

    from src.security.rbac import AccessAction, AccessContext, check_resource_access

    decision = await check_resource_access(
        request,
        db_session,
        current_user,
        course_uuid,
        AccessAction.READ,
        context=AccessContext.DASHBOARD,
        raise_on_deny=False,
    )
    return bool(decision.allowed and (decision.via_admin or decision.via_authorship))


async def enforce_course_activity_media_access(
    parts: list[str],
    current_user,
    db_session: AsyncSession,
    request: Request | None,
) -> None:
    """Enforce course, paid-offer, activity-lock, and publication rules.

    ``parts`` is the validated ``orgs/{org}/courses/{course}/activities/{activity}/…``
    content path. It is used by both the local-filesystem and S3 content
    routers, so changing storage backends does not change authorization.
    """
    course_uuid, activity_uuid = parts[3], parts[5]
    course = (await db_session.execute(
        select(Course).where(Course.course_uuid == course_uuid)
    )).scalars().first()
    activity = (await db_session.execute(
        select(Activity).where(
            Activity.activity_uuid == activity_uuid,
            Activity.course_id == course.id if course else False,
        )
    )).scalars().first()
    if course is None or activity is None:
        raise HTTPException(status_code=403, detail="Access denied")

    is_preview = await _is_course_preview_authorized(
        request, course_uuid, current_user, db_session
    )

    if not is_preview:
        if not course.published:
            status_code = 401 if isinstance(current_user, AnonymousUser) else 403
            raise HTTPException(status_code=status_code, detail="Access denied")

        has_paid_offer = await _resource_has_paid_offer(course_uuid, db_session)
        if has_paid_offer:
            if isinstance(current_user, AnonymousUser):
                raise HTTPException(status_code=401, detail="Authentication required")
            if isinstance(current_user, APITokenUser) or not isinstance(current_user, PublicUser):
                raise HTTPException(status_code=403, detail="Access denied")
            if not await _has_current_paid_enrollment(course_uuid, current_user, db_session):
                raise HTTPException(status_code=403, detail="Access denied")
        else:
            from src.security.rbac import AccessAction, AccessContext, check_resource_access

            try:
                await check_resource_access(
                    request,
                    db_session,
                    current_user,
                    course_uuid,
                    AccessAction.READ,
                    context=AccessContext.PUBLIC_VIEW,
                )
            except HTTPException as exc:
                if isinstance(current_user, AnonymousUser) and exc.status_code == 403:
                    raise HTTPException(
                        status_code=401, detail="Authentication required"
                    ) from exc
                raise

        if not activity.published:
            raise HTTPException(status_code=403, detail="Access denied")

        # Activity-level paid access is already used by the activity reader.
        # Apply the same EE decision to the underlying file URL so a hidden
        # activity body cannot be bypassed by requesting its media key.
        if not await check_ee_activity_paid_access(
            request, activity.id, current_user, db_session
        ):
            raise HTTPException(status_code=403, detail="Access denied")

        # Preserve chapter/activity authenticated and restricted-group locks.
        # The reader scrubs locked content; the file route must deny the bytes.
        from src.services.courses.activities.activities import _apply_activity_lock

        parent_chapter = (await db_session.execute(
            select(Chapter)
            .join(ChapterActivity, ChapterActivity.chapter_id == Chapter.id)
            .where(ChapterActivity.activity_id == activity.id)
        )).scalars().first()
        activity_read = ActivityRead.model_validate(activity)
        await _apply_activity_lock(
            activity_read,
            activity,
            course,
            current_user,
            db_session,
            parent_chapter=parent_chapter,
        )
        if activity_read.is_locked:
            raise HTTPException(status_code=403, detail="Access denied")
