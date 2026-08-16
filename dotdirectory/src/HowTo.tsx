/**
 * How to get listed — for the people who need to read it.
 *
 * This existed already, inside the register panel, where it was useless: that
 * panel only mounts when there is a Polkadot App host, so the instructions were
 * visible exclusively to people who had already found the thing the
 * instructions describe. Anyone opening dotdirectory.dot in an ordinary browser
 * — which is how a link gets followed — saw a list of other people's apps and
 * no hint that their own could be on it.
 *
 * The first version of this file then made the opposite mistake: it explained
 * what the two steps MEAN without ever saying what to do. "Announce it. One
 * transaction puts it on this list" is a description of a mechanism, not an
 * instruction — nobody can follow it. It also told the reader the form was
 * "above" when it renders below. So the steps now name the actual field, the
 * actual button label and the actual order, because that is the part a person
 * needs and the part that was missing.
 *
 * The two writes have genuinely different rules and stating them plainly is the
 * rest of the job. Announcing is permissionless because the contract admits a
 * label only when the registry already gives it an owner; describing is not,
 * because the resolver takes records only from the owner. People assume the
 * opposite of both — that listing needs approval, and that a description is
 * public property.
 */
export function HowTo({ inHost, nameOnly }: { inHost: boolean; nameOnly: number }) {
  return (
    <details className="howto" open={!inHost}>
      <summary>Get your app listed</summary>

      <p className="howto-lede">
        Two transactions, sent from the panel
        {inHost ? ' below' : ' this page shows when it is opened inside the Polkadot app'}. The
        first can be sent by anyone; the second only by the name's owner.
      </p>

      <ol>
        <li>
          <strong>Have a registered <code>.dot</code>.</strong> Names come from DotNS, not from
          here — <code>dotns register domain -n yourname</code>, or the Polkadot app's own name
          flow. This directory can only list names the registry already has an owner for, which is
          what stops it filling with names nobody holds.
        </li>

        <li>
          <strong>Put it on the list.</strong>
          {inHost ? ' In the panel below, type' : ' Open dotdirectory.dot inside the Polkadot app — that is where signing keys live, and the panel only appears there. Type'}{' '}
          the label into <em>Name</em> without the <code>.dot</code> — <code>yourname</code>, not{' '}
          <code>yourname.dot</code>. The page checks the chain as you type and tells you whether it
          is registered, already listed, and whether it is yours. Then press{' '}
          <em>Add to the directory</em> and approve the transaction.
          <br />
          <span className="howto-note">
            You can do this for someone else's name too, and they can do it for yours. There is
            nobody to ask.
          </span>
        </li>

        <li>
          <strong>Say what it is.</strong> If the connected account owns the name, three more
          fields appear: <em>Display name</em>, <em>What it is</em> and <em>Category</em>. Fill them
          and press <em>Update</em>. That writes your name's <code>manifest</code> and{' '}
          <code>category</code> records — the sentence the directory shows, and the chip people
          filter by.
          <br />
          <span className="howto-note">
            Skip it and your app still appears, as a bare name under "name only" —{' '}
            {nameOnly > 0 ? `${nameOnly} of the names here have never done this step.` : 'as some here are.'}
          </span>
        </li>
      </ol>

      <p className="howto-foot">
        Nothing indexes this directory on a schedule, so if your app is not on the list no machine
        is going to notice. That is the trade for a list that cannot fall behind the chain — and it
        is why step 2 is yours. Reading, on the other hand, needs nothing: no wallet, no app, any
        browser.
      </p>
    </details>
  );
}
