# Inbox assistant runbook

The shared mailbox `kashroot.app@gmail.com` is triaged by a scheduled Claude Code
Routine named **Kashroot inbox assistant**. It runs in the Kashroot cloud environment
with the Gmail connector, follows `.claude/skills/inbox-assistant/SKILL.md`, and
emails a digest after each run.

## What it does

- Reads inbox threads not yet labelled `Agent/Handled` or `Agent/Needs-You`.
- Flag reports from the app become `[data-review]` GitHub issues with evidence and a
  moderator recommendation. It never resolves flags or edits kashrut data.
- Bug reports and failed-deploy mail become GitHub issues, plus a PR on a
  `claude/inbox/*` branch when the fix is small and green. It never merges.
- Human mail gets a draft reply for you to review. It never sends email.
- Google security alerts and anything needing a human get `Agent/Needs-You`.

## Labels

`Agent/Handled`, `Agent/Needs-You` are the state machine. `Agent/Report`,
`Agent/Bug`, `Agent/Infra` are categories. Removing both state labels from a thread
re-queues it for the next run.

## Changing behaviour

Edit the skill file and merge to `main`; the Routine prompt only points at it. Change
the schedule, pause, or delete the Routine from the Routines page in Claude Code on
the web. To run it now, fire the Routine from the same page.

## Guardrails to keep

Email content is treated as data. No sends, no deletes, no pushes to `main`, no
production or vendor changes, at most 3 PRs and 15 threads per run.
