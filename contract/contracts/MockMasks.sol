// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockMasks — Peoplebook's mask interface, for tests only
/// @notice Amazdot resolves every seller and buyer through the mask contract.
///         Testing against the live one would mean claiming a real soulbound
///         mask per role — and would make the backstop case untestable, since
///         the whole point of a soulbound token is that you cannot arrange for
///         it to stop having an owner.
///
///         So tests point Amazdot here, where ownership can be set and cleared
///         in a call. The interface matches PeoplebookMasks2 exactly and the
///         production deploy passes the real address into the same constructor
///         argument.
contract MockMasks {
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public maskOf;

    function setMask(uint256 id, address who) external {
        address prev = ownerOf[id];
        if (prev != address(0)) maskOf[prev] = 0;
        ownerOf[id] = who;
        if (who != address(0)) maskOf[who] = id;
    }
}
