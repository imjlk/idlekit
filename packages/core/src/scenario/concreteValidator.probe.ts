import { validateConcreteQuota } from "./concreteValidator";

const accepted = validateConcreteQuota({ count: 2 });
const rejected = validateConcreteQuota({ count: "no" });
if (!accepted.success || rejected.success || accepted.data.count !== 2) {
  throw new Error("probe validator mismatch");
}
console.log("probe-ok");
