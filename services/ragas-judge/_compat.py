"""Phase 16 Sprint 16.2 — ragas 0.4.x compat shim.

ragas 0.4.x has a top-level eager import in ragas/llms/base.py:
    from langchain_community.chat_models.vertexai import ChatVertexAI

That submodule was REMOVED from langchain-community when the integration
moved into its own `langchain-google-vertexai` package (langchain-community
≥0.3). ragas's setup.py doesn't pin langchain-community, so pip resolves to
the latest version and the import fails on container startup.

We don't use the Vertex AI backend (LM Studio is the judge LLM). So we
register a stub module with a dummy ChatVertexAI class BEFORE ragas is
imported anywhere. ragas's vertexai factory is never called by our /score
endpoint, so the stub is never exercised — it just satisfies the eager
import.

REMOVE THIS SHIM when ragas ships a patch updating the import path to
`from langchain_google_vertexai import ChatVertexAI`. Track upstream at:
    https://github.com/explodinggradients/ragas

Import this module FIRST, before any ragas / langchain import in the
application. main.py does `from _compat import *` at the very top.
"""

from __future__ import annotations

import sys
import types

_STUB_MODULE_NAME = "langchain_community.chat_models.vertexai"


def _install_vertexai_stub() -> None:
    """Register a dummy module at the missing import path."""
    if _STUB_MODULE_NAME in sys.modules:
        # Real module exists — nothing to stub
        return

    # Verify the real module is genuinely missing (don't shadow a working install)
    try:
        import langchain_community.chat_models.vertexai  # noqa: F401

        # Real one is importable; do nothing
        return
    except ImportError:
        # Genuinely missing — install our stub
        pass

    stub = types.ModuleType(_STUB_MODULE_NAME)
    stub.__doc__ = (
        "Stub installed by services/ragas-judge/_compat.py to satisfy ragas's "
        "stale eager import. The real ChatVertexAI lives in "
        "langchain_google_vertexai now. This stub is never invoked at runtime "
        "because our /score endpoint doesn't use the Vertex backend."
    )

    class ChatVertexAI:  # noqa: D401
        """Stub for langchain_community.chat_models.vertexai.ChatVertexAI.

        Never instantiated at runtime — only satisfies ragas's import.
        Raises RuntimeError if anyone actually tries to use it.
        """

        def __init__(self, *args, **kwargs) -> None:
            raise RuntimeError(
                "ChatVertexAI stub invoked — this should not happen. "
                "If you need Vertex backend, remove the _compat.py shim "
                "and install langchain-google-vertexai instead."
            )

    stub.ChatVertexAI = ChatVertexAI
    sys.modules[_STUB_MODULE_NAME] = stub


def _patch_openai_reasoning_content_fallback() -> None:
    """For reasoning models (qwen3.6, deepseek-r1, o1, etc.) LM Studio returns
    the structured-output JSON in ``message.reasoning_content`` and leaves
    ``message.content`` empty. Instructor reads ``content`` only, so the JSON
    parse fails with "EOF while parsing".

    This shim wraps ``AsyncCompletions.create`` and ``Completions.create`` and,
    when the returned message has empty ``content`` but a non-empty
    ``reasoning_content``, copies the latter into the former so downstream
    parsers (instructor, ragas) work transparently.

    Tracked as Phase 16 OPEN-1; this is the proper fix.

    REMOVE when either:
      - LM Studio normalizes content field for reasoning models, OR
      - ragas / instructor learns to read reasoning_content directly
    """
    try:
        from openai.resources.chat.completions import AsyncCompletions, Completions
    except ImportError:
        return

    def _maybe_fixup(result):
        """Mutate the response in place so any consumer (instructor, raw caller)
        sees structured output in `content`."""
        choices = getattr(result, "choices", None)
        if not choices:
            return result
        for choice in choices:
            msg = getattr(choice, "message", None)
            if not msg:
                continue
            content = getattr(msg, "content", None)
            reasoning = getattr(msg, "reasoning_content", None)
            if (not content) and reasoning:
                # Strip trailing tab/space artifacts some reasoning models append
                msg.content = reasoning.strip()
        return result

    _orig_async = AsyncCompletions.create
    _orig_sync = Completions.create

    async def _async_create(self, *args, **kwargs):
        result = await _orig_async(self, *args, **kwargs)
        return _maybe_fixup(result)

    def _sync_create(self, *args, **kwargs):
        result = _orig_sync(self, *args, **kwargs)
        return _maybe_fixup(result)

    AsyncCompletions.create = _async_create  # type: ignore[method-assign]
    Completions.create = _sync_create  # type: ignore[method-assign]


def _patch_instructor_openai_mode() -> None:
    """Swap instructor.Mode.JSON → JSON_SCHEMA for the OpenAI provider.

    ragas/llms/base.py hardcodes `mode=instructor.Mode.JSON` when wrapping the
    OpenAI client. Mode.JSON sends `response_format={"type": "json_object"}`
    which is OpenAI-only. LM Studio (and many other OpenAI-compatible
    endpoints) reject this with `400 'response_format.type' must be
    'json_schema' or 'text'`.

    Instructor's Mode.JSON_SCHEMA sends `response_format={"type": "json_schema",
    "json_schema": {...}}` which IS supported by LM Studio and is also valid
    on real OpenAI for newer models.

    REMOVE when ragas allows configuring the instructor mode via llm_factory
    kwargs OR auto-detects local OpenAI-compat endpoints.
    """
    try:
        import instructor
    except ImportError:
        return  # instructor not yet installed; nothing to patch

    _original_from_openai = instructor.from_openai
    target_mode = getattr(instructor.Mode, "JSON", None)
    schema_mode = getattr(instructor.Mode, "JSON_SCHEMA", None)
    if target_mode is None or schema_mode is None:
        return  # Mode names not present; bail without patching

    def _patched_from_openai(client, **kwargs):
        # Only rewrite when the caller asked for JSON — leave TOOLS, FUNCTIONS,
        # MD_JSON, etc. alone for whoever wants those modes deliberately.
        if kwargs.get("mode") == target_mode:
            kwargs["mode"] = schema_mode
        wrapped = _original_from_openai(client, **kwargs)
        # Phase 17.x: tighten instructor's default retry policy. Instructor
        # uses tenacity with `wait_random_exponential(multiplier=1, max=15)`
        # which produces 15-30s gaps in our trace when the LLM returns
        # imperfect JSON. We override `default_max_retries` to 1 so a single
        # failure surfaces immediately to our outer _retry_on_transient
        # layer (which has its own bounded backoff). User-observable effect:
        # idle gaps between LM Studio calls drop from ~30s to ~1s.
        try:
            if hasattr(wrapped, "default_max_retries"):
                wrapped.default_max_retries = 1
        except Exception:
            pass
        return wrapped

    instructor.from_openai = _patched_from_openai


# Apply on import (order matters: stub the missing module BEFORE anything
# tries to import ragas; patch openai BEFORE any client is constructed)
_install_vertexai_stub()
_patch_openai_reasoning_content_fallback()
_patch_instructor_openai_mode()
