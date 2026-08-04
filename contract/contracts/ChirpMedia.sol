// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title ChirpMedia — the picture in the post, on the chain that keeps it
/// @notice Same lesson PeopleFace learned, applied to chirps: store a key and
///         the picture is really in somebody's cache with a receipt on chain.
///         Store the bytes and every reader sees the same image, for ever,
///         with nothing to renew.
///
///         WHY NOT BULLETIN. Bulletin forgets after about a fortnight, which is
///         acceptable for a preimage you can re-submit and unacceptable for a
///         post that is meant to still be there next year. A chirp cannot be
///         edited into having its picture back.
///
///         WHY THE CAP IS 24 KB. Twice PeopleFace's, because this is a picture
///         somebody looks AT rather than a 40px avatar — but still small enough
///         that the storage deposit is a few cents rather than a surprise. A
///         640px WebP at quality 70 lands around 20 KB, which is the size this
///         was chosen for. Anything larger is a photo that was never resized,
///         and charging someone a deposit for that mistake is not a kindness.
///
///         The author check is by MASK, not by chirp id: this contract cannot
///         see into Chirp2's storage to ask who wrote a given chirp, so it
///         records who attached what and lets readers compare that against the
///         chirp's own author. A mismatch means somebody attached a picture to
///         a post that was not theirs, and a client should ignore it.
/// @custom:cdm @thebutton/chirpmedia
contract ChirpMedia {
    error NotYourMask();
    error TooBig(uint256 size);
    error Empty();
    error NotYours();

    event Attached(uint256 indexed chirpId, uint256 indexed mask, uint256 size);
    event Detached(uint256 indexed chirpId);

    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    /// 24 kilobytes — see the note above on why this number and not a bigger one.
    uint256 public constant MAX = 24_000;

    mapping(uint256 => bytes) internal _media;
    /// chirpId => the mask that attached it, so a reader can check it was the author
    mapping(uint256 => uint256) public authorOf;
    /// chirpId => a short alt text, because a picture nobody can describe is a
    /// picture some readers simply do not receive
    mapping(uint256 => string) public altOf;

    /// @param chirpId the chirp to attach to
    /// @param mask a mask you hold — and, for this to be honoured, the one that posted
    /// @param webp the image bytes, already resized
    /// @param alt a short description, may be empty
    function attach(uint256 chirpId, uint256 mask, bytes calldata webp, string calldata alt) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        // Once attached, only the attaching mask may replace it. Without this a
        // second mask could overwrite somebody's picture on their own post.
        uint256 held = authorOf[chirpId];
        if (held != 0 && held != mask) revert NotYours();
        if (webp.length == 0) revert Empty();
        if (webp.length > MAX) revert TooBig(webp.length);
        _media[chirpId] = webp;
        authorOf[chirpId] = mask;
        altOf[chirpId] = alt;
        emit Attached(chirpId, mask, webp.length);
    }

    /// @notice Take the picture off and stop paying to store it. The chirp stays.
    function detach(uint256 chirpId, uint256 mask) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (authorOf[chirpId] != mask) revert NotYours();
        delete _media[chirpId];
        delete authorOf[chirpId];
        delete altOf[chirpId];
        emit Detached(chirpId);
    }

    /// @notice Empty when this chirp has no picture. Most do not.
    function mediaOf(uint256 chirpId) external view returns (bytes memory) {
        return _media[chirpId];
    }

    /// @notice Size and author without fetching the bytes, so a timeline can
    ///         decide what to load rather than pulling every image it scrolls past.
    function infoOf(uint256 chirpId) external view returns (uint256 size, uint256 mask, string memory alt) {
        return (_media[chirpId].length, authorOf[chirpId], altOf[chirpId]);
    }
}
