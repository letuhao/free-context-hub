# Governance & Decisions

Layered on [topics](06-coordination.md), these primitives let a group of actors make
and record **collective decisions** — approvals, votes, intake triage, and dispute
resolution — with a durable audit trail. They implement the governance phase of the
Dead Light Framework (see [ROADMAP.md](../../ROADMAP.md)).

## Key concepts

- **Request-Approval** — an artifact change is submitted as a request that routes
  through a **Delegation-of-Authority (DoA) matrix**, possibly multi-level. Each step
  is endorsed, returned, or rejected.
- **Motions & voting** — a **motion** is proposed to a **decision body** (a weighted
  electorate), seconded, balloted, and tallied after a deadline. Votes snapshot their
  weight at cast time; a motion can be **vetoed**.
- **Proxies** — body members can grant a proxy to vote on their behalf.
- **Intake mailbox** — a project inbox for violation reports, suggestions, and
  requests; items are triaged by routing them to a task, request, motion, or dispute.
- **Disputes** — a formal dispute over an artifact, opened within a topic and driven
  to a terminal resolution.
- **Review queue** — AI-generated lessons enter `pending-review`; humans approve or
  return them.

## How to use it

### MCP (agents)

**Approval routing**: `submit_request`, `list_requests`, `get_request`,
`decide_request_step`

**Motions & voting**: `propose_motion`, `second_motion`, `cast_vote`, `veto_motion`,
`tally_motion`, `list_motions`, `get_motion`

**Decision bodies & proxies**: `create_decision_body`, `add_body_member`,
`grant_proxy`, `revoke_proxy`, `list_proxies`, `get_decision_body`,
`list_decision_bodies`

**Intake**: `submit_intake`, `triage_intake`, `dismiss_intake`, `get_intake`,
`list_intake`

**Disputes**: `open_dispute`, `resolve_dispute`, `get_dispute`, `list_disputes`

**Review**: `submit_for_review`, `list_review_requests`

### REST

- `/api/topics/:id/requests` · `/api/topics/:id/motions` · `/api/decision-bodies`
- `/api/intake` · `/api/topics/:id/disputes`
- `/api/projects/:id/review-requests`

### GUI

- **Review Inbox** (`/review`) — approve/return AI-generated and submitted lessons.
- **Authorization** (`/authorization`), **Identity** (`/identity`), **Delegation**
  (`/delegation`) — administrative governance views.

## Safety note

Governance and authorization primitives are **safety-sensitive**. Changes to them go
through a cold-start adversary review (see the project's
[safety-sensitive review policy](../../CLAUDE.md)).

## Related

- [Coordination](06-coordination.md) · [Access Control & Identity](08-access-control-identity.md)
