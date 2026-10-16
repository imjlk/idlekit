import { validateConcreteQuota } from "@idlekit/core";

const accepted = validateConcreteQuota({ count: 2 });
if (!accepted.success) throw new Error("types");
export const count: number = accepted.data.count;
