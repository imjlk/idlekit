import { defineGroup } from "@bunli/core";
import replayVerifyCommand from "../replayVerify";

export default defineGroup({
  name: "replay",
  description: "Replay artifact commands",
  commands: [replayVerifyCommand],
});
