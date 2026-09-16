This file for brain-dumping and future idea for gws-docs-edit. Nothing in this file is finalized. 

Agents: don't consider this file or contents in your answers unless I tell you to, don't edit this file unless I tell you to.

# Idea: review types and confirm are strict and correct and not overly permiscuous
# Idea: discover and review tech debt

# Idea: review docs

A lot of changes have happened in this doc including being converted from a skill+cli to a independent mcp app. I suspect the docs have drifted and need fixes and refocusing. Thoughts?


# Idea: ref oriented/leading variable, action, attr, function naming

Adopt naming to be more ref/target oriented/leading. For example, createDoc --> docCreate. And order alphabetically in code, types, docs, help, by default unless there is reason not to.

# Idea: nested list item support

How are we currently supporting nested list items? Are we doing enough? For example, indicating level in query, markdown ss, supporting in apply when in markdown insert payloads.

# Idea: cleanup SKILL.md

including tips/rules that better belong in run command's help notes

# Idea: Align code with AGENTS.md code quality rules

# Idea: less reliance on gws

I use gws, but not everyone may.

Towards that, we'd alternate, direct auth without reliance on gws.

- the default should be default auth
- need to extend auth to get/manage it's own tokens instead of gws
- need to brainstorm docs, how to handle/setup a google cloud app
- need to make it easy for users to setup/use gws
- Consider sharing gws env vars, and/or instruct to set our own with special instructions for gws