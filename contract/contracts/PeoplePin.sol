// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title PeoplePin - the one chirp a profile leads with
/// @notice X lets you pin a post to the top of your profile, and it is the
///         difference between a profile that is a stream and a profile that
///         says something. It belongs on chain rather than on a device: a
///         pinned post is what OTHER people see when they arrive, so a local
///         preference would pin it for nobody but yourself.
///
///         A sibling contract, again, because PeoplebookMasks2 is deployed and
///         its profile struct cannot grow. That is now the third field identity
///         has gained this way, and the pattern holds: one small contract, one
///         mapping, nothing orphaned.
///
///         The chirp id is NOT checked against the Chirp contract. It is a
///         separate contract and this one has no business reading it — a reader
///         resolves the id and finds nothing if it was deleted, which is the
///         same thing it must handle anyway when a pinned chirp is removed
///         later. Storing a number we cannot keep honest is better than
///         pretending to validate it.
/// @custom:cdm @thebutton/peoplepin
contract PeoplePin {
    error NotYourMask();

    event Pinned(uint256 indexed mask, uint256 chirpId);
    event Unpinned(uint256 indexed mask);

    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    /// mask -> the chirp it leads with. Zero means none.
    mapping(uint256 => uint256) public pinOf;

    function pin(uint256 mask, uint256 chirpId) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        pinOf[mask] = chirpId;
        emit Pinned(mask, chirpId);
    }

    function unpin(uint256 mask) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        delete pinOf[mask];
        emit Unpinned(mask);
    }
}
