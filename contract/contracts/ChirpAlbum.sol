// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title ChirpAlbum — up to four pictures on a chirp, the way X allows
/// @notice ChirpMedia holds ONE image per chirp. That was the right first step
///         and it is the wrong shape for the feature people actually expect:
///         four photographs of the same afternoon are one post, not four.
///
///         Rather than replace it, this sits beside it. ChirpMedia keeps serving
///         every chirp that already has a picture — those are on chain and are
///         not going to be migrated — and the app reads the album first, falling
///         back to the single. Nothing that exists stops working.
///
///         SLOTS, NOT AN APPEND-ONLY LIST. `attach(chirpId, mask, slot, …)` puts
///         an image at a known index, so re-attaching replaces rather than
///         duplicates, and a failed second upload does not leave the post with
///         a hole it cannot fill. `count` is the highest slot filled plus one,
///         which is what a client needs to lay the grid out.
///
///         THE DEPOSIT IS PER IMAGE. Four pictures is four storage deposits,
///         paid by whoever attaches them. That is why the cap is four and the
///         size limit is unchanged: this makes a post richer, not cheaper.
/// @custom:cdm @thebutton/chirpalbum
contract ChirpAlbum {
    error NotYourMask();
    error NotYours();
    error TooBig(uint256 size);
    error Empty();
    error BadSlot(uint8 slot);

    event Attached(uint256 indexed chirpId, uint256 indexed mask, uint8 slot, uint256 size);
    event Detached(uint256 indexed chirpId, uint8 slot);

    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    /// Same 24 kB per image as ChirpMedia. A picture somebody looks AT, resized
    /// before it is sent, and small enough that the deposit is cents.
    uint256 public constant MAX = 24_000;
    /// Four, because that is what a grid reads as. Five is a gallery and wants
    /// a different interface than a timeline row.
    uint8 public constant SLOTS = 4;

    mapping(uint256 => mapping(uint8 => bytes)) internal _img;
    mapping(uint256 => mapping(uint8 => string)) internal _alt;
    /// chirpId => the mask that attached, so a reader can check it was the author
    mapping(uint256 => uint256) public authorOf;
    /// chirpId => how many slots are in use (highest filled + 1)
    mapping(uint256 => uint8) public count;

    function attach(uint256 chirpId, uint256 mask, uint8 slot, bytes calldata webp, string calldata alt) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (slot >= SLOTS) revert BadSlot(slot);
        uint256 held = authorOf[chirpId];
        if (held != 0 && held != mask) revert NotYours();
        if (webp.length == 0) revert Empty();
        if (webp.length > MAX) revert TooBig(webp.length);

        _img[chirpId][slot] = webp;
        _alt[chirpId][slot] = alt;
        authorOf[chirpId] = mask;
        if (slot + 1 > count[chirpId]) count[chirpId] = slot + 1;
        emit Attached(chirpId, mask, slot, webp.length);
    }

    /// @notice Remove one picture. The rest keep their slots — renumbering them
    ///         would change what every other reader is looking at.
    function detach(uint256 chirpId, uint8 slot) external {
        uint256 mask = authorOf[chirpId];
        if (mask == 0 || MASKS.ownerOf(mask) != msg.sender) revert NotYours();
        delete _img[chirpId][slot];
        delete _alt[chirpId][slot];
        emit Detached(chirpId, slot);
    }

    function imageOf(uint256 chirpId, uint8 slot) external view returns (bytes memory) {
        return _img[chirpId][slot];
    }

    /// @notice Sizes and alts for the whole post in one read, so a timeline can
    ///         lay out the grid and decide what to fetch without pulling any
    ///         bytes it may not show.
    function infoOf(uint256 chirpId)
        external
        view
        returns (uint256 mask, uint8 n, uint256[SLOTS] memory sizes, string[SLOTS] memory alts)
    {
        mask = authorOf[chirpId];
        n = count[chirpId];
        for (uint8 i = 0; i < SLOTS; i++) {
            sizes[i] = _img[chirpId][i].length;
            alts[i] = _alt[chirpId][i];
        }
    }
}
