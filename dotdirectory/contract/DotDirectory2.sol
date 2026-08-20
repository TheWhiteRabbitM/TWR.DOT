// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The `.dot` name registry: `owner(node)` gives the account that owns a
///         namehash. It is the only identity claim checkable on this chain, and
///         everything below rests on it.
interface IDotRegistry {
    function owner(bytes32 node) external view returns (address);
}

/// @title DotDirectory2 — the plaintext label list, with arrival times
/// @notice Second version of the on-chain directory. The first is live at
///         0x8ebd9f5a7c278744c90c88c149b5fb95144277a7 and works; this adds the
///         two things a reader kept having to pay for out of band.
///
///         WHY A NEW DEPLOY
///         1. WHEN. A directory without arrival times cannot answer "what is
///            new", and that question is most of what a history view is for.
///            The chain knows the answer at announce time and it costs one slot
///            to keep, but it cannot be added to a live contract's storage
///            layout after the fact.
///         2. HOW MANY CALLS. Reading 205 names and their owners took 205
///            round trips, because owners live in the registry rather than
///            here. `pageDetailed` resolves them inside a single view, turning
///            a page of fifty names into ONE call. Measured on v1, owners alone
///            cost ~19 seconds in a browser; this makes them free.
///
///         Everything else is unchanged and deliberately so. Announcing is open
///         to anyone and gated only by the registry; pruning is open to anyone
///         and gated only by the registry saying the name is gone. There is no
///         admin, no owner and no pause, so there is nothing for an operator to
///         decide and therefore nobody to trust or to lose.
///
///         WHAT IT STILL DOES NOT DO
///         Nothing on-chain wakes up on its own. This does not discover names;
///         it removes the need for a scheduled machine to be the only thing that
///         can. Anyone may call it — the registrant, a keeper, a wallet at
///         registration time, or a one-off backfill.
/// @custom:cdm @thebutton/dotdirectory2
contract DotDirectory2 {
    // --------------------------------------------------------------- errors
    error NotRegistered();
    error AlreadyListed();
    error NotListed();
    error StillOwned();
    error BadLabel();

    // --------------------------------------------------------------- events
    event Announced(string label, address indexed owner, uint256 index, uint64 atBlock);
    event Pruned(string label, uint256 index);

    IDotRegistry public constant REGISTRY =
        IDotRegistry(0x527b08a640b527a3dae0C4BE04D7344E430B6E50);

    /// @dev keccak256("dot"), the parent node every `<label>.dot` hangs from.
    bytes32 internal constant DOT_NODE =
        keccak256(abi.encodePacked(bytes32(0), keccak256("dot")));

    /// @notice A name, its current owner, and the block it was first announced.
    struct Entry {
        string label;
        address owner;
        uint64 firstSeenBlock;
    }

    /// @notice Every label known to be registered, in announcement order.
    string[] public labels;

    /// @dev label hash -> position + 1, so zero still means "absent".
    mapping(bytes32 => uint256) internal _slot;

    /// @notice The block a label was first announced here. Survives a prune and
    ///         a re-announce: the ecosystem's record of when a name appeared
    ///         should not be erased by a lapsed registration that came back.
    mapping(bytes32 => uint64) public firstSeenBlock;

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

        _add(label, key, holder);
        lastChangedAt = block.number;
    }

    /// @notice Announce many labels at once, for backfilling a directory that an
    ///         off-chain indexer already found.
    /// @dev Skips anything already listed or unregistered rather than reverting:
    ///      a backfill of two hundred names must not fail because one of them
    ///      lapsed since the snapshot was taken.
    function announceMany(string[] calldata batch) external returns (uint256 added) {
        for (uint256 i = 0; i < batch.length; i += 1) {
            if (bytes(batch[i]).length == 0) continue;
            bytes32 key = keccak256(bytes(batch[i]));
            if (_slot[key] != 0) continue;
            address holder = REGISTRY.owner(_node(key));
            if (holder == address(0)) continue;

            _add(batch[i], key, holder);
            added += 1;
        }
        if (added != 0) lastChangedAt = block.number;
    }

    /// @notice Backfill with an arrival block taken from an off-chain index.
    /// @dev The v1 directory and dotmetrics both know when each name really
    ///      first appeared, which is earlier than any migration to this
    ///      contract. Recording `block.number` for those would date the
    ///      migration rather than the name, so the true value can be supplied —
    ///      but ONLY where none is held yet, and never into the future, so a
    ///      later caller cannot rewrite an arrival that is already recorded.
    function announceManyDated(string[] calldata batch, uint64[] calldata seen)
        external
        returns (uint256 added)
    {
        for (uint256 i = 0; i < batch.length; i += 1) {
            if (bytes(batch[i]).length == 0) continue;
            bytes32 key = keccak256(bytes(batch[i]));
            if (_slot[key] != 0) continue;
            address holder = REGISTRY.owner(_node(key));
            if (holder == address(0)) continue;

            uint64 at = i < seen.length && seen[i] != 0 && seen[i] <= block.number
                ? seen[i]
                : uint64(block.number);
            labels.push(batch[i]);
            _slot[key] = labels.length;
            if (firstSeenBlock[key] == 0) firstSeenBlock[key] = at;
            emit Announced(batch[i], holder, labels.length - 1, firstSeenBlock[key]);
            added += 1;
        }
        if (added != 0) lastChangedAt = block.number;
    }

    // ---------------------------------------------------------------- prune

    /// @notice Remove a label the registry no longer recognises.
    /// @dev Swap-and-pop, so ordering is not stable across prunes. Readers key
    ///      on the label, never on the index. `firstSeenBlock` is deliberately
    ///      NOT cleared — see the mapping's own note.
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

    /// @notice Labels only. Cheapest read; use when owners are not needed.
    function page(uint256 start, uint256 size) external view returns (string[] memory out) {
        uint256 total = labels.length;
        if (start >= total) return new string[](0);
        uint256 end = start + size;
        if (end > total) end = total;
        out = new string[](end - start);
        for (uint256 i = start; i < end; i += 1) out[i - start] = labels[i];
    }

    /// @notice Labels with their current owner and arrival block, in one call.
    /// @dev The owner is resolved from the registry inside this view, which is
    ///      the whole point: a client that would otherwise make one call per
    ///      name makes one call per page. Keep `size` moderate — every entry
    ///      costs an external call, and an eth_call still has a gas ceiling.
    function pageDetailed(uint256 start, uint256 size) external view returns (Entry[] memory out) {
        uint256 total = labels.length;
        if (start >= total) return new Entry[](0);
        uint256 end = start + size;
        if (end > total) end = total;
        out = new Entry[](end - start);
        for (uint256 i = start; i < end; i += 1) {
            string memory label = labels[i];
            bytes32 key = keccak256(bytes(label));
            out[i - start] = Entry({
                label: label,
                owner: REGISTRY.owner(_node(key)),
                firstSeenBlock: firstSeenBlock[key]
            });
        }
    }

    /// @notice The current owner of a listed label, or zero if the registration
    ///         has lapsed since it was announced.
    function ownerOfLabel(string calldata label) external view returns (address) {
        return REGISTRY.owner(_node(keccak256(bytes(label))));
    }

    // ---------------------------------------------------------------- inner

    function _add(string calldata label, bytes32 key, address holder) internal {
        labels.push(label);
        _slot[key] = labels.length;
        if (firstSeenBlock[key] == 0) firstSeenBlock[key] = uint64(block.number);
        emit Announced(label, holder, labels.length - 1, firstSeenBlock[key]);
    }

    function _node(bytes32 labelHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(DOT_NODE, labelHash));
    }
}
