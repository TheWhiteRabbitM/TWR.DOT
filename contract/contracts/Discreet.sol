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

/// @title Discreet
/// @notice Private bookings for real people. A provider publishes a service and
///         time slots; clients book as personhood aliases — provably unique
///         humans with no name, phone or email anywhere. Deposits in escrow fix
///         no-show economics without identity, and every alias carries a
///         portable, anonymous kept/missed record.
/// @dev    Four roles in one deployable suite: provider registry, slot book,
///         booking escrow state machine, and the KeptWord reputation ledger.
///         Everything a provider can configure lives in ServiceConfig, so the
///         same contract serves a therapist, a barber, a clinic, a tutor or a
///         group class without redeploying:
///
///           - depositWei      0 = trust mode; >0 = refundable commitment
///           - capacity        1 = one-to-one; >1 = group/class slots
///           - autoConfirm     true = booking is instantly confirmed;
///                             false = the provider approves each request
///           - cancelWindow    seconds before start until which the client can
///                             cancel with a full refund
///           - clientTier      minimum personhood tier to book (1 or 2)
///           - detailsCid      Bulletin CID of the public service card
///
///         Booking lifecycle: Requested -> Confirmed -> Completed
///                                     \-> Declined   \-> NoShow / Cancelled
/// @custom:cdm @thebutton/discreet
contract Discreet {
    // ------------------------------------------------------------- constants

    address public constant PERSONHOOD = address(uint160(0x0a010000));
    bytes32 public constant CONTEXT = keccak256("discreet.dot");

    /// @notice Minimum tier to LIST a service (providers are accountable).
    uint8 public constant PROVIDER_MIN_STATUS = 1;

    uint256 public constant MAX_NAME_BYTES = 80;
    uint256 public constant MAX_CID_BYTES = 96;
    uint256 public constant MAX_SLOTS_PER_CALL = 48;
    uint256 public constant MAX_ACTIVE_PER_CLIENT = 3;

    // ----------------------------------------------------------------- types

    struct ServiceConfig {
        /// @dev Wei of deposit per booking. 0 disables escrow entirely.
        uint128 depositWei;
        /// @dev Seats per slot: 1 = appointment, N = class/group.
        uint16 capacity;
        /// @dev Seconds before start during which cancelling forfeits deposit.
        uint32 cancelWindow;
        /// @dev Confirm bookings automatically or require provider approval.
        bool autoConfirm;
        /// @dev Minimum client personhood tier (1 = Lite, 2 = Full).
        uint8 clientTier;
    }

    struct Service {
        bytes32 provider; // provider's contextAlias
        address payout; // where forfeited deposits / fees go
        uint64 createdAt;
        bool paused;
        ServiceConfig config;
        string name;
        string category;
        /// @dev Bulletin CID of the public service card (description, place, …).
        string detailsCid;
    }

    struct Slot {
        uint64 startsAt;
        uint32 durationSec;
        uint16 booked; // seats taken
        bool closed; // provider withdrew the slot
    }

    enum BookingState {
        None,
        Requested,
        Confirmed,
        Declined,
        Cancelled,
        Completed,
        NoShow
    }

    struct Booking {
        bytes32 client; // client's contextAlias — the only identity anywhere
        uint64 serviceId;
        uint64 slotId;
        uint128 deposit;
        BookingState state;
        uint64 at;
        /// @dev Optional Bulletin CID of an encrypted note for the provider.
        string noteCid;
    }

    /// @notice Anonymous, portable reliability record of an alias.
    struct KeptWord {
        uint32 kept;
        uint32 missed;
        uint32 cancelled;
    }

    // ----------------------------------------------------------------- state

    Service[] private _services;
    /// @dev serviceId => slots.
    mapping(uint256 => Slot[]) private _slots;
    Booking[] private _bookings;
    /// @dev serviceId => slotId => alias => bookingId+1 (0 = none).
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) private _bookedAt;
    /// @dev alias => number of bookings in Requested/Confirmed.
    mapping(bytes32 => uint8) private _activeOf;
    /// @dev alias => reliability ledger.
    mapping(bytes32 => KeptWord) private _keptWord;
    /// @dev provider alias => service ids.
    mapping(bytes32 => uint64[]) private _servicesOf;

    // ---------------------------------------------------------------- events

    event ServiceListed(uint64 indexed id, bytes32 indexed provider, string name);
    event ServiceUpdated(uint64 indexed id);
    event SlotsAdded(uint64 indexed serviceId, uint256 firstSlotId, uint256 count);
    event Booked(uint64 indexed serviceId, uint64 indexed slotId, uint256 bookingId, bytes32 indexed client);
    event BookingStateChanged(uint256 indexed bookingId, BookingState state);

    // ---------------------------------------------------------------- errors

    error NotHuman(uint8 status, uint8 required);
    error NotProvider();
    error BadInput(string what);
    error UnknownService(uint256 id);
    error UnknownSlot(uint256 id);
    error UnknownBooking(uint256 id);
    error SlotFull();
    error SlotClosed();
    error AlreadyBooked();
    error TooManyActive(uint8 max);
    error WrongState(BookingState have);
    error WrongDeposit(uint256 want, uint256 got);
    error TooLate();
    error ServicePaused();

    // ------------------------------------------------------------- internals

    function _identify(uint8 minStatus) private view returns (IPersonhood.PersonhoodInfo memory info) {
        info = IPersonhood(PERSONHOOD).personhoodStatus(msg.sender, CONTEXT);
        if (info.status < minStatus) revert NotHuman(info.status, minStatus);
    }

    function _service(uint256 id) private view returns (Service storage s) {
        if (id >= _services.length) revert UnknownService(id);
        s = _services[id];
    }

    // ------------------------------------------------------------- providers

    /// @notice List a service. Fully configurable — see ServiceConfig.
    function listService(
        string calldata name,
        string calldata category,
        string calldata detailsCid,
        ServiceConfig calldata config,
        address payout
    ) external returns (uint64 id) {
        IPersonhood.PersonhoodInfo memory info = _identify(PROVIDER_MIN_STATUS);
        if (bytes(name).length == 0 || bytes(name).length > MAX_NAME_BYTES) revert BadInput("name");
        if (bytes(category).length > MAX_NAME_BYTES) revert BadInput("category");
        if (bytes(detailsCid).length > MAX_CID_BYTES) revert BadInput("detailsCid");
        if (config.capacity == 0) revert BadInput("capacity");
        if (config.clientTier < 1 || config.clientTier > 2) revert BadInput("clientTier");

        id = uint64(_services.length);
        _services.push(
            Service({
                provider: info.contextAlias,
                payout: payout == address(0) ? msg.sender : payout,
                createdAt: uint64(block.timestamp),
                paused: false,
                config: config,
                name: name,
                category: category,
                detailsCid: detailsCid
            })
        );
        _servicesOf[info.contextAlias].push(id);
        emit ServiceListed(id, info.contextAlias, name);
    }

    /// @notice Update config / details / paused. Provider only.
    function updateService(
        uint64 id,
        ServiceConfig calldata config,
        string calldata detailsCid,
        bool paused
    ) external {
        Service storage s = _service(id);
        IPersonhood.PersonhoodInfo memory info = _identify(PROVIDER_MIN_STATUS);
        if (s.provider != info.contextAlias) revert NotProvider();
        if (config.capacity == 0) revert BadInput("capacity");
        if (config.clientTier < 1 || config.clientTier > 2) revert BadInput("clientTier");
        if (bytes(detailsCid).length > MAX_CID_BYTES) revert BadInput("detailsCid");
        s.config = config;
        s.detailsCid = detailsCid;
        s.paused = paused;
        emit ServiceUpdated(id);
    }

    /// @notice Publish open slots. Provider only.
    function addSlots(uint64 serviceId, uint64[] calldata startsAt, uint32 durationSec)
        external
    {
        Service storage s = _service(serviceId);
        IPersonhood.PersonhoodInfo memory info = _identify(PROVIDER_MIN_STATUS);
        if (s.provider != info.contextAlias) revert NotProvider();
        if (startsAt.length == 0 || startsAt.length > MAX_SLOTS_PER_CALL) revert BadInput("slots");
        uint256 first = _slots[serviceId].length;
        for (uint256 i = 0; i < startsAt.length; ++i) {
            _slots[serviceId].push(Slot({ startsAt: startsAt[i], durationSec: durationSec, booked: 0, closed: false }));
        }
        emit SlotsAdded(serviceId, first, startsAt.length);
    }

    /// @notice Provider decision on a requested booking (manual-confirm mode).
    function decide(uint256 bookingId, bool accept) external {
        Booking storage b = _booking(bookingId);
        Service storage s = _service(b.serviceId);
        IPersonhood.PersonhoodInfo memory info = _identify(PROVIDER_MIN_STATUS);
        if (s.provider != info.contextAlias) revert NotProvider();
        if (b.state != BookingState.Requested) revert WrongState(b.state);
        if (accept) {
            b.state = BookingState.Confirmed;
        } else {
            b.state = BookingState.Declined;
            _release(b);
            _refund(b);
        }
        emit BookingStateChanged(bookingId, b.state);
    }

    /// @notice Close out an attended/missed booking after the slot time.
    ///         Kept → deposit refunded, kept++. NoShow → deposit to payout, missed++.
    function settle(uint256 bookingId, bool attended) external {
        Booking storage b = _booking(bookingId);
        Service storage s = _service(b.serviceId);
        IPersonhood.PersonhoodInfo memory info = _identify(PROVIDER_MIN_STATUS);
        if (s.provider != info.contextAlias) revert NotProvider();
        if (b.state != BookingState.Confirmed) revert WrongState(b.state);
        Slot storage slot = _slotOf(b);
        if (block.timestamp < slot.startsAt) revert TooLate();

        _release(b);
        if (attended) {
            b.state = BookingState.Completed;
            _keptWord[b.client].kept += 1;
            _refund(b);
        } else {
            b.state = BookingState.NoShow;
            _keptWord[b.client].missed += 1;
            uint256 amount = b.deposit;
            b.deposit = 0;
            if (amount > 0) {
                (bool ok, ) = s.payout.call{ value: amount }("");
                ok; // devnet: a failing payout must not lock settlement
            }
        }
        emit BookingStateChanged(bookingId, b.state);
    }

    // --------------------------------------------------------------- clients

    /// @notice Book a slot as an anonymous verified human.
    function book(uint64 serviceId, uint64 slotId, string calldata noteCid)
        external
        payable
        returns (uint256 bookingId)
    {
        Service storage s = _service(serviceId);
        if (s.paused) revert ServicePaused();
        IPersonhood.PersonhoodInfo memory info = _identify(s.config.clientTier);
        Slot storage slot = _slot(serviceId, slotId);
        if (slot.closed) revert SlotClosed();
        if (slot.booked >= s.config.capacity) revert SlotFull();
        if (block.timestamp >= slot.startsAt) revert TooLate();
        if (_bookedAt[serviceId][slotId][info.contextAlias] != 0) revert AlreadyBooked();
        if (_activeOf[info.contextAlias] >= MAX_ACTIVE_PER_CLIENT) revert TooManyActive(uint8(MAX_ACTIVE_PER_CLIENT));
        if (msg.value != s.config.depositWei) revert WrongDeposit(s.config.depositWei, msg.value);
        if (bytes(noteCid).length > MAX_CID_BYTES) revert BadInput("noteCid");

        slot.booked += 1;
        _activeOf[info.contextAlias] += 1;
        bookingId = _bookings.length;
        _bookings.push(
            Booking({
                client: info.contextAlias,
                serviceId: serviceId,
                slotId: slotId,
                deposit: uint128(msg.value),
                state: s.config.autoConfirm ? BookingState.Confirmed : BookingState.Requested,
                at: uint64(block.timestamp),
                noteCid: noteCid
            })
        );
        _bookedAt[serviceId][slotId][info.contextAlias] = bookingId + 1;
        emit Booked(serviceId, uint64(slotId), bookingId, info.contextAlias);
        emit BookingStateChanged(bookingId, _bookings[bookingId].state);
    }

    /// @notice Cancel your own booking. Inside the cancel window the deposit is
    ///         refunded; after it, it is forfeited to the provider.
    function cancel(uint256 bookingId) external {
        Booking storage b = _booking(bookingId);
        Service storage s = _service(b.serviceId);
        IPersonhood.PersonhoodInfo memory info = _identify(1);
        if (b.client != info.contextAlias) revert NotProvider();
        if (b.state != BookingState.Requested && b.state != BookingState.Confirmed) revert WrongState(b.state);
        Slot storage slot = _slotOf(b);

        b.state = BookingState.Cancelled;
        _keptWord[b.client].cancelled += 1;
        _release(b);

        bool inWindow = block.timestamp + s.config.cancelWindow <= slot.startsAt;
        if (inWindow) {
            _refund(b);
        } else {
            uint256 amount = b.deposit;
            b.deposit = 0;
            if (amount > 0) {
                (bool ok, ) = s.payout.call{ value: amount }("");
                ok;
            }
        }
        emit BookingStateChanged(bookingId, BookingState.Cancelled);
    }

    // ------------------------------------------------------------- accounting

    function _booking(uint256 id) private view returns (Booking storage b) {
        if (id >= _bookings.length) revert UnknownBooking(id);
        b = _bookings[id];
    }

    function _slot(uint256 serviceId, uint256 slotId) private view returns (Slot storage) {
        if (slotId >= _slots[serviceId].length) revert UnknownSlot(slotId);
        return _slots[serviceId][slotId];
    }

    function _slotOf(Booking storage b) private view returns (Slot storage) {
        return _slots[b.serviceId][b.slotId];
    }

    function _release(Booking storage b) private {
        Slot storage slot = _slotOf(b);
        if (slot.booked > 0) slot.booked -= 1;
        if (_activeOf[b.client] > 0) _activeOf[b.client] -= 1;
        _bookedAt[b.serviceId][b.slotId][b.client] = 0;
    }

    function _refund(Booking storage b) private {
        uint256 amount = b.deposit;
        b.deposit = 0;
        if (amount > 0) {
            (bool ok, ) = msg.sender.call{ value: amount }("");
            ok; // refund goes to the caller = the alias's current account
        }
    }

    // ----------------------------------------------------------------- reads

    function serviceCount() external view returns (uint256) {
        return _services.length;
    }

    function service(uint256 id) external view returns (Service memory) {
        return _service(id);
    }

    function services(uint256 offset, uint256 limit) external view returns (Service[] memory slice) {
        uint256 len = _services.length;
        if (offset >= len) return new Service[](0);
        uint256 end = offset + limit;
        if (end > len) end = len;
        slice = new Service[](end - offset);
        for (uint256 i = offset; i < end; ++i) slice[i - offset] = _services[i];
    }

    function slotCount(uint256 serviceId) external view returns (uint256) {
        return _slots[serviceId].length;
    }

    function slots(uint256 serviceId, uint256 offset, uint256 limit)
        external
        view
        returns (Slot[] memory slice)
    {
        Slot[] storage all = _slots[serviceId];
        uint256 len = all.length;
        if (offset >= len) return new Slot[](0);
        uint256 end = offset + limit;
        if (end > len) end = len;
        slice = new Slot[](end - offset);
        for (uint256 i = offset; i < end; ++i) slice[i - offset] = all[i];
    }

    function booking(uint256 id) external view returns (Booking memory) {
        return _booking(id);
    }

    function bookingCount() external view returns (uint256) {
        return _bookings.length;
    }

    /// @notice The anonymous reliability record of an alias.
    function keptWordOf(bytes32 alias_) external view returns (KeptWord memory) {
        return _keptWord[alias_];
    }

    /// @notice Everything the frontend needs about the calling account.
    function me(address account)
        external
        view
        returns (uint8 status, bytes32 yourAlias, uint8 activeBookings, KeptWord memory record)
    {
        IPersonhood.PersonhoodInfo memory info = IPersonhood(PERSONHOOD).personhoodStatus(account, CONTEXT);
        return (info.status, info.contextAlias, _activeOf[info.contextAlias], _keptWord[info.contextAlias]);
    }
}
