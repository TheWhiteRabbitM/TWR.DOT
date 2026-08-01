// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The .dot name registry, used ONLY to verify a claimer's own name.
///         `owner(node)` returns the account that owns a namehash. We call it
///         with a node the claimer supplies and only grant the reputation boost
///         when it resolves back to `msg.sender` — so the boost is earned and
///         checked on chain, never asserted.
interface IDotRegistry {
    function owner(bytes32 node) external view returns (address);
}

/// @title PeoplebookAvatars — a claimable, on-chain avatar NFT for peoplebook.dot
/// @notice Every handle in the devnet identity registry has a generated mask.
///         Here anyone can CLAIM the mask for a handle: it mints an ERC-721 to
///         the caller, paid for in the native token, and rolls a rarity on chain
///         at mint time — gacha-style, not assigned in advance. The image is a
///         deterministic SVG generated inside `tokenURI`, so the NFT is fully
///         self-contained and shows in any wallet with nothing hosted anywhere.
///
///         REPUTATION BOOST (opt-in, verified): a claimer may pass a `.dot`
///         namehash they own. If `registry.owner(node) == msg.sender` the odds
///         shift toward the rarer tiers. Ownership is proven by the registry
///         call, so no unverifiable "who deployed what" linkage is trusted.
///
///         PROFILE (opt-in): whoever holds a mask can attach social details to
///         it — a Telegram handle, an X handle, a one-line bio — and edit or
///         clear them for free at any time. The links are vouched for by mask
///         ownership: a profile is only ever written by the account that holds
///         the token, and it rides along in the NFT's on-chain metadata.
/// @custom:cdm @thebutton/peoplebook
contract PeoplebookAvatars {
    // --------------------------------------------------------------- errors
    error HandleTaken(string handle);
    error BadHandle();
    error Underpaid(uint256 sent, uint256 price);
    error NotOwner();
    error NoToken(uint256 id);
    error NotApproved();
    error BadProfile();

    // --------------------------------------------------------------- events
    event Claimed(uint256 indexed id, string handle, address indexed owner, uint8 tier, bool boosted);
    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed spender, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event PriceChanged(uint256 price);
    event ProfileSet(uint256 indexed id, string telegram, string x, string bio);

    // ------------------------------------------------------------- metadata
    string public constant name = "Peoplebook Avatars";
    string public constant symbol = "MASK";

    /// @notice The .dot registry on this chain (namehash -> owner).
    IDotRegistry public constant REGISTRY =
        IDotRegistry(0x527b08a640b527a3dae0C4BE04D7344E430B6E50);

    // ------------------------------------------------------------- ownership
    address public owner_;
    /// @notice Mint price in the native token's smallest unit. Owner-settable so
    ///         the right "1 PAS" value can be set without guessing decimals at
    ///         deploy time; the app reads `price()` and pays exactly that.
    uint256 public price;

    modifier onlyOwner() {
        if (msg.sender != owner_) revert NotOwner();
        _;
    }

    // ----------------------------------------------------------- token state
    uint256 public totalSupply;
    mapping(uint256 => address) internal _ownerOf;
    mapping(address => uint256) internal _balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    /// @notice The handle a token was minted for.
    mapping(uint256 => string) public handleOf;
    /// @notice The rolled tier: 0 Legendary, 1 Epic, 2 Rare, 3 Uncommon, 4 Common.
    mapping(uint256 => uint8) public tierOf;
    /// @notice keccak(handle) => taken. One mint per handle.
    mapping(bytes32 => bool) public claimed;
    /// @notice keccak(handle) => tokenId (0 if unclaimed).
    mapping(bytes32 => uint256) public tokenOfHandle;

    /// @notice Optional social details a mask owner attaches to their token.
    struct Profile { string telegram; string x; string bio; }
    mapping(uint256 => Profile) internal _profile;

    /// @dev No constructor args: the deploy tool calls this with none. Price is
    ///      set by the owner after deploy (the right "1 PAS" in planck), so a
    ///      wrong decimal guess never gets baked into the deployment.
    constructor() {
        owner_ = msg.sender;
    }

    // ---------------------------------------------------------------- claim
    /// @param handle  the devnet handle to mint a mask for (e.g. "watanabe.01")
    /// @param dotNode a .dot namehash the caller owns for the boost, or 0 for none
    function claim(string calldata handle, bytes32 dotNode) external payable returns (uint256 id) {
        uint256 n = bytes(handle).length;
        if (n == 0 || n > 64) revert BadHandle();
        bytes32 key = keccak256(bytes(handle));
        if (claimed[key]) revert HandleTaken(handle);
        if (msg.value < price) revert Underpaid(msg.value, price);

        bool boosted = _isContributor(dotNode);

        id = ++totalSupply;
        claimed[key] = true;
        tokenOfHandle[key] = id;
        handleOf[id] = handle;
        uint8 tier = _roll(handle, id, boosted);
        tierOf[id] = tier;

        _ownerOf[id] = msg.sender;
        unchecked { _balanceOf[msg.sender]++; }
        emit Transfer(address(0), msg.sender, id);
        emit Claimed(id, handle, msg.sender, tier, boosted);
    }

    /// @dev The boost is granted only when the registry confirms the caller owns
    ///      the supplied node. A wrong or empty node simply yields no boost.
    function _isContributor(bytes32 dotNode) internal view returns (bool) {
        if (dotNode == bytes32(0)) return false;
        try REGISTRY.owner(dotNode) returns (address o) {
            return o == msg.sender && o != address(0);
        } catch {
            return false;
        }
    }

    /// @dev Rarity roll. A pseudo-random percentile from block + caller + handle.
    ///      Weak randomness on purpose — this is a devnet collectible, not money.
    ///      Cumulative bands: <3 Legendary, <13 Epic, <33 Rare, <63 Uncommon,
    ///      else Common. A boost nudges the percentile toward 0 (rarer).
    function _roll(string calldata handle, uint256 id, bool boosted) internal view returns (uint8) {
        uint256 seed = uint256(
            keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp, msg.sender, handle, id))
        );
        uint256 pct = seed % 100;
        if (boosted) pct = (pct * 65) / 100; // shift ~35% toward the rare end
        if (pct < 3) return 0;
        if (pct < 13) return 1;
        if (pct < 33) return 2;
        if (pct < 63) return 3;
        return 4;
    }

    // --------------------------------------------------------------- profile
    /// @notice Attach or update the social details on a mask you own. Editing is
    ///         free (gas only). Pass "" for a field to clear it. Because only the
    ///         token's current owner can call this, a profile is always vouched
    ///         for by whoever holds the mask.
    /// @param id       the token to set the profile on (caller must own it)
    /// @param telegram a Telegram handle without the @, <= 32 bytes ("" clears)
    /// @param x        an X / Twitter handle without the @, <= 32 bytes ("" clears)
    /// @param bio      a short line about you, <= 160 bytes ("" clears)
    function setProfile(
        uint256 id,
        string calldata telegram,
        string calldata x,
        string calldata bio
    ) external {
        if (_ownerOf[id] != msg.sender) revert NotOwner();
        if (bytes(telegram).length > 32 || bytes(x).length > 32 || bytes(bio).length > 160) revert BadProfile();
        // Keep the values safe to inline into the tokenURI JSON: no quotes,
        // backslashes or control characters (a bad value would only corrupt the
        // caller's own metadata, but reject it cleanly anyway).
        if (!_jsonSafe(bytes(telegram)) || !_jsonSafe(bytes(x)) || !_jsonSafe(bytes(bio))) revert BadProfile();
        _profile[id] = Profile(telegram, x, bio);
        emit ProfileSet(id, telegram, x, bio);
    }

    /// @notice The social details attached to a mask (empty strings if unset).
    function profileOf(uint256 id) external view returns (string memory telegram, string memory x, string memory bio) {
        Profile storage p = _profile[id];
        return (p.telegram, p.x, p.bio);
    }

    function _jsonSafe(bytes calldata s) private pure returns (bool) {
        for (uint256 i; i < s.length; i++) {
            bytes1 c = s[i];
            if (c == 0x22 || c == 0x5c || c < 0x20) return false; // " \ or control
        }
        return true;
    }

    // --------------------------------------------------------------- ERC-721
    function ownerOf(uint256 id) public view returns (address o) {
        o = _ownerOf[id];
        if (o == address(0)) revert NoToken(id);
    }

    function balanceOf(address a) public view returns (uint256) {
        return _balanceOf[a];
    }

    function approve(address spender, uint256 id) external {
        address o = _ownerOf[id];
        if (msg.sender != o && !isApprovedForAll[o][msg.sender]) revert NotApproved();
        getApproved[id] = spender;
        emit Approval(o, spender, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 id) public {
        if (from != _ownerOf[id]) revert NotApproved();
        if (to == address(0)) revert NotApproved();
        if (msg.sender != from && !isApprovedForAll[from][msg.sender] && msg.sender != getApproved[id]) revert NotApproved();
        unchecked { _balanceOf[from]--; _balanceOf[to]++; }
        _ownerOf[id] = to;
        delete getApproved[id];
        emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        transferFrom(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes calldata) external {
        transferFrom(from, to, id);
    }

    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0x01ffc9a7 || iid == 0x80ac58cd || iid == 0x5b5e139f; // ERC165, ERC721, ERC721Metadata
    }

    // ------------------------------------------------------------- owner ops
    function setPrice(uint256 newPrice) external onlyOwner {
        price = newPrice;
        emit PriceChanged(newPrice);
    }

    function withdraw(address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }

    // -------------------------------------------------------------- tokenURI
    string[5] internal TIER_NAMES = ["Legendary", "Epic", "Rare", "Uncommon", "Common"];

    function tokenURI(uint256 id) external view returns (string memory) {
        if (_ownerOf[id] == address(0)) revert NoToken(id);
        string memory h = handleOf[id];
        string memory tier = TIER_NAMES[tierOf[id]];
        string memory svg = _svg(h);
        string memory image = string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));
        string memory json = string.concat(
            '{"name":"', h, '","description":"A peoplebook mask, claimed on chain for the devnet identity ',
            h, '. Rarity rolled at mint.","image":"', image,
            '","attributes":[{"trait_type":"Rarity","value":"', tier, '"}', _socialAttrs(id), ']}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @dev Appends Telegram/X trait objects when the owner has set them, so the
    ///      social links show up wherever the NFT's metadata is read.
    function _socialAttrs(uint256 id) internal view returns (string memory) {
        Profile storage p = _profile[id];
        string memory out = "";
        if (bytes(p.telegram).length != 0) out = string.concat(out, ',{"trait_type":"Telegram","value":"', p.telegram, '"}');
        if (bytes(p.x).length != 0) out = string.concat(out, ',{"trait_type":"X","value":"', p.x, '"}');
        return out;
    }

    // --------------------------------------------------------- on-chain image
    string[10] internal PAL = [
        "#4f8cff","#a855f7","#ec4899","#22d3ee","#2dd4bf","#f59e0b","#f472b6","#818cf8","#34d399","#fb7185"
    ];

    /// @dev The mask, generated the same way the app draws it: a gradient square,
    ///      a rounded helmet, a visor and a mouth, seeded by the handle.
    function _svg(string memory h) internal view returns (string memory) {
        uint256 s = uint256(keccak256(bytes(h)));
        string memory c1 = PAL[s % 10];
        string memory c2 = PAL[(s / 10) % 10];
        uint256 round = 6 + (s % 6);
        uint256 visorY = 17 + ((s / 7) % 4);
        uint256 eye = (s / 13) % 3;
        string memory W = "rgba(255,255,255,.95)";

        string memory visor;
        if (eye == 0) {
            visor = string.concat('<rect x="13" y="', _u(visorY), '" width="14" height="2.4" rx="1.2" fill="', W, '"/>');
        } else if (eye == 1) {
            visor = string.concat(
                '<circle cx="15.5" cy="', _u(visorY + 1), '" r="1.7" fill="', W,
                '"/><circle cx="24.5" cy="', _u(visorY + 1), '" r="1.7" fill="', W, '"/>'
            );
        } else {
            visor = string.concat(
                '<rect x="13" y="', _u(visorY), '" width="6" height="2.4" rx="1.2" fill="', W,
                '"/><rect x="21" y="', _u(visorY), '" width="6" height="2.4" rx="1.2" fill="', W, '"/>'
            );
        }

        return string.concat(
            '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">',
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0" stop-color="', c1, '"/><stop offset="1" stop-color="', c2, '"/></linearGradient></defs>',
            '<rect width="40" height="40" fill="url(#g)"/>',
            '<circle cx="12" cy="10" r="16" fill="#fff" opacity="0.12"/>',
            '<rect x="10" y="8" width="20" height="24" rx="', _u(round), '" fill="none" stroke="', W, '" stroke-width="1.6"/>',
            visor,
            '<rect x="16" y="26" width="8" height="1.5" rx="0.75" fill="', W, '" opacity="0.6"/>',
            '</svg>'
        );
    }

    function _u(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v;
        uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory b = new bytes(len);
        while (v != 0) { len--; b[len] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(b);
    }
}

/// @dev Minimal base64 (MIT, Brecht Devos). Encodes bytes for the data URIs.
library Base64 {
    string internal constant TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function encode(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        string memory table = TABLE;
        uint256 encodedLen = 4 * ((data.length + 2) / 3);
        string memory result = new string(encodedLen + 32);

        assembly {
            mstore(result, encodedLen)
            let tablePtr := add(table, 1)
            let dataPtr := data
            let endPtr := add(dataPtr, mload(data))
            let resultPtr := add(result, 32)

            for {} lt(dataPtr, endPtr) {} {
                dataPtr := add(dataPtr, 3)
                let input := mload(dataPtr)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(18, input), 0x3F)))) resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(12, input), 0x3F)))) resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(6, input), 0x3F)))) resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(input, 0x3F)))) resultPtr := add(resultPtr, 1)
            }
            switch mod(mload(data), 3)
            case 1 { mstore8(sub(resultPtr, 1), 0x3d) mstore8(sub(resultPtr, 2), 0x3d) }
            case 2 { mstore8(sub(resultPtr, 1), 0x3d) }
        }
        return result;
    }
}
