# Netrc file

Turns the machines in a `.netrc` file into secrets: every block
contributes `<host>/login` and `<host>/password`, which then appear in
every secret picker beside the vault's own entries. Titles only — a
value is read from the file at the moment it is used and never copied
anywhere.

## Settings

None.

## Capabilities

`read-file` — the source reads the file the user pointed it at, and
nothing else on the machine.

## Try it

Copy the `netrc-secrets` folder into Mill's plugins folder (Settings >
Extensions > Open plugins folder) and reload plugins. Then open
Secrets > Sources, add a source, pick "Netrc file" as its kind, and
leave the file at `~/.netrc`.
