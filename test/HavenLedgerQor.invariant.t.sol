// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {PqTestKeys} from "haven-pq-kit-test/PqTestKeys.sol";
import {HavenLedgerQor} from "../src/HavenLedgerQor.sol";
import {NativeReceipt} from "../src/NativeReceipt.sol";
import {FakeBridge} from "./mocks/FakeBridge.sol";
import {FixtureQor} from "./FixtureQor.sol";

/// @notice Drives the QOR ledger with honest, forged, replayed, fractional and oversized calls, extra
/// funding, and a bridge that sometimes lies.
contract QorHandler is Test {
    uint256 internal constant UQOR = 1e12;
    HavenLedgerQor internal ledger;
    FakeBridge internal bridge;
    address internal payer;
    bytes internal lastSig;
    uint256 internal lastAmount;
    bytes32 internal lastAction;
    string internal lastMemo;
    uint256 internal lastDeadline;
    uint256 internal lastNonce;
    uint256 public moved;
    uint256 public funded;

    constructor(HavenLedgerQor ledger_, FakeBridge bridge_) {
        ledger = ledger_;
        bridge = bridge_;
        payer = ledger_.payer();
    }

    /// Every run begins with one honest payment, so each run checks the invariants over real payouts and
    /// proves the honest path still works. `pay` is not wrapped in try: if it reverts, `moved` stays 0 and
    /// `afterInvariant` fails the run.
    modifier primed() {
        if (moved == 0) {
            uint256 amount = 1_000 * UQOR;
            uint256 deadline = block.timestamp + 1 hours;
            bytes memory sig = PqTestKeys.sign(
                payer,
                PqAuth.encodeMessage(
                    block.chainid,
                    address(ledger),
                    payer,
                    ledger.PAY(),
                    ledger.nonce(),
                    deadline,
                    ledger.argsHash(ledger.payee(), amount, "")
                )
            );
            ledger.pay(amount, "", deadline, sig);
            moved++;
        }
        _;
    }

    /// `fraction` (one call in four) makes the amount not a whole uqor; such a call must never succeed.
    function signed(bool refund, uint256 uqor, uint16 fraction, uint8 memoLen, uint8 mode) external primed {
        uint256 amount = bound(uqor, 1, 1_000_000) * UQOR + (fraction % 4 == 3 ? uint256(fraction) : 0);
        bridge.setMode(FakeBridge.Mode(bound(mode, 0, 9) > 5 ? 0 : bound(mode, 0, 5)));
        string memory memo = _memo(bound(memoLen, 0, 50));
        bytes32 action = refund ? ledger.REFUND() : ledger.PAY();
        address to = refund ? payer : ledger.payee();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = PqTestKeys.sign(
            payer,
            PqAuth.encodeMessage(
                block.chainid, address(ledger), payer, action, ledger.nonce(), deadline, ledger.argsHash(to, amount, memo)
            )
        );
        lastSig = sig;
        lastAmount = amount;
        lastAction = action;
        lastMemo = memo;
        lastDeadline = deadline;
        lastNonce = ledger.nonce();
        bool ok;
        if (refund) {
            try ledger.refund(amount, memo, deadline, sig) {
                ok = true;
            } catch {}
        } else {
            try ledger.pay(amount, memo, deadline, sig) {
                ok = true;
            } catch {}
        }
        if (ok) {
            assertEq(amount % UQOR, 0, "a fractional uqor amount moved");
            moved++;
        }
        bridge.setMode(FakeBridge.Mode.Honest);
    }

    /// A signature whose transaction reverted is still unspent, so reusing it may succeed exactly once.
    function replay() external primed {
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

    function forged(uint256 uqor, bytes32 seed) external primed {
        bytes memory sig = new bytes(PqAuth.SIG_LEN);
        for (uint256 i = 0; i < 32; i++) {
            sig[i] = seed[i];
        }
        try ledger.pay(bound(uqor, 1, 1_000_000) * UQOR, "", block.timestamp + 1 hours, sig) {} catch {}
    }

    function fund(uint256 amount) external primed {
        amount = bound(amount, 1, 2 ether);
        vm.deal(address(this), amount);
        (bool ok,) = address(ledger).call{value: amount}("");
        assertTrue(ok);
        funded += amount;
    }

    function _memo(uint256 len) private pure returns (string memory) {
        bytes memory m = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            m[i] = bytes1(uint8(97 + (i % 26)));
        }
        return string(m);
    }
}

contract HavenLedgerQorInvariantTest is FixtureQor {
    QorHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new QorHandler(ledger, bridge);
        targetContract(address(handler));
    }

    /// QOR leaves only for the two names fixed at creation: nothing is created or lost, and nobody else gains.
    function invariant_qorGoesOnlyToPayerOrPayee() public view {
        assertEq(address(ledger).balance + payer.balance + payee.balance, FUNDED + handler.funded());
        assertEq(address(handler).balance, 0);
        assertEq(relayer.balance, 0);
        assertEq(thief.balance, 0);
    }

    /// Every payout has exactly one Native receipt naming its amount in uqor, and no receipt exists without a payout.
    function invariant_onePayoutPerNativeReceipt() public view {
        uint256 count = ledger.payoutCount();
        assertEq(uint256(bridge.count()), count);
        assertEq(ledger.nonce(), count);
        uint256 toPayer;
        uint256 toPayee;
        for (uint256 i = 0; i < count; i++) {
            HavenLedgerQor.Payout memory p = ledger.payout(i);
            FakeBridge.Receipt memory r = bridge.receipt(p.receiptId);
            assertEq(p.receiptId, i + 1);
            assertEq(p.amount % UQOR, 0);
            assertEq(r.sender, ledger.ledgerAccount());
            assertTrue(_startsWith(bytes(r.note), bytes(ledger.noteOf(i, p.commitment, p.amount, ""))));
            if (p.to == payer) toPayer += p.amount;
            else toPayee += p.amount;
        }
        assertEq(payer.balance, toPayer);
        assertEq(payee.balance, toPayee);
        assertEq(address(ledger).balance, FUNDED + handler.funded() - toPayer - toPayee);
    }

    /// Only signed whole-uqor calls through an honest bridge can succeed, and the honest payment that opens
    /// every run (see `primed`) must have gone through.
    function afterInvariant() public view {
        assertEq(handler.moved(), ledger.payoutCount());
        assertGt(handler.moved(), 0);
    }

    function _startsWith(bytes memory hay, bytes memory prefix) private pure returns (bool) {
        if (prefix.length > hay.length) return false;
        for (uint256 i = 0; i < prefix.length; i++) {
            if (hay[i] != prefix[i]) return false;
        }
        return true;
    }
}
