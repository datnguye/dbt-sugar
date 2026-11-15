---
name: spec-change
description: Turn a request into an accepted contract change before any code - a proposal in docs/proposals/, the spec delta in docs/spec.md and, when a decision changes, a decision record. Use first for any new feature, behaviour change or new data source. Writes docs only.
---

# Spec change

No code in this skill. The output is a contract someone else could build from.

1. **Read** `docs/spec.md` and `docs/decisions/README.md`. Find the sections the request touches.
2. **Verify facts.** If it depends on dbt output (OTel records, `dbt.log` lines, manifest or run_results fields), run the `data-prober` subagent on a real dbt v2 project first. Never write a spec line about a file shape you haven't measured.
3. **Write the proposal**: copy `docs/proposals/0000-template.md` to `docs/proposals/NNNN-<slug>.md` (next number). Fill every section; "Out of scope" is not optional.
4. **Apply the spec delta** to `docs/spec.md`: describe behaviour, not tasks. No status, no TODOs. Use the words the spec already uses for a concept.
5. **Decisions:** if the change contradicts or adds an architectural decision, add `docs/decisions/NNNN-<slug>.md` from the template and list it in the index.
6. If the change moves a flow in `docs/architecture.html` (startup, live loop, keeping invocations, Diff tab), update that flow too.
7. Run the `spec-reviewer` subagent on the docs diff. Fix until it reports no blockers.
8. Show the user the proposal path and the spec delta in one short block, and ask to accept. Code starts with `/build` after a yes.
