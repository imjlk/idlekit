import { validateQuota } from "./quota";

const accepted = validateQuota({ count: 2 });
const rejected = validateQuota({ count: "no" });
if (!accepted.success) {
  throw new Error("typia rejected a valid quota");
}
if (rejected.success) {
  throw new Error("typia accepted an invalid quota");
}
console.log("typia-ok");
