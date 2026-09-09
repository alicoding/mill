import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build, defineConfig, type Plugin, type UserConfig } from "vite";

// Shared Vite library-mode config for the plugin-frame runtime's two
// IIFE entries (goal 0396): activation.js and bootstrap.js each run on
// an opaque-origin sandboxed frame with no bundler and no `import` of
// their own, so `formats: ['iife']` is the one output shape that works
// there (a widely-used editor's own webview shim ships the same way,
// built from TypeScript with esbuild -- goal 0396's Precedent). Vite
// 8's `build.lib` (frontend/node_modules/vite@8.2.2's own dist/node/
// index.d.ts, LibraryOptions/its own runtime check) refuses more than
// one entry when a format is iife/umd ("Multiple entry points are not
// supported when output formats include \"umd\" or \"iife\"."), so each
// entry gets its OWN build pass -- frameLibConfig is that one pass,
// parameterized by entry name, run twice: once per `npm run build:frame`
// CLI invocation below, and twice more (in-memory-adjacent, written to
// the same dist/plugin-frame/) by pluginFrameDevMiddleware so `task dev`
// serves the identical build, not the raw TypeScript.
export const FRAME_ENTRIES = ["activation", "bootstrap"] as const;
export type FrameEntryName = (typeof FRAME_ENTRIES)[number];

export function frameLibConfig(entry: FrameEntryName, outDir = "dist/plugin-frame"): UserConfig {
  return {
    // false, not the default "public": the main `vite build` pass
    // already copies frontend/public/** into dist/ once; this build
    // only ever emits the one entry file below, so copying public/
    // again here would duplicate every static asset into dist/
    // plugin-frame/ for nothing.
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      minify: true,
      lib: {
        entry: resolve(import.meta.dirname, `src/plugin-frame/${entry}.ts`),
        formats: ["iife"],
        // iife requires a global name even though neither entry ever
        // reads it back -- both are self-executing scripts with no
        // export a consumer could reach; nothing assigns it.
        name: `Mill${entry[0].toUpperCase()}${entry.slice(1)}Frame`,
        fileName: () => `${entry}.js`,
      },
      rolldownOptions: {
        // Same "no warning survives a build" posture as vite.config.ts's
        // own onLog: a stray transitive import (the risk goal 0396's own
        // brief calls out -- pulling a generated-bindings module into an
        // opaque-origin bundle) shows up as a bundler warning before it
        // ever reaches the freshness gate's grep.
        onLog(level, log) {
          if (level === "warn") {
            const message = `[plugin-frame build] warning treated as error: ${log.code ?? ""} ${log.message}`;
            console.error(message);
            process.exitCode = 1;
            throw new Error(message);
          }
        },
      },
    },
  };
}

// pluginFrameDevMiddleware serves /plugin-frame/activation.js and
// /plugin-frame/bootstrap.js from a real build of the two entries
// above (never the raw .ts, which is not valid to load with
// `<script src>` and would violate the frame's no-imports contract
// anyway) -- installed into the MAIN dev server (vite.config.ts), the
// same served paths dist/ answers in production. Builds once at
// server start and again whenever a file under src/plugin-frame/
// changes; every other request is served from the last successful
// build on disk, so a build failure never wedges an unrelated reload.
export function pluginFrameDevMiddleware(): Plugin {
  const root = import.meta.dirname;
  const distDir = resolve(root, "dist/plugin-frame");
  let building: Promise<void> | null = null;

  async function rebuildAll(): Promise<void> {
    for (const entry of FRAME_ENTRIES) {
      await build({ ...frameLibConfig(entry), root, configFile: false, logLevel: "warn" });
    }
  }

  return {
    name: "mill-plugin-frame-dev",
    configureServer(server) {
      building = rebuildAll().catch((err: unknown) => {
        server.config.logger.error(`[plugin-frame] initial build failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      server.watcher.on("change", (file) => {
        if (!file.replaceAll("\\", "/").includes("/src/plugin-frame/")) return;
        building = rebuildAll().catch((err: unknown) => {
          server.config.logger.error(`[plugin-frame] rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      });
      server.middlewares.use((req, res, next) => {
        const match = /^\/plugin-frame\/(activation|bootstrap)\.js$/.exec((req.url ?? "").split("?")[0]);
        if (!match) { next(); return; }
        void (building ?? Promise.resolve()).then(() => {
          try {
            const code = readFileSync(resolve(distDir, `${match[1]}.js`), "utf8");
            res.setHeader("Content-Type", "text/javascript");
            res.end(code);
          } catch {
            res.statusCode = 503;
            res.end("plugin-frame runtime failed to build; check the dev server log");
          }
        });
      });
    },
  };
}

// CLI entry point (`vite build --config vite.config.frame.ts`): reads
// MILL_FRAME_ENTRY to pick which of the two single-entry passes this
// invocation is -- package.json's build:frame script runs it twice.
export default defineConfig(() => {
  const entry = process.env.MILL_FRAME_ENTRY as FrameEntryName | undefined;
  if (!entry || !(FRAME_ENTRIES as readonly string[]).includes(entry)) {
    throw new Error(`vite.config.frame.ts needs MILL_FRAME_ENTRY set to one of ${FRAME_ENTRIES.join(", ")}`);
  }
  return frameLibConfig(entry);
});
