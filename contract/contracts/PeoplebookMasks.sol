// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The `.dot` name registry: `owner(node)` gives the account that owns a
///         namehash. This is the ONE identity claim that can be checked on this
///         chain, so it is what a verified name on a mask rests on.
interface IDotRegistry {
    function owner(bytes32 node) external view returns (address);
}

/// @title PeoplebookMasks — one unforgeable mask per account
/// @notice A generated avatar NFT bound to the account that claims it.
///
///         WHY IT IS NOT CLAIMED BY HANDLE
///         The first version let anyone claim any handle string, because devnet
///         handles live on the People chain and this contract, on Asset Hub,
///         cannot read them — the two chains' accounts do not even correspond.
///         That meant anyone could take `watanabe.01` and, through a social
///         built on top, post as them. There is no on-chain proof of People
///         handle ownership available here, so the fix is to remove the thing
///         being squatted: a mask is derived from YOUR ADDRESS, one per account.
///         Nobody can take yours, because there is no name to take.
///
///         VERIFIED NAME (optional)
///         A `.dot` name IS provable here. Pass the label and the contract
///         recomputes its namehash and asks the registry who owns it; the name
///         is recorded only if that is you. So a name shown on a mask is always
///         one the holder really owns — and it also improves the rarity roll.
///
///         SOULBOUND
///         Masks cannot be transferred. An identity that can be sold is an
///         identity that can be stolen, which is the whole problem this contract
///         exists to close.
/// @custom:cdm @thebutton/peoplebookmasks
contract PeoplebookMasks {
    // --------------------------------------------------------------- errors
    error AlreadyClaimed();
    error NoMask();
    error NotOwner();
    error BadProfile();
    error Soulbound();

    // --------------------------------------------------------------- events
    event Claimed(uint256 indexed id, address indexed owner, uint8 tier, string verifiedName);
    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event ProfileSet(uint256 indexed id, string telegram, string x, string bio);

    string public constant name = "Peoplebook Masks";
    string public constant symbol = "MASK";

    IDotRegistry public constant REGISTRY =
        IDotRegistry(0x527b08a640b527a3dae0C4BE04D7344E430B6E50);
    /// @dev keccak256("dot"), the parent node every `<label>.dot` hangs from.
    bytes32 internal constant DOT_NODE =
        keccak256(abi.encodePacked(bytes32(0), keccak256("dot")));

    uint256 public totalSupply;
    /// @notice The mask belonging to an account, or 0 if it has not claimed one.
    mapping(address => uint256) public maskOf;
    mapping(uint256 => address) internal _ownerOf;
    /// @notice 0 Legendary, 1 Epic, 2 Rare, 3 Uncommon, 4 Common.
    mapping(uint256 => uint8) public tierOf;
    /// @notice The `.dot` label the holder proved they own, or "" — never a name
    ///         anyone merely asserted.
    mapping(uint256 => string) public verifiedName;

    struct Profile { string telegram; string x; string bio; }
    mapping(uint256 => Profile) internal _profile;

    // ---------------------------------------------------------------- claim
    /// @param dotLabel a `.dot` label you own, without the suffix (e.g. "alice"
    ///        for alice.dot), or "" to claim a mask with no verified name.
    function claim(string calldata dotLabel) external returns (uint256 id) {
        if (maskOf[msg.sender] != 0) revert AlreadyClaimed();

        bool verified;
        if (bytes(dotLabel).length != 0) {
            bytes32 node = keccak256(abi.encodePacked(DOT_NODE, keccak256(bytes(dotLabel))));
            try REGISTRY.owner(node) returns (address o) {
                verified = (o == msg.sender && o != address(0));
            } catch {
                verified = false;
            }
        }

        id = ++totalSupply;
        maskOf[msg.sender] = id;
        _ownerOf[id] = id > 0 ? msg.sender : address(0);
        uint8 tier = _roll(id, verified);
        tierOf[id] = tier;
        if (verified) verifiedName[id] = dotLabel;

        emit Transfer(address(0), msg.sender, id);
        emit Claimed(id, msg.sender, tier, verified ? dotLabel : "");
    }

    /// @dev Rarity roll — deliberately weak randomness: this is a devnet
    ///      collectible, not money. A proven `.dot` shifts the percentile toward
    ///      the rare end. Bands: <3 Legendary, <13 Epic, <33 Rare, <63 Uncommon.
    function _roll(uint256 id, bool verified) internal view returns (uint8) {
        uint256 pct = uint256(
            keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp, msg.sender, id))
        ) % 100;
        if (verified) pct = (pct * 65) / 100;
        if (pct < 3) return 0;
        if (pct < 13) return 1;
        if (pct < 33) return 2;
        if (pct < 63) return 3;
        return 4;
    }

    // --------------------------------------------------------------- profile
    /// @notice Attach or update the links on your own mask. Free, and only the
    ///         holder can write — so a profile is always vouched for by the
    ///         account it belongs to. Pass "" to clear a field.
    function setProfile(string calldata telegram, string calldata x, string calldata bio) external {
        uint256 id = maskOf[msg.sender];
        if (id == 0) revert NoMask();
        if (bytes(telegram).length > 32 || bytes(x).length > 32 || bytes(bio).length > 160) revert BadProfile();
        if (!_jsonSafe(bytes(telegram)) || !_jsonSafe(bytes(x)) || !_jsonSafe(bytes(bio))) revert BadProfile();
        _profile[id] = Profile(telegram, x, bio);
        emit ProfileSet(id, telegram, x, bio);
    }

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
        if (o == address(0)) revert NoMask();
    }

    function balanceOf(address a) public view returns (uint256) {
        return maskOf[a] == 0 ? 0 : 1;
    }

    /// @dev Soulbound: every transfer path reverts. Wallets still display the
    ///      token through ownerOf/tokenURI; it simply cannot change hands.
    function approve(address, uint256) external pure { revert Soulbound(); }
    function setApprovalForAll(address, bool) external pure { revert Soulbound(); }
    function transferFrom(address, address, uint256) external pure { revert Soulbound(); }
    function safeTransferFrom(address, address, uint256) external pure { revert Soulbound(); }
    function safeTransferFrom(address, address, uint256, bytes calldata) external pure { revert Soulbound(); }
    function getApproved(uint256) external pure returns (address) { return address(0); }
    function isApprovedForAll(address, address) external pure returns (bool) { return false; }

    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0x01ffc9a7 || iid == 0x80ac58cd || iid == 0x5b5e139f;
    }

    // -------------------------------------------------------------- tokenURI
    string[5] internal TIER_NAMES = ["Legendary", "Epic", "Rare", "Uncommon", "Common"];

    function tokenURI(uint256 id) external view returns (string memory) {
        address o = _ownerOf[id];
        if (o == address(0)) revert NoMask();
        string memory label = bytes(verifiedName[id]).length != 0
            ? string.concat(verifiedName[id], ".dot")
            : string.concat("mask #", _u(id));
        string memory image = string.concat(
            "data:image/svg+xml;base64,", Base64.encode(bytes(_svg(o)))
        );
        string memory json = string.concat(
            '{"name":"', label,
            '","description":"A peoplebook mask, bound to the account that claimed it. Not transferable.","image":"', image,
            '","attributes":[{"trait_type":"Rarity","value":"', TIER_NAMES[tierOf[id]], '"}',
            bytes(verifiedName[id]).length != 0
                ? string.concat(',{"trait_type":"Verified .dot","value":"', verifiedName[id], '.dot"}')
                : "",
            _socialAttrs(id), ']}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

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

    /// @dev The mask is generated from the OWNER'S ADDRESS, so it is theirs by
    ///      construction and no two accounts share one by accident.
    function _svg(address who) internal view returns (string memory) {
        uint256 s = uint256(keccak256(abi.encodePacked(who)));
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
