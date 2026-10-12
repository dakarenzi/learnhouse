"""Tests for src/services/courses/activities/activities.py."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from src.db.courses.activities import (
    ActivityCreate,
    ActivityRead,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    ActivityUpdate,
)
from src.db.organizations import OrganizationRead
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.security import course_media_access
from src.services.courses.activities.activities import (
    EditorBootstrapResponse,
    _apply_activity_lock,
    _trigger_course_embedding,
    create_activity,
    delete_activity,
    get_activities,
    get_activity,
    get_activityby_id,
    get_editor_bootstrap,
    update_activity,
)


async def _read_activity_by_identifier(
    identifier, mock_request, activity, current_user, db
):
    if identifier == "uuid":
        return await get_activity(
            mock_request, activity.activity_uuid, current_user, db
        )
    return await get_activityby_id(
        mock_request, activity.id, current_user, db
    )


class TestCreateActivity:
    @pytest.mark.asyncio
    async def test_raises_404_when_chapter_not_found(
        self, mock_request, db, org, admin_user
    ):
        activity_obj = ActivityCreate(
            name="Test",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            chapter_id=9999,
            course_id=1,
            org_id=org.id,
            content={},
        )
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await create_activity(mock_request, activity_obj, admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_creates_activity_successfully(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        activity_obj = ActivityCreate(
            name="New Activity",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            chapter_id=chapter.id,
            course_id=course.id,
            org_id=org.id,
            content={"type": "doc", "content": []},
        )
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await create_activity(mock_request, activity_obj, admin_user, db)

        assert isinstance(result, ActivityRead)
        assert result.name == "New Activity"


class TestGetEditorBootstrap:
    @pytest.mark.asyncio
    async def test_raises_404_when_activity_not_found(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_editor_bootstrap(mock_request, "nonexistent-uuid", admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_editor_bootstrap_response(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        fake_org_read = MagicMock(spec=OrganizationRead)

        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.orgs._build_org_read_with_resolved",
            return_value=fake_org_read,
        ):
            result = await get_editor_bootstrap(
                mock_request, activity.activity_uuid, admin_user, db
            )

        assert isinstance(result, EditorBootstrapResponse)
        assert result.activity.name == activity.name
        assert result.course.org_uuid == org.org_uuid

    @pytest.mark.asyncio
    async def test_scrubs_content_when_no_paid_access(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        fake_org_read = MagicMock(spec=OrganizationRead)

        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.enforce_course_lesson_access",
            new_callable=AsyncMock,
            return_value=(False, False),
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.orgs._build_org_read_with_resolved",
            return_value=fake_org_read,
        ):
            result = await get_editor_bootstrap(
                mock_request, activity.activity_uuid, admin_user, db
            )

        assert result.activity.content == {"paid_access": False}

    @pytest.mark.asyncio
    async def test_editor_preview_keeps_content_without_student_entitlement(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        fake_org_read = MagicMock(spec=OrganizationRead)
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.enforce_course_lesson_access",
            new_callable=AsyncMock,
            return_value=(True, False),
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=False,
        ) as paid_check, patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.orgs._build_org_read_with_resolved",
            return_value=fake_org_read,
        ):
            result = await get_editor_bootstrap(
                mock_request, activity.activity_uuid, admin_user, db
            )

        assert result.activity.content == activity.content
        paid_check.assert_not_awaited()


class TestGetActivity:
    @pytest.mark.asyncio
    async def test_raises_404_for_unknown_activity(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_activity(mock_request, "nonexistent-uuid", admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_activity_read(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ):
            result = await get_activity(
                mock_request, activity.activity_uuid, admin_user, db
            )

        assert isinstance(result, ActivityRead)
        assert result.name == activity.name

    @pytest.mark.asyncio
    async def test_author_preview_keeps_content_without_student_entitlement(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.enforce_course_lesson_access",
            new_callable=AsyncMock,
            return_value=(True, False),
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=False,
        ) as paid_check, patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ):
            result = await get_activity(
                mock_request, activity.activity_uuid, admin_user, db
            )

        assert result.content == activity.content
        paid_check.assert_not_awaited()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("identifier", ["uuid", "numeric"])
    @pytest.mark.parametrize(
        ("principal", "is_public", "expected_status"),
        [
            ("anonymous", False, 401),
            ("learner", False, 403),
            ("anonymous", True, 401),
            ("learner", True, 403),
        ],
    )
    async def test_unpublished_course_denied_without_content_disclosure(
        self,
        identifier,
        principal,
        is_public,
        expected_status,
        mock_request,
        db,
        course,
        chapter,
        activity,
        regular_user,
        anonymous_user,
        monkeypatch,
    ):
        course.public = is_public
        course.published = False
        activity.content = {"body": "private lesson sentinel"}
        await db.commit()
        monkeypatch.setattr(
            course_media_access,
            "_is_course_preview_authorized",
            AsyncMock(return_value=False),
        )
        current_user = anonymous_user if principal == "anonymous" else regular_user

        with pytest.raises(HTTPException) as exc:
            await _read_activity_by_identifier(
                identifier, mock_request, activity, current_user, db
            )

        assert exc.value.status_code == expected_status
        assert "private lesson sentinel" not in str(exc.value.detail)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("identifier", ["uuid", "numeric"])
    async def test_private_published_course_denied_without_content_disclosure(
        self,
        identifier,
        mock_request,
        db,
        course,
        chapter,
        activity,
        anonymous_user,
        monkeypatch,
    ):
        course.public = False
        course.published = True
        activity.content = {"body": "private course sentinel"}
        await db.commit()
        monkeypatch.setattr(
            course_media_access,
            "_is_course_preview_authorized",
            AsyncMock(return_value=False),
        )
        with pytest.raises(HTTPException) as exc:
            await _read_activity_by_identifier(
                identifier, mock_request, activity, anonymous_user, db
            )

        assert exc.value.status_code == 403
        assert "private course sentinel" not in str(exc.value.detail)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("identifier", ["uuid", "numeric"])
    @pytest.mark.parametrize("has_entitlement", [False, True])
    async def test_paid_course_requires_verified_entitlement(
        self,
        identifier,
        has_entitlement,
        mock_request,
        db,
        course,
        chapter,
        activity,
        regular_user,
        monkeypatch,
    ):
        course.public = True
        course.published = True
        activity.content = {"body": "paid lesson sentinel"}
        await db.commit()
        monkeypatch.setattr(
            course_media_access,
            "_is_course_preview_authorized",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(
            course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=True)
        )
        entitlement_check = AsyncMock(return_value=has_entitlement)
        monkeypatch.setattr(
            course_media_access, "_has_current_paid_enrollment", entitlement_check
        )
        monkeypatch.setattr(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            AsyncMock(return_value=True),
        )

        if not has_entitlement:
            with pytest.raises(HTTPException) as exc:
                await _read_activity_by_identifier(
                    identifier, mock_request, activity, regular_user, db
                )
            assert exc.value.status_code == 403
            assert "paid lesson sentinel" not in str(exc.value.detail)
        else:
            monkeypatch.setattr(
                "src.services.courses.activities.activities._apply_activity_lock",
                AsyncMock(),
            )
            result = await _read_activity_by_identifier(
                identifier, mock_request, activity, regular_user, db
            )
            assert result.content == {"body": "paid lesson sentinel"}

        entitlement_check.assert_awaited_once_with(course.course_uuid, regular_user, db)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("identifier", ["uuid", "numeric"])
    async def test_unpublished_activity_denied_on_accessible_course(
        self,
        identifier,
        mock_request,
        db,
        course,
        chapter,
        activity,
        regular_user,
        monkeypatch,
    ):
        course.public = True
        course.published = True
        activity.published = False
        activity.content = {"body": "unpublished activity sentinel"}
        await db.commit()
        monkeypatch.setattr(
            course_media_access,
            "_is_course_preview_authorized",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(
            course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=False)
        )
        monkeypatch.setattr(
            "src.services.courses.activities.activities.check_resource_access",
            AsyncMock(),
        )

        with pytest.raises(HTTPException) as exc:
            await _read_activity_by_identifier(
                identifier, mock_request, activity, regular_user, db
            )

        assert exc.value.status_code == 403
        assert "unpublished activity sentinel" not in str(exc.value.detail)

    @pytest.mark.asyncio
    async def test_editor_bootstrap_denies_unpublished_activity_to_learner(
        self,
        mock_request,
        db,
        course,
        chapter,
        activity,
        regular_user,
        monkeypatch,
    ):
        course.public = True
        course.published = True
        activity.published = False
        activity.content = {"body": "unpublished editor sentinel"}
        await db.commit()
        monkeypatch.setattr(
            course_media_access,
            "_is_course_preview_authorized",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(
            course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=False)
        )
        monkeypatch.setattr(
            "src.services.courses.activities.activities.check_resource_access",
            AsyncMock(),
        )

        with pytest.raises(HTTPException) as exc:
            await get_editor_bootstrap(
                mock_request, activity.activity_uuid, regular_user, db
            )

        assert exc.value.status_code == 403
        assert "unpublished editor sentinel" not in str(exc.value.detail)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("identifier", ["uuid", "numeric"])
    @pytest.mark.parametrize("locked_resource", ["chapter", "activity"])
    async def test_restricted_locks_scrub_reader_content(
        self,
        identifier,
        locked_resource,
        mock_request,
        db,
        course,
        chapter,
        activity,
        regular_user,
        monkeypatch,
    ):
        activity.content = {"body": "locked lesson sentinel"}
        if locked_resource == "chapter":
            chapter.lock_type = "restricted"
        else:
            activity.lock_type = "restricted"
        await db.commit()
        monkeypatch.setattr(
            course_media_access,
            "_is_course_preview_authorized",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(
            course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=False)
        )
        monkeypatch.setattr(
            "src.services.courses.activities.activities.check_resource_access",
            AsyncMock(),
        )
        monkeypatch.setattr(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            AsyncMock(return_value=True),
        )
        monkeypatch.setattr(
            "src.services.courses.activities.activities.is_org_admin",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(
            "src.services.courses.activities.activities.batch_accessible_restricted_uuids",
            AsyncMock(return_value=set()),
        )

        async def is_locked(lock_type, *_args, **_kwargs):
            return lock_type == "restricted"

        monkeypatch.setattr(
            "src.services.courses.activities.activities.is_locked_for_user",
            AsyncMock(side_effect=is_locked),
        )

        result = await _read_activity_by_identifier(
            identifier, mock_request, activity, regular_user, db
        )

        assert result.is_locked is True
        assert result.content == {}
        assert result.details is None
        assert "locked lesson sentinel" not in str(result.model_dump())

    @pytest.mark.asyncio
    @pytest.mark.parametrize("identifier", ["uuid", "numeric"])
    @pytest.mark.parametrize("principal", ["author", "administrator"])
    async def test_author_and_admin_can_preview_draft_activity(
        self,
        identifier,
        principal,
        mock_request,
        db,
        course,
        chapter,
        activity,
        regular_user,
        admin_user,
        monkeypatch,
    ):
        course.public = False
        course.published = False
        chapter.lock_type = "restricted"
        activity.lock_type = "restricted"
        activity.published = False
        activity.content = {"body": "draft preview sentinel"}
        await db.commit()

        current_user = admin_user
        if principal == "author":
            current_user = regular_user
            db.add(
                ResourceAuthor(
                    resource_uuid=course.course_uuid,
                    user_id=current_user.id,
                    authorship=ResourceAuthorshipEnum.CREATOR,
                    authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                    creation_date="test",
                    update_date="test",
                )
            )
            await db.commit()

        paid_check = AsyncMock(return_value=False)
        monkeypatch.setattr(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            paid_check,
        )

        result = await _read_activity_by_identifier(
            identifier, mock_request, activity, current_user, db
        )

        assert result.content == {"body": "draft preview sentinel"}
        assert result.is_locked is False
        paid_check.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_numeric_and_uuid_readers_return_the_same_authorized_payload(
        self, mock_request, db, course, chapter, activity, regular_user, monkeypatch
    ):
        monkeypatch.setattr(
            course_media_access,
            "_is_course_preview_authorized",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(
            course_media_access, "_resource_has_paid_offer", AsyncMock(return_value=False)
        )
        monkeypatch.setattr(
            "src.services.courses.activities.activities.check_resource_access",
            AsyncMock(),
        )
        monkeypatch.setattr(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            AsyncMock(return_value=True),
        )
        monkeypatch.setattr(
            "src.services.courses.activities.activities._apply_activity_lock",
            AsyncMock(),
        )

        uuid_result = await get_activity(
            mock_request, activity.activity_uuid, regular_user, db
        )
        numeric_result = await get_activityby_id(
            mock_request, activity.id, regular_user, db
        )

        assert numeric_result.model_dump() == uuid_result.model_dump()


class TestUpdateActivity:
    @pytest.mark.asyncio
    async def test_raises_404_when_activity_not_found(
        self, mock_request, db, admin_user
    ):
        update_obj = ActivityUpdate(name="Updated")
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await update_activity(mock_request, update_obj, "nonexistent-uuid", admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_updates_activity_name(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        update_obj = ActivityUpdate(name="Renamed Activity")
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.create_activity_version",
            new_callable=AsyncMock,
        ):
            result = await update_activity(
                mock_request, update_obj, activity.activity_uuid, admin_user, db
            )
        assert isinstance(result, ActivityRead)
        assert result.name == "Renamed Activity"

    @pytest.mark.asyncio
    async def test_updates_activity_content_creates_version(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        new_content = {"type": "doc", "content": [{"type": "paragraph"}]}
        update_obj = ActivityUpdate(content=new_content)
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.create_activity_version",
            new_callable=AsyncMock,
        ) as mock_version, patch(
            "src.services.courses.activities.activities._trigger_course_embedding",
            new_callable=AsyncMock,
        ):
            result = await update_activity(
                mock_request, update_obj, activity.activity_uuid, admin_user, db
            )
        assert isinstance(result, ActivityRead)
        mock_version.assert_called_once()


class TestDeleteActivity:
    @pytest.mark.asyncio
    async def test_raises_404_when_activity_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await delete_activity(mock_request, "nonexistent-uuid", admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_deletes_activity(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.transfer.storage_utils.delete_storage_directory",
            return_value=None,
        ):
            result = await delete_activity(
                mock_request, activity.activity_uuid, admin_user, db
            )
        assert result == {"detail": "Activity deleted"}


class TestGetActivityById:
    @pytest.mark.asyncio
    async def test_raises_404_when_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_activityby_id(mock_request, 99999, admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_activity_by_id(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_activityby_id(mock_request, activity.id, admin_user, db)
        assert isinstance(result, ActivityRead)
        assert result.id == activity.id


# ---------------------------------------------------------------------------
# _apply_activity_lock
# ---------------------------------------------------------------------------

_PATCH_IS_ORG_ADMIN = "src.services.courses.activities.activities.is_org_admin"
_PATCH_BATCH_ACCESSIBLE = "src.services.courses.activities.activities.batch_accessible_restricted_uuids"
_PATCH_IS_LOCKED = "src.services.courses.activities.activities.is_locked_for_user"


class TestApplyActivityLock:
    @pytest.mark.asyncio
    async def test_admin_bypasses_lock(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        """Admin path: returns immediately without locking (covers lines 272-275)."""
        activity_read = ActivityRead.model_validate(activity)
        with patch(_PATCH_IS_ORG_ADMIN, new_callable=AsyncMock, return_value=True):
            await _apply_activity_lock(activity_read, activity, course, admin_user, db)
        assert activity_read.is_locked is False

    @pytest.mark.asyncio
    async def test_uses_provided_parent_chapter(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        """parent_chapter provided: no extra query (covers line 281)."""
        activity_read = ActivityRead.model_validate(activity)
        with patch(_PATCH_IS_ORG_ADMIN, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_BATCH_ACCESSIBLE, new_callable=AsyncMock, return_value=set()), \
             patch(_PATCH_IS_LOCKED, new_callable=AsyncMock, return_value=False):
            await _apply_activity_lock(
                activity_read, activity, course, regular_user, db, parent_chapter=chapter
            )
        assert activity_read.is_locked is False

    @pytest.mark.asyncio
    @pytest.mark.asyncio
    async def test_fetches_chapter_when_not_provided(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        """parent_chapter=None: queries DB for chapter (covers line 285)."""
        activity_read = ActivityRead.model_validate(activity)
        with patch(_PATCH_IS_ORG_ADMIN, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_BATCH_ACCESSIBLE, new_callable=AsyncMock, return_value=set()), \
             patch(_PATCH_IS_LOCKED, new_callable=AsyncMock, return_value=False):
            await _apply_activity_lock(
                activity_read, activity, course, regular_user, db, parent_chapter=None
            )
        assert activity_read.is_locked is False

    @pytest.mark.asyncio
    async def test_locks_activity_when_restricted(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        """Covers lines 295, 305, 315, 326-329 (restricted lock path)."""
        activity_read = ActivityRead.model_validate(activity)
        with patch(_PATCH_IS_ORG_ADMIN, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_BATCH_ACCESSIBLE, new_callable=AsyncMock, return_value=set()), \
             patch(_PATCH_IS_LOCKED, new_callable=AsyncMock, return_value=True):
            await _apply_activity_lock(
                activity_read, activity, course, regular_user, db
            )
        assert activity_read.is_locked is True


# ---------------------------------------------------------------------------
# _trigger_course_embedding
# ---------------------------------------------------------------------------


class TestTriggerCourseEmbedding:
    @pytest.mark.asyncio
    async def test_runs_embedding_when_course_found(self, db, course):
        """Covers lines 438-439 (lazy imports inside _trigger_course_embedding)."""
        async def fake_get_db():
            yield db

        with patch(
            "src.core.events.database.get_db_session",
            return_value=fake_get_db(),
        ), patch(
            "src.services.ai.rag.embedding_service.embed_course_content",
            new_callable=AsyncMock,
        ) as mock_embed:
            await _trigger_course_embedding(course.id, course.org_id)

        mock_embed.assert_called_once_with(course.id, course.org_id, db)


# ---------------------------------------------------------------------------
# get_activities
# ---------------------------------------------------------------------------


class TestGetActivities:
    @pytest.mark.asyncio
    async def test_raises_404_when_no_published_activities(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_activities(mock_request, chapter.id, admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_published_activities(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        """Covers line 525 (the select statement in get_activities)."""
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_activities(mock_request, chapter.id, admin_user, db)
        assert isinstance(result, list)
        assert len(result) >= 1
