/**
 * How to buy and how to sell, in the product rather than in a chat reply.
 *
 * The question "how do I sell something here" arrived from the person who
 * commissioned the market, looking at the market. That is not a question to
 * answer once — it is a missing panel, and dotdirectory made exactly this
 * mistake first: instructions that existed only inside the wallet-gated panel,
 * so the only people who could read them were the ones who had already found
 * the thing being explained.
 *
 * So this always renders, needs no wallet, and names the real buttons in the
 * real order.
 */
export function HowTo({ inHost }: { inHost: boolean }) {
  return (
    <details className="howto" open={!inHost}>
      <summary>How buying and selling work here</summary>

      <div className="howto-cols">
        <div>
          <h3>To buy</h3>
          <ol>
            <li>
              Open <code>amazdotcom.dot</code> inside the Polkadot app. Browsing works in any
              browser; paying needs the keys, and they live there.
            </li>
            <li>
              <strong>Claim a Peoplebook mask</strong> if you have not. It is free, one per
              account, and it is where a seller seals your delivery to — without it there is
              nowhere to send you anything.
            </li>
            <li>
              Pick an item and press <em>Buy</em>. Your money goes into the contract, not to the
              seller. For a shipped item you paste your address first and it is encrypted to the
              seller before it leaves your browser.
            </li>
            <li>
              When it arrives, press <em>Confirm</em> — the seller is paid instantly. Do nothing
              and they are paid anyway after about three days. If it is wrong, press{' '}
              <em>Dispute</em> instead.
            </li>
            <li>
              Then you can leave a review. Only a paid order can, which is the entire reason the
              stars here mean anything.
            </li>
          </ol>
        </div>

        <div>
          <h3>To sell</h3>
          <ol>
            <li>
              Same two things: the Polkadot app, and a mask. The mask is your shop — your rating
              and your completed sales attach to it, not to an address you might change.
            </li>
            <li>
              Open <em>Sell something</em> and fill in the name, the price in PAS and how many you
              have.
            </li>
            <li>
              <strong>Digital?</strong> Encrypt your file first, upload it to Bulletin, and paste
              the CID. Then paste the key you encrypted it with — it never leaves your browser,
              only its hash is stored. <em>Keep that key.</em> It is the only way to win a dispute
              later, and nobody can recover it for you.
            </li>
            <li>
              <strong>Shipped?</strong> Leave those blank. You will get the buyer's address
              encrypted to your mask when they order.
            </li>
            <li>
              Press <em>Put it up for sale</em>. When an order arrives, send the sealed key (or
              mark it shipped) and wait to be paid.
            </li>
          </ol>
        </div>
      </div>

      <p className="howto-foot">
        Nobody takes a cut and nobody can remove you — there is no admin function in the contract
        to do either. The flip side is that nobody can rescue you from a bad trade either: read the
        seller's rating, and for anything expensive, prefer a digital item, where a dispute settles
        itself.
      </p>
    </details>
  );
}
