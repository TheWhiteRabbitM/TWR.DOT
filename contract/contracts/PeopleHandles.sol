// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title PeopleHandles - the @ name a mask goes by
/// @notice Devnet identities live on the People chain as usernames like
///         watanabe.01. This contract runs on Asset Hub and CANNOT read that
///         chain: there is no cross-chain state read available to a contract
///         here, so ownership of a username cannot be proven on this side.
///         Pretending otherwise is exactly what let anyone claim anyone in the
///         first version of the masks contract.
///
///         So this proves nothing about ownership. It gives the two properties
///         that still matter in an app:
///
///           UNIQUE - a handle belongs to one mask, first come first served, so
///                    two accounts can never show the same name.
///           BOUND  - only the holder of that mask can set or release it, and a
///                    mask is account-bound and cannot be transferred.
///
///         A reader must show these WITHOUT a verified mark. The tick belongs to
///         a .dot, which the masks contract checks against the registry - that
///         check is real and this one is not.
///
///         It is a separate contract on purpose: identity gained this field after
///         masks and chirps already held real content, and a new masks contract
///         would have orphaned both.
/// @custom:cdm @thebutton/peoplehandles
contract PeopleHandles {
    error NotYourMask();
    error TakenAlready(uint256 byMask);
    error BadHandle();

    event HandleSet(uint256 indexed mask, string handle);
    event HandleCleared(uint256 indexed mask, string handle);

    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);
    mapping(uint256 => string) public handleOf;
    mapping(bytes32 => uint256) public maskOfHandle;

    function setHandle(uint256 mask, string calldata handle) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        uint256 n = bytes(handle).length;
        if (n == 0 || n > 32 || !_plain(bytes(handle))) revert BadHandle();
        bytes32 key = keccak256(bytes(_lower(handle)));
        uint256 held = maskOfHandle[key];
        if (held != 0 && held != mask) revert TakenAlready(held);
        string memory old = handleOf[mask];
        if (bytes(old).length != 0) maskOfHandle[keccak256(bytes(_lower(old)))] = 0;
        handleOf[mask] = handle;
        maskOfHandle[key] = mask;
        emit HandleSet(mask, handle);
    }

    function clearHandle(uint256 mask) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        string memory old = handleOf[mask];
        if (bytes(old).length == 0) return;
        maskOfHandle[keccak256(bytes(_lower(old)))] = 0;
        delete handleOf[mask];
        emit HandleCleared(mask, old);
    }

    function _plain(bytes memory s) private pure returns (bool) {
        for (uint256 i; i < s.length; i++) {
            uint8 c = uint8(s[i]);
            bool ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
                || c == 46 || c == 45 || c == 95;
            if (!ok) return false;
        }
        return true;
    }

    function _lower(string memory s) private pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c >= 65 && c <= 90) b[i] = bytes1(c + 32);
        }
        return string(b);
    }
}
