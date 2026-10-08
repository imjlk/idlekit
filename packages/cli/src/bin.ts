import { cli } from "./main";
import { formatCliError, toCliError } from "./errors";

// A dedicated executable entry avoids relying on import.meta.main after bundling.
try { await cli.run(process.argv.slice(2)); }
catch (error) { console.error(formatCliError(toCliError(error))); process.exitCode = 1; }
