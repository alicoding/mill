# What plugins expose to agents

A plugin extends what you can do in Mill. Declaring a tool is what
extends what an **agent** can do — the same action, reached from the
other side. Nothing a plugin builds is automatically callable: the
plugin author names the tools they want reachable, and you decide
whether that plugin runs at all.

## See what is installed

`list_plugins` answers with every plugin, whether it is turned on, and
what it contributes:

```
[
  { "id": "mill-textcase", "name": "Text case", "version": "1.0.0",
    "enabled": true,
    "contributions": {
      "canvasObjects": [], "commands": [], "steps": ["text-case"],
      "tools": ["change_text_case"], "views": 0, "captures": 0 } }
]
```

A plugin you turned off is still listed, with `enabled: false`, so an
agent can tell "turned off" from "not installed". It contributes
nothing callable while it is off.

## Call a plugin's tool

Every reachable tool appears in the tool list as
`plugin_<pluginId>_<toolName>` — `plugin_mill-textcase_change_text_case`
for the example above. The arguments are the plugin author's own: they
wrote the tool's input contract, and the agent reads it directly.

Turning the plugin off in Settings › Extensions removes its tools from
the list straight away. Turning it back on, or reloading it after an
edit, puts them back. No restart either way.

## What a plugin's steps and kinds look like

`list_step_types` includes every step a turned-on plugin contributes,
marked `"source": "plugin:<pluginId>"`. Mill's own steps carry no
source. An agent authoring a workflow composes both the same way.

`atlas_list_kinds` reports `boardObjectKinds`: every canvas noun
`atlas_create_board_object` accepts, with the same `source` marking on
the ones a plugin contributes. An agent can put a plugin's own object
on your board.

## How a write parks

A tool the author declared as a write goes through exactly the gate
every other Mill write takes. It needs **Allow MCP clients to import
data** turned on in Settings, and then it parks for your approval — the
prompt shows the author's own sentence and what this call would do it
with:

```
Clips a page onto the board. -- url: https://example.com
```

Approve it and it runs; deny it and nothing happened. A read-effect
tool answers straight away and never parks.

A plugin's own guarded actions — opening a URL, reading a folder,
writing content — still take their own guardrail check when they run.
Being reachable by an agent never widens what a plugin may do.
