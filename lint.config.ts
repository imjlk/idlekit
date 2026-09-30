import { graphLintConfig } from "./evidence.config";

/**
 * Discovered by the evidence program. Inventory programs set
 * `@ttsc/lint` `enabled: false` so they do not load this graph:
 * their Program does not contain the hosts.
 */
export default graphLintConfig;
