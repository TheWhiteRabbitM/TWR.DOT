// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title DotMail — private mail with no server and no visible recipient
/// @notice WHAT THIS DOES DIFFERENTLY, AND WHY
///
///         Email loses its metadata to the provider. A naive mail-on-chain
///         loses it to everybody, permanently: `to` and `from` in cleartext,
///         unforgeable, forever. That is worse than email at the exact thing
///         email is already bad at, which is why chirp refused to fake DMs on
///         a statement store where sender and topic are public.
///
///         So nothing here names a recipient. An envelope carries an opaque
///         TAG and an EPHEMERAL public key. The sender derives a shared secret
///         from their throwaway key and the recipient's published key; the tag
///         is a hash of that secret. Only the holder of the recipient key can
///         recompute it, by trying each envelope in turn. An observer sees a
///         stream of blobs and cannot say whose mail any of them is.
///
///         WHAT IS STILL PUBLIC, SAID PLAINLY: whoever pays. A transaction has
///         a signer, so `from` is recorded rather than hidden, because pretending
///         otherwise would be the same lie this contract exists to avoid. Hiding
///         it needs a proof that the payer is *some* member of a set without
///         saying which, and that has to be verifiable by this chain before it
///         means anything here.
///
///         THE SUBJECT LINE IS INSIDE THE SEAL. Not a field. A subject is the
///         most revealing short string a message has, and a "private" mailbox
///         that publishes subjects is a mailbox that looks safe and is not.
/// @custom:cdm @thebutton/dotmail
contract DotMail {
    error NoKey();
    error Empty();
    error TooBig(uint256 size);
    error BadRange();

    /// A picture is looked at; a letter is read. 16 kB of text is a long letter,
    /// and every byte is a storage deposit paid by the sender.
    uint256 public constant MAX = 16_000;

    /// FOUR, ALWAYS, WHETHER OR NOT THEY ARE USED.
    ///
    /// A letter is sealed to the recipient's key, so its sender cannot re-read
    /// it afterwards: "Sent" is a second sealing, to yourself. Rather than pay
    /// for a second envelope, the body is encrypted once and its key wrapped
    /// per reader, one slot each.
    ///
    /// The count is FIXED because a variable one would publish how many people
    /// a letter went to. Unused slots carry random bytes that no observer can
    /// tell from real ones, so every envelope on this chain looks alike.
    uint8 public constant SLOTS = 4;

    event KeySet(address indexed who, bytes32 key);
    event Mail(uint256 indexed id, address indexed from);

    struct Envelope {
        bytes32[SLOTS] tags; // H(shared secret) per reader; only they can match one
        bytes32 eph;         // sender's throwaway X25519 public key
        address from;        // the payer, recorded because it is public anyway
        uint40 time;         // block time, so a client need not index events
        bytes sealed_;       // wrapped keys ++ nonce ++ ciphertext, opaque here
    }

    Envelope[] private _mail;

    /// Recipient X25519 public keys. Anyone can publish one for themselves and
    /// replace it later; old mail stays readable only with the old private key,
    /// which is the honest consequence of rotating rather than a bug.
    mapping(address => bytes32) public keyOf;

    function setKey(bytes32 key) external {
        if (key == bytes32(0)) revert Empty();
        keyOf[msg.sender] = key;
        emit KeySet(msg.sender, key);
    }

    function send(bytes32[SLOTS] calldata tags, bytes32 eph, bytes calldata sealed_)
        external
        returns (uint256 id)
    {
        if (sealed_.length == 0) revert Empty();
        if (sealed_.length > MAX) revert TooBig(sealed_.length);
        _mail.push(Envelope(tags, eph, msg.sender, uint40(block.timestamp), sealed_));
        id = _mail.length - 1;
        emit Mail(id, msg.sender);
    }

    function count() external view returns (uint256) {
        return _mail.length;
    }

    /// @notice Tags and ephemeral keys only, in bulk.
    /// @dev Finding your own mail means trying every envelope, so the scan has
    ///      to be cheap or the privacy is theoretical. Pulling bodies while
    ///      scanning would move megabytes to find a few kilobytes; this returns
    ///      the two 32-byte fields a client needs to decide, and nothing else.
    ///      Reading a page at a time is what took a chirp timeline from fifty
    ///      round trips to one.
    /// @dev `tags` comes back FLAT: SLOTS entries per envelope, in order. A
    ///      nested array would cost more to encode for no gain, and the client
    ///      already knows the stride.
    function heads(uint256 start, uint256 n)
        external
        view
        returns (bytes32[] memory tags, bytes32[] memory ephs)
    {
        uint256 total = _mail.length;
        if (start > total) revert BadRange();
        uint256 end = start + n;
        if (end > total) end = total;
        uint256 len = end - start;
        tags = new bytes32[](len * SLOTS);
        ephs = new bytes32[](len);
        for (uint256 i = 0; i < len; i++) {
            Envelope storage e = _mail[start + i];
            for (uint8 s = 0; s < SLOTS; s++) tags[i * SLOTS + s] = e.tags[s];
            ephs[i] = e.eph;
        }
    }

    /// One envelope in full, fetched only once a tag has matched.
    function envelope(uint256 id)
        external
        view
        returns (bytes32[SLOTS] memory tags, bytes32 eph, address from, uint40 time, bytes memory sealed_)
    {
        Envelope storage e = _mail[id];
        return (e.tags, e.eph, e.from, e.time, e.sealed_);
    }

    /// Several bodies at once, for an inbox that just matched a page of tags.
    function bodies(uint256[] calldata ids)
        external
        view
        returns (bytes[] memory out, address[] memory froms, uint40[] memory times)
    {
        out = new bytes[](ids.length);
        froms = new address[](ids.length);
        times = new uint40[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            Envelope storage e = _mail[ids[i]];
            out[i] = e.sealed_;
            froms[i] = e.from;
            times[i] = e.time;
        }
    }
}
