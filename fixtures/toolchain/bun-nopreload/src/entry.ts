import typia from "typia";

interface Quota {
  count: number;
}

const validate = typia.createValidate<Quota>();
const accepted = validate({ count: 2 });
const rejected = validate({ count: "no" });
if (!accepted.success || rejected.success) {
  throw new Error("nopreload validator mismatch");
}
console.log("nopreload-ok");
