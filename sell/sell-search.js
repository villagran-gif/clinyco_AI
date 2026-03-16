export function buildSellSearchInput(state) {
  return {
    rut: state?.contactDraft?.c_rut || null
  };
}
