// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {PqTestKeys} from "haven-pq-kit-test/PqTestKeys.sol";
import {HavenLedger} from "../src/HavenLedger.sol";
import {NativeReceipt} from "../src/NativeReceipt.sol";
import {FakeBridge} from "./mocks/FakeBridge.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {Fixture} from "./Fixture.sol";

/// @notice Drives the ledger with honest, forged, replayed and oversized calls, and a bridge that sometimes lies.
contract Handler is Test {
    HavenLedger internal ledger;
    FakeBridge internal bridge;
    address internal payer;
    bytes internal lastSig;
    uint256 internal lastAmount;
    bytes32 internal lastAction;
    string internal lastMemo;
    uint256 internal lastDeadline;
    uint256 internal lastNonce;
    uint256 public moved;

    constructor(HavenLedger ledger_, FakeBridge bridge_) {
        ledger = ledger_;
        bridge = bridge_;
        payer = ledger_.payer();
    }

    function signed(bool refund, uint256 amount, uint8 memoLen, uint8 mode) external {
        amount = bound(amount, 1, 600_000);
        bridge.setMode(FakeBridge.Mode(bound(mode, 0, 9) > 5 ? 0 : bound(mode, 0, 5)));
        string memory memo = _memo(bound(memoLen, 0, 60));
        bytes32 action = refund ? ledger.REFUND() : ledger.PAY();
        address to = refund ? payer : ledger.payee();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = PqTestKeys.sign(
            payer,
            PqAuth.encodeMessage(
                block.chainid,
                address(ledger),
                payer,
                action,
                ledger.nonce(),
                deadline,
                ledger.argsHash(to, amount, memo)
            )
        );
        lastSig = sig;
        lastAmount = amount;
        lastAction = action;
        lastMemo = memo;
        lastDeadline = deadline;
        lastNonce = ledger.nonce();
        if (refund) {
            try ledger.refund(amount, memo, deadline, sig) {
                moved++;
            } catch {}
        } else {
            try ledger.pay(amount, memo, deadline, sig) {
                moved++;
            } catch {}
        }
        bridge.setMode(FakeBridge.Mode.Honest);
    }

    /// A signature whose transaction reverted is still unspent, so reusing it may succeed exactly once.
    function replay() external {
        if (lastSig.length == 0) return;
        uint256 before = ledger.nonce();
        bool ok;
        if (lastAction == ledger.PAY()) {
            try ledger.pay(lastAmount, lastMemo, lastDeadline, lastSig) {
                ok = true;
            } catch {}
        } else {
            try ledger.refund(lastAmount, lastMemo, lastDeadline, lastSig) {
                ok = true;
            } catch {}
        }
        if (ok) {
            assertEq(before, lastNonce, "a spent signature was accepted again");
            moved++;
        }
    }

    function forged(uint256 amount, bytes32 seed) external {
        bytes memory sig = new bytes(PqAuth.SIG_LEN);
        for (uint256 i = 0; i < 32; i++) {
            sig[i] = seed[i];
        }
        try ledger.pay(bound(amount, 1, 600_000), "", block.timestamp + 1 hours, sig) {} catch {}
    }

    function _memo(uint256 len) private pure returns (string memory) {
        bytes memory m = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            m[i] = bytes1(uint8(97 + (i % 26)));
        }
        return string(m);
    }
}

contract HavenLedgerInvariantTest is Fixture {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(ledger, bridge);
        targetContract(address(handler));
    }

    /// Funds leave only for the two names fixed at creation.
    function invariant_fundsGoOnlyToPayerOrPayee() public view {
        uint256 n = token.transferCount();
        for (uint256 i = 0; i < n; i++) {
            (address from, address to,) = token.transfers(i);
            if (from == address(ledger)) assertTrue(to == payer || to == payee);
        }
    }

    /// Every payout has exactly one Native receipt, and no receipt exists without a payout.
    function invariant_onePayoutPerNativeReceipt() public view {
        uint256 count = ledger.payoutCount();
        assertEq(uint256(bridge.count()), count);
        assertEq(ledger.nonce(), count);
        uint256 out;
        for (uint256 i = 0; i < count; i++) {
            HavenLedger.Payout memory p = ledger.payout(i);
            FakeBridge.Receipt memory r = bridge.receipt(p.receiptId);
            assertEq(p.receiptId, i + 1);
            assertEq(r.sender, ledger.ledgerAccount());
            assertTrue(_contains(bytes(r.note), bytes(NativeReceipt.hex32(p.commitment))));
            out += p.amount;
        }
        assertEq(token.balanceOf(address(ledger)), FUNDED - out);
    }

    /// Only signed calls through an honest bridge can succeed, and the run must include some.
    function afterInvariant() public view {
        assertEq(handler.moved(), ledger.payoutCount());
        assertGt(handler.moved(), 0);
    }

    function _contains(bytes memory hay, bytes memory needle) private pure returns (bool) {
        if (needle.length > hay.length) return false;
        for (uint256 i = 0; i + needle.length <= hay.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }
}
