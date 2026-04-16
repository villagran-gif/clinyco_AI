#!/usr/bin/env node
import { runZapCli } from "../_shared/cli.js";
import { getDeal } from "../_shared/sell-client.js";
import { handleNormalizeRutOnDealCreate } from "./index.js";

runZapCli({
  name: "rut-normalizado-crear-trato",
  fetchById: (id) => getDeal(id),
  handler: (deal, opts) => handleNormalizeRutOnDealCreate(deal, opts)
});
