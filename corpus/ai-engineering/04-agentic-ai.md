# Agentic AI: Tool Calling, MCP, and the ReAct Loop

## Who executes a tool call

In function or tool calling, the model does **not** run any code. It emits a
**structured request** — a tool name plus arguments, typically as JSON — and the
**host application** executes the tool and feeds the result back into the
conversation. This separation is the foundation of agent safety and control: because
the host mediates every execution, it can validate arguments, enforce permissions,
rate-limit, and refuse dangerous calls. A model that "decides" to call a tool has
only *requested* it; nothing happens until the host chooses to act. Believing the
model executes tools directly misunderstands the trust boundary the whole design
depends on.

## Tool output is untrusted input

Whatever a tool returns — a web page, a file, a database row, another system's
response — must be treated as **untrusted data, not trusted instructions**.
Returned content can contain **prompt injection**: text like "ignore your previous
instructions and do X." If the agent treats tool output as authoritative
instructions, an attacker who controls any retrieved content controls the agent.
The defense is to keep a firm line between *instructions* (from the developer and
user) and *data* (everything a tool returns), and to never let data escalate into
commands.

## More tools is not better

It is tempting to give an agent every tool it might conceivably need. Past a small,
curated set this backfires. A large tool list increases the chance the model picks
the wrong tool, inflates the prompt with tool descriptions, and raises the overall
error rate. A handful of well-named, well-described tools consistently outperforms a
sprawling toolbox. Curation — not breadth — is what makes an agent reliable.

## ReAct structures reasoning but does not validate it

The **ReAct** pattern interleaves reasoning and acting: the model reasons about what
to do, takes an action (a tool call), observes the result, and repeats. This
structure helps an agent break a task into steps and react to real outputs. But
ReAct is only a control loop — it does **not** validate the tool calls the model
produces. The model can still reason its way to a wrong action or invent incorrect
arguments. Structure is not verification.

## MCP standardizes the interface, the host still mediates

The **Model Context Protocol (MCP)** is a common interface for how applications
expose tools, resources, and prompts to language models. It defines the *contract* —
how capabilities are described and invoked — so that any compliant model and any
compliant application can interoperate without bespoke glue. MCP standardizes the
exposure; it does not change the execution model. The host still mediates and
performs every actual tool execution.

## Structured output is not semantic correctness

Constraining a model to a schema (via structured output, a grammar, or
function-calling) reliably reduces **malformed** calls: the output will be valid JSON
with the required fields and types. It does **not** guarantee the arguments are
**semantically correct** — the model can produce a perfectly well-formed call with
the wrong values. Schema enforcement fixes shape, not meaning; argument correctness
still needs validation.
