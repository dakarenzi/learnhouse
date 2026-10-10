"""Access control for assignment model-answer media stored under /content."""

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.assignments import Assignment
from src.db.users import AnonymousUser, APITokenUser


def is_assignment_solution_file(parts: list[str]) -> bool:
    """Match exactly the native assignment model-answer storage layout."""
    return (
        len(parts) == 10
        and parts[0] == "orgs"
        and parts[2] == "courses"
        and parts[4] == "activities"
        and parts[6] == "assignments"
        and parts[8] == "solution"
    )


def is_assignment_solution_path(parts: list[str]) -> bool:
    """Match the protected answer directory, including malformed descendants."""
    return (
        len(parts) >= 9
        and parts[0] == "orgs"
        and parts[2] == "courses"
        and parts[4] == "activities"
        and parts[6] == "assignments"
        and parts[8] == "solution"
    )


async def enforce_assignment_solution_file_access(
    parts: list[str],
    current_user,
    db_session: AsyncSession,
    request: Request | None,
) -> None:
    """Require the same reveal decision as the assignment API before bytes."""
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    if isinstance(current_user, APITokenUser) or request is None:
        raise HTTPException(status_code=403, detail="Access denied")

    course_uuid, activity_uuid, assignment_uuid, filename = (
        parts[3], parts[5], parts[7], parts[9]
    )
    assignment = (await db_session.execute(
        select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    )).scalars().first()
    if (
        assignment is None
        or assignment.solution_file != filename
        or not assignment.solution_file
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    # Confirm the stored assignment belongs to the course/activity in the key;
    # a valid assignment UUID must not make another path alias readable.
    from src.db.courses.activities import Activity
    from src.db.courses.courses import Course

    course = (await db_session.execute(
        select(Course).where(Course.course_uuid == course_uuid)
    )).scalars().first()
    activity = (await db_session.execute(
        select(Activity).where(
            Activity.activity_uuid == activity_uuid,
            Activity.course_id == course.id if course else False,
        )
    )).scalars().first()
    if (
        course is None
        or activity is None
        or assignment.course_id != course.id
        or assignment.activity_id != activity.id
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    # This is the same server-side reveal rule used by assignment reads:
    # NEVER, ON_SUBMISSION, AFTER_GRADING, and the remaining-retry guard.
    from src.services.courses.activities.assignments import _resolve_solution_visibility

    if not await _resolve_solution_visibility(
        request, db_session, current_user, course_uuid, assignment
    ):
        raise HTTPException(status_code=403, detail="Access denied")
