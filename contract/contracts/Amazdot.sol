// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Peoplebook masks. One per account, SOULBOUND, and the identity every
///         other app here already shares.
interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
    function maskOf(address who) external view returns (uint256);
}

/// @notice Mailbox keys, one per mask. This is how anything private travels:
///         the buyer seals their address to the seller's key, the seller seals
///         the item key to the buyer's.
interface IMailKeys {
    function keyOf(uint256 mask) external view returns (bytes32);
}

/// @title Amazdot â€” a marketplace where the escrow needs nobody to arbitrate it
/// @notice WHAT THIS IS AND IS NOT
///
///         It is not a clone of a large retailer, and pretending otherwise would
///         set a target that guarantees failure. That company's moat is
///         warehouses, returns and a staff of people who decide who was right.
///         A chain gives you none of those, and no contract will.
///
///         What a chain gives instead: money that neither party holds while the
///         deal is open, reviews that cannot be bought because they are welded
///         to a paid order, no platform cut, and nobody who can remove you.
///         That is a real market, and it is the one this builds.
///
///         DIGITAL GOODS ARE SETTLED, NOT ARBITRATED
///         The interesting half. At listing time the seller commits to
///         `keccak256(key)` for the symmetric key their file on Bulletin is
///         encrypted with. On payment they post that key sealed to the buyer's
///         published mailbox key, so only the buyer can open it. Then:
///
///           - buyer confirms      â†’ seller paid, immediately;
///           - nobody says anything â†’ seller paid after AUTO_RELEASE blocks;
///           - buyer disputes      â†’ the seller may `prove` by revealing the key
///                                   IN THE CLEAR. The contract checks it against
///                                   the commitment and pays them.
///
///         That last branch is the whole design. The seller's way of winning an
///         argument is to publish the goods, which costs them exactly what the
///         lie was worth and settles the question without a judge. A buyer who
///         disputes honestly gets a refund when the seller cannot prove; a buyer
///         who disputes dishonestly gets a file everyone else now has too, and
///         the seller is paid anyway. Nobody had to be trusted.
///
///         PHYSICAL GOODS ARE NOT, AND THIS SAYS SO
///         No contract can see a parcel arrive. Physical orders get escrow, a
///         buyer confirmation, a timeout that releases to the seller, and a
///         `settleTogether` that splits the money any way the two of them
///         both sign for. When they disagree and neither yields, the funds stay
///         locked. That is not a solution and is not dressed as one: it is the
///         honest shape of the problem, and it is why the digital path exists
///         first.
///
///         IDENTITY IS A MASK, NOT A NAME
///         Sellers and buyers are Peoplebook masks â€” the identity chirp,
///         peoplebook and dotmail already share. Three reasons, and the third is
///         the one that changed the design:
///
///           1. selling needs no domain. A `.dot` costs something and, under
///              nine characters, needs full personhood verification.
///           2. mailbox keys are indexed BY MASK. Sealing anything requires
///              looking up a counterparty's public key, so anchoring to the
///              thing that already carries one removes a whole lookup layer.
///           3. masks are SOULBOUND. A `.dot` name can lapse or be sold, and an
///              earlier draft of this contract resolved the seller at payout
///              time â€” so a name expiring mid-order paid the escrow to the zero
///              address, which on this VM succeeds and silently burns it. With a
///              mask that failure cannot be written. It is designed out rather
///              than caught.
///
///         ADDRESSES ARE NEVER IN THE CLEAR
///         A delivery address on a public chain is a permanent doxx. Buyers pass
///         `sealed` â€” their details encrypted to the seller's mailbox key. The
///         contract stores ciphertext and cannot read it, which is the point.
///         The buyer's own mask travels with the order so the seller has
///         somewhere to seal the reply to.
///
///         NO ADMIN, NO OWNER, NO PAUSE, NO FEE
///         There is no address that can take a cut, freeze an order, delist a
///         seller or drain the escrow. Not as a promise â€” there is no function.
/// @custom:cdm @amazdotcom/amazdot
contract Amazdot {
    // --------------------------------------------------------------- errors
    error NotSeller();
    error NotBuyer();
    error NoMask();
    error SelfDeal();
    error BadPrice();
    error BadState();
    error SoldOut();
    error Underpaid();
    error TooEarly();
    error TooLate();
    error BadKey();
    error BadSplit();
    error BadStars();
    error NotParty();
    error NothingToPay();
    error PayoutFailed();

    // --------------------------------------------------------------- events
    event Listed(uint256 indexed id, uint256 indexed seller, uint256 price, bool digital);
    event Restocked(uint256 indexed id, uint32 stock);
    event Delisted(uint256 indexed id);
    event Ordered(uint256 indexed orderId, uint256 indexed listingId, address indexed buyer, uint256 paid);
    event Delivered(uint256 indexed orderId, bytes sealedKey);
    event Shipped(uint256 indexed orderId, string note);
    event Confirmed(uint256 indexed orderId);
    event Disputed(uint256 indexed orderId, string reason);
    event Proven(uint256 indexed orderId, bytes key);
    event Refunded(uint256 indexed orderId, uint256 amount);
    event Paid(uint256 indexed orderId, address indexed to, uint256 amount);
    event Reviewed(uint256 indexed orderId, uint8 stars, string body);
    event SplitProposed(uint256 indexed orderId, address indexed by, uint16 toBuyerBps);

    /// @notice The mask contract this market trusts for identity.
    ///
    ///         `immutable` rather than `constant`, and that is a deliberate
    ///         trade. A hardcoded address cannot be pointed at a fake registry â€”
    ///         but it also cannot be pointed at a test one, and a contract that
    ///         moves other people's money must be exercisable end to end before
    ///         it holds any. Immutable buys both: chosen once at deploy, in the
    ///         open, and unchangeable forever after. There is no setter.
    ///
    ///         Live masks are at 0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a â€”
    ///         check the deploy transaction, not this comment.
    IMasks public immutable MASKS;

    constructor(IMasks masks) {
        MASKS = masks;
    }

    /// @notice Blocks after delivery before an unanswered order pays out.
    ///         At ~6s a block this is about three days â€” long enough for a buyer
    ///         who is asleep, short enough that a seller is not financing them.
    uint64 public constant AUTO_RELEASE = 43_200;

    /// @notice Blocks a seller has to answer a dispute before the buyer is
    ///         refunded. Deliberately shorter than AUTO_RELEASE: the seller
    ///         already holds the proof, so needing longer means they do not.
    uint64 public constant PROVE_WINDOW = 14_400;

    enum State {
        None,
        Paid,       // money escrowed, nothing sent yet
        Delivered,  // digital: key sealed to buyer. physical: marked shipped
        Confirmed,  // buyer said it arrived â€” terminal, paid out
        Disputed,   // buyer objected, clock running on the seller
        Refunded,   // terminal, buyer got the money back
        Settled     // terminal, paid out by timeout or by mutual split
    }

    struct Listing {
        uint256 seller;     // mask id â€” soulbound, so this never becomes nobody
        string title;
        string descCid;     // long description on Bulletin, optional
        string imageCid;    // product image on Bulletin, optional
        string payloadCid;  // digital only: the ENCRYPTED file on Bulletin
        bytes32 keyCommit;  // digital only: keccak256(symmetric key)
        uint256 price;      // in plancks, exact â€” no haggling, no partial fills
        uint32 stock;       // 0 means delisted or sold out
        bool digital;
        uint64 listedAt;
    }

    struct Order {
        uint256 listingId;
        address buyer;
        uint256 buyerMask;  // where the seller seals the reply to
        uint256 paid;
        State state;
        uint64 at;          // block of the last state change, for both clocks
        uint16 buyerSplit;  // proposed share to the buyer, in bps, +1. 0 = none
        uint16 sellerSplit; // same, from the seller's side
        bytes sealed_;      // physical: delivery details, encrypted to the seller
        bytes sealedKey;    // digital: the item key, encrypted to the buyer
    }

    struct Review {
        uint8 stars;
        string body;
        uint64 at;
    }

    Listing[] private _listings;
    Order[] private _orders;

    /// @notice One review per order, so a review costs what the item costs.
    ///         There is no other way to write one. That is the whole anti-fake
    ///         mechanism and it needs no identity system to work.
    mapping(uint256 => Review) public reviewOf;

    /// @notice Orders per listing and per buyer, for views that would otherwise
    ///         make a client read every order ever placed.
    mapping(uint256 => uint256[]) private _ordersOfListing;
    mapping(address => uint256[]) private _ordersOfBuyer;

    /// @notice Running totals per seller label. Kept as state rather than
    ///         computed by readers: a storefront that has to walk every order to
    ///         show a rating is a storefront nobody waits for.
    mapping(uint256 => uint32) public sales;
    mapping(uint256 => uint32) public reviews;
    mapping(uint256 => uint32) public starsTotal;

    // ------------------------------------------------------------- identity

    /// @dev Checked on every write, never cached. Masks are soulbound, so unlike
    ///      a name this answer cannot change under an open order â€” which is why
    ///      the payout path below has no "seller vanished" branch to get wrong.
    function _requireSeller(uint256 mask) internal view {
        if (mask == 0) revert NoMask();
        if (MASKS.ownerOf(mask) != msg.sender) revert NotSeller();
    }

    /// @dev A buyer needs a mask too, and not for symmetry: it is where the
    ///      seller seals the item key or the shipping reply to. An order from
    ///      someone with nowhere to receive things cannot be completed, so it is
    ///      refused at the door rather than stranded halfway.
    function _requireBuyerMask() internal view returns (uint256 mask) {
        mask = MASKS.maskOf(msg.sender);
        if (mask == 0) revert NoMask();
    }

    // -------------------------------------------------------------- selling

    /// @notice Put something up for sale under a `.dot` name you own.
    /// @param keyCommit For a digital item, keccak256 of the key its payload is
    ///        encrypted with. This is a commitment made BEFORE any sale, which
    ///        is what makes a later reveal proof rather than assertion.
    function list(
        uint256 seller,
        string calldata title,
        string calldata descCid,
        string calldata imageCid,
        string calldata payloadCid,
        bytes32 keyCommit,
        uint256 price,
        uint32 stock,
        bool digital
    ) external returns (uint256 id) {
        _requireSeller(seller);
        if (price == 0) revert BadPrice();
        if (stock == 0) revert SoldOut();
        // A digital listing without a commitment could never be proven, so the
        // dispute branch would silently degrade to the physical one.
        if (digital && keyCommit == bytes32(0)) revert BadKey();

        _listings.push(
            Listing({
                seller: seller,
                title: title,
                descCid: descCid,
                imageCid: imageCid,
                payloadCid: payloadCid,
                keyCommit: keyCommit,
                price: price,
                stock: stock,
                digital: digital,
                listedAt: uint64(block.number)
            })
        );
        id = _listings.length - 1;
        emit Listed(id, seller, price, digital);
    }

    function restock(uint256 id, uint32 stock) external {
        Listing storage l = _listings[id];
        _requireSeller(l.seller);
        l.stock = stock;
        if (stock == 0) emit Delisted(id);
        else emit Restocked(id, stock);
    }

    // --------------------------------------------------------------- buying

    /// @notice Pay for one unit. The money leaves the buyer and reaches nobody:
    ///         it sits here until the order ends one way or another.
    /// @param sealed_ Physical orders: delivery details encrypted to the
    ///        seller's published mailbox key. Never plaintext â€” see the header.
    function buy(uint256 listingId, bytes calldata sealed_)
        external
        payable
        returns (uint256 orderId)
    {
        Listing storage l = _listings[listingId];
        if (l.stock == 0) revert SoldOut();
        if (msg.value != l.price) revert Underpaid();
        uint256 buyerMask = _requireBuyerMask();
        // Buying from yourself costs only gas — the escrow returns to the same
        // pocket — and a confirmed order is the ONLY door to writing a review.
        // Without this, five stars are free and the review system is decorative.
        // It does not defeat someone willing to run a second mask and move real
        // funds between accounts they control; it removes the version that costs
        // nothing, which is the version that actually gets used.
        if (buyerMask == l.seller) revert SelfDeal();

        unchecked {
            l.stock -= 1;
        }

        _orders.push(
            Order({
                listingId: listingId,
                buyer: msg.sender,
                buyerMask: buyerMask,
                paid: msg.value,
                state: State.Paid,
                at: uint64(block.number),
                buyerSplit: 0,
                sellerSplit: 0,
                sealed_: sealed_,
                sealedKey: ""
            })
        );
        orderId = _orders.length - 1;
        _ordersOfListing[listingId].push(orderId);
        _ordersOfBuyer[msg.sender].push(orderId);
        emit Ordered(orderId, listingId, msg.sender, msg.value);
    }

    // ------------------------------------------------------------ delivering

    /// @notice Digital: hand over the key, sealed so only the buyer can read it.
    ///         The contract cannot check the seal â€” that is what `prove` is for.
    function deliver(uint256 orderId, bytes calldata sealedKey) external {
        Order storage o = _orders[orderId];
        Listing storage l = _listings[o.listingId];
        _requireSeller(l.seller);
        if (o.state != State.Paid) revert BadState();
        if (!l.digital) revert BadState();
        o.sealedKey = sealedKey;
        o.state = State.Delivered;
        o.at = uint64(block.number);
        emit Delivered(orderId, sealedKey);
    }

    /// @notice Physical: say it is on its way. Starts the same clock, and is
    ///         worth exactly what the seller's name is worth â€” nothing here can
    ///         verify it, and the header does not pretend otherwise.
    function ship(uint256 orderId, string calldata note) external {
        Order storage o = _orders[orderId];
        Listing storage l = _listings[o.listingId];
        _requireSeller(l.seller);
        if (o.state != State.Paid) revert BadState();
        if (l.digital) revert BadState();
        o.state = State.Delivered;
        o.at = uint64(block.number);
        emit Shipped(orderId, note);
    }

    // ------------------------------------------------------------- settling

    /// @notice The buyer is happy. Pays out at once, and is the only path that
    ///         does not involve waiting.
    function confirm(uint256 orderId) external {
        Order storage o = _orders[orderId];
        if (msg.sender != o.buyer) revert NotBuyer();
        if (o.state != State.Delivered) revert BadState();
        o.state = State.Confirmed;
        emit Confirmed(orderId);
        _payout(orderId);
    }

    /// @notice Nobody said anything for AUTO_RELEASE blocks. Open to anyone, so
    ///         a seller is never waiting on the buyer's goodwill to be paid, and
    ///         never waiting on us either.
    function settle(uint256 orderId) external {
        Order storage o = _orders[orderId];
        if (o.state != State.Delivered) revert BadState();
        if (block.number < o.at + AUTO_RELEASE) revert TooEarly();
        o.state = State.Settled;
        _payout(orderId);
    }

    /// @notice The buyer objects. Stops the clock and starts a shorter one on
    ///         the seller.
    function dispute(uint256 orderId, string calldata reason) external {
        Order storage o = _orders[orderId];
        if (msg.sender != o.buyer) revert NotBuyer();
        if (o.state != State.Delivered) revert BadState();
        if (block.number >= o.at + AUTO_RELEASE) revert TooLate();
        o.state = State.Disputed;
        o.at = uint64(block.number);
        emit Disputed(orderId, reason);
    }

    /// @notice Win the argument by publishing the goods.
    ///
    ///         The seller reveals the key in the clear; the contract checks it
    ///         against the commitment made before anyone paid. If it matches,
    ///         the item was real and openable and the seller is paid. The cost
    ///         is that the key is now public and so, to anyone holding the
    ///         payload CID, is the item.
    ///
    ///         That price is the mechanism, not a flaw in it. It makes a false
    ///         dispute pointless â€” the liar gets a file that is now worthless to
    ///         resell and the seller is paid regardless â€” while leaving an
    ///         honest seller a way out that needs no judge, no oracle and no
    ///         appeal to us.
    function prove(uint256 orderId, bytes calldata key) external {
        Order storage o = _orders[orderId];
        Listing storage l = _listings[o.listingId];
        _requireSeller(l.seller);
        if (o.state != State.Disputed) revert BadState();
        if (!l.digital) revert BadState();
        if (keccak256(key) != l.keyCommit) revert BadKey();
        o.state = State.Settled;
        emit Proven(orderId, key);
        _payout(orderId);
    }

    /// @notice The seller did not answer the dispute in time. Open to anyone, so
    ///         a buyer's refund does not depend on the buyer still being around.
    ///
    ///         DIGITAL ONLY, and that restriction is the difference between a
    ///         marketplace and a free shop. A timeout refund is fair here only
    ///         because the seller HAD a way to answer and did not take it: the
    ///         commitment was made before the sale and `prove` was one call away.
    ///
    ///         Allowing the same timeout on a physical order â€” which the first
    ///         version of this contract did â€” hands every physical buyer a free
    ///         item. Receive the parcel, dispute it, wait; the seller cannot
    ///         prove a parcel to a contract, so the clock runs out and the money
    ///         comes back while the goods stay bought. Physical disputes end at
    ///         `settleTogether` or they do not end, which is honest, and the
    ///         header says so.
    function refund(uint256 orderId) external {
        Order storage o = _orders[orderId];
        if (o.state != State.Disputed) revert BadState();
        if (!_listings[o.listingId].digital) revert BadState();
        if (block.number < o.at + PROVE_WINDOW) revert TooEarly();
        _refund(orderId);
    }

    /// @notice The seller gives up, at any point before payout. Cheaper than
    ///         arguing and available without waiting for a clock.
    function refundBuyer(uint256 orderId) external {
        Order storage o = _orders[orderId];
        Listing storage l = _listings[o.listingId];
        _requireSeller(l.seller);
        if (o.state != State.Paid && o.state != State.Delivered && o.state != State.Disputed) {
            revert BadState();
        }
        _refund(orderId);
    }

    /// @notice Each side proposes a split; when both have proposed the SAME
    ///         split, the money moves. The only route out of a physical dispute,
    ///         and deliberately not a clever one: two parties who agree can
    ///         always end it, two who never agree stay stuck, and inventing a
    ///         winner here would mean inventing an arbiter.
    ///
    ///         WHY TWO CALLS RATHER THAN ONE SIGNATURE
    ///         The first version took the counterparty's signature and recovered
    ///         it with `ecrecover`, which needs a secp256k1 key. Most accounts
    ///         here do not have one: a Substrate account reaches contracts
    ///         through pallet-revive's address mapping, so it has an H160 and no
    ///         corresponding EVM private key, and `ecrecover` can never return
    ///         it. That version compiled, read well, and would have been
    ///         unusable by nearly every user of this chain â€” the only escape
    ///         from a physical dispute, closed to almost everyone.
    ///
    ///         Two transactions cost more than one signature. They also work.
    /// @param toBuyerBps Share returned to the buyer, in basis points.
    function proposeSplit(uint256 orderId, uint16 toBuyerBps) external {
        Order storage o = _orders[orderId];
        Listing storage l = _listings[o.listingId];
        if (toBuyerBps > 10_000) revert BadSplit();
        if (o.state != State.Disputed && o.state != State.Delivered) revert BadState();

        address seller = MASKS.ownerOf(l.seller);
        bool isBuyer = msg.sender == o.buyer;
        if (!isBuyer && msg.sender != seller) revert NotParty();

        // +1 so that "proposed zero to the buyer" is distinguishable from
        // "has not proposed", which are opposite positions in a dispute.
        if (isBuyer) o.buyerSplit = toBuyerBps + 1;
        else o.sellerSplit = toBuyerBps + 1;
        emit SplitProposed(orderId, msg.sender, toBuyerBps);

        if (o.buyerSplit == 0 || o.sellerSplit != o.buyerSplit) return;

        uint256 amount = o.paid;
        if (amount == 0) revert NothingToPay();
        o.paid = 0;
        o.state = State.Settled;

        uint256 toBuyer = (amount * toBuyerBps) / 10_000;
        uint256 toSeller = amount - toBuyer;
        if (toSeller > 0) {
            _credit(l.seller);
            _send(seller, toSeller, orderId);
        }
        if (toBuyer > 0) _send(o.buyer, toBuyer, orderId);
    }

    // -------------------------------------------------------------- reviews

    /// @notice One review, from the buyer, on an order that ended in payment.
    ///         Not "verified purchase" as a badge â€” as the only door in.
    function review(uint256 orderId, uint8 stars, string calldata body) external {
        Order storage o = _orders[orderId];
        Listing storage l = _listings[o.listingId];
        if (msg.sender != o.buyer) revert NotBuyer();
        if (o.state != State.Confirmed && o.state != State.Settled) revert BadState();
        if (stars < 1 || stars > 5) revert BadStars();
        if (reviewOf[orderId].at != 0) revert BadState();

        reviewOf[orderId] = Review({stars: stars, body: body, at: uint64(block.number)});
        unchecked {
            reviews[l.seller] += 1;
            starsTotal[l.seller] += stars;
        }
        emit Reviewed(orderId, stars, body);
    }

    // --------------------------------------------------------------- money

    /// @dev The seller is resolved at PAYOUT time from the mask, which is
    ///      soulbound â€” so unlike a `.dot` name it cannot have been sold or
    ///      allowed to lapse between the order and the payment. An earlier draft
    ///      keyed sellers by name and had to carry a "seller vanished, refund
    ///      instead" branch, because paying the zero address on this VM succeeds
    ///      and burns the money in silence. The zero check below is kept as a
    ///      backstop, but with masks it should be unreachable.
    function _payout(uint256 orderId) internal {
        Order storage o = _orders[orderId];
        Listing storage l = _listings[o.listingId];
        uint256 amount = o.paid;
        if (amount == 0) revert NothingToPay();

        address seller = MASKS.ownerOf(l.seller);
        if (seller == address(0)) {
            _refund(orderId);
            return;
        }

        o.paid = 0;
        _credit(l.seller);
        _send(seller, amount, orderId);
    }

    /// @dev Stock comes back. `buy` took a unit out of inventory; a refund means
    ///      the sale did not happen, and a seller who has to notice and restock
    ///      by hand will find out they were quietly sold out days later.
    function _refund(uint256 orderId) internal {
        Order storage o = _orders[orderId];
        uint256 amount = o.paid;
        if (amount == 0) revert NothingToPay();
        o.paid = 0;
        o.state = State.Refunded;
        unchecked {
            _listings[o.listingId].stock += 1;
        }
        emit Refunded(orderId, amount);
        _send(o.buyer, amount, orderId);
    }

    function _credit(uint256 seller) internal {
        unchecked {
            sales[seller] += 1;
        }
    }

    /// @dev State is zeroed before the transfer everywhere above, so re-entry
    ///      finds an order with nothing left to pay and reverts on NothingToPay.
    function _send(address to, uint256 amount, uint256 orderId) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert PayoutFailed();
        emit Paid(orderId, to, amount);
    }


    // ----------------------------------------------------------------- views

    function listingCount() external view returns (uint256) {
        return _listings.length;
    }

    function orderCount() external view returns (uint256) {
        return _orders.length;
    }

    /// @dev Paged like DotDirectory2, and for the same measured reason: a client
    ///      that asks per item spends a round trip per item.
    function page(uint256 start, uint256 size) external view returns (Listing[] memory out) {
        uint256 len = _listings.length;
        if (start >= len) return new Listing[](0);
        uint256 end = start + size;
        if (end > len) end = len;
        out = new Listing[](end - start);
        for (uint256 i = start; i < end; ++i) out[i - start] = _listings[i];
    }

    function listing(uint256 id) external view returns (Listing memory) {
        return _listings[id];
    }

    function order(uint256 id) external view returns (Order memory) {
        return _orders[id];
    }

    function ordersOfBuyer(address who) external view returns (uint256[] memory) {
        return _ordersOfBuyer[who];
    }

    function ordersOfListing(uint256 id) external view returns (uint256[] memory) {
        return _ordersOfListing[id];
    }

    /// @notice Average rating in hundredths, so a client never divides by zero
    ///         and never renders "NaN stars" at a stranger.
    function rating(uint256 seller) external view returns (uint32 avgX100, uint32 count) {
        count = reviews[seller];
        avgX100 = count == 0 ? 0 : (starsTotal[seller] * 100) / count;
    }
}
