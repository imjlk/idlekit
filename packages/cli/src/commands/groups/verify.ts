import { defineGroup } from "../../runtime/command";
import verifyRuntimeCommand from "../verifyRuntime";

export default defineGroup({
  name: "verify",
  description: "Verify a game runtime against idlekit",
  commands: [verifyRuntimeCommand],
});
