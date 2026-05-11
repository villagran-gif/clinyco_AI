#!/usr/bin/env node
import { runZapCli } from "../_shared/cli.js";
import { sellFetch } from "../_shared/sell-client.js";
import { handleNormalizeRutOnContactCreate } from "./index.js";

async function getContact(id) {
  const data = await sellFetch(`/contacts/${id}`);
  return data.data || data;
}

runZapCli({
  name: "normaliza-rut-contacto",
  fetchById: getContact,
  handler: (contact, opts) => handleNormalizeRutOnContactCreate(contact, opts)
});
