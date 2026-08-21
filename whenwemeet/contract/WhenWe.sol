// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPeoplebook {
    function ownerOf(uint256 id) external view returns (address);
}

/**
 * Finding a time that works, without handing anyone your calendar.
 *
 * Everybody has used the web2 version of this: you get a link, you tick the
 * slots that suit you, and in exchange a company learns who you meet, when you
 * are free, and usually your email address. None of that is needed to answer the
 * question. What is needed is a list of options, a tick per person per option,
 * and a guarantee that one person cannot tick fifty times.
 *
 * So: options are strings, a vote is a bitmap of the slots that suit you, and
 * the guarantee is a Peoplebook mask. Change your mind by voting again; the last
 * word replaces the first, and the tallies move with it.
 *
 * There is no owner. Not even the person who opened the poll can close it,
 * delete it, or remove a vote — including me.
 */
contract WhenWe {
    uint8 public constant MAX_OPTIONS = 16;

    IPeoplebook public immutable PEOPLEBOOK;

    struct Poll {
        uint256 mask;      // who opened it
        address opener;
        uint64 at;         // block it was opened in
        string title;
        string[] options;
    }

    Poll[] private _polls;

    /// poll => mask => bitmap of chosen options, plus one bit to mark "has voted"
    mapping(uint256 => mapping(uint256 => uint32)) private _ballot;
    /// poll => option => count
    mapping(uint256 => mapping(uint8 => uint32)) public tally;
    mapping(uint256 => uint32) public voters;

    uint64 public lastChangedAt;

    event Opened(uint256 indexed id, uint256 indexed mask, string title);
    event Voted(uint256 indexed id, uint256 indexed mask, uint32 bitmap);

    error NotYourMask();
    error NoOptions();
    error TooManyOptions();
    error NoSuchPoll();
    error OutOfRange();

    constructor(address peoplebook) {
        PEOPLEBOOK = IPeoplebook(peoplebook);
    }

    modifier held(uint256 mask) {
        if (PEOPLEBOOK.ownerOf(mask) != msg.sender) revert NotYourMask();
        _;
    }

    function open(uint256 mask, string calldata title, string[] calldata options)
        external
        held(mask)
        returns (uint256 id)
    {
        if (options.length == 0) revert NoOptions();
        if (options.length > MAX_OPTIONS) revert TooManyOptions();
        id = _polls.length;
        Poll storage p = _polls.push();
        p.mask = mask;
        p.opener = msg.sender;
        p.at = uint64(block.number);
        p.title = title;
        for (uint256 i = 0; i < options.length; i++) p.options.push(options[i]);
        lastChangedAt = uint64(block.number);
        emit Opened(id, mask, title);
    }

    /// Tick the slots that suit you. Voting again replaces your previous answer,
    /// which is what changing your mind looks like when nothing can be deleted.
    function vote(uint256 mask, uint256 id, uint32 bitmap) external held(mask) {
        if (id >= _polls.length) revert NoSuchPoll();
        uint8 n = uint8(_polls[id].options.length);
        if (bitmap >> n != 0) revert OutOfRange();

        uint32 prev = _ballot[id][mask];
        if (prev == 0) voters[id] += 1;
        uint32 prevBits = prev & ((uint32(1) << n) - 1);

        for (uint8 i = 0; i < n; i++) {
            bool was = (prevBits >> i) & 1 == 1;
            bool now_ = (bitmap >> i) & 1 == 1;
            if (was && !now_) tally[id][i] -= 1;
            if (!was && now_) tally[id][i] += 1;
        }
        // the high bit records that this mask has answered, even with no slots
        _ballot[id][mask] = bitmap | 0x80000000;
        lastChangedAt = uint64(block.number);
        emit Voted(id, mask, bitmap);
    }

    function count() external view returns (uint256) {
        return _polls.length;
    }

    function titleOf(uint256 id) external view returns (string memory) {
        if (id >= _polls.length) revert NoSuchPoll();
        return _polls[id].title;
    }

    function optionsOf(uint256 id) external view returns (string[] memory) {
        if (id >= _polls.length) revert NoSuchPoll();
        return _polls[id].options;
    }

    function meta(uint256 id)
        external
        view
        returns (uint256 mask, address opener, uint64 at, uint8 options, uint32 people)
    {
        if (id >= _polls.length) revert NoSuchPoll();
        Poll storage p = _polls[id];
        return (p.mask, p.opener, p.at, uint8(p.options.length), voters[id]);
    }

    /// Counts for every option, in one call.
    function tallies(uint256 id) external view returns (uint32[] memory out) {
        if (id >= _polls.length) revert NoSuchPoll();
        uint8 n = uint8(_polls[id].options.length);
        out = new uint32[](n);
        for (uint8 i = 0; i < n; i++) out[i] = tally[id][i];
    }

    /// What this mask answered, and whether it answered at all.
    function ballotOf(uint256 id, uint256 mask) external view returns (uint32 bitmap, bool answered) {
        uint32 b = _ballot[id][mask];
        return (b & 0x7fffffff, b != 0);
    }
}
