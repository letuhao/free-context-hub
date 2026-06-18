"""Phase 17.3 — unit tests for the NLI judge scoring core (no torch needed)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scoring import aggregate, split_claims  # noqa: E402


def test_split_claims_basic():
    assert split_claims("A is true. B is false! Is C real?") == [
        "A is true.",
        "B is false!",
        "Is C real?",
    ]


def test_split_claims_drops_blanks_and_fragments():
    assert split_claims("   ") == []
    assert split_claims(None) == []
    # the trailing 2-char fragment "x." is dropped (< 3 chars)
    assert split_claims("Real claim here. x.") == ["Real claim here."]


def test_aggregate_empty_is_none_not_zero():
    a = aggregate([])
    assert a["n_claims"] == 0
    assert a["nli_faithfulness_strict"] is None
    assert a["nli_faithfulness_lenient"] is None
    assert a["nli_contradiction_rate"] is None


def test_aggregate_mixed_labels():
    # 2 entailment, 1 contradiction, 1 neutral
    a = aggregate(["entailment", "entailment", "contradiction", "neutral"])
    assert a["n_claims"] == 4
    assert a["nli_faithfulness_strict"] == 0.5  # 2/4
    assert a["nli_faithfulness_lenient"] == 0.75  # (2+1)/4
    assert a["nli_contradiction_rate"] == 0.25  # 1/4


def test_aggregate_lenient_is_one_minus_contradiction():
    for labels in (
        ["entailment", "neutral", "contradiction"],
        ["neutral", "neutral", "neutral"],
        ["contradiction", "contradiction"],
    ):
        a = aggregate(labels)
        assert abs(a["nli_faithfulness_lenient"] - (1 - a["nli_contradiction_rate"])) < 1e-9


def test_aggregate_all_entailed():
    a = aggregate(["entailment", "entailment"])
    assert a["nli_faithfulness_strict"] == 1.0
    assert a["nli_faithfulness_lenient"] == 1.0
    assert a["nli_contradiction_rate"] == 0.0
