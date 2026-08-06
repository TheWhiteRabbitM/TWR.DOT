// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title DotMailKeys — one mailbox key per mask, so three apps mean one person
/// @notice WHAT WENT WRONG WITHOUT THIS
///
///         DotMail's own `keyOf` is indexed by `msg.sender`. Inside a product
///         the host signs with an account it derives PER APP, so chirp and
///         dotmail see different addresses for the same human being. Measured
///         against the live chain before this contract existed: of eighteen
///         masks with owners, ZERO of those owners had a mailbox key. Not a
///         few. None. peoplebook and chirp already share the Masks contract as
///         their idea of a person; mail was the only one keeping its own list,
///         and a second list does not stay wrong quietly — it disagrees.
///
///         So a key hangs off the MASK, which is what the other two already
///         agree on, and the write is gated on owning it. Exactly the shape
///         ChirpHandles uses for usernames, for the same reason.
///
/// @notice WHAT THIS PROVES
///         That the holder of a mask published this key. It does NOT prove they
///         are the People-chain user of the same name: Asset Hub cannot read
///         that chain, so nothing here can check it, and no client should draw
///         a tick from this alone.
/// @custom:cdm @thebutton/dotmailkeys
contract DotMailKeys {
    error NotYourMask();
    error Empty();

    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    event KeySet(uint256 indexed mask, bytes32 key);
    event KeyCleared(uint256 indexed mask);

    /// mask => X25519 public key.
    mapping(uint256 => bytes32) public keyOf;

    /// Publish the key people seal letters to you with.
    ///
    /// Replacing it is allowed and its consequence is stated rather than
    /// prevented: letters already sealed to the old key stay readable only with
    /// the old private key, which is what rotating a key means everywhere.
    function setKey(uint256 mask, bytes32 key) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (key == bytes32(0)) revert Empty();
        keyOf[mask] = key;
        emit KeySet(mask, key);
    }

    /// Stop being reachable. The envelopes already sent do not go away, because
    /// nothing on a chain does; only the ability to address new ones does.
    function clearKey(uint256 mask) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        delete keyOf[mask];
        emit KeyCleared(mask);
    }

    /// @notice Several at once, for a client resolving a page of correspondents.
    /// @dev The same lesson as every other read here: one round trip, not fifty.
    ///      A mask with no key comes back as zero, which the caller must read as
    ///      "no mailbox" and never as "could not ask".
    function keysOf(uint256[] calldata masks) external view returns (bytes32[] memory out) {
        out = new bytes32[](masks.length);
        for (uint256 i = 0; i < masks.length; i++) out[i] = keyOf[masks[i]];
    }
}
