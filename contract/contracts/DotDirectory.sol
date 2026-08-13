// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The `.dot` name registry: `owner(node)` gives the account that owns a
///         namehash. It is the only identity claim checkable on this chain, and
///         everything below rests on it.
interface IDotRegistry {
    function owner(bytes32 node) external view returns (address);
}

/// @title DotDirectory — the plaintext label list DotNS cannot give you
/// @notice DotNS is ENS-style: names are keys in a namehash-mapped store, and the
///         registry's events carry the HASH of a name, never its text. So there
///         is no way to ask the chain "what names exist" — you can only ask "who
///         owns namehash(x)" for an x you already have. A hash cannot be
///         reversed, so the plaintext has to come from somewhere else.
///
///         Today it comes from an indexer that walks every block and scrapes
///         ascii runs out of raw extrinsic bytes, because historical calls
///         cannot be decoded once a runtime upgrade moves call indices. That
///         works, but it means discovery needs a machine with thirty minutes and
///         a schedule — and in August 2026 that schedule fell behind the chain
///         and stayed behind, because a run killed by a timeout wrote nothing and
///         the next one restarted with more to do.
///
///         This contract removes the need for that machine. It is a public list
///         of labels, and the only thing it enforces is that each one is real:
///
///           ANNOUNCE  anyone may submit a label. It is stored only if
///                     REGISTRY.owner(namehash(label)) is non-zero. Nobody can
///                     poison the list with names that were never registered,
///                     and no permission is needed to add a name you do not own
///                     — announcing someone else's real name is a favour, not an
///                     attack.
///           PRUNE     anyone may submit a label already stored. It is removed
///                     only if the registry now says it has no owner. The list
///                     cleans itself the same way it fills: permissionlessly,
///                     and only in the direction the registry allows.
///
///         There is no admin, no owner and no pause. Both directions are gated by
///         the same external truth, so there is nothing for an operator to decide
///         and therefore nobody to trust or to lose.
///
///         WHAT THIS DOES NOT DO
///         It does not discover names by itself. Nothing on-chain wakes up on its
///         own; a contract runs only when a transaction calls it. What changes is
///         who can do the calling: today one GitHub schedule, after this anyone —
///         the registrant announcing their own name, a keeper, a wallet doing it
///         on registration, or a one-off backfill. Any of them is enough, and no
///         particular one is required.
/// @custom:cdm @thebutton/dotdirectory
contract DotDirectory {
    // --------------------------------------------------------------- errors
    error NotRegistered();
    error AlreadyListed();
    error NotListed();
    error StillOwned();
    error BadLabel();

    // --------------------------------------------------------------- events
    event Announced(string label, address indexed owner, uint256 index);
    event Pruned(string label, uint256 index);

    IDotRegistry public constant REGISTRY =
        IDotRegistry(0x527b08a640b527a3dae0C4BE04D7344E430B6E50);

    /// @dev keccak256("dot"), the parent node every `<label>.dot` hangs from.
    bytes32 internal constant DOT_NODE =
        keccak256(abi.encodePacked(bytes32(0), keccak256("dot")));

    /// @notice Every label known to be registered, in announcement order.
    string[] public labels;

    /// @dev label hash -> position + 1, so zero still means "absent".
    mapping(bytes32 => uint256) internal _slot;

    /// @notice Block height of the last change, so a reader can tell in one call
    ///         whether anything moved since it last looked.
    uint256 public lastChangedAt;

    // ------------------------------------------------------------- announce

    /// @notice Add a `.dot` label to the public list.
    /// @param label the label without the suffix, e.g. "dotmetrics" for
    ///        dotmetrics.dot. Must be one the registry says has an owner.
    function announce(string calldata label) public {
        if (bytes(label).length == 0) revert BadLabel();
        bytes32 key = keccak256(bytes(label));
        if (_slot[key] != 0) revert AlreadyListed();

        address holder = REGISTRY.owner(_node(key));
        if (holder == address(0)) revert NotRegistered();

        labels.push(label);
        _slot[key] = labels.length;
        lastChangedAt = block.number;
        emit Announced(label, holder, labels.length - 1);
    }

    /// @notice Announce many labels at once. Used to backfill the names an
    ///         off-chain indexer already found, so the list starts complete
    ///         rather than empty.
    /// @dev Skips anything already listed or unregistered instead of reverting:
    ///      a backfill of two hundred names must not fail because one of them
    ///      lapsed since the snapshot was taken.
    function announceMany(string[] calldata batch) external returns (uint256 added) {
        for (uint256 i = 0; i < batch.length; i += 1) {
            if (bytes(batch[i]).length == 0) continue;
            bytes32 key = keccak256(bytes(batch[i]));
            if (_slot[key] != 0) continue;
            address holder = REGISTRY.owner(_node(key));
            if (holder == address(0)) continue;

            labels.push(batch[i]);
            _slot[key] = labels.length;
            emit Announced(batch[i], holder, labels.length - 1);
            added += 1;
        }
        if (added != 0) lastChangedAt = block.number;
    }

    // ---------------------------------------------------------------- prune

    /// @notice Remove a label the registry no longer recognises.
    /// @dev Swap-and-pop, so ordering is not stable across prunes. Readers key
    ///      on the label, never on the index.
    function prune(string calldata label) external {
        bytes32 key = keccak256(bytes(label));
        uint256 slot = _slot[key];
        if (slot == 0) revert NotListed();
        if (REGISTRY.owner(_node(key)) != address(0)) revert StillOwned();

        uint256 index = slot - 1;
        uint256 last = labels.length - 1;
        if (index != last) {
            string memory moved = labels[last];
            labels[index] = moved;
            _slot[keccak256(bytes(moved))] = index + 1;
        }
        labels.pop();
        delete _slot[key];
        lastChangedAt = block.number;
        emit Pruned(label, index);
    }

    // ----------------------------------------------------------------- read

    function count() external view returns (uint256) {
        return labels.length;
    }

    function isListed(string calldata label) external view returns (bool) {
        return _slot[keccak256(bytes(label))] != 0;
    }

    /// @notice Read a slice of the list in one call.
    /// @dev The whole point of this contract is that a browser can do discovery
    ///      itself, so reads are paged: a page of a few hundred labels is one
    ///      eth_call, against the alternative of scanning a hundred thousand
    ///      blocks. `size` is clamped rather than rejected so a caller can ask
    ///      for more than exists without a revert.
    function page(uint256 start, uint256 size) external view returns (string[] memory out) {
        uint256 total = labels.length;
        if (start >= total) return new string[](0);
        uint256 end = start + size;
        if (end > total) end = total;
        out = new string[](end - start);
        for (uint256 i = start; i < end; i += 1) out[i - start] = labels[i];
    }

    /// @notice The current owner of a listed label, or the zero address if the
    ///         registration has lapsed since it was announced.
    /// @dev Lets a reader check the list against the registry without knowing how
    ///      namehashes are built, and lets a keeper find what to prune.
    function ownerOfLabel(string calldata label) external view returns (address) {
        return REGISTRY.owner(_node(keccak256(bytes(label))));
    }

    // ---------------------------------------------------------------- inner

    function _node(bytes32 labelHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(DOT_NODE, labelHash));
    }
}
