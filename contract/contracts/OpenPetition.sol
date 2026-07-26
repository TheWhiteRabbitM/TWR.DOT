// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Personhood precompile exposed by the Polkadot Products runtime.
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

/// @title OpenPetition
/// @notice A public petition register where one human signs once, ever, per
///         petition — and the count can prove it.
/// @dev Signatures are keyed on the signer's personhood `contextAlias`, so a
///      human cannot multiply signatures with fresh addresses, and the counts
///      are stratified by personhood tier instead of gated on one:
///
///        - Full (2): counted as a verified human signature.
///        - Lite (1): counted separately as provisional — a registered
///          username is some friction, but any number of fresh accounts can
///          reach it, so it is never mixed into the verified count.
///        - None (0): rejected.
///
///      Stratifying keeps the register honest AND usable on devnet, where the
///      Full flow may not be reachable for everyone yet. The headline number
///      is always the verified one; the provisional count is disclosure, not
///      inflation.
/// @custom:cdm @thebutton/openpetition
contract OpenPetition {
    struct Petition {
        /// @dev contextAlias of the creator.
        bytes32 author;
        uint64 createdAt;
        /// @dev Signatures from Full-tier humans. The number that matters.
        uint32 fullCount;
        /// @dev Signatures from Lite-tier accounts. Disclosed, never merged.
        uint32 liteCount;
        string title;
        /// @dev Optional CID of a longer body published on Bulletin. May be "".
        string bodyCid;
    }

    /// @notice Fixed address of the personhood precompile.
    /// @dev Numeric cast avoids depending on EIP-55 checksum casing.
    ///      Equals 0x000000000000000000000000000000000a010000.
    address public constant PERSONHOOD = address(uint160(0x0a010000));

    /// @notice Alias derivation context for this app.
    bytes32 public constant CONTEXT = keccak256("openpetition.dot");

    /// @notice Minimum tier to create or sign. Lite — see the tier note above.
    uint8 public constant MIN_STATUS = 1;

    /// @notice Petitions one alias may create. Spam brake, not a feature.
    uint8 public constant MAX_PER_AUTHOR = 5;

    uint256 public constant MIN_TITLE_BYTES = 8;
    uint256 public constant MAX_TITLE_BYTES = 160;
    uint256 public constant MAX_BODY_CID_BYTES = 96;

    Petition[] private _petitions;

    /// @dev petitionId => alias => tier the signature was recorded at (0 = none).
    mapping(uint256 => mapping(bytes32 => uint8)) private _signedTier;

    /// @dev alias => petitions created.
    mapping(bytes32 => uint8) private _createdBy;

    event Created(uint256 indexed id, bytes32 indexed author, string title);
    event Signed(uint256 indexed id, bytes32 indexed who, uint8 tier);

    error NotHuman(uint8 status, uint8 required);
    error AlreadySigned(uint256 id);
    error UnknownPetition(uint256 id);
    error TooManyPetitions(uint8 max);
    error BadTitle(uint256 bytesLength);
    error BadBodyCid(uint256 bytesLength);

    function _identify() private view returns (IPersonhood.PersonhoodInfo memory info) {
        info = IPersonhood(PERSONHOOD).personhoodStatus(msg.sender, CONTEXT);
        if (info.status < MIN_STATUS) {
            revert NotHuman(info.status, MIN_STATUS);
        }
    }

    /// @notice Open a petition.
    /// @param title Short statement of the ask. 8–160 bytes.
    /// @param bodyCid Optional Bulletin CID of a longer text. Empty string for none.
    /// @return id The new petition's id.
    function create(string calldata title, string calldata bodyCid)
        external
        returns (uint256 id)
    {
        IPersonhood.PersonhoodInfo memory info = _identify();

        uint256 titleLen = bytes(title).length;
        if (titleLen < MIN_TITLE_BYTES || titleLen > MAX_TITLE_BYTES) {
            revert BadTitle(titleLen);
        }
        if (bytes(bodyCid).length > MAX_BODY_CID_BYTES) {
            revert BadBodyCid(bytes(bodyCid).length);
        }
        if (_createdBy[info.contextAlias] >= MAX_PER_AUTHOR) {
            revert TooManyPetitions(MAX_PER_AUTHOR);
        }

        _createdBy[info.contextAlias] += 1;
        id = _petitions.length;
        _petitions.push(
            Petition({
                author: info.contextAlias,
                createdAt: uint64(block.timestamp),
                fullCount: 0,
                liteCount: 0,
                title: title,
                bodyCid: bodyCid
            })
        );

        emit Created(id, info.contextAlias, title);
    }

    /// @notice Sign a petition. One signature per human, ever, per petition.
    function sign(uint256 id) external {
        if (id >= _petitions.length) revert UnknownPetition(id);
        IPersonhood.PersonhoodInfo memory info = _identify();

        if (_signedTier[id][info.contextAlias] != 0) {
            revert AlreadySigned(id);
        }
        _signedTier[id][info.contextAlias] = info.status;

        if (info.status >= 2) {
            _petitions[id].fullCount += 1;
        } else {
            _petitions[id].liteCount += 1;
        }

        emit Signed(id, info.contextAlias, info.status);
    }

    /// @notice Number of petitions ever opened.
    function count() external view returns (uint256) {
        return _petitions.length;
    }

    /// @notice Read one petition.
    function get(uint256 id) external view returns (Petition memory) {
        if (id >= _petitions.length) revert UnknownPetition(id);
        return _petitions[id];
    }

    /// @notice Page through petitions, oldest-first.
    function page(uint256 offset, uint256 limit)
        external
        view
        returns (Petition[] memory slice)
    {
        uint256 len = _petitions.length;
        if (offset >= len) return new Petition[](0);

        uint256 end = offset + limit;
        if (end > len) end = len;

        slice = new Petition[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            slice[i - offset] = _petitions[i];
        }
    }

    /// @notice Everything the frontend needs about one account, in one call.
    /// @return status The account's personhood tier.
    /// @return yourAlias The account's alias in this context.
    /// @return signedTier Tier the account signed `id` at, or 0 if it has not.
    function me(address account, uint256 id)
        external
        view
        returns (uint8 status, bytes32 yourAlias, uint8 signedTier)
    {
        IPersonhood.PersonhoodInfo memory info =
            IPersonhood(PERSONHOOD).personhoodStatus(account, CONTEXT);
        uint8 tier = id < _petitions.length ? _signedTier[id][info.contextAlias] : 0;
        return (info.status, info.contextAlias, tier);
    }
}
