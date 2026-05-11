#!/usr/bin/env node
import { getDeal } from "../_shared/sell-client.js";
import { handleMetaConversionLead } from "./index.js";
import { runZapCli } from "../_shared/cli.js";

runZapCli({
  name: "meta-conversion-leads",
  fetchById: getDeal,
  handler: handleMetaConversionLead,
});
