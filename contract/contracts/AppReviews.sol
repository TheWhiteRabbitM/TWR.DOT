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

/// @title AppReviews — user reviews of .dot apps, for dot-store.dot
/// @notice One reviewer, one review per app. A reviewer is a verified human
///         (their personhood alias) when personhood is required, and simply an
///         address when it is not. The contract supports BOTH on purpose:
///
///         - On the devnet it ships with `minStatus = 0`, so anyone can review
///           without proof of personhood — the whole point is to exercise the
///           store while personhood is not yet self-service. Those reviews carry
///           `status = 0` and are keyed on the wallet address, so the UI can
///           label them plainly as unverified: a fresh wallet is one reviewer,
///           not one human.
///         - For mainnet the owner raises `minStatus` (1 = Lite, 2 = Full).
///           Reviews are then keyed on the personhood `contextAlias`, so a human
///           cannot multiply reviews with fresh wallets, exactly like the
///           TrueReviews / OpenPetition contracts.
///
///         The switch is a single owner-settable number, so the same deployed
///         logic carries a testnet store and a personhood-gated one; nothing in
///         the review path forks on the network.
/// @custom:cdm @thebutton/dot-store
contract AppReviews {
    struct App {
        /// @dev The .dot label being reviewed, e.g. "truereviews". The anchor.
        string label;
        /// @dev Display name captured the first time the app was reviewed.
        string name;
        /// @dev Sum of ratings and their count — the displayed average.
        uint32 sum;
        uint32 count;
        uint64 firstAt;
    }

    struct Review {
        /// @dev contextAlias when status >= 1, else the reviewer's address.
        bytes32 author;
        uint8 rating; // 1..5
        uint8 status; // 0 = unverified (address), 1 = Lite, 2 = Full
        uint64 at;
        /// @dev The review text itself, kept on-chain and short. No Bulletin
        ///      dependency, so a review works the moment the store loads.
        string body;
    }

    /// @notice Fixed address of the personhood precompile
    ///         (0x000000000000000000000000000000000a010000).
    address public constant PERSONHOOD = address(uint160(0x0a010000));

    /// @notice Alias derivation context for this app.
    bytes32 public constant CONTEXT = keccak256("dot-store.dot");

    uint256 public constant MIN_LABEL_BYTES = 3;
    uint256 public constant MAX_LABEL_BYTES = 63;
    uint256 public constant MAX_NAME_BYTES = 120;
    uint256 public constant MAX_BODY_BYTES = 280;

    /// @notice Who may change the personhood requirement.
    address public owner;

    /// @notice Minimum personhood tier to post a review. 0 = open (devnet), 1 =
    ///         Lite, 2 = Full. Owner-settable, so mainnet can gate without a
    ///         redeploy.
    uint8 public minStatus;

    /// @dev appKey => app record.
    mapping(bytes32 => App) private _apps;
    /// @dev appKey => reviews.
    mapping(bytes32 => Review[]) private _reviews;
    /// @dev appKey => author => 1-based review index (0 = has not reviewed).
    mapping(bytes32 => mapping(bytes32 => uint256)) private _reviewedAt;
    /// @dev Every app ever reviewed, for the directory.
    bytes32[] private _appKeys;

    event AppAdded(bytes32 indexed key, string label, string name);
    event Reviewed(bytes32 indexed key, bytes32 indexed who, uint8 rating, uint8 status);
    event MinStatusChanged(uint8 from, uint8 to);

    error NotHuman(uint8 status, uint8 required);
    error AlreadyReviewed(bytes32 key);
    error BadRating(uint8 rating);
    error BadLabel(uint256 bytesLength);
    error BadName(uint256 bytesLength);
    error BadBody(uint256 bytesLength);
    error UnknownApp(bytes32 key);
    error NotOwner();

    constructor() {
        owner = msg.sender;
        minStatus = 0; // open on this devnet — see the contract note.
    }

    /// @notice Deterministic on-chain key for a .dot label.
    function keyFor(string calldata label) public pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    /// @notice Raise (or lower) the personhood requirement. Owner only. This is
    ///         how a mainnet deployment flips from open to personhood-gated.
    function setMinStatus(uint8 newMin) external {
        if (msg.sender != owner) revert NotOwner();
        emit MinStatusChanged(minStatus, newMin);
        minStatus = newMin;
    }

    /// @dev Identify the caller under the current requirement. The author id is
    ///      the personhood alias when we have one, otherwise the address — so
    ///      the same path serves an open store and a gated one, and a review
    ///      always records the status it was made under.
    function _identify() private view returns (bytes32 author, uint8 status) {
        IPersonhood.PersonhoodInfo memory info =
            IPersonhood(PERSONHOOD).personhoodStatus(msg.sender, CONTEXT);
        status = info.status;
        if (status < minStatus) revert NotHuman(status, minStatus);
        author = status >= 1 ? info.contextAlias : bytes32(uint256(uint160(msg.sender)));
    }

    /// @notice Post a review of a .dot app. One review per reviewer, per app.
    /// @param label  The .dot label, e.g. "truereviews".
    /// @param name   Display name (used only when the app is first reviewed).
    /// @param rating 1..5.
    /// @param body   Short review text (<= 280 bytes).
    /// @return key The app key.
    function review(
        string calldata label,
        string calldata name,
        uint8 rating,
        string calldata body
    ) external returns (bytes32 key) {
        if (rating < 1 || rating > 5) revert BadRating(rating);
        uint256 labLen = bytes(label).length;
        if (labLen < MIN_LABEL_BYTES || labLen > MAX_LABEL_BYTES) revert BadLabel(labLen);
        if (bytes(name).length > MAX_NAME_BYTES) revert BadName(bytes(name).length);
        if (bytes(body).length > MAX_BODY_BYTES) revert BadBody(bytes(body).length);

        (bytes32 author, uint8 status) = _identify();
        key = keccak256(bytes(label));

        if (_reviewedAt[key][author] != 0) revert AlreadyReviewed(key);

        App storage a = _apps[key];
        if (a.firstAt == 0) {
            a.label = label;
            a.name = name;
            a.firstAt = uint64(block.timestamp);
            _appKeys.push(key);
            emit AppAdded(key, label, name);
        }

        a.sum += rating;
        a.count += 1;

        _reviews[key].push(
            Review({
                author: author,
                rating: rating,
                status: status,
                at: uint64(block.timestamp),
                body: body
            })
        );
        _reviewedAt[key][author] = _reviews[key].length;

        emit Reviewed(key, author, rating, status);
    }

    /// @notice Number of distinct apps reviewed.
    function appCount() external view returns (uint256) {
        return _appKeys.length;
    }

    /// @notice Read an app's aggregate record.
    function app(bytes32 key) external view returns (App memory) {
        if (_apps[key].firstAt == 0) revert UnknownApp(key);
        return _apps[key];
    }

    /// @notice How many reviews an app has.
    function reviewCount(bytes32 key) external view returns (uint256) {
        return _reviews[key].length;
    }

    /// @notice Page through an app's reviews, oldest-first.
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

    /// @notice Page through the reviewed-app directory, newest-first.
    function directory(uint256 offset, uint256 limit)
        external
        view
        returns (App[] memory slice)
    {
        uint256 len = _appKeys.length;
        if (offset >= len) return new App[](0);
        uint256 end = offset + limit;
        if (end > len) end = len;
        slice = new App[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            slice[i - offset] = _apps[_appKeys[len - 1 - i]];
        }
    }

    /// @notice Everything the frontend needs about one account at one app.
    /// @return status     The account's personhood tier (0 if none).
    /// @return required   The current minimum tier to post.
    /// @return yourAuthor The id the account would review under.
    /// @return yourRating The rating the account left (0 if none).
    function me(address account, bytes32 key)
        external
        view
        returns (uint8 status, uint8 required, bytes32 yourAuthor, uint8 yourRating)
    {
        IPersonhood.PersonhoodInfo memory info =
            IPersonhood(PERSONHOOD).personhoodStatus(account, CONTEXT);
        bytes32 author =
            info.status >= 1 ? info.contextAlias : bytes32(uint256(uint160(account)));
        uint256 idx = _reviewedAt[key][author];
        uint8 r = idx == 0 ? 0 : _reviews[key][idx - 1].rating;
        return (info.status, minStatus, author, r);
    }
}
