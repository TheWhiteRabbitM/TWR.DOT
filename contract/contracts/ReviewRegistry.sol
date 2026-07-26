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

/// @title TrueReviews
/// @notice Reviews for real-world places you can trust: one verified human,
///         one review per place, ever. Each place is anchored to its
///         OpenStreetMap identifier, so a review here is about a real business
///         anyone can find on a map — and the count cannot be padded with fake
///         or paid accounts.
/// @dev Reviews are keyed on the reviewer's personhood `contextAlias`, so a
///      human cannot multiply reviews with fresh wallets. Tiers are stratified
///      like OpenPetition: Full (2) reviews drive the displayed rating; Lite (1)
///      reviews are disclosed separately (a username is some friction, but any
///      number of fresh accounts can reach it); None (0) is rejected.
/// @custom:cdm @thebutton/truereviews
contract ReviewRegistry {
    struct Place {
        /// @dev Stable OSM reference, e.g. "node/240109189". The public anchor.
        string osmRef;
        /// @dev Display name captured when the place was first reviewed.
        string name;
        /// @dev Coordinates × 1e6 (deep-links to OSM / Google Maps).
        int32 latE6;
        int32 lonE6;
        /// @dev Sum of Full-tier ratings and their count — the displayed score.
        uint32 sumFull;
        uint32 fullCount;
        /// @dev Lite-tier ratings, disclosed, never merged into the score.
        uint32 sumLite;
        uint32 liteCount;
        uint64 firstAt;
    }

    struct Review {
        bytes32 author;
        uint8 rating; // 1..5
        uint8 tier; // 1 = Lite, 2 = Full
        uint64 at;
        /// @dev Optional Bulletin CID of the review text. May be "".
        string bodyCid;
    }

    /// @notice Fixed address of the personhood precompile.
    ///         Equals 0x000000000000000000000000000000000a010000.
    address public constant PERSONHOOD = address(uint160(0x0a010000));

    /// @notice Alias derivation context for this app.
    bytes32 public constant CONTEXT = keccak256("truereviews.dot");

    /// @notice Minimum tier to post a review. Lite — see the tier note above.
    uint8 public constant MIN_STATUS = 1;

    uint256 public constant MIN_OSM_REF_BYTES = 3;
    uint256 public constant MAX_OSM_REF_BYTES = 48;
    uint256 public constant MAX_NAME_BYTES = 120;
    uint256 public constant MAX_BODY_CID_BYTES = 96;

    /// @dev placeKey => place record.
    mapping(bytes32 => Place) private _places;
    /// @dev placeKey => reviews.
    mapping(bytes32 => Review[]) private _reviews;
    /// @dev placeKey => alias => 1-based review index (0 = has not reviewed).
    mapping(bytes32 => mapping(bytes32 => uint256)) private _reviewedAt;
    /// @dev Every place ever reviewed, for the directory.
    bytes32[] private _placeKeys;

    event PlaceAdded(bytes32 indexed key, string osmRef, string name);
    event Reviewed(bytes32 indexed key, bytes32 indexed who, uint8 rating, uint8 tier);

    error NotHuman(uint8 status, uint8 required);
    error AlreadyReviewed(bytes32 key);
    error BadRating(uint8 rating);
    error BadOsmRef(uint256 bytesLength);
    error BadName(uint256 bytesLength);
    error BadBodyCid(uint256 bytesLength);
    error UnknownPlace(bytes32 key);

    /// @notice Deterministic on-chain key for an OSM reference.
    function keyFor(string calldata osmRef) public pure returns (bytes32) {
        return keccak256(bytes(osmRef));
    }

    function _identify() private view returns (IPersonhood.PersonhoodInfo memory info) {
        info = IPersonhood(PERSONHOOD).personhoodStatus(msg.sender, CONTEXT);
        if (info.status < MIN_STATUS) {
            revert NotHuman(info.status, MIN_STATUS);
        }
    }

    /// @notice Post a review for a place. One review per human, ever, per place.
    /// @param osmRef   Stable OSM reference, e.g. "node/240109189".
    /// @param name     Display name (used only when the place is first seen).
    /// @param latE6    Latitude × 1e6.
    /// @param lonE6    Longitude × 1e6.
    /// @param rating   1..5.
    /// @param bodyCid  Optional Bulletin CID of the written review. "" for none.
    /// @return key The place key.
    function review(
        string calldata osmRef,
        string calldata name,
        int32 latE6,
        int32 lonE6,
        uint8 rating,
        string calldata bodyCid
    ) external returns (bytes32 key) {
        if (rating < 1 || rating > 5) revert BadRating(rating);
        uint256 refLen = bytes(osmRef).length;
        if (refLen < MIN_OSM_REF_BYTES || refLen > MAX_OSM_REF_BYTES) revert BadOsmRef(refLen);
        if (bytes(name).length > MAX_NAME_BYTES) revert BadName(bytes(name).length);
        if (bytes(bodyCid).length > MAX_BODY_CID_BYTES) revert BadBodyCid(bytes(bodyCid).length);

        IPersonhood.PersonhoodInfo memory info = _identify();
        key = keccak256(bytes(osmRef));

        if (_reviewedAt[key][info.contextAlias] != 0) revert AlreadyReviewed(key);

        Place storage p = _places[key];
        if (p.firstAt == 0) {
            // First review of this place — register it.
            p.osmRef = osmRef;
            p.name = name;
            p.latE6 = latE6;
            p.lonE6 = lonE6;
            p.firstAt = uint64(block.timestamp);
            _placeKeys.push(key);
            emit PlaceAdded(key, osmRef, name);
        }

        if (info.status >= 2) {
            p.sumFull += rating;
            p.fullCount += 1;
        } else {
            p.sumLite += rating;
            p.liteCount += 1;
        }

        _reviews[key].push(
            Review({
                author: info.contextAlias,
                rating: rating,
                tier: info.status,
                at: uint64(block.timestamp),
                bodyCid: bodyCid
            })
        );
        _reviewedAt[key][info.contextAlias] = _reviews[key].length;

        emit Reviewed(key, info.contextAlias, rating, info.status);
    }

    /// @notice Number of distinct places reviewed.
    function placeCount() external view returns (uint256) {
        return _placeKeys.length;
    }

    /// @notice Read a place record.
    function place(bytes32 key) external view returns (Place memory) {
        if (_places[key].firstAt == 0) revert UnknownPlace(key);
        return _places[key];
    }

    /// @notice How many reviews a place has.
    function reviewCount(bytes32 key) external view returns (uint256) {
        return _reviews[key].length;
    }

    /// @notice Page through a place's reviews, oldest-first.
    function reviews(bytes32 key, uint256 offset, uint256 limit)
        external
        view
        returns (Review[] memory slice)
    {
        Review[] storage all = _reviews[key];
        uint256 len = all.length;
        if (offset >= len) return new Review[](0);
        uint256 end = offset + limit;
        if (end > len) end = len;
        slice = new Review[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            slice[i - offset] = all[i];
        }
    }

    /// @notice Page through the place directory, newest-first.
    function directory(uint256 offset, uint256 limit)
        external
        view
        returns (Place[] memory slice)
    {
        uint256 len = _placeKeys.length;
        if (offset >= len) return new Place[](0);
        uint256 end = offset + limit;
        if (end > len) end = len;
        slice = new Place[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            // newest-first
            slice[i - offset] = _places[_placeKeys[len - 1 - i]];
        }
    }

    /// @notice Everything the frontend needs about one account at one place.
    /// @return status    The account's personhood tier.
    /// @return yourAlias The account's alias in this context.
    /// @return yourRating The rating the account left (0 if none).
    function me(address account, bytes32 key)
        external
        view
        returns (uint8 status, bytes32 yourAlias, uint8 yourRating)
    {
        IPersonhood.PersonhoodInfo memory info =
            IPersonhood(PERSONHOOD).personhoodStatus(account, CONTEXT);
        uint256 idx = _reviewedAt[key][info.contextAlias];
        uint8 r = idx == 0 ? 0 : _reviews[key][idx - 1].rating;
        return (info.status, info.contextAlias, r);
    }
}
