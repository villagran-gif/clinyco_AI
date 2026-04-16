#!/usr/bin/env node
import { runZapCli } from "../_shared/cli.js";
import { getDeal } from "../_shared/sell-client.js";
import { handleUpdateComisiones } from "./index.js";

runZapCli({
  name: "update-comisiones",
  fetchById: (id) => getDeal(id),
  handler: (deal, opts) => handleUpdateComisiones(deal, opts)
});
