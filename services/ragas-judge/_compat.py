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
        return _original_from_openai(client, **kwargs)

    instructor.from_openai = _patched_from_openai


# Apply on import
_install_vertexai_stub()
_patch_instructor_openai_mode()
