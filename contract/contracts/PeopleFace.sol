// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title PeopleFace - the picture itself, on the chain that will keep it
/// @notice PeoplePFP stored a KEY and left the picture on Bulletin. Two things
///         were wrong with that, and only one of them was foreseen.
///
///         The foreseen one: Bulletin forgets after about a fortnight, so a
///         picture had to be re-uploaded to stay alive.
///
///         The one that mattered: the picture only ever came back from the
///         device that set it. Clear the browser and it was gone - which means
///         it was never really on the chain at all, it was in a cache with a
///         receipt on chain. A profile picture that dies with a browser cache is
///         not a profile picture.
///
///         So the bytes live here. A 128px WebP is a couple of kilobytes, which
///         is a storage deposit its owner pays once and nobody has to renew. It
///         cannot expire, it cannot fail to resolve, and it is the same for
///         every reader because there is only one copy and everyone reads it.
///
///         The cap is deliberately tight. This is an avatar drawn at forty
///         pixels; anything that does not fit in twelve kilobytes at that size
///         is a photograph somebody forgot to resize, and letting it through
///         would charge them for a mistake.
/// @custom:cdm @thebutton/peopleface
contract PeopleFace {
    error NotYourMask();
    error TooBig(uint256 size);
    error Empty();

    event Set(uint256 indexed mask, uint256 size);
    event Cleared(uint256 indexed mask);

    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    /// Twelve kilobytes. Enough for 128px of WebP with room to spare, small
    /// enough that a deposit is not a surprise.
    uint256 public constant MAX = 12_000;

    mapping(uint256 => bytes) internal _face;

    /// @param mask a mask you hold
    /// @param webp the image bytes, already square and already small
    function setFace(uint256 mask, bytes calldata webp) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (webp.length == 0) revert Empty();
        if (webp.length > MAX) revert TooBig(webp.length);
        _face[mask] = webp;
        emit Set(mask, webp.length);
    }

    /// @notice Go back to the generated avatar, and stop paying to store this.
    function clear(uint256 mask) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        delete _face[mask];
        emit Cleared(mask);
    }

    /// @notice Empty when this mask has no picture. Not an error: most do not.
    function faceOf(uint256 mask) external view returns (bytes memory) {
        return _face[mask];
    }

    /// @notice The size alone, so a caller can decide whether to fetch it.
    function sizeOf(uint256 mask) external view returns (uint256) {
        return _face[mask].length;
    }
}
