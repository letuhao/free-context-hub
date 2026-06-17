"""v11 hybrid baseline runtime-fix — unit test for the reasoning_effort=none patch.

Guards `_build_openai_client` in main.py against silently losing the wrapper
that injects `extra_body={"reasoning_effort": "none"}` on every
`chat.completions.create` call. Without that wrapper, LM Studio's gemma-4
family enters reasoning-by-default mode, dumps a long internal trace before
emitting visible content, exhausts `max_tokens` mid-stream, and the RAGAS
faithfulness metric returns `null` for every row. That's the regression
this test exists to catch.

Symptom shape of the bug this prevents: 147/152 rows with
`faithfulness=null`, judge calls 3-4x slower than expected (~50s vs ~14s).
Forensic baseline kept at
`docs/qc/baselines/_archive/2026-06-17-v11-broken-pre-reasoning-effort-patch.{json,md}`.

Pure stdlib (no pytest). Run inside the container:

    docker exec free-context-hub-ragas-judge-1 python -m unittest \\
        /app/test_reasoning_effort_patch.py -v

Or locally if you have the sidecar deps installed.
"""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch


class TestReasoningEffortPatch(unittest.TestCase):
    """Verify _build_openai_client wraps create() and injects extra_body."""

    def _build_with_mock(self, *, async_mode: bool):
        """Construct a client with the OpenAI cls fully mocked.

        Returns (built_client, mock_orig_create, mock_class_instance).
        """
        import main  # type: ignore[import-not-found]

        mock_orig_create = AsyncMock() if async_mode else MagicMock()
        # Build a minimal fake OpenAI client with a chat.completions.create attr.
        fake_client = MagicMock()
        fake_client.chat.completions.create = mock_orig_create

        fake_cls = MagicMock(return_value=fake_client)
        target = "openai.AsyncOpenAI" if async_mode else "openai.OpenAI"

        with patch(target, fake_cls):
            built = main._build_openai_client(
                "http://localhost:1234/v1", "sk-test", async_mode=async_mode
            )
        return built, mock_orig_create, fake_client

    def test_async_patch_installed(self):
        """The patched create must NOT be the original; it must be a wrapper."""
        client, orig_create, _ = self._build_with_mock(async_mode=True)
        # After patch the attribute must be a different callable than the original.
        self.assertIsNot(
            client.chat.completions.create,
            orig_create,
            "Async patch was not installed — _build_openai_client did not "
            "replace chat.completions.create with a wrapper.",
        )

    def test_sync_patch_installed(self):
        client, orig_create, _ = self._build_with_mock(async_mode=False)
        self.assertIsNot(
            client.chat.completions.create,
            orig_create,
            "Sync patch was not installed — _build_openai_client did not "
            "replace chat.completions.create with a wrapper.",
        )

    def test_async_injects_reasoning_effort_when_extra_body_absent(self):
        """When caller passes no extra_body, the wrapper adds it."""
        client, orig_create, _ = self._build_with_mock(async_mode=True)
        asyncio.run(
            client.chat.completions.create(
                model="google/gemma-4-26b-a4b",
                messages=[{"role": "user", "content": "hi"}],
            )
        )
        orig_create.assert_called_once()
        kwargs = orig_create.call_args.kwargs
        self.assertIn(
            "extra_body",
            kwargs,
            "wrapper did not inject extra_body — the reasoning_effort=none "
            "patch is broken and gemma will exhaust max_tokens on reasoning.",
        )
        self.assertEqual(
            kwargs["extra_body"].get("reasoning_effort"),
            "none",
            "wrapper injected extra_body but reasoning_effort is wrong "
            f"(got {kwargs['extra_body'].get('reasoning_effort')!r}); "
            "expected 'none'.",
        )

    def test_sync_injects_reasoning_effort_when_extra_body_absent(self):
        client, orig_create, _ = self._build_with_mock(async_mode=False)
        client.chat.completions.create(
            model="google/gemma-4-26b-a4b",
            messages=[{"role": "user", "content": "hi"}],
        )
        orig_create.assert_called_once()
        kwargs = orig_create.call_args.kwargs
        self.assertEqual(kwargs.get("extra_body", {}).get("reasoning_effort"), "none")

    def test_async_preserves_caller_extra_body_keys(self):
        """If caller already set extra_body keys, we MUST NOT clobber them."""
        client, orig_create, _ = self._build_with_mock(async_mode=True)
        asyncio.run(
            client.chat.completions.create(
                model="google/gemma-4-26b-a4b",
                messages=[{"role": "user", "content": "hi"}],
                extra_body={"top_logprobs": 5},
            )
        )
        kwargs = orig_create.call_args.kwargs
        eb = kwargs["extra_body"]
        self.assertEqual(eb.get("top_logprobs"), 5, "caller's key was clobbered")
        self.assertEqual(eb.get("reasoning_effort"), "none", "patch did not add its key")

    def test_async_respects_caller_override_of_reasoning_effort(self):
        """If the caller explicitly sets reasoning_effort, we must NOT override it."""
        client, orig_create, _ = self._build_with_mock(async_mode=True)
        asyncio.run(
            client.chat.completions.create(
                model="google/gemma-4-26b-a4b",
                messages=[{"role": "user", "content": "hi"}],
                extra_body={"reasoning_effort": "high"},
            )
        )
        kwargs = orig_create.call_args.kwargs
        self.assertEqual(
            kwargs["extra_body"].get("reasoning_effort"),
            "high",
            "patch used dict.setdefault — must preserve caller-provided value, "
            "not overwrite it.",
        )

    def test_extra_body_none_in_kwargs_is_handled_safely(self):
        """openai sdk allows extra_body=None as 'unset'; we must not crash."""
        client, orig_create, _ = self._build_with_mock(async_mode=True)
        asyncio.run(
            client.chat.completions.create(
                model="x",
                messages=[],
                extra_body=None,
            )
        )
        kwargs = orig_create.call_args.kwargs
        self.assertEqual(kwargs["extra_body"].get("reasoning_effort"), "none")


if __name__ == "__main__":
    unittest.main()
