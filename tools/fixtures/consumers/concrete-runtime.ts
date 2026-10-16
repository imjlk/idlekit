import { validateConcreteQuota } from "@idlekit/core";

const accepted = validateConcreteQuota({ count: 2 });
const rejected = validateConcreteQuota({ count: "no" });
if (!accepted.success || rejected.success || accepted.data.count !== 2) throw new Error("published validator mismatch");
console.log("published-ok");
