// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title PeoplePFP - the picture a mask goes by
/// @notice A sibling contract rather than a field, because PeoplebookMasks2 is
///         deployed and its profile struct is frozen; adding to it would have
///         orphaned every mask and every chirp. Extending sideways costs one
///         deploy and loses nothing - the same lesson PeopleHandles taught.
///
///         The picture itself is NOT here. It lives on the Bulletin chain as a
///         preimage, uploaded through the host, and this contract holds only the
///         key. Two reasons: image bytes in contract storage would be paid for
///         by every person who sets one, and the host's preimage surface is the
///         only upload path an ordinary user has - the Bulletin storage pool a
///         publisher uses needs an authorisation they cannot get.
///
///         Bulletin retention is a window of roughly a fortnight, so a picture
///         left alone expires. That is deliberate and handled off chain: a
///         preimage is content-addressed, so re-uploading the identical bytes
///         yields the identical key, and the app renews by reading the picture
///         back and submitting it again. The renewal therefore costs no
///         transaction and never touches this contract. A key stored here can
///         point at bytes that have since expired, and a reader that finds
///         nothing simply falls back to the generated avatar - which is why
///         `clear` exists but is not required.
/// @custom:cdm @thebutton/peoplepfp
contract PeoplePFP {
    error NotYourMask();
    error BadKey();

    event Set(uint256 indexed mask, bytes key);
    event Cleared(uint256 indexed mask);

    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    /// @dev `bytes` rather than `bytes32`: the host returns the preimage key as
    ///      a hex string and its width is the host's business, not ours. Storing
    ///      a shape we merely assume would break silently the day it changed.
    mapping(uint256 => bytes) internal _pfp;

    /// @param mask a mask you hold
    /// @param key  the preimage key the host returned, up to 64 bytes
    function setPfp(uint256 mask, bytes calldata key) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (key.length == 0 || key.length > 64) revert BadKey();
        _pfp[mask] = key;
        emit Set(mask, key);
    }

    /// @notice Go back to the generated avatar.
    function clear(uint256 mask) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        delete _pfp[mask];
        emit Cleared(mask);
    }

    /// @notice Empty when this mask has no picture, or has cleared it. It is
    ///         never an error: a mask without a face is the normal case.
    function pfpOf(uint256 mask) external view returns (bytes memory) {
        return _pfp[mask];
    }
}
