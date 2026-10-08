import { defineGroup } from "../../runtime/command";
import strategiesListCommand from "../strategies";

export default defineGroup({
  name: "strategies",
  description: "Strategy registry commands",
  commands: [strategiesListCommand],
});
