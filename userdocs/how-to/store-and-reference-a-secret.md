---
kind: how-to
---

# Store and reference a secret

Put a value in the vault, then pick it from any field that needs one.
Why every such field is a pick, not a text box, is in
[Secrets are references](../concepts/secrets.md).

## Store it

1. Open **Secrets**. The first time, press **Create vault**; after
   that, press **Unlock** if the vault is locked.
2. Press **New secret**.
3. Give it a **Title** you will recognise in a picker — *GitHub token*,
   say — and paste the value into **Password**. Username, Website,
   Notes and Tags are optional.
4. Press **Save**. The entry appears in the list; **Copy password**
   puts the value on your clipboard for ten seconds.

## Reference it from a step

1. Open the workflow and select the step, or open the Configure entry
   (an Integration, an MCP server, an AI provider, an Environment).
2. In the secret field, open the picker. Entries are grouped under
   **Vault** and **Secret sources**; **Add new secret** creates one
   without leaving the field.
3. Pick the entry. The field shows its title, never the value, and the
   run resolves it when the step executes.

## Use a value you keep elsewhere

1. Open **Secrets › Sources** and add the source — your shell
   environment, a `.env` file, or a password manager's CLI.
2. Its keys now appear in every picker under **Secret sources**. Pick
   one exactly as you would a vault entry; Mill reads the value at run
   time and never copies it into the vault.

## If the picker is greyed out

The vault is locked. Open **Secrets** and press **Unlock**, or search
"unlock vault" in the command palette (⌘K).
