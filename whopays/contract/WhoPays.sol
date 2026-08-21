// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPeoplebook {
    function ownerOf(uint256 id) external view returns (address);
}

/**
 * Who paid for what, and who owes whom.
 *
 * The web2 version works well and costs you your social graph: an app that knows
 * who you travel with, who you eat with, how often and for how much. None of
 * that is needed to settle a tab. What is needed is a list of amounts, a name
 * against each, and agreement about who was in.
 *
 * The arithmetic is deliberately not in here. A contract that computes balances
 * has to take a view about rounding, and a view about rounding is a view about
 * who eats the last cent. Storage keeps the facts — payer, amount, who it was
 * split between — and every reader derives the same balances from them, which
 * they can check.
 *
 * Amounts are integers in the smallest unit of whatever you are counting, so a
 * currency is a label rather than a feature.
 */
contract WhoPays {
    IPeoplebook public immutable PEOPLEBOOK;

    struct Tab {
        uint256 mask;      // who opened it
        uint64 at;
        string name;
        string unit;       // "EUR", "pizza slices", whatever is being counted
        uint256[] members;
    }

    struct Entry {
        uint256 tab;
        uint256 payer;     // mask that paid
        uint64 at;
        uint128 amount;    // smallest unit
        uint32 shareBits;  // which member indexes it was split between
        string what;
    }

    Tab[] private _tabs;
    Entry[] private _entries;
    mapping(uint256 => uint256[]) private _tabEntries;
    mapping(uint256 => mapping(uint256 => bool)) public isMember;

    uint64 public lastChangedAt;

    event TabOpened(uint256 indexed id, uint256 indexed mask, string name);
    event Joined(uint256 indexed id, uint256 indexed mask);
    event Added(uint256 indexed id, uint256 indexed entry, uint256 indexed payer, uint128 amount);

    error NotYourMask();
    error NoSuchTab();
    error AlreadyIn();
    error NotIn();
    error TooManyMembers();
    error NothingToSplit();

    uint8 public constant MAX_MEMBERS = 32;

    constructor(address peoplebook) {
        PEOPLEBOOK = IPeoplebook(peoplebook);
    }

    modifier held(uint256 mask) {
        if (PEOPLEBOOK.ownerOf(mask) != msg.sender) revert NotYourMask();
        _;
    }

    function open(uint256 mask, string calldata name, string calldata unit)
        external
        held(mask)
        returns (uint256 id)
    {
        id = _tabs.length;
        Tab storage t = _tabs.push();
        t.mask = mask;
        t.at = uint64(block.number);
        t.name = name;
        t.unit = unit;
        t.members.push(mask);
        isMember[id][mask] = true;
        lastChangedAt = uint64(block.number);
        emit TabOpened(id, mask, name);
    }

    /// Anyone holding a mask can join a tab. Leaving is not offered: a tab you
    /// were part of is a fact about what happened, not a preference.
    function join(uint256 mask, uint256 id) external held(mask) {
        Tab storage t = _tab(id);
        if (isMember[id][mask]) revert AlreadyIn();
        if (t.members.length >= MAX_MEMBERS) revert TooManyMembers();
        t.members.push(mask);
        isMember[id][mask] = true;
        lastChangedAt = uint64(block.number);
        emit Joined(id, mask);
    }

    /// Record a payment. `shareBits` marks the member indexes it was split
    /// between; zero means everyone who is in the tab right now.
    function add(uint256 mask, uint256 id, string calldata what, uint128 amount, uint32 shareBits)
        external
        held(mask)
    {
        Tab storage t = _tab(id);
        if (!isMember[id][mask]) revert NotIn();
        uint32 bits = shareBits == 0 ? uint32((uint256(1) << t.members.length) - 1) : shareBits;
        if (bits >> t.members.length != 0) revert NothingToSplit();
        if (bits == 0 || amount == 0) revert NothingToSplit();

        uint256 e = _entries.length;
        _entries.push(
            Entry({ tab: id, payer: mask, at: uint64(block.number), amount: amount, shareBits: bits, what: what })
        );
        _tabEntries[id].push(e);
        lastChangedAt = uint64(block.number);
        emit Added(id, e, mask, amount);
    }

    /* ------------------------------------------------------------- reads -- */

    function tabCount() external view returns (uint256) {
        return _tabs.length;
    }

    function tabMeta(uint256 id)
        external
        view
        returns (uint256 mask, uint64 at, string memory name, string memory unit, uint256[] memory members, uint256 entries)
    {
        Tab storage t = _tab(id);
        return (t.mask, t.at, t.name, t.unit, t.members, _tabEntries[id].length);
    }

    function entryIds(uint256 id) external view returns (uint256[] memory) {
        return _tabEntries[id];
    }

    function entry(uint256 e)
        external
        view
        returns (uint256 tab, uint256 payer, uint64 at, uint128 amount, uint32 shareBits, string memory what)
    {
        Entry storage x = _entries[e];
        return (x.tab, x.payer, x.at, x.amount, x.shareBits, x.what);
    }

    function _tab(uint256 id) private view returns (Tab storage) {
        if (id >= _tabs.length) revert NoSuchTab();
        return _tabs[id];
    }
}
