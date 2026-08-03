// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ScoreManager} from "./ScoreManager.sol";

/**
 * @title PolarisLoanEngine
 * @notice Undercollateralized BNPL. A borrower splits a purchase into equal
 *         installments; the merchant is paid up front from protocol liquidity;
 *         the keeper collects each installment when it falls due.
 *
 * @dev The collection model is a pull, not a push. At checkout the borrower
 *      approves this contract for the full repayment amount once, and each
 *      installment is drawn with transferFrom. That is what lets a keeper
 *      collect on schedule without the borrower being online -- and it is why
 *      `repay` is callable by anyone: the funds can only ever move from the
 *      borrower to this contract, so a third-party caller is harmless and
 *      keeps the keeper permissionless.
 *
 *      Two functions exist purely for the keeper and are the reason this
 *      protocol maps cleanly onto KeeperHub's check-and-execute:
 *        checkLiquidatable(loanId) -> bool     (the condition, a pure view)
 *        liquidate(loanId)                     (the action)
 *      Evaluating both inside a single KeeperHub call closes the window in
 *      which a borrower repaying at the last second could still be liquidated
 *      on a stale read.
 */
contract PolarisLoanEngine is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Annualised interest, in basis points.
    uint256 public constant INTEREST_RATE_BPS = 1000; // 10%
    /// Share of interest kept by the protocol.
    uint256 public constant PROTOCOL_FEE_BPS = 2000; // 20%
    /// How long an installment may be overdue before the loan is liquidatable.
    uint256 public constant GRACE_PERIOD = 3 days;

    enum LoanStatus {
        Active,
        Repaid,
        Liquidated
    }

    struct Loan {
        address borrower;
        address merchant;
        uint128 principal;
        uint128 totalOwed;
        uint128 totalRepaid;
        uint32 installmentCount;
        uint32 installmentsPaid;
        uint64 startedAt;
        uint64 intervalSeconds;
        LoanStatus status;
    }

    IERC20 public immutable stablecoin;
    ScoreManager public immutable scoreManager;
    address public treasury;

    mapping(uint256 => Loan) public loans;
    mapping(address => uint256) public activeDebtOf;
    mapping(address => bool) public isOriginator;

    uint256 public loanCount;
    uint256 public protocolFeesAccrued;

    event LoanCreated(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed merchant,
        uint256 principal,
        uint256 totalOwed,
        uint32 installments
    );
    event InstallmentPaid(
        uint256 indexed loanId,
        address indexed borrower,
        uint32 installmentIndex,
        uint256 amount,
        bool onTime
    );
    event LoanFullyRepaid(uint256 indexed loanId, address indexed borrower);
    event LoanLiquidated(uint256 indexed loanId, address indexed borrower, uint256 outstanding);
    event OriginatorSet(address indexed originator, bool allowed);
    event TreasuryChanged(address indexed treasury);

    error NotOriginator();
    error InvalidLoan();
    error LoanNotActive();
    error ZeroAmount();
    error InvalidInstallments();
    error NotLiquidatable();
    error ExceedsCreditLimit();

    modifier onlyOriginator() {
        if (!isOriginator[msg.sender]) revert NotOriginator();
        _;
    }

    constructor(
        address initialOwner,
        IERC20 _stablecoin,
        ScoreManager _scoreManager,
        address _treasury
    ) Ownable(initialOwner) {
        stablecoin = _stablecoin;
        scoreManager = _scoreManager;
        treasury = _treasury;
    }

    // -----------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------

    function setOriginator(address originator, bool allowed) external onlyOwner {
        isOriginator[originator] = allowed;
        emit OriginatorSet(originator, allowed);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasuryChanged(_treasury);
    }

    /// @notice Seed protocol liquidity used to pay merchants up front.
    function fund(uint256 amount) external {
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
    }

    // -----------------------------------------------------------------
    // Origination
    // -----------------------------------------------------------------

    /**
     * @notice Open a BNPL plan and pay the merchant immediately.
     * @dev The borrower must already have approved this contract for
     *      `totalOwed`; that single approval is what every later installment
     *      is drawn against.
     */
    function createLoan(
        address borrower,
        address merchant,
        uint256 principal,
        uint32 installmentCount,
        uint64 intervalSeconds
    ) external onlyOriginator nonReentrant returns (uint256 loanId) {
        if (principal == 0) revert ZeroAmount();
        if (installmentCount == 0 || installmentCount > 24) revert InvalidInstallments();

        uint256 term = uint256(installmentCount) * uint256(intervalSeconds);
        uint256 interest = (principal * INTEREST_RATE_BPS * term) / (10_000 * 365 days);
        uint256 totalOwed = principal + interest;

        if (activeDebtOf[borrower] + totalOwed > scoreManager.creditLimitOf(borrower)) {
            revert ExceedsCreditLimit();
        }

        loanId = ++loanCount;
        loans[loanId] = Loan({
            borrower: borrower,
            merchant: merchant,
            principal: uint128(principal),
            totalOwed: uint128(totalOwed),
            totalRepaid: 0,
            installmentCount: installmentCount,
            installmentsPaid: 0,
            startedAt: uint64(block.timestamp),
            intervalSeconds: intervalSeconds,
            status: LoanStatus.Active
        });
        activeDebtOf[borrower] += totalOwed;

        // Merchant is paid now, in full. That is the product.
        stablecoin.safeTransfer(merchant, principal);

        emit LoanCreated(loanId, borrower, merchant, principal, totalOwed, installmentCount);
    }

    // -----------------------------------------------------------------
    // Collection -- what the keeper calls
    // -----------------------------------------------------------------

    /// @notice Amount due for the next unpaid installment.
    function installmentAmount(uint256 loanId) public view returns (uint256) {
        Loan storage l = loans[loanId];
        if (l.borrower == address(0)) revert InvalidLoan();
        uint256 remaining = uint256(l.totalOwed) - uint256(l.totalRepaid);
        uint32 left = l.installmentCount - l.installmentsPaid;
        if (left == 0) return 0;
        // Last installment absorbs any rounding dust so the loan closes exactly.
        return left == 1 ? remaining : remaining / left;
    }

    /// @notice When installment `index` (0-based) becomes collectable.
    function installmentDueAt(uint256 loanId, uint32 index) public view returns (uint256) {
        Loan storage l = loans[loanId];
        return uint256(l.startedAt) + (uint256(index) + 1) * uint256(l.intervalSeconds);
    }

    /// @notice True when the next installment is due now.
    function isInstallmentDue(uint256 loanId) public view returns (bool) {
        Loan storage l = loans[loanId];
        if (l.status != LoanStatus.Active) return false;
        return block.timestamp >= installmentDueAt(loanId, l.installmentsPaid);
    }

    /**
     * @notice Draw `amount` from the borrower against the loan.
     * @dev Permissionless by design -- see the contract-level note. Funds can
     *      only move from the borrower to this contract, so the worst a hostile
     *      caller can do is pay somebody's debt early.
     */
    function repay(uint256 loanId, uint256 amount) external nonReentrant {
        Loan storage l = loans[loanId];
        if (l.borrower == address(0)) revert InvalidLoan();
        if (l.status != LoanStatus.Active) revert LoanNotActive();
        if (amount == 0) revert ZeroAmount();

        uint256 remaining = uint256(l.totalOwed) - uint256(l.totalRepaid);
        if (amount > remaining) amount = remaining;

        stablecoin.safeTransferFrom(l.borrower, address(this), amount);

        bool onTime = block.timestamp <=
            installmentDueAt(loanId, l.installmentsPaid) + GRACE_PERIOD;

        l.totalRepaid += uint128(amount);
        l.installmentsPaid += 1;
        activeDebtOf[l.borrower] -= amount;

        uint256 interestPortion = (amount * INTEREST_RATE_BPS) / 10_000;
        uint256 fee = (interestPortion * PROTOCOL_FEE_BPS) / 10_000;
        if (fee > 0) {
            protocolFeesAccrued += fee;
        }

        emit InstallmentPaid(loanId, l.borrower, l.installmentsPaid, amount, onTime);

        if (onTime) {
            scoreManager.recordOnTimePayment(l.borrower);
        } else {
            scoreManager.recordLatePayment(l.borrower);
        }

        if (l.totalRepaid >= l.totalOwed) {
            l.status = LoanStatus.Repaid;
            emit LoanFullyRepaid(loanId, l.borrower);
        }
    }

    // -----------------------------------------------------------------
    // Liquidation -- the check-and-execute pair
    // -----------------------------------------------------------------

    /**
     * @notice The condition half of the keeper's check-and-execute.
     * @dev A pure view returning a plain bool, so KeeperHub can evaluate it as
     *      a condition and branch on it without interpreting protocol types.
     */
    function checkLiquidatable(uint256 loanId) public view returns (bool) {
        Loan storage l = loans[loanId];
        if (l.borrower == address(0)) return false;
        if (l.status != LoanStatus.Active) return false;
        if (l.installmentsPaid >= l.installmentCount) return false;
        return block.timestamp > installmentDueAt(loanId, l.installmentsPaid) + GRACE_PERIOD;
    }

    /// @notice The action half. Reverts unless the condition genuinely holds.
    function liquidate(uint256 loanId) external nonReentrant {
        if (!checkLiquidatable(loanId)) revert NotLiquidatable();

        Loan storage l = loans[loanId];
        uint256 outstanding = uint256(l.totalOwed) - uint256(l.totalRepaid);

        l.status = LoanStatus.Liquidated;
        activeDebtOf[l.borrower] -= outstanding;

        scoreManager.recordLiquidation(l.borrower);
        emit LoanLiquidated(loanId, l.borrower, outstanding);
    }

    // -----------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    function outstandingOf(uint256 loanId) external view returns (uint256) {
        Loan storage l = loans[loanId];
        return uint256(l.totalOwed) - uint256(l.totalRepaid);
    }

    function sweepFees() external {
        uint256 amount = protocolFeesAccrued;
        protocolFeesAccrued = 0;
        if (amount > 0) {
            stablecoin.safeTransfer(treasury, amount);
        }
    }
}
