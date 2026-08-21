// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPeoplebook {
    function ownerOf(uint256 id) external view returns (address);
}

/**
 * A message that publishes itself if you stop checking in.
 *
 * The web2 version of this exists and asks for an enormous act of faith: you
 * write something that matters, hand it to a company, and trust that the company
 * still exists on the day it is needed, still has your file, still has a working
 * mail server, and still intends to honour the arrangement. Every one of those
 * is a promise by someone with no obligation to keep it.
 *
 * Here the promise is arithmetic. You set a watch and a message. Coming back
 * resets the clock. If the clock runs past its deadline, the message is readable
 * by anyone who asks the contract, because it was always in the contract and the
 * only thing changing is whether the contract says it is due.
 *
 * Two things follow, and both are honest rather than convenient:
 *   1. Nothing is secret. A chain cannot keep a secret and pretend otherwise, so
 *      the message is public from the moment it is written and the deadline only
 *      governs when it is PRESENTED. Write it accordingly.
 *   2. Nobody can stop it. Not the holder, not me. There is no owner, no pause,
 *      and cancelling means what it says: the watch ends, and the message stops
 *      being due — the words stay where they are.
 */
contract StillHere {
    IPeoplebook public immutable PEOPLEBOOK;

    struct Watch {
        uint256 mask;
        address keeper;
        uint64 lastSeen;   // block of the last check-in
        uint64 window;     // blocks of silence that mean "gone"
        uint64 startedAt;
        bool cancelled;
        string label;      // what this is, shown before it is due
        string message;    // what it says
    }

    Watch[] private _watches;
    mapping(uint256 => uint256[]) private _byMask;

    uint64 public lastChangedAt;

    event Started(uint256 indexed id, uint256 indexed mask, uint64 window);
    event CheckedIn(uint256 indexed id, uint64 atBlock);
    event Ended(uint256 indexed id);

    error NotYourMask();
    error NotYours();
    error NoSuchWatch();
    error WindowTooShort();
    error AlreadyEnded();

    /// A watch must outlast a bad afternoon: roughly ten minutes of blocks.
    uint64 public constant MIN_WINDOW = 300;

    constructor(address peoplebook) {
        PEOPLEBOOK = IPeoplebook(peoplebook);
    }

    function start(uint256 mask, string calldata label, string calldata message, uint64 window)
        external
        returns (uint256 id)
    {
        if (PEOPLEBOOK.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (window < MIN_WINDOW) revert WindowTooShort();
        id = _watches.length;
        _watches.push(
            Watch({
                mask: mask,
                keeper: msg.sender,
                lastSeen: uint64(block.number),
                window: window,
                startedAt: uint64(block.number),
                cancelled: false,
                label: label,
                message: message
            })
        );
        _byMask[mask].push(id);
        lastChangedAt = uint64(block.number);
        emit Started(id, mask, window);
    }

    /// Still here. Resets the clock, and only the keeper can say it.
    function checkIn(uint256 id) external {
        Watch storage w = _at(id);
        if (w.keeper != msg.sender) revert NotYours();
        if (w.cancelled) revert AlreadyEnded();
        w.lastSeen = uint64(block.number);
        lastChangedAt = uint64(block.number);
        emit CheckedIn(id, uint64(block.number));
    }

    /// End the watch. The message stops being due; it does not stop existing,
    /// because nothing here can be deleted and saying otherwise would be a lie.
    function cancel(uint256 id) external {
        Watch storage w = _at(id);
        if (w.keeper != msg.sender) revert NotYours();
        if (w.cancelled) revert AlreadyEnded();
        w.cancelled = true;
        lastChangedAt = uint64(block.number);
        emit Ended(id);
    }

    function count() external view returns (uint256) {
        return _watches.length;
    }

    /// Everything about a watch except the words.
    function meta(uint256 id)
        external
        view
        returns (
            uint256 mask,
            address keeper,
            uint64 lastSeen,
            uint64 window,
            uint64 startedAt,
            bool cancelled,
            bool due,
            uint64 blocksLeft
        )
    {
        Watch storage w = _at(id);
        uint64 deadline = w.lastSeen + w.window;
        bool isDue = !w.cancelled && uint64(block.number) >= deadline;
        return (
            w.mask,
            w.keeper,
            w.lastSeen,
            w.window,
            w.startedAt,
            w.cancelled,
            isDue,
            uint64(block.number) >= deadline ? 0 : deadline - uint64(block.number)
        );
    }

    function labelOf(uint256 id) external view returns (string memory) {
        return _at(id).label;
    }

    /// The words. Readable whenever, because a chain cannot pretend to hold a
    /// secret — what the deadline decides is when a reader is being TOLD.
    function messageOf(uint256 id) external view returns (string memory) {
        return _at(id).message;
    }

    function watchesOf(uint256 mask) external view returns (uint256[] memory) {
        return _byMask[mask];
    }

    function _at(uint256 id) private view returns (Watch storage) {
        if (id >= _watches.length) revert NoSuchWatch();
        return _watches[id];
    }
}
