"""Phase 17 Bug 2a fix — unit test for contexts_text formatting in main.py /score.

Validates the path-prefix logic that gives ragas's NLI verifier the file path
alongside the snippet text. Before this fix, ContextItem.id was dropped on the
floor and "located in src/foo.ts" claims were systematically rejected even
when the file IS the cited context. See the closeout at
`docs/qc/2026-05-25-phase-17-ragas-judge-fix-a-b.md` for the audit story.

This is the smallest viable unit test for the sidecar — pure stdlib, no
pytest. Run inside the container:

    docker exec free-context-hub-ragas-judge-1 python -m unittest \\
        /app/test_contexts_format.py -v

Or locally if you have the sidecar deps installed.
"""

from __future__ import annotations

import unittest
from dataclasses import dataclass


# Mirror of ContextItem; the test exercises the formatting logic
# in isolation so we don't have to spin up the whole FastAPI stack.
@dataclass
class _Ctx:
    id: str | None
    text: str


def _format(contexts: list[_Ctx]) -> list[str]:
    """Copy of the production line in main.py /score endpoint."""
    return [
        f"File: {c.id}\n{c.text}" if c.id else c.text
        for c in contexts
    ]


class ContextFormatTests(unittest.TestCase):
    def test_with_id_prepends_file_header(self):
        out = _format([_Ctx(id="src/foo.ts", text="export function bar()")])
        self.assertEqual(out, ["File: src/foo.ts\nexport function bar()"])

    def test_empty_id_falls_back_to_text_only(self):
        # id=None or "" — fallback path (legacy callers, no file association)
        out = _format([_Ctx(id=None, text="lonely text")])
        self.assertEqual(out, ["lonely text"])
        out = _format([_Ctx(id="", text="lonely text")])
        self.assertEqual(out, ["lonely text"])

    def test_preserves_order(self):
        out = _format([
            _Ctx(id="a", text="A"),
            _Ctx(id="b", text="B"),
            _Ctx(id="c", text="C"),
        ])
        self.assertEqual(out, ["File: a\nA", "File: b\nB", "File: c\nC"])

    def test_multiline_text_unchanged_after_prefix(self):
        body = "line1\nline2\nline3"
        out = _format([_Ctx(id="k", text=body)])
        self.assertEqual(out, [f"File: k\n{body}"])

    def test_empty_contexts_list(self):
        self.assertEqual(_format([]), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
