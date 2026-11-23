// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {Bech32} from "./Bech32.sol";
import {NativeReceipt} from "./NativeReceipt.sol";

/// @notice The native-QOR twin of `HavenLedger`. The EVM's denom on QoreChain is `uqor`, so QOR this
/// contract sends is the recipient's x/bank `uqor` balance: the payout itself lands on the Native bank
/// lane, in the same transaction as the receipt written into the approved Native contract.
/// QOR leaves only for the payee or the payer named at creation, only with the payer's fresh ML-DSA-87
/// signature, and only together with that receipt. If either lane refuses, neither changes.
/// @dev Separate from `HavenLedger` so the recorded fUSD deployment and its audit stay as they are.
/// Amounts are in wei (18 decimals) and must be whole `uqor` (multiples of 1e12 wei), so the bank
/// balance change is exact.
contract HavenLedgerQor {
    using PqAuth for PqAuth.Signer;

    /// The CrossVM bridge precompile. It reaches only Native contracts on the governance allowlist.
    address public constant BRIDGE = 0x0000000000000000000000000000000000000901;
    uint8 internal constant NATIVE = 1;
    uint256 internal constant MAX_TTL = 1 days;

    /// One `uqor` in wei. The bank lane keeps 6 decimals, the EVM 18.
    uint256 public constant UQOR = 1e12;
    /// Native QOR, in the slot where `HavenLedger` puts its ERC-20.
    address public constant token = address(0);

    /// Not the fUSD ledger's actions: a signature for one asset is never an authorization for the other.
    bytes32 public constant PAY = keccak256("haven-ledger.qor.pay");
    bytes32 public constant REFUND = keccak256("haven-ledger.qor.refund");
    bytes32 public constant COMMITMENT_DOMAIN = keccak256("haven-ledger.commitment.v1");

    struct Payout {
        address to;
        uint128 amount;
        uint64 receiptId;
        uint64 nativeHeight;
        uint64 evmBlock;
        bytes32 commitment;
    }

    address public immutable payer;
    address public immutable payee;
    /// The Native receipt book, `qor1...`.
    string public receipts;
    /// This contract as the Native lane names it, `qor1...`.
    string public ledgerAccount;

    PqAuth.Signer internal payerAuth;
    Payout[] internal payouts_;
    uint256 private entered;

    error ZeroAddress();
    error SameParty();
    error BadTarget();
    error ZeroAmount();
    error AmountTooLarge();
    error NotWholeUqor(uint256 amount);
    error BridgeInactive();
    error InsufficientBalance(uint256 balance, uint256 needed);
    error TransferFailed();
    error Reentrancy();
    error NoSuchPayout(uint256 id);

    event Moved(
        uint256 indexed id,
        address indexed to,
        bool refund,
        uint256 amount,
        uint64 receiptId,
        uint64 nativeHeight,
        bytes32 commitment
    );
    event Funded(address indexed from, uint256 amount);

    modifier lock() {
        if (entered != 0) revert Reentrancy();
        entered = 1;
        _;
        entered = 0;
    }

    constructor(address payer_, address payee_, string memory receipts_) {
        if (payer_ == address(0) || payee_ == address(0)) revert ZeroAddress();
        if (payer_ == payee_) revert SameParty();
        bytes memory t = bytes(receipts_);
        if (t.length < 5 || t[0] != "q" || t[1] != "o" || t[2] != "r" || t[3] != "1") revert BadTarget();
        payer = payer_;
        payee = payee_;
        receipts = receipts_;
        ledgerAccount = Bech32.qor(address(this));
        payerAuth.init(payer_);
    }

    /// @notice Anyone may fund the ledger with QOR. A bank send to `ledgerAccount` funds it too.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Pay the stored payee `amount` wei of QOR.
    function pay(uint256 amount, string calldata memo, uint256 deadline, bytes calldata signature)
        external
        lock
        returns (uint256 id)
    {
        return _move(PAY, payee, amount, memo, deadline, signature);
    }

    /// @notice Return `amount` wei of QOR to the stored payer.
    function refund(uint256 amount, string calldata memo, uint256 deadline, bytes calldata signature)
        external
        lock
        returns (uint256 id)
    {
        return _move(REFUND, payer, amount, memo, deadline, signature);
    }

    function nonce() external view returns (uint256) {
        return payerAuth.nonce;
    }

    function payoutCount() external view returns (uint256) {
        return payouts_.length;
    }

    function payout(uint256 id) external view returns (Payout memory) {
        if (id >= payouts_.length) revert NoSuchPayout(id);
        return payouts_[id];
    }

    /// @notice The hash the payer signs over, besides the kit's domain, chain, contract, nonce and deadline.
    function argsHash(address to, uint256 amount, string memory memo) public pure returns (bytes32) {
        return keccak256(abi.encode(to, token, amount, keccak256(bytes(memo))));
    }

    /// @notice The commitment written into the Native note. Anyone can recompute it from the EVM call.
    function commitmentOf(bytes32 action, address to, uint256 amount, uint256 n, bytes memory signature)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                COMMITMENT_DOMAIN, block.chainid, address(this), action, to, token, amount, n, keccak256(signature)
            )
        );
    }

    /// @notice "haven-ledger v1 n=<nonce> c=0x<commitment> a=<amount in uqor>uqor" and, if a memo was
    /// signed, " m=<memo>". The asset and amount are in the note so a Native reader sees them.
    function noteOf(uint256 n, bytes32 commitment, uint256 amount, string memory memo)
        public
        pure
        returns (string memory)
    {
        string memory base = string.concat(
            "haven-ledger v1 n=",
            NativeReceipt.decimal(n),
            " c=",
            NativeReceipt.hex32(commitment),
            " a=",
            NativeReceipt.decimal(amount / UQOR),
            "uqor"
        );
        if (bytes(memo).length == 0) return base;
        return string.concat(base, " m=", memo);
    }

    function _move(
        bytes32 action,
        address to,
        uint256 amount,
        string calldata memo,
        uint256 deadline,
        bytes calldata signature
    ) private returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint128).max) revert AmountTooLarge();
        if (amount % UQOR != 0) revert NotWholeUqor(amount);
        NativeReceipt.checkMemo(memo);

        id = payerAuth.nonce;
        payerAuth.authorize(action, argsHash(to, amount, memo), deadline, MAX_TTL, signature);

        bytes32 commitment = commitmentOf(action, to, amount, id, signature);
        string memory text = noteOf(id, commitment, amount, memo);
        (uint64 receiptId, uint64 nativeHeight) = _record(text);

        payouts_.push(
            Payout({
                to: to,
                amount: uint128(amount),
                receiptId: receiptId,
                nativeHeight: nativeHeight,
                evmBlock: uint64(block.number),
                commitment: commitment
            })
        );
        emit Moved(id, to, action == REFUND, amount, receiptId, nativeHeight, commitment);

        // After the Native write on purpose: a short balance or a recipient that refuses QOR must undo
        // the receipt too. Every effect is above this line, and `lock` stops a reentrant pay or refund.
        uint256 held = address(this).balance;
        if (held < amount) revert InsufficientBalance(held, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _record(string memory text) private returns (uint64 receiptId, uint64 nativeHeight) {
        (bool ok, bytes memory ret) = BRIDGE.call(
            abi.encodeWithSignature(
                "executeCrossVMCall(uint8,string,bytes)", NATIVE, receipts, NativeReceipt.recordPayload(text)
            )
        );
        if (!ok) {
            // The bridge's reason names the refusal (not allowlisted, or the Native contract's error).
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        // An inactive precompile answers success with no data. Never treat that as a receipt.
        if (ret.length == 0) revert BridgeInactive();
        bytes memory reply = ret;
        if (ret.length >= 64 && uint256(bytes32(ret)) == 32) reply = abi.decode(ret, (bytes));
        return NativeReceipt.check(reply, ledgerAccount, text);
    }
}
