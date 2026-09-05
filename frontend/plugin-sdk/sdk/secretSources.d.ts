/** The doors one source call receives. There is no other way to reach
 * the machine from a source: no network, no command, no path outside
 * the one the user configured. */
export interface SecretSourceCtx {
    /** The file or folder the user configured this source with. */
    path: string;
    /** Reads the configured file. For a folder-shaped source, pass a
     * name inside that folder; anything that would leave the folder is
     * refused. */
    readFile: (relative?: string) => string;
    /** Lists the folder's own files, optionally narrowed by a glob such
     * as `"*.env"`. Folder-shaped sources only. */
    listFiles: (pattern?: string) => string[];
}
/** One source's implementation. `list` and `resolve` are required and
 * must match the "list" and "resolve" capabilities the manifest
 * declares; add `discover` or `import` only alongside their own
 * declared capability. */
export interface SecretSourceDecl {
    /** Returns the NAMES this source holds — never a value. A name is
     * what a user picks in a secret picker, so make it readable
     * ("api.example.com/password"). */
    list: (ctx: SecretSourceCtx) => string[];
    /** Returns one name's value. Return an empty string when the source
     * does not hold that name. */
    resolve: (ctx: SecretSourceCtx, key: string) => string;
    /** Offers stores found under the configured folder, so a user can
     * add them as sources of their own. Only for a folder-shaped or
     * pathless source. */
    discover?: (ctx: SecretSourceCtx) => {
        path: string;
        label: string;
    }[];
    /** Returns several names' values at once, for the one case reading
     * them one at a time would re-read the same file repeatedly. */
    import?: (ctx: SecretSourceCtx, keys: string[]) => Record<string, string>;
}
/** How a source's path field renders: `"file"` asks for one file,
 * `"folder"` for a folder to read inside, `"none"` for a store that
 * needs no path at all. */
export type SecretSourcePathKind = 'file' | 'folder' | 'none';
/** What contributes.secretSources declares for one source: the id
 * secrets.js registers under, the label the picker offers it as (40
 * characters or fewer), how its path field renders, and which of the
 * four functions it implements. */
export interface SecretSourceContribution {
    id: string;
    label: string;
    path: {
        kind: SecretSourcePathKind;
        label: string;
        placeholder?: string;
        default?: string;
    };
    capabilities: ('list' | 'resolve' | 'discover' | 'import')[];
}
