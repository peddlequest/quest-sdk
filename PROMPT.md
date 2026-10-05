# A prompt for Claude: integrate PeddleQuest

Paste everything in the box below into Claude (Claude Code, claude.ai or the
API) inside your project, then say what you want: "show our live quests on the
home page", "add a claim button", "verify the winner list in CI".

It tells Claude what the SDK can and cannot do, so it does not invent
endpoints, and it keeps the rules that matter: amounts are base-unit strings,
the SDK never signs, and the contracts are unaudited.

````text
You are integrating PeddleQuest (https://peddlequest.xyz), a quest platform
whose reward pools are held in an on-chain escrow, into this codebase.
Use the official TypeScript SDK, `@peddlequest/sdk`
(source: https://github.com/peddlequest/quest-sdk, docs:
https://docs.peddlequest.xyz/integrations/sdk). `viem` v2 is a peer
dependency. Read the SDK's README in node_modules before writing code, and
use only what it exports. Do not invent endpoints, fields or options.

INSTALL
  npm install github:peddlequest/quest-sdk viem
  (when it is on npm: npm install @peddlequest/sdk viem)

WHAT THE SDK GIVES YOU
1. Public API client (read-only, no key needed):
     import { createPeddleQuestClient, PeddleQuestApiError } from '@peddlequest/sdk';
     const pq = createPeddleQuestClient(); // https://api.peddlequest.xyz/api
     pq.listQuests({ status: ['active'], chainIds: ['0x2105'] })
     pq.getQuest(linkTitle)        pq.getQuestTasks(linkTitle)
     pq.getScoreboard(linkTitle, { page, pageSize })
     pq.getQuestEscrow(linkTitle)  pq.getActivePromotions()  pq.getRewardAssets()
     pq.getClaimProofs(linkTitle, { token })   // needs the winner's own session token
   A non-2xx answer throws PeddleQuestApiError { status, errorCode, reason? }.
2. Contracts on Base (8453), Robinhood Chain (4663), BNB Smart Chain (56) and
   Arc (5042): getContracts(chainId), PEDDLEQUEST_CHAINS, and the ABIs
   peddlesQuestEscrowAbi, peddlesPromotionMarketAbi, peddlesQuestBadgeAbi,
   peddlesFeeRouterAbi.
3. Escrow helpers (viem PublicClient): deriveEscrowQuestId, getQuestPool,
   hasClaimed, buildClaimCall(proof) -> a call object for the USER'S wallet.
4. Promotion reads: getPromotionSlot, derivePromotionSubject, PromotionPlacement.
5. Winner-list verification: verifyWinners(cidOrUrlOrObject, client) ->
   { match, failures, notes }; plus leafHash, computeMerkleRoot, verifyMerkleProof.
6. Widgets (iframes, no framework): mountQuestWidget, mountLeaderboardWidget,
   mountLiveQuestsWidget, and the *WidgetUrl helpers. For plain HTML use
   <script src="https://peddlequest.xyz/widget.js" data-peddlequest-quest="<linkTitle>" async></script>

RULES YOU MUST FOLLOW
- Money: on-chain amounts (grossAmount, fundedAmount, proof amount) are
  base-unit decimal STRINGS that come with `decimals`. Never use a JS number
  for them and never assume 18 decimals. Format only at the render edge
  (viem's formatUnits). The human-unit `rewards.tokens[].amount` on quest
  cards is display-only: do no arithmetic with it.
- The SDK is read-only. It never holds a key, signs or broadcasts.
  buildClaimCall returns a call; the user's wallet sends it. Never ask for,
  store or log a private key or a session token.
- Claims: only the winner's own session can fetch their proof. The reward is
  always paid to proof.account, whoever submits the transaction.
- Privacy: a scoreboard row's `wallet` field is a username, not an address.
  Do not try to resolve it to a wallet.
- Honesty: the PeddleQuest contracts are UNAUDITED. Never write "audited",
  "secure" or "guaranteed" in UI copy or docs. Do not show a pool, an end
  date or a count the API did not return: leave it out instead of showing 0.
  Some task types are self-reported, so do not describe all points as verified.
- Referrals: to attribute visitors, add `?ref=<code>` to quest links or pass
  `ref` to a widget. Add no utm_* parameters.
- Errors: handle PeddleQuestApiError and network failure with a visible,
  specific state and a retry. Never fail silently.

HOW TO WORK
1. Look at this codebase first: framework, data-fetching pattern, styling,
   wallet library. Match them.
2. Ask me which of these I want if I have not said: (a) list or feature live
   quests, (b) embed a widget, (c) show a pool and its claim window, (d) a
   claim button for winners, (e) verify a winner list, (f) link out with our
   referral code.
3. Fetch on the server where the framework allows it, cache briefly (30-60 s),
   and render loading, empty and error states.
4. Write a small test or a script that calls the real API once to prove the
   integration works, then show me what you changed.
````

## What to ask for

| You say | Claude builds |
|---|---|
| "List the live quests on Base on our home page" | a server-side `listQuests` call with loading, empty and error states |
| "Embed the leaderboard for `<linkTitle>`" | `mountLeaderboardWidget` or the one-line `widget.js` tag |
| "Show the pool and when claims close" | `getQuestEscrow` + `getQuestPool`, amounts formatted with their decimals |
| "Add a claim button for winners" | `getClaimProofs` with the user's session, `buildClaimCall`, the wallet sends it |
| "Check the winner list in CI" | `verifyWinners` against the on-chain root, failing the job on a mismatch |
