---
id: corpus/developer/version-control/git-merge-rebase-trunk
domain: developer
subdomain: version-control
topic: git-merge-rebase-trunk
sources:
  - "git-scm.com — docs + Pro Git book (read 2026-06-16, OPEN, paraphrased)"
  - "atlassian.com/git/tutorials — merging vs rebasing (READ, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Git — merge vs rebase, and branching strategy

## Merge vs rebase
- **Merge** integrates branches by creating a **merge commit** that ties the two histories together.
  It is **non-destructive** — existing commits are preserved, so history shows the true, branching
  shape (with merge commits).
- **Rebase** moves/replays your branch's commits **on top of** another branch's tip, producing a
  **linear** history. It **rewrites commits** (new commit hashes for the replayed commits).
So merge and rebase do **not** produce identical history: merge keeps a branching graph with a merge
commit; rebase yields a straight line and rewritten commit IDs.

## The golden rule of rebase
**Never rebase commits that have been pushed/shared** with others. Rebasing rewrites history; if
others have based work on those commits, rewriting them diverges everyone's history and forces
painful recovery. Rebasing **shared/public branches is not safe** — rebase only local, un-pushed work.

## Fast-forward
If the target branch has no new commits since you branched, Git can **fast-forward** — just move the
branch pointer forward, no merge commit needed. `--no-ff` forces a merge commit to record that a
branch existed.

## Branching strategies
- **Trunk-based development** — everyone integrates into one main branch ("trunk") frequently, using
  **short-lived** feature branches (hours/days), behind feature flags if needed. Optimizes for
  continuous integration and fewer painful merges.
- **Long-lived feature branches** (e.g. classic Gitflow) isolate work longer but accumulate
  divergence and **merge conflicts/integration risk** the longer they live.
The modern CI/CD lean is trunk-based with small, frequent, reversible changes.
