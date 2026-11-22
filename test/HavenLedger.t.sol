// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {HavenLedger} from "../src/HavenLedger.sol";
import {Bech32} from "../src/Bech32.sol";
import {NativeReceipt} from "../src/NativeReceipt.sol";
import {FakeBridge} from "./mocks/FakeBridge.sol";
import {Fixture} from "./Fixture.sol";

contract HavenLedgerTest is Fixture {
    // --------------------------------------------------------------- naming the ledger on the Native lane

    function test_bech32_matchesTheChainForKnownAccounts() public pure {
        assertEq(Bech32.qor(0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396), "qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl");
        assertEq(Bech32.qor(0xf09cc23e992A4591A456836D7223655399D0BB90), "qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv");
    }

    function test_constructor_storesTheTwoNamesAndItsOwnNativeName() public view {
        assertEq(ledger.payer(), payer);
        assertEq(ledger.payee(), payee);
        assertEq(ledger.token(), address(token));
        assertEq(ledger.receipts(), RECEIPTS);
        assertEq(ledger.ledgerAccount(), Bech32.qor(address(ledger)));
    }

    function test_constructor_refusesZeroSameAndBadTarget() public {
        vm.expectRevert(HavenLedger.ZeroAddress.selector);
        new HavenLedger(address(0), payee, address(token), RECEIPTS);
        vm.expectRevert(HavenLedger.SameParty.selector);
        new HavenLedger(payer, payer, address(token), RECEIPTS);
        vm.expectRevert(HavenLedger.BadTarget.selector);
        new HavenLedger(payer, payee, address(token), "0x0901");
    }

    function test_constructor_refusesAPayerWithNoRegisteredKey() public {
        vm.expectRevert(abi.encodeWithSelector(PqAuth.KeyNotRegistered.selector, thief));
        new HavenLedger(thief, payee, address(token), RECEIPTS);
    }

    // --------------------------------------------------------------- scene 1: a payout and its receipt

    function test_pay_movesFundsAndWritesTheReceiptThatNamesIt() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(250_000, "invoice 7", deadline);
        bytes32 expected = ledger.commitmentOf(ledger.PAY(), payee, 250_000, 0, sig);

        vm.prank(relayer);
        uint256 id = ledger.pay(250_000, "invoice 7", deadline, sig);

        assertEq(id, 0);
        assertEq(token.balanceOf(payee), 250_000);
        assertEq(token.balanceOf(address(ledger)), FUNDED - 250_000);
        assertEq(ledger.nonce(), 1);

        HavenLedger.Payout memory p = ledger.payout(0);
        assertEq(p.to, payee);
        assertEq(p.amount, 250_000);
        assertEq(p.receiptId, 1);
        assertEq(p.nativeHeight, block.number);
        assertEq(p.evmBlock, block.number);
        assertEq(p.commitment, expected);

        FakeBridge.Receipt memory r = bridge.receipt(1);
        assertEq(r.sender, ledger.ledgerAccount());
        assertEq(r.note, string.concat("haven-ledger v1 n=0 c=", NativeReceipt.hex32(expected), " m=invoice 7"));
        assertEq(bridge.count(), 1);
    }

    function test_pay_withoutAMemoLeavesItOutOfTheNote() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(1, "", deadline);
        ledger.pay(1, "", deadline, sig);
        bytes32 c = ledger.payout(0).commitment;
        assertEq(bridge.receipt(1).note, string.concat("haven-ledger v1 n=0 c=", NativeReceipt.hex32(c)));
    }

    function test_refund_paysOnlyTheStoredPayer() public {
        uint256 deadline = _deadline();
        ledger.refund(400_000, "", deadline, _refundSig(400_000, "", deadline));
        assertEq(token.balanceOf(payer), 400_000);
        assertEq(token.balanceOf(payee), 0);
        assertEq(ledger.payout(0).to, payer);
        assertEq(bridge.count(), 1);
    }

    function test_pay_emitsBothIds() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(10, "", deadline);
        bytes32 c = ledger.commitmentOf(ledger.PAY(), payee, 10, 0, sig);
        vm.expectEmit(address(ledger));
        emit HavenLedger.Moved(0, payee, false, 10, 1, uint64(block.number), c);
        ledger.pay(10, "", deadline, sig);
    }

    // --------------------------------------------------------------- scene 2: the Native lane refuses

    function test_pay_nativeRefusalUndoesThePayment() public {
        string memory memo = "a memo the Native book will not take, because the whole note is longer than 140";
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(100, memo, deadline);
        vm.expectRevert(
            bytes(
                "cross-VM call failed: the note must be 1 to 140 characters: execute wasm contract failed: CosmWasm contract execution failed"
            )
        );
        ledger.pay(100, memo, deadline, sig);
        assertEq(token.balanceOf(payee), 0);
        assertEq(ledger.nonce(), 0);
        assertEq(ledger.payoutCount(), 0);
        assertEq(bridge.count(), 0);
    }

    // --------------------------------------------------------------- scene 3: the EVM lane fails after the Native write

    function test_pay_failedTransferUndoesTheNativeReceipt() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(FUNDED + 1, "", deadline);
        vm.expectRevert(bytes("ERC20: transfer amount exceeds balance"));
        ledger.pay(FUNDED + 1, "", deadline, sig);
        assertEq(bridge.count(), 0);
        assertEq(ledger.payoutCount(), 0);
        assertEq(ledger.nonce(), 0);
    }

    // --------------------------------------------------------------- scene 4: a classical key alone

    function test_pay_refusesAJunkSignatureBeforeTheBridge() public {
        vm.prank(thief);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(100, "", _deadline(), _junk());
        assertEq(bridge.count(), 0);
        assertEq(token.balanceOf(payee), 0);
    }

    function test_pay_refusesTheWrongSigner() public {
        _register(payee);
        uint256 deadline = _deadline();
        bytes memory sig = _signAs(payee, ledger.PAY(), payee, 100, "", deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(100, "", deadline, sig);
    }

    function test_pay_signatureForAPayCannotRefund() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(100, "", deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.refund(100, "", deadline, sig);
    }

    function test_pay_signatureCoversTheAmountAndTheMemo() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(100, "a", deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(101, "a", deadline, sig);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(100, "b", deadline, sig);
    }

    // --------------------------------------------------------------- scene 5: a replay

    function test_pay_refusesAReplayedSignature() public {
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(100, "", deadline);
        ledger.pay(100, "", deadline, sig);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(100, "", deadline, sig);
        assertEq(bridge.count(), 1);
        assertEq(token.balanceOf(payee), 100);
    }

    function test_pay_aSignatureWhoseCallRevertedIsStillUnspent() public {
        bridge.setMode(FakeBridge.Mode.Inactive);
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(100, "", deadline);
        vm.expectRevert(HavenLedger.BridgeInactive.selector);
        ledger.pay(100, "", deadline, sig);
        bridge.setMode(FakeBridge.Mode.Honest);
        ledger.pay(100, "", deadline, sig);
        assertEq(token.balanceOf(payee), 100);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(100, "", deadline, sig);
    }

    // --------------------------------------------------------------- scene 6: a target governance did not approve

    function test_pay_bridgeRefusesAnUnlistedTarget() public {
        string memory other = "qor1qg5ega6dykkxc307y25pecuufrjkxkaggkkxh7nad0vhyhtuhw3sqaa3c5";
        HavenLedger stray = new HavenLedger(payer, payee, address(token), other);
        token.mint(address(stray), 100);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory message = PqAuth.encodeMessage(
            block.chainid, address(stray), payer, stray.PAY(), 0, deadline, stray.argsHash(payee, 100, "")
        );
        vm.expectRevert(
            bytes(string.concat("cross-VM bridge call refused: target cosmwasm:", other, " is not allowlisted"))
        );
        stray.pay(100, "", deadline, _sign(payer, message));
        assertEq(token.balanceOf(payee), 0);
    }

    // --------------------------------------------------------------- a bridge that is off or lies

    function test_pay_refusesAnInactiveBridge() public {
        bridge.setMode(FakeBridge.Mode.Inactive);
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(100, "", deadline);
        vm.expectRevert(HavenLedger.BridgeInactive.selector);
        ledger.pay(100, "", deadline, sig);
    }

    function test_pay_refusesAReplyNamingAnotherSender() public {
        bridge.setMode(FakeBridge.Mode.WrongSender);
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(100, "", deadline);
        vm.expectRevert(NativeReceipt.ReplyMismatch.selector);
        ledger.pay(100, "", deadline, sig);
        assertEq(token.balanceOf(payee), 0);
    }

    function test_pay_refusesAReplyWithADifferentNote() public {
        bridge.setMode(FakeBridge.Mode.WrongNote);
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(100, "", deadline);
        vm.expectRevert(NativeReceipt.ReplyMismatch.selector);
        ledger.pay(100, "", deadline, sig);
    }

    function test_pay_refusesAReplyWithAnUnknownField() public {
        bridge.setMode(FakeBridge.Mode.ExtraField);
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(100, "", deadline);
        vm.expectRevert(NativeReceipt.ReplyMismatch.selector);
        ledger.pay(100, "", deadline, sig);
    }

    function test_pay_acceptsTheRawReplyOfOlderNodes() public {
        bridge.setMode(FakeBridge.Mode.RawReply);
        uint256 deadline = _deadline();
        ledger.pay(100, "", deadline, _paySig(100, "", deadline));
        assertEq(ledger.payout(0).receiptId, 1);
    }

    // --------------------------------------------------------------- input checks

    function test_pay_refusesMemosThatCouldLeaveTheJsonOrBeTrimmed() public {
        uint256 deadline = _deadline();
        string[5] memory bad = ['say "hi"', "back\\slash", " lead", "trail ", "tab\there"];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.expectRevert(NativeReceipt.BadMemo.selector);
            ledger.pay(100, bad[i], deadline, _junk());
        }
        bytes memory long = new bytes(NativeReceipt.MAX_MEMO + 1);
        for (uint256 i = 0; i < long.length; i++) {
            long[i] = "a";
        }
        vm.expectRevert(NativeReceipt.BadMemo.selector);
        ledger.pay(100, string(long), deadline, _junk());
    }

    function test_pay_refusesZeroAndOversizedAmounts() public {
        vm.expectRevert(HavenLedger.ZeroAmount.selector);
        ledger.pay(0, "", _deadline(), _junk());
        vm.expectRevert(HavenLedger.AmountTooLarge.selector);
        ledger.pay(uint256(type(uint128).max) + 1, "", _deadline(), _junk());
    }

    function test_pay_refusesAnExpiredOrFarDeadline() public {
        uint256 past = block.timestamp - 1;
        bytes memory sig = _paySig(100, "", past);
        vm.expectRevert(abi.encodeWithSelector(PqAuth.Expired.selector, past));
        ledger.pay(100, "", past, sig);
        uint256 far = block.timestamp + 2 days;
        sig = _paySig(100, "", far);
        vm.expectRevert(abi.encodeWithSelector(PqAuth.DeadlineTooFar.selector, far, 1 days));
        ledger.pay(100, "", far, sig);
    }

    function test_payout_refusesAnUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(HavenLedger.NoSuchPayout.selector, 0));
        ledger.payout(0);
    }
}
