// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPeoplebook {
    function ownerOf(uint256 id) external view returns (address);
}

/**
 * One human, one pixel, every so many blocks.
 *
 * r/place worked because Reddit could tell one account from a thousand, and it
 * still lost ground to scripted armies. On a chain with no personhood the same
 * board is worthless: whoever writes the best bot owns the canvas by lunchtime.
 * So the only interesting version of this game is the one where an identity is
 * a person, and that is exactly what the mask registry provides.
 *
 * Everything a player does is here. There is no server keeping the picture, no
 * admin who can clear it, no owner, no pause. The canvas IS the contract state:
 * 64 words of storage, four bits a pixel, and whoever placed them last.
 *
 * The clock is the chain. A mask may place once every COOLDOWN blocks, which
 * makes block height the resource the game is played against — you cannot buy
 * your way to more turns, only wait like everyone else.
 */
contract BlockCanvas {
    uint16 public constant SIDE = 64;
    uint16 public constant PIXELS = 4096;   // SIDE * SIDE
    uint8 public constant COLORS = 16;      // one nibble each
    uint64 public constant COOLDOWN = 30;   // blocks between placements

    IPeoplebook public immutable PEOPLEBOOK;

    /// 4096 pixels at 4 bits: 64 pixels to a word, 64 words.
    uint256[64] private _words;

    /// Block at which each mask last placed, so the wait is per person.
    mapping(uint256 => uint64) public lastBlockOf;
    mapping(uint256 => uint32) public placedBy;

    uint32 public totalPlaced;
    uint64 public lastChangedAt;

    event Placed(uint256 indexed mask, uint16 indexed index, uint8 color, uint64 atBlock);

    error NotYourMask();
    error OutOfBounds();
    error NoSuchColour();
    error StillWaiting(uint64 blocksLeft);

    constructor(address peoplebook) {
        PEOPLEBOOK = IPeoplebook(peoplebook);
    }

    /// Paint one pixel. Reverts rather than silently ignoring, so a client that
    /// mis-times the cooldown finds out instead of showing a lie.
    function place(uint256 mask, uint16 index, uint8 colour) external {
        if (PEOPLEBOOK.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (index >= PIXELS) revert OutOfBounds();
        if (colour >= COLORS) revert NoSuchColour();

        uint64 last = lastBlockOf[mask];
        if (last != 0) {
            uint64 ready = last + COOLDOWN;
            if (uint64(block.number) < ready) revert StillWaiting(ready - uint64(block.number));
        }

        uint256 w = index >> 6;             // 64 pixels per word
        uint256 shift = (index & 63) * 4;
        uint256 word = _words[w];
        word &= ~(uint256(0xf) << shift);
        word |= uint256(colour) << shift;
        _words[w] = word;

        lastBlockOf[mask] = uint64(block.number);
        placedBy[mask] += 1;
        totalPlaced += 1;
        lastChangedAt = uint64(block.number);

        emit Placed(mask, index, colour, uint64(block.number));
    }

    /// The whole picture in one call: 64 words, 4 bits a pixel, row major.
    function board() external view returns (uint256[64] memory) {
        return _words;
    }

    function pixel(uint16 index) external view returns (uint8) {
        if (index >= PIXELS) revert OutOfBounds();
        return uint8((_words[index >> 6] >> ((index & 63) * 4)) & 0xf);
    }

    /// Blocks a mask must still wait. Zero means it can place now.
    function waitFor(uint256 mask) external view returns (uint64) {
        uint64 last = lastBlockOf[mask];
        if (last == 0) return 0;
        uint64 ready = last + COOLDOWN;
        return uint64(block.number) >= ready ? 0 : ready - uint64(block.number);
    }
}
