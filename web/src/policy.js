// Client-side mirror of server/store.js applyAccountPolicy — the draft on
// screen must always show the placement a save would produce:
//   1 hop   -> primary account
//   2+ hops -> hop 1 (disposable front) on the first burner, backbone primary
// Hops with accountPinned are manual overrides and keep their account.
export function applyAccountPolicy(chain, accounts) {
  if (!chain || !Array.isArray(chain.hops)) return chain;
  const list = Array.isArray(accounts) ? accounts : [];
  const primaryId = list[0]?.id || '';
  const burnerId = list.find((a) => a.burner)?.id || '';
  const frontId = chain.hops.length > 1 && burnerId ? burnerId : primaryId;
  chain.hops.forEach((h, i) => {
    if (h.accountPinned) return;
    h.accountId = i === 0 ? frontId : primaryId;
  });
  return chain;
}
