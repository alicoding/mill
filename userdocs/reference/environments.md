---
kind: reference
---

# Environments

An **environment** is a named set of variables a run selects. One
workflow, one integration, two stages: the only thing that changes
between them is which environment the run picked.

Environments live in **Configure › Environments**.

## Write a variable into a request

In an integration's URL, a header value, or its body, write a variable
name in double braces:

```
{{API_BASE}}/v1/updates
```

When a run starts, Mill replaces every reference with the selected
environment's value and sends the result. Nothing is stored resolved,
and nothing is guessed: a name the environment does not define stops the
run before it starts, naming the variable.

To send the braces themselves, escape the opening pair with a backslash:
`\{{API_BASE}}` is sent as `{{API_BASE}}`. Text that is not a variable
name — a JSON body's own braces, for instance — is left exactly as
written.

## Add an environment

1. Open **Configure › Environments** and choose **New environment**.
2. Give it a **Label**: the name a run picks it by, such as Sandbox or
   Production.
3. Add a variable: a **name** and a **value**.

A variable name starts with a letter or underscore, then letters, digits
or underscores. No two variables in one environment may share a name.

## Plain and secret variables

Tick **Secret** beside a variable and its value becomes a pick from your
secret store instead of typed text. The environment holds the pointer,
never the secret itself, so an exported environment carries no
credentials.

A secret variable with nothing picked yet shows **Needs a value** on the
row. It resolves to an empty string until you pick one.

## Choosing an environment for a run

- A workflow's **Environment** on the canvas is the stage its runs use.
  Scheduled runs, triggered runs, and runs started by another workflow
  all use it, because there is nobody to ask.
- Running from the canvas or the workflow list opens the run dialog with
  that environment already chosen. Pick another for this one run, or
  pick **None**.

The run records the environment it actually started in. Activity shows
it per run, and a redrive replays that same stage even if the workflow's
default has moved on since.

## Shell environments

An execution environment (**Configure › Execution Environments**) can
borrow a shared environment's variables through **Variables from
environment**. Those variables are added under the shell's own, so a
name the shell sets itself wins.

## What you cannot delete

An environment a workflow targets, or a shell borrows, cannot be
deleted. Mill names what still uses it, so you can clear the reference
first.

## For agents

`mill://environments` lists every environment, its label, and its
variable names, each marked plain or secret. Values never cross that
boundary — an agent can see that `{{API_BASE}}` will resolve without
being told what it resolves to.
