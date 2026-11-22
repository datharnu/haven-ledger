// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqTestBase} from "haven-pq-kit-test/PqTestBase.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {HavenLedger} from "../src/HavenLedger.sol";
import {FakeBridge} from "./mocks/FakeBridge.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract Fixture is PqTestBase {
    string internal constant RECEIPTS = "qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8";
    uint256 internal constant FUNDED = 1_000_000;

    address internal payer = makeAddr("payer");
    address internal payee = makeAddr("payee");
    address internal thief = makeAddr("thief");
    address internal relayer = makeAddr("relayer");

    FakeBridge internal bridge;
    MockERC20 internal token;
    HavenLedger internal ledger;

    function setUp() public virtual override {
        super.setUp();
        vm.etch(0x0000000000000000000000000000000000000901, address(new FakeBridge()).code);
        bridge = FakeBridge(0x0000000000000000000000000000000000000901);
        bridge.setAllowed(RECEIPTS);
        _register(payer);
        token = new MockERC20();
        ledger = new HavenLedger(payer, payee, address(token), RECEIPTS);
        token.mint(address(ledger), FUNDED);
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }

    function _signAs(address signer, bytes32 action, address to, uint256 amount, string memory memo, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes memory message = PqAuth.encodeMessage(
            block.chainid, address(ledger), payer, action, ledger.nonce(), deadline, ledger.argsHash(to, amount, memo)
        );
        return _sign(signer, message);
    }

    function _paySig(uint256 amount, string memory memo, uint256 deadline) internal view returns (bytes memory) {
        return _signAs(payer, ledger.PAY(), payee, amount, memo, deadline);
    }

    function _refundSig(uint256 amount, string memory memo, uint256 deadline) internal view returns (bytes memory) {
        return _signAs(payer, ledger.REFUND(), payer, amount, memo, deadline);
    }

    function _junk() internal pure returns (bytes memory) {
        return new bytes(PqAuth.SIG_LEN);
    }
}
