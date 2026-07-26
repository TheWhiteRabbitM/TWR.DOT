// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Personhood precompile exposed by the Polkadot Products runtime.
/// @dev `contextAlias` is a per-application pseudonym: stable for one human
///      within one context, and not linkable to that human's activity in any
///      other application.
interface IPersonhood {
    struct PersonhoodInfo {
        uint8 status; // 0 = None, 1 = Lite, 2 = Full
        bytes32 contextAlias;
    }

    function personhoodStatus(address account, bytes32 context)
        external
        view
        returns (PersonhoodInfo memory);
}

/// @title The Button
/// @notice A single global button. Every human may press it exactly once, ever.
/// @dev The entire point of this contract is that presses are keyed on the
///      caller's personhood `contextAlias` rather than on `msg.sender`. Anyone
///      can generate unlimited addresses, so an address-keyed version would be
///      a bot leaderboard within minutes. One human resolves to one alias in
///      this context, so the counter means something.
/// @custom:cdm @thebutton/the-button
contract TheButton {
    struct Press {
        bytes32 who; // contextAlias of the presser
        uint64 pressedAt; // block timestamp
    }

    /// @notice Fixed address of the personhood precompile.
    /// @dev Written as a numeric cast rather than a hex address literal so the
    ///      source does not depend on getting EIP-55 checksum casing right.
    ///      Equals 0x000000000000000000000000000000000a010000.
    address public constant PERSONHOOD = address(uint160(0x0a010000));

    /// @notice Application context used to derive per-human aliases.
    bytes32 public constant CONTEXT = keccak256("thebutton.dot");

    /// @notice Minimum personhood tier required to press.
    /// @dev Full (2), and deliberately not configurable. Tier 1 (Lite) only
    ///      means "registered a username", which any number of fresh accounts
    ///      can do — allowing it would let one human press repeatedly and
    ///      defeat the point of the contract. CDM has no mechanism for
    ///      constructor arguments anyway, so these are compile-time constants.
    uint8 public constant MIN_STATUS = 2;

    /// @notice Total number of humans who have pressed.
    uint256 public totalPresses;

    /// @dev contextAlias => 1-based ordinal. 0 means "never pressed".
    mapping(bytes32 => uint256) private _ordinal;

    /// @dev Press history in order.
    Press[] private _roll;

    event Pressed(bytes32 indexed who, uint256 indexed ordinal, uint64 pressedAt);

    error NotHuman(uint8 status, uint8 required);
    error AlreadyPressed(uint256 ordinal);

    /// @notice Press the button. Reverts if the caller is not a verified human,
    ///         or if that human has already pressed.
    /// @return ordinal The caller's place in history, 1-based.
    function press() external returns (uint256 ordinal) {
        IPersonhood.PersonhoodInfo memory info =
            IPersonhood(PERSONHOOD).personhoodStatus(msg.sender, CONTEXT);

        if (info.status < MIN_STATUS) {
            revert NotHuman(info.status, MIN_STATUS);
        }

        uint256 existing = _ordinal[info.contextAlias];
        if (existing != 0) {
            revert AlreadyPressed(existing);
        }

        unchecked {
            ordinal = ++totalPresses;
        }

        _ordinal[info.contextAlias] = ordinal;
        _roll.push(Press({who: info.contextAlias, pressedAt: uint64(block.timestamp)}));

        emit Pressed(info.contextAlias, ordinal, uint64(block.timestamp));
    }

    /// @notice Everything the frontend needs for a given account, in one call.
    /// @param account The address to inspect.
    /// @return total Global press count.
    /// @return yourOrdinal The account's ordinal, or 0 if it has not pressed.
    /// @return yourStatus The account's personhood tier.
    /// @return yourAlias The account's alias in this context.
    function snapshot(address account)
        external
        view
        returns (uint256 total, uint256 yourOrdinal, uint8 yourStatus, bytes32 yourAlias)
    {
        IPersonhood.PersonhoodInfo memory info =
            IPersonhood(PERSONHOOD).personhoodStatus(account, CONTEXT);

        return (totalPresses, _ordinal[info.contextAlias], info.status, info.contextAlias);
    }

    /// @notice Whether a given alias has already pressed.
    function ordinalOf(bytes32 contextAlias) external view returns (uint256) {
        return _ordinal[contextAlias];
    }

    /// @notice Paginated press history, newest-last.
    /// @param offset Index to start from.
    /// @param limit Maximum number of entries to return.
    function roll(uint256 offset, uint256 limit) external view returns (Press[] memory page) {
        uint256 len = _roll.length;
        if (offset >= len) {
            return new Press[](0);
        }

        uint256 end = offset + limit;
        if (end > len) {
            end = len;
        }

        page = new Press[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = _roll[i];
        }
    }

    /// @notice Length of the press history.
    function rollLength() external view returns (uint256) {
        return _roll.length;
    }
}
