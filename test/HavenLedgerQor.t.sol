// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {HavenLedger} from "../src/HavenLedger.sol";
import {HavenLedgerQor} from "../src/HavenLedgerQor.sol";
import {Bech32} from "../src/Bech32.sol";
import {NativeReceipt} from "../src/NativeReceipt.sol";
import {FakeBridge} from "./mocks/FakeBridge.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {RejectingPayee, ReentrantPayee} from "./mocks/QorPayees.sol";
import {FixtureQor} from "./FixtureQor.sol";

contract HavenLedgerQorTest is FixtureQor {
    // --------------------------------------------------------------- creation and funding

    function test_constructor_storesTheTwoNamesAndItsOwnNativeName() public view {
        assertEq(ledger.payer(), payer);
        assertEq(ledger.payee(), payee);
        assertEq(ledger.token(), address(0));
        assertEq(ledger.UQOR(), 1e12);
        assertEq(ledger.receipts(), RECEIPTS);
        assertEq(ledger.ledgerAccount(), Bech32.qor(address(ledger)));
    }

    function test_constructor_refusesZeroSameBadTargetAndUnregisteredPayer() public {
        vm.expectRevert(HavenLedgerQor.ZeroAddress.selector);
        new HavenLedgerQor(address(0), payee, RECEIPTS);
        vm.expectRevert(HavenLedgerQor.ZeroAddress.selector);
        new HavenLedgerQor(payer, address(0), RECEIPTS);
        vm.expectRevert(HavenLedgerQor.SameParty.selector);
        new HavenLedgerQor(payer, payer, RECEIPTS);
        vm.expectRevert(HavenLedgerQor.BadTarget.selector);
        new HavenLedgerQor(payer, payee, "0x0901");
        vm.expectRevert(abi.encodeWithSelector(PqAuth.KeyNotRegistered.selector, thief));
        new HavenLedgerQor(thief, payee, RECEIPTS);
    }

    function test_receive_acceptsQorFromAnyoneAndSaysSo() public {
        vm.deal(thief, 1 ether);
        vm.expectEmit(address(ledger));
        emit HavenLedgerQor.Funded(thief, 1 ether);
        vm.prank(thief);
        (bool ok,) = address(ledger).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(ledger).balance, FUNDED + 1 ether);
    }

    function test_noOtherFunctionTakesQor() public {
        vm.deal(thief, 1 ether);
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(UQOR, "", deadline);
        vm.prank(thief);
        (bool ok,) =
            address(ledger).call{value: 1}(abi.encodeCall(HavenLedgerQor.pay, (UQOR, "", deadline, sig)));
        assertFalse(ok);
        assertEq(ledger.nonce(), 0);
    }

    // --------------------------------------------------------------- scene 1: a payout and its receipt

    function test_pay_movesQorAndWritesTheReceiptThatNamesIt() public {
        uint256 amount = 1 ether;
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(amount, "invoice 7", deadline);
        bytes32 expected = ledger.commitmentOf(ledger.PAY(), payee, amount, 0, sig);

        vm.prank(relayer);
        uint256 id = ledger.pay(amount, "invoice 7", deadline, sig);

        assertEq(id, 0);
        assertEq(payee.balance, amount);
        assertEq(address(ledger).balance, FUNDED - amount);
        assertEq(relayer.balance, 0);
        assertEq(ledger.nonce(), 1);

        HavenLedgerQor.Payout memory p = ledger.payout(0);
        assertEq(p.to, payee);
        assertEq(p.amount, amount);
        assertEq(p.receiptId, 1);
        assertEq(p.nativeHeight, block.number);
        assertEq(p.evmBlock, block.number);
        assertEq(p.commitment, expected);

        FakeBridge.Receipt memory r = bridge.receipt(1);
        assertEq(r.sender, ledger.ledgerAccount());
        assertEq(
            r.note,
            string.concat("haven-ledger v1 n=0 c=", NativeReceipt.hex32(expected), " a=1000000uqor m=invoice 7")
        );
        assertEq(bridge.count(), 1);
    }

    function test_pay_withoutAMemoLeavesItOutOfTheNote() public {
        uint256 deadline = _deadline();
        ledger.pay(UQOR, "", deadline, _paySig(UQOR, "", deadline));
        bytes32 c = ledger.payout(0).commitment;
        assertEq(bridge.receipt(1).note, string.concat("haven-ledger v1 n=0 c=", NativeReceipt.hex32(c), " a=1uqor"));
        assertEq(payee.balance, UQOR);
    }

    function test_refund_paysOnlyTheStoredPayer() public {
        uint256 deadline = _deadline();
        ledger.refund(2 ether, "", deadline, _refundSig(2 ether, "", deadline));
        assertEq(payer.balance, 2 ether);
        assertEq(payee.balance, 0);
        assertEq(ledger.payout(0).to, payer);
        assertEq(bridge.count(), 1);
    }

    function test_pay_emitsBothIds() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(10 * UQOR, "", deadline);
        bytes32 c = ledger.commitmentOf(ledger.PAY(), payee, 10 * UQOR, 0, sig);
        vm.expectEmit(address(ledger));
        emit HavenLedgerQor.Moved(0, payee, false, 10 * UQOR, 1, uint64(block.number), c);
        ledger.pay(10 * UQOR, "", deadline, sig);
    }

    // --------------------------------------------------------------- scene 2: the Native lane refuses

    function test_pay_nativeRefusalUndoesThePayment() public {
        string memory memo = "a memo the Native book will not take, because the whole note is over 140";
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(UQOR, memo, deadline);
        vm.expectRevert(
            bytes(
                "cross-VM call failed: the note must be 1 to 140 characters: execute wasm contract failed: CosmWasm contract execution failed"
            )
        );
        ledger.pay(UQOR, memo, deadline, sig);
        assertEq(payee.balance, 0);
        assertEq(address(ledger).balance, FUNDED);
        assertEq(ledger.nonce(), 0);
        assertEq(ledger.payoutCount(), 0);
        assertEq(bridge.count(), 0);
    }

    // --------------------------------------------------------------- scene 3: the EVM lane fails after the Native write

    function test_pay_shortBalanceUndoesTheNativeReceipt() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(FUNDED + UQOR, "", deadline);
        vm.expectRevert(abi.encodeWithSelector(HavenLedgerQor.InsufficientBalance.selector, FUNDED, FUNDED + UQOR));
        ledger.pay(FUNDED + UQOR, "", deadline, sig);
        assertEq(bridge.count(), 0);
        assertEq(ledger.payoutCount(), 0);
        assertEq(ledger.nonce(), 0);
        assertEq(address(ledger).balance, FUNDED);
    }

    function test_pay_aPayeeThatRefusesQorUndoesTheNativeReceipt() public {
        RejectingPayee rejecting = new RejectingPayee();
        HavenLedgerQor other = new HavenLedgerQor(payer, address(rejecting), RECEIPTS);
        vm.deal(address(other), FUNDED);
        uint256 deadline = _deadline();
        bytes memory sig = _signFor(other, payer, other.PAY(), address(rejecting), UQOR, "", deadline);
        vm.expectRevert(HavenLedgerQor.TransferFailed.selector);
        other.pay(UQOR, "", deadline, sig);
        assertEq(bridge.count(), 0);
        assertEq(other.payoutCount(), 0);
        assertEq(other.nonce(), 0);
        assertEq(address(other).balance, FUNDED);
        assertEq(address(rejecting).balance, 0);
    }

    // --------------------------------------------------------------- reentrancy

    function test_pay_aReentrantPayeeCannotPayItselfTwice() public {
        ReentrantPayee attacker = new ReentrantPayee();
        HavenLedgerQor other = new HavenLedgerQor(payer, address(attacker), RECEIPTS);
        vm.deal(address(other), FUNDED);
        uint256 deadline = _deadline();
        bytes memory first = _signFor(other, payer, other.PAY(), address(attacker), UQOR, "", deadline);
        // A valid signature for the next nonce, which the payee tries to spend from inside the transfer.
        bytes memory second = _sign(
            payer,
            PqAuth.encodeMessage(
                block.chainid, address(other), payer, other.PAY(), 1, deadline, other.argsHash(address(attacker), UQOR, "")
            )
        );
        attacker.arm(other, false, UQOR, deadline, second);

        other.pay(UQOR, "", deadline, first);

        assertTrue(attacker.reentered());
        assertEq(attacker.reentryError(), abi.encodeWithSelector(HavenLedgerQor.Reentrancy.selector));
        assertEq(address(attacker).balance, UQOR);
        assertEq(other.payoutCount(), 1);
        assertEq(other.nonce(), 1);
        assertEq(bridge.count(), 1);

        // The second signature was never spent, so it still works once, from outside.
        other.pay(UQOR, "", deadline, second);
        assertEq(address(attacker).balance, 2 * UQOR);
        assertEq(other.payoutCount(), 2);
    }

    function test_pay_aReentrantPayeeThatRevertsUndoesEverything() public {
        ReentrantPayee attacker = new ReentrantPayee();
        HavenLedgerQor other = new HavenLedgerQor(payer, address(attacker), RECEIPTS);
        vm.deal(address(other), FUNDED);
        uint256 deadline = _deadline();
        bytes memory first = _signFor(other, payer, other.PAY(), address(attacker), UQOR, "", deadline);
        attacker.arm(other, true, UQOR, deadline, first);
        vm.expectRevert(HavenLedgerQor.TransferFailed.selector);
        other.pay(UQOR, "", deadline, first);
        assertEq(bridge.count(), 0);
        assertEq(other.payoutCount(), 0);
        assertEq(address(other).balance, FUNDED);
    }

    // --------------------------------------------------------------- whole uqor only

    function test_pay_refusesAmountsThatAreNotWholeUqor() public {
        uint256 deadline = _deadline();
        uint256[3] memory bad = [uint256(1), UQOR - 1, 3 * UQOR + 1];
        for (uint256 i = 0; i < bad.length; i++) {
            bytes memory sig = _paySig(bad[i], "", deadline);
            vm.expectRevert(abi.encodeWithSelector(HavenLedgerQor.NotWholeUqor.selector, bad[i]));
            ledger.pay(bad[i], "", deadline, sig);
        }
        bytes memory refundSig = _refundSig(UQOR + 7, "", deadline);
        vm.expectRevert(abi.encodeWithSelector(HavenLedgerQor.NotWholeUqor.selector, UQOR + 7));
        ledger.refund(UQOR + 7, "", deadline, refundSig);
        assertEq(bridge.count(), 0);
        assertEq(ledger.nonce(), 0);
    }

    // --------------------------------------------------------------- scene 4: a classical key alone

    function test_pay_refusesAJunkSignatureBeforeTheBridge() public {
        vm.prank(thief);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(UQOR, "", _deadline(), _junk());
        assertEq(bridge.count(), 0);
        assertEq(payee.balance, 0);
    }

    function test_pay_refusesTheWrongSigner() public {
        _register(payee);
        uint256 deadline = _deadline();
        bytes memory sig = _signAs(payee, ledger.PAY(), payee, UQOR, "", deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(UQOR, "", deadline, sig);
    }

    function test_pay_signatureForAPayCannotRefund() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(UQOR, "", deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.refund(UQOR, "", deadline, sig);
    }

    function test_pay_signatureCoversTheAmountAndTheMemo() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(UQOR, "a", deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(2 * UQOR, "a", deadline, sig);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(UQOR, "b", deadline, sig);
    }

    // --------------------------------------------------------------- scene 5: a replay

    function test_pay_refusesAReplayedSignature() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(UQOR, "", deadline);
        ledger.pay(UQOR, "", deadline, sig);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(UQOR, "", deadline, sig);
        assertEq(bridge.count(), 1);
        assertEq(payee.balance, UQOR);
    }

    // --------------------------------------------------------------- one asset's signature is not the other's

    function test_actionsDifferFromTheFusdLedger() public {
        MockERC20 fusd = new MockERC20();
        HavenLedger fusdLedger = new HavenLedger(payer, payee, address(fusd), RECEIPTS);
        assertTrue(ledger.PAY() != fusdLedger.PAY());
        assertTrue(ledger.REFUND() != fusdLedger.REFUND());
        assertTrue(ledger.PAY() != fusdLedger.REFUND());
        assertTrue(ledger.REFUND() != fusdLedger.PAY());
    }

    function test_aFusdSignatureCannotMoveQor() public {
        MockERC20 fusd = new MockERC20();
        HavenLedger fusdLedger = new HavenLedger(payer, payee, address(fusd), RECEIPTS);
        fusd.mint(address(fusdLedger), FUNDED);
        uint256 deadline = _deadline();
        // Same payer, nonce, amount, memo and deadline, signed for the fUSD ledger.
        bytes memory sig = _sign(
            payer,
            PqAuth.encodeMessage(
                block.chainid,
                address(fusdLedger),
                payer,
                fusdLedger.PAY(),
                0,
                deadline,
                fusdLedger.argsHash(payee, UQOR, "")
            )
        );
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(UQOR, "", deadline, sig);
        // It is still good where it was meant to be spent.
        fusdLedger.pay(UQOR, "", deadline, sig);
        assertEq(fusd.balanceOf(payee), UQOR);
        assertEq(payee.balance, 0);
    }

    function test_aQorSignatureCannotMoveFusd() public {
        MockERC20 fusd = new MockERC20();
        HavenLedger fusdLedger = new HavenLedger(payer, payee, address(fusd), RECEIPTS);
        fusd.mint(address(fusdLedger), FUNDED);
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(UQOR, "", deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        fusdLedger.pay(UQOR, "", deadline, sig);
        assertEq(fusd.balanceOf(payee), 0);
    }

    function test_theFusdActionIsRefusedEvenWhenSignedForThisLedger() public {
        uint256 deadline = _deadline();
        bytes memory sig = _signAs(payer, keccak256("haven-ledger.pay"), payee, UQOR, "", deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(UQOR, "", deadline, sig);
        sig = _signAs(payer, keccak256("haven-ledger.refund"), payer, UQOR, "", deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.refund(UQOR, "", deadline, sig);
    }

    // --------------------------------------------------------------- a bridge that is off, unlisted or lies

    function test_pay_bridgeRefusesAnUnlistedTarget() public {
        string memory unlisted = "qor1qg5ega6dykkxc307y25pecuufrjkxkaggkkxh7nad0vhyhtuhw3sqaa3c5";
        HavenLedgerQor stray = new HavenLedgerQor(payer, payee, unlisted);
        vm.deal(address(stray), FUNDED);
        uint256 deadline = _deadline();
        bytes memory sig = _signFor(stray, payer, stray.PAY(), payee, UQOR, "", deadline);
        vm.expectRevert(
            bytes(string.concat("cross-VM bridge call refused: target cosmwasm:", unlisted, " is not allowlisted"))
        );
        stray.pay(UQOR, "", deadline, sig);
        assertEq(payee.balance, 0);
    }

    function test_pay_refusesAnInactiveBridgeAndTheSignatureStaysUnspent() public {
        bridge.setMode(FakeBridge.Mode.Inactive);
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(UQOR, "", deadline);
        vm.expectRevert(HavenLedgerQor.BridgeInactive.selector);
        ledger.pay(UQOR, "", deadline, sig);
        assertEq(payee.balance, 0);
        bridge.setMode(FakeBridge.Mode.Honest);
        ledger.pay(UQOR, "", deadline, sig);
        assertEq(payee.balance, UQOR);
    }

    function test_pay_refusesALyingReply() public {
        FakeBridge.Mode[3] memory lies =
            [FakeBridge.Mode.WrongSender, FakeBridge.Mode.WrongNote, FakeBridge.Mode.ExtraField];
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(UQOR, "", deadline);
        for (uint256 i = 0; i < lies.length; i++) {
            bridge.setMode(lies[i]);
            vm.expectRevert(NativeReceipt.ReplyMismatch.selector);
            ledger.pay(UQOR, "", deadline, sig);
        }
        assertEq(payee.balance, 0);
        assertEq(address(ledger).balance, FUNDED);
    }

    function test_pay_acceptsTheRawReplyOfOlderNodes() public {
        bridge.setMode(FakeBridge.Mode.RawReply);
        uint256 deadline = _deadline();
        ledger.pay(UQOR, "", deadline, _paySig(UQOR, "", deadline));
        assertEq(ledger.payout(0).receiptId, 1);
    }

    // --------------------------------------------------------------- input checks

    function test_pay_refusesBadMemosZeroOversizedAndExpired() public {
        vm.expectRevert(NativeReceipt.BadMemo.selector);
        ledger.pay(UQOR, 'say "hi"', _deadline(), _junk());
        vm.expectRevert(HavenLedgerQor.ZeroAmount.selector);
        ledger.pay(0, "", _deadline(), _junk());
        vm.expectRevert(HavenLedgerQor.AmountTooLarge.selector);
        ledger.pay(uint256(type(uint128).max) + 1, "", _deadline(), _junk());
        uint256 past = block.timestamp - 1;
        bytes memory sig = _paySig(UQOR, "", past);
        vm.expectRevert(abi.encodeWithSelector(PqAuth.Expired.selector, past));
        ledger.pay(UQOR, "", past, sig);
    }

    function test_payout_refusesAnUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(HavenLedgerQor.NoSuchPayout.selector, 0));
        ledger.payout(0);
    }

    // --------------------------------------------------------------- the TypeScript vectors

    function test_vectorsMatchTheTypeScript() public {
        address at = 0x3333333333333333333333333333333333333333;
        address p = 0x1111111111111111111111111111111111111111;
        address q = 0x2222222222222222222222222222222222222222;
        vm.chainId(9800);
        _register(p);
        deployCodeTo("HavenLedgerQor.sol:HavenLedgerQor", abi.encode(p, q, RECEIPTS), at);
        HavenLedgerQor v = HavenLedgerQor(payable(at));
        bytes memory signature = new bytes(PqAuth.SIG_LEN);
        bytes32 args = v.argsHash(q, 1 ether, "invoice 1");
        bytes32 c = v.commitmentOf(v.PAY(), q, 1 ether, 0, signature);
        assertEq(v.PAY(), 0x16f937ef09f1c1944047c2812b86083a9be667bf35922dbfc47408f135508e96);
        assertEq(args, 0xbb88ae558f7a4fb8c4feb93576543904d95dc5857b6680b4260bc8b2f3399017);
        assertEq(c, 0x0ed7c205df59d8f54fc83b4a13ad204e6b0f92823eddcf7838afad6cdb3f95ca);
        assertEq(
            v.noteOf(0, c, 1 ether, "invoice 1"),
            "haven-ledger v1 n=0 c=0x0ed7c205df59d8f54fc83b4a13ad204e6b0f92823eddcf7838afad6cdb3f95ca a=1000000uqor m=invoice 1"
        );
        assertEq(
            PqAuth.encodeMessage(9800, at, p, v.PAY(), 0, 1_700_003_600, args),
            hex"e75e64e2fe37c327a6196b667e791aa53e61a6f7df40e7ac0542d985cea3627800000000000000000000000000000000000000000000000000000000000026480000000000000000000000003333333333333333333333333333333333333333000000000000000000000000111111111111111111111111111111111111111116f937ef09f1c1944047c2812b86083a9be667bf35922dbfc47408f135508e960000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006553ff10bb88ae558f7a4fb8c4feb93576543904d95dc5857b6680b4260bc8b2f3399017"
        );
    }
}
