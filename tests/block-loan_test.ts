
import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.14.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

// Test constants
const CONTRACT_NAME = "block-loan";
const ERR_UNAUTHORIZED = 100;
const ERR_INVALID_LOAN = 101;
const ERR_LOAN_NOT_OPEN = 102;
const ERR_COLLATERAL_LOW = 103;
const ERR_ALREADY_FUNDED = 104;
const ERR_ALREADY_REPAID = 105;
const ERR_LOAN_NOT_FUNDED = 106;
const ERR_LOAN_NOT_DUE = 107;
const ERR_INSUFFICIENT_REPAYMENT = 108;

// Status constants
const STATUS_OPEN = 0;
const STATUS_FUNDED = 1;
const STATUS_REPAID = 2;
const STATUS_LIQUIDATED = 3;

Clarinet.test({
    name: "Test loan creation - successful loan request",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000), // loan amount
                    types.uint(1200), // collateral required
                    types.principal(deployer.address), // collateral token
                    types.uint(100)   // deadline (block height)
                ],
                borrower.address
            ),
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(0); // First loan ID
        
        // Verify loan counter incremented
        let loanCounter = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan-counter",
            [],
            deployer.address
        );
        loanCounter.result.expectUint(1);
    },
});

Clarinet.test({
    name: "Test loan creation - multiple loans increment counter",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower1 = accounts.get("wallet_1")!;
        const borrower2 = accounts.get("wallet_2")!;
        const lender = accounts.get("wallet_3")!;
        
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(500),
                    types.uint(600),
                    types.principal(deployer.address),
                    types.uint(50)
                ],
                borrower1.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(2000),
                    types.uint(2500),
                    types.principal(deployer.address),
                    types.uint(75)
                ],
                borrower2.address
            ),
        ]);
        
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectUint(0); // First loan
        block.receipts[1].result.expectOk().expectUint(1); // Second loan
        
        // Verify final loan counter
        let loanCounter = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan-counter",
            [],
            deployer.address
        );
        loanCounter.result.expectUint(2);
    },
});

Clarinet.test({
    name: "Test get-loan function - retrieve loan details",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Create a loan first
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1500),
                    types.uint(1800),
                    types.principal(deployer.address),
                    types.uint(120)
                ],
                borrower.address
            ),
        ]);
        
        assertEquals(block.receipts.length, 1);
        
        // Retrieve loan details
        let loanDetails = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan",
            [types.uint(0)],
            deployer.address
        );
        
        let loan = loanDetails.result.expectSome().expectTuple() as any;
        assertEquals(loan["borrower"], borrower.address);
        assertEquals(loan["lender"], lender.address);
        assertEquals(loan["amount"], "u1500");
        assertEquals(loan["collateral"], "u1800");
        assertEquals(loan["status"], "u0");
    },
});

Clarinet.test({
    name: "Test get-loan function - non-existent loan returns none",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        
        // Try to get a loan that doesn't exist
        let loanDetails = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan",
            [types.uint(999)],
            deployer.address
        );
        
        loanDetails.result.expectNone();
    },
});

Clarinet.test({
    name: "Test contract stats - initial state",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        
        let stats = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-contract-stats",
            [],
            deployer.address
        );
        
        let statsData = stats.result.expectTuple() as any;
        assertEquals(statsData["total-loans"], "u0");
        // Block height should be greater than 0
        const blockHeight = parseInt(statsData["block-height"].replace('u', ''));
        assertEquals(blockHeight > 0, true);
    },
});
