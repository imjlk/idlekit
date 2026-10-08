import { defineGroup } from "../../runtime/command";
import replayVerifyCommand from "../replayVerify";

export default defineGroup({
  name: "replay",
  description: "Replay artifact commands",
  commands: [replayVerifyCommand],
});
