-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OutletType" AS ENUM ('OUTLET', 'CENTRAL_KITCHEN');

-- CreateEnum
CREATE TYPE "OutletStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('INGREDIENT', 'PERISHABLE', 'PACKAGING');

-- CreateEnum
CREATE TYPE "ServiceMode" AS ENUM ('ALL', 'DINE_IN', 'TAKEAWAY');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CountFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('PURCHASE_ORDER', 'PAY_AND_CLAIM', 'PAYMENT_REQUEST');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('INGREDIENT', 'ASSET', 'MAINTENANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'CONFIRMED', 'AWAITING_DELIVERY', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'INITIATED', 'PENDING', 'PARTIALLY_PAID', 'DEPOSIT_PAID', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('SUPPLIER', 'PAY_CLAIM', 'STAFF_CLAIM', 'INTERNAL_TRANSFER');

-- CreateEnum
CREATE TYPE "ReceivingStatus" AS ENUM ('COMPLETE', 'PARTIAL', 'DISPUTED');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('WASTAGE', 'BREAKAGE', 'EXPIRED', 'THEFT', 'CORRECTION', 'SPILLAGE', 'USED_NOT_RECORDED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PENDING', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PackagingScope" AS ENUM ('ALL', 'CATEGORY', 'ITEMS');

-- CreateEnum
CREATE TYPE "PackagingChannel" AS ENUM ('ALL', 'DINE_IN', 'TAKEAWAY', 'GRAB', 'DELIVERY');

-- CreateEnum
CREATE TYPE "SyncType" AS ENUM ('PRODUCTS', 'SALES', 'EMPLOYEES');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SUCCESS', 'FAILED', 'IN_PROGRESS');

-- CreateEnum
CREATE TYPE "ApprovalRuleType" AS ENUM ('ORDER_APPROVAL', 'STOCK_ADJUSTMENT', 'STOCK_TRANSFER', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "SopStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Shift" AS ENUM ('OPENING', 'MIDDAY', 'CLOSING');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ScheduleRecurrence" AS ENUM ('SHIFT', 'SPECIFIC_TIMES', 'HOURLY');

-- CreateEnum
CREATE TYPE "BankLineDirection" AS ENUM ('CR', 'DR');

-- CreateEnum
CREATE TYPE "CashCategory" AS ENUM ('CARD', 'QR', 'STOREHUB', 'GRAB', 'GRAB_PUTRAJAYA', 'FOODPANDA', 'MEETINGS_EVENTS', 'GASTROHUB', 'CAPITAL', 'MANAGEMENT_FEE', 'ADTD', 'RAW_MATERIALS', 'DELIVERY', 'DIRECTORS_ALLOWANCE', 'EMPLOYEE_SALARY', 'PARTIMER', 'STATUTORY_PAYMENT', 'STAFF_CLAIM', 'PETTY_CASH', 'MARKETPLACE_FEE', 'DIGITAL_ADS', 'KOL', 'OTHER_MARKETING', 'RENT', 'UTILITIES', 'SOFTWARE', 'CFS_FEE', 'COMPLIANCE', 'TAX', 'LICENSING_FEE', 'ROYALTY_FEE', 'LOAN', 'BANK_FEE', 'EQUIPMENTS', 'MAINTENANCE', 'INVESTMENTS', 'INTERCO_PEOPLE', 'INTERCO_RAW_MATERIAL', 'INTERCO_INVESTMENTS', 'INTERCO_EXPENSES', 'TRANSFER_NOT_SUCCESSFUL', 'OTHER_INFLOW', 'OTHER_OUTFLOW');

-- CreateEnum
CREATE TYPE "RecurringExpenseCategory" AS ENUM ('RENT', 'UTILITY', 'SAAS', 'PAYROLL_SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "RecurringCadence" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateTable
CREATE TABLE "AppConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ShortLink" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OutletType" NOT NULL DEFAULT 'OUTLET',
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "phone" TEXT,
    "status" "OutletStatus" NOT NULL DEFAULT 'ACTIVE',
    "storehubId" TEXT,
    "companyName" TEXT,
    "regNo" TEXT,
    "lat" DECIMAL(65,30),
    "lng" DECIMAL(65,30),
    "openTime" TEXT DEFAULT '08:00',
    "closeTime" TEXT DEFAULT '22:00',
    "daysOpen" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[],
    "isOpen" BOOLEAN DEFAULT false,
    "isBusy" BOOLEAN DEFAULT false,
    "pickupTimeMins" INTEGER DEFAULT 15,
    "pickupStoreId" TEXT,
    "loyaltyOutletId" TEXT,
    "posNativeCutoverAt" TIMESTAMP(3),
    "staffPin" TEXT,
    "stripeAccountId" TEXT,
    "stripeOnboarded" BOOLEAN DEFAULT false,
    "stripeEnabled" BOOLEAN DEFAULT false,
    "rmMerchantId" TEXT,
    "rmClientId" TEXT,
    "rmClientSecret" TEXT,
    "rmPrivateKey" TEXT,
    "rmIsProduction" BOOLEAN DEFAULT false,
    "rmEnabled" BOOLEAN DEFAULT false,
    "bukkuToken" TEXT,
    "bukkuSubdomain" TEXT,
    "bukkuEnabled" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "outletId" TEXT,
    "username" TEXT,
    "passwordHash" TEXT,
    "pin" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "outletIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "appAccess" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "moduleAccess" JSONB DEFAULT '{}',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountName" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "tokenRevokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "ItemGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageArea" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "StorageArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "itemType" "ItemType" NOT NULL DEFAULT 'INGREDIENT',
    "baseUom" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "storageArea" TEXT,
    "shelfLifeDays" INTEGER,
    "checkFrequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPackage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT,
    "packageName" TEXT NOT NULL,
    "packageLabel" TEXT NOT NULL,
    "conversionFactor" DECIMAL(65,30) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "containsPackageId" TEXT,

    CONSTRAINT "ProductPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "location" TEXT,
    "supplierCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leadTimeDays" INTEGER NOT NULL DEFAULT 1,
    "deliveryDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "moq" TEXT,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountName" TEXT,
    "telegramChatId" TEXT,
    "depositPercent" INTEGER,
    "depositTermsDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProduct" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productPackageId" TEXT,
    "price" DECIMAL(65,30) NOT NULL,
    "moq" DECIMAL(65,30),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productPackageId" TEXT,
    "oldPrice" DECIMAL(65,30) NOT NULL,
    "newPrice" DECIMAL(65,30) NOT NULL,
    "changePercent" DECIMAL(65,30) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletProduct" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "countFrequency" "CountFrequency" NOT NULL DEFAULT 'MONTHLY',

    CONSTRAINT "OutletProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderType" "OrderType" NOT NULL DEFAULT 'PURCHASE_ORDER',
    "expenseCategory" "ExpenseCategory" NOT NULL DEFAULT 'INGREDIENT',
    "outletId" TEXT NOT NULL,
    "supplierId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "deliveryCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliveryDate" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "claimedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productPackageId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "totalPrice" DECIMAL(65,30) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "orderId" TEXT,
    "transferId" TEXT,
    "outletId" TEXT NOT NULL,
    "supplierId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentType" "PaymentType" DEFAULT 'SUPPLIER',
    "expenseCategory" "ExpenseCategory" NOT NULL DEFAULT 'INGREDIENT',
    "claimedById" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "vendorName" TEXT,
    "vendorBankName" TEXT,
    "vendorBankAccountNumber" TEXT,
    "vendorBankAccountName" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidVia" TEXT,
    "paymentRef" TEXT,
    "popShortLink" TEXT,
    "popSentAt" TIMESTAMP(3),
    "amountPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "deliveryDate" TIMESTAMP(3),
    "depositPercent" INTEGER,
    "depositTermsDays" INTEGER,
    "depositAmount" DECIMAL(65,30),
    "depositPaidAt" TIMESTAMP(3),
    "depositRef" TEXT,
    "claimBatchId" TEXT,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "aiPrefilledAt" TIMESTAMP(3),
    "aiPrefilledFields" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrClaimBatch" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "paymentRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paidVia" TEXT DEFAULT 'bank_transfer',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrClaimBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receiving" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "transferId" TEXT,
    "outletId" TEXT NOT NULL,
    "supplierId" TEXT,
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ReceivingStatus" NOT NULL DEFAULT 'COMPLETE',
    "invoicePhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receiving_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivingItem" (
    "id" TEXT NOT NULL,
    "receivingId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productPackageId" TEXT,
    "orderedQty" DECIMAL(65,30),
    "receivedQty" DECIMAL(65,30) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "discrepancyReason" TEXT,

    CONSTRAINT "ReceivingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "frequency" "CountFrequency" NOT NULL,
    "countedById" TEXT NOT NULL,
    "countDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountItem" (
    "id" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productPackageId" TEXT,
    "expectedQty" DECIMAL(65,30),
    "countedQty" DECIMAL(65,30),
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "varianceReason" TEXT,
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "StockCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productPackageId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "adjustmentType" "AdjustmentType" NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "costAmount" DECIMAL(65,30),
    "reason" TEXT,
    "photoUrl" TEXT,
    "adjustedById" TEXT NOT NULL,
    "stockCountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "fromOutletId" TEXT NOT NULL,
    "toOutletId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "transferredById" TEXT NOT NULL,
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productPackageId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParLevel" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "parLevel" DECIMAL(65,30) NOT NULL,
    "reorderPoint" DECIMAL(65,30) NOT NULL,
    "maxLevel" DECIMAL(65,30),
    "avgDailyUsage" DECIMAL(65,30),
    "lastCalculated" TIMESTAMP(3),

    CONSTRAINT "ParLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "sellingPrice" DECIMAL(65,30),
    "storehubId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuIngredient" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityUsed" DECIMAL(65,30) NOT NULL,
    "uom" TEXT NOT NULL,
    "serviceMode" "ServiceMode" NOT NULL DEFAULT 'ALL',

    CONSTRAINT "MenuIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingRule" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "scope" "PackagingScope" NOT NULL DEFAULT 'ALL',
    "category" TEXT,
    "menuIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channel" "PackagingChannel" NOT NULL DEFAULT 'ALL',
    "modifier" TEXT,
    "perOrder" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTransaction" (
    "id" TEXT NOT NULL,
    "storehubTxId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "menuId" TEXT,
    "menuName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "grossAmount" DECIMAL(65,30) NOT NULL,
    "transactedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTarget" (
    "id" TEXT NOT NULL,
    "roundKey" TEXT NOT NULL,
    "dayType" TEXT NOT NULL,
    "revenue" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "aov" DECIMAL(10,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "reasoning" TEXT,
    "priorRevenue" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorehubSync" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "syncType" "SyncType" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'SUCCESS',
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorehubSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruleType" "ApprovalRuleType" NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DECIMAL(65,30),
    "outlets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approverIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "details" TEXT,
    "targetId" TEXT,
    "targetName" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sop" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "content" TEXT,
    "status" "SopStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "expectedRecurrence" "ScheduleRecurrence" NOT NULL DEFAULT 'SHIFT',
    "expectedTimesPerDay" INTEGER NOT NULL DEFAULT 1,
    "expectedTimes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedDueMinutes" INTEGER NOT NULL DEFAULT 0,
    "expectedDaysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "appliesToAllOutlets" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopStep" (
    "id" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "photoRequired" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SopStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopOutlet" (
    "id" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopOutlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checklist" (
    "id" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "date" DATE NOT NULL,
    "shift" "Shift" NOT NULL DEFAULT 'OPENING',
    "timeSlot" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "ChecklistStatus" NOT NULL DEFAULT 'PENDING',
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "photoRequired" BOOLEAN NOT NULL DEFAULT false,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "photoUrl" TEXT,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopSchedule" (
    "id" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "shift" "Shift" NOT NULL DEFAULT 'OPENING',
    "recurrence" "ScheduleRecurrence" NOT NULL DEFAULT 'SHIFT',
    "times" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dueMinutes" INTEGER NOT NULL DEFAULT 0,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" DATE,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "roleType" TEXT NOT NULL,
    "auditTarget" TEXT NOT NULL DEFAULT 'OUTLET',
    "jobRoleFilter" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditSection" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AuditSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditSectionItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "photoRequired" BOOLEAN NOT NULL DEFAULT false,
    "ratingType" TEXT NOT NULL DEFAULT 'pass_fail',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AuditSectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditReport" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "auditorId" TEXT NOT NULL,
    "auditeeId" TEXT,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "overallScore" DECIMAL(65,30),
    "overallNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditReportItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "sectionName" TEXT NOT NULL,
    "itemTitle" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "photoRequired" BOOLEAN NOT NULL DEFAULT false,
    "ratingType" TEXT NOT NULL DEFAULT 'pass_fail',
    "rating" INTEGER,
    "notes" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "AuditReportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewSettings" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "gbpPlaceId" TEXT,
    "gbpAccountId" TEXT,
    "gbpLocationName" TEXT,
    "googleReviewUrl" TEXT,
    "ratingThreshold" INTEGER NOT NULL DEFAULT 4,
    "heading" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "feedbackFields" JSONB DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalFeedback" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "feedback" TEXT,
    "source" TEXT NOT NULL DEFAULT 'qr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads_account" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "descriptive_name" TEXT NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'MYR',
    "time_zone" TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
    "is_manager" BOOLEAN NOT NULL DEFAULT false,
    "is_test_account" BOOLEAN NOT NULL DEFAULT false,
    "outlet_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads_campaign" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "advertising_channel_type" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "daily_budget_micros" BIGINT,
    "outlet_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads_metric_daily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "account_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "conversions" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "conversions_value" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "avg_cpc_micros" BIGINT,
    "ctr" DECIMAL(8,6),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_metric_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads_keyword_metric" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "ad_group_id" TEXT NOT NULL,
    "criterion_id" TEXT NOT NULL,
    "keyword_text" TEXT NOT NULL,
    "match_type" TEXT NOT NULL,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "conversions" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_keyword_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads_invoice" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE,
    "billing_period_start" DATE NOT NULL,
    "billing_period_end" DATE NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'MYR',
    "subtotal_micros" BIGINT NOT NULL DEFAULT 0,
    "adjustments_micros" BIGINT NOT NULL DEFAULT 0,
    "regulatory_costs_micros" BIGINT NOT NULL DEFAULT 0,
    "tax_micros" BIGINT NOT NULL DEFAULT 0,
    "total_micros" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "pdf_source_url" TEXT,
    "pdf_storage_path" TEXT,
    "pdf_hash_sha256" TEXT,
    "pdf_size_bytes" INTEGER,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads_sync_log" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "account_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "rows_inserted" INTEGER,
    "rows_updated" INTEGER,
    "error_message" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ads_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads_conversion_daily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "account_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "conversion_action_id" TEXT NOT NULL,
    "conversion_action_name" TEXT NOT NULL,
    "conversion_category" TEXT NOT NULL,
    "conversions" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "conversions_value" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_conversion_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads_payment" (
    "id" TEXT NOT NULL,
    "year_month" TEXT NOT NULL,
    "outlet_id" TEXT,
    "campaign_id" TEXT,
    "subtotal_micros" BIGINT NOT NULL DEFAULT 0,
    "tax_micros" BIGINT NOT NULL DEFAULT 0,
    "total_micros" BIGINT NOT NULL DEFAULT 0,
    "currency_code" TEXT NOT NULL DEFAULT 'MYR',
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "paid_at" TIMESTAMP(3),
    "paid_by_user_id" TEXT,
    "payment_method" TEXT,
    "reference_number" TEXT,
    "pop_photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pop_telegram_token" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "mcc_customer_id" TEXT,
    "daily_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "keyword_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "invoice_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indeed_ads_job" (
    "id" TEXT NOT NULL,
    "indeed_job_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "campaign_name" TEXT,
    "title" TEXT NOT NULL,
    "location_city" TEXT,
    "location_state" TEXT,
    "outlet_id" TEXT,
    "status" TEXT,
    "premium" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indeed_ads_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indeed_ads_metric_daily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "job_id" TEXT NOT NULL,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "apply_starts" BIGINT NOT NULL DEFAULT 0,
    "applies" BIGINT NOT NULL DEFAULT 0,
    "spend_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cost_per_click" DECIMAL(10,4),
    "cost_per_apply" DECIMAL(10,4),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indeed_ads_metric_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indeed_ads_sync_log" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "rows_upserted" INTEGER,
    "error_message" TEXT,

    CONSTRAINT "indeed_ads_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indeed_ads_invoice" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT,
    "issue_date" DATE NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount_usd" DECIMAL(12,2) NOT NULL,
    "amount_myr" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "pdf_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indeed_ads_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "accountName" TEXT,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "closingBalance" DECIMAL(12,2) NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "totalInflows" DECIMAL(12,2),
    "totalOutflows" DECIMAL(12,2),
    "interCoInflows" DECIMAL(12,2),
    "interCoOutflows" DECIMAL(12,2),
    "fileUrl" TEXT,
    "notes" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "txnDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "direction" "BankLineDirection" NOT NULL,
    "category" "CashCategory",
    "outletId" TEXT,
    "isInterCo" BOOLEAN NOT NULL DEFAULT false,
    "classifiedBy" TEXT,
    "ruleName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RmPayout" (
    "id" TEXT NOT NULL,
    "settlementDate" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "method" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "storeId" TEXT NOT NULL,
    "entityName" TEXT,
    "bankAccountLast4" TEXT,
    "txnCount" INTEGER NOT NULL DEFAULT 0,
    "grossTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "mdrFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'success',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RmPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RmPayoutLine" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "rmTransactionId" TEXT NOT NULL,
    "rmOrderId" TEXT,
    "orderId" TEXT,
    "gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "mdrFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "method" TEXT,
    "txnTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RmPayoutLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "RecurringExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "cadence" "RecurringCadence" NOT NULL,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "outletId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShortLink_createdAt_idx" ON "ShortLink"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_code_key" ON "Outlet"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_storehubId_key" ON "Outlet"("storehubId");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_pickupStoreId_key" ON "Outlet"("pickupStoreId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_name_key" ON "ItemGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_slug_key" ON "ItemGroup"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "StorageArea_name_key" ON "StorageArea"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StorageArea_slug_key" ON "StorageArea"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_supplierCode_key" ON "Supplier"("supplierCode");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_supplierId_productId_productPackageId_key" ON "SupplierProduct"("supplierId", "productId", "productPackageId");

-- CreateIndex
CREATE INDEX "PriceHistory_supplierId_changedAt_idx" ON "PriceHistory"("supplierId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutletProduct_outletId_productId_key" ON "OutletProduct"("outletId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_clientRequestId_key" ON "Order"("clientRequestId");

-- CreateIndex
CREATE INDEX "Order_outletId_createdAt_idx" ON "Order"("outletId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_productId_productPackageId_key" ON "OrderItem"("orderId", "productId", "productPackageId");

-- CreateIndex
CREATE INDEX "Invoice_aiPrefilledAt_idx" ON "Invoice"("aiPrefilledAt");

-- CreateIndex
CREATE INDEX "Invoice_outletId_idx" ON "Invoice"("outletId");

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_supplierId_invoiceNumber_key" ON "Invoice"("supplierId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "HrClaimBatch_batchNumber_key" ON "HrClaimBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "HrClaimBatch_userId_status_idx" ON "HrClaimBatch"("userId", "status");

-- CreateIndex
CREATE INDEX "HrClaimBatch_status_createdAt_idx" ON "HrClaimBatch"("status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "StockCountItem_stockCountId_productId_productPackageId_key" ON "StockCountItem"("stockCountId", "productId", "productPackageId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_outletId_productId_productPackageId_key" ON "StockBalance"("outletId", "productId", "productPackageId");

-- CreateIndex
CREATE UNIQUE INDEX "ParLevel_productId_outletId_key" ON "ParLevel"("productId", "outletId");

-- CreateIndex
CREATE UNIQUE INDEX "Menu_storehubId_key" ON "Menu"("storehubId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuIngredient_menuId_productId_serviceMode_key" ON "MenuIngredient"("menuId", "productId", "serviceMode");

-- CreateIndex
CREATE INDEX "PackagingRule_isActive_idx" ON "PackagingRule"("isActive");

-- CreateIndex
CREATE INDEX "PackagingRule_scope_idx" ON "PackagingRule"("scope");

-- CreateIndex
CREATE INDEX "PackagingRule_productId_idx" ON "PackagingRule"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesTransaction_storehubTxId_key" ON "SalesTransaction"("storehubTxId");

-- CreateIndex
CREATE INDEX "SalesTransaction_outletId_transactedAt_idx" ON "SalesTransaction"("outletId", "transactedAt");

-- CreateIndex
CREATE INDEX "SalesTransaction_menuId_idx" ON "SalesTransaction"("menuId");

-- CreateIndex
CREATE INDEX "SalesTarget_roundKey_dayType_isActive_idx" ON "SalesTarget"("roundKey", "dayType", "isActive");

-- CreateIndex
CREATE INDEX "SalesTarget_effectiveFrom_idx" ON "SalesTarget"("effectiveFrom");

-- CreateIndex
CREATE INDEX "StorehubSync_outletId_syncType_lastSyncAt_idx" ON "StorehubSync"("outletId", "syncType", "lastSyncAt");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_module_createdAt_idx" ON "ActivityLog"("module", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SopCategory_name_key" ON "SopCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SopCategory_slug_key" ON "SopCategory"("slug");

-- CreateIndex
CREATE INDEX "Sop_categoryId_idx" ON "Sop"("categoryId");

-- CreateIndex
CREATE INDEX "Sop_status_idx" ON "Sop"("status");

-- CreateIndex
CREATE INDEX "SopStep_sopId_idx" ON "SopStep"("sopId");

-- CreateIndex
CREATE UNIQUE INDEX "SopStep_sopId_stepNumber_key" ON "SopStep"("sopId", "stepNumber");

-- CreateIndex
CREATE INDEX "SopOutlet_outletId_idx" ON "SopOutlet"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "SopOutlet_sopId_outletId_key" ON "SopOutlet"("sopId", "outletId");

-- CreateIndex
CREATE INDEX "Checklist_outletId_date_idx" ON "Checklist"("outletId", "date");

-- CreateIndex
CREATE INDEX "Checklist_assignedToId_date_idx" ON "Checklist"("assignedToId", "date");

-- CreateIndex
CREATE INDEX "Checklist_status_idx" ON "Checklist"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Checklist_sopId_outletId_date_shift_assignedToId_timeSlot_key" ON "Checklist"("sopId", "outletId", "date", "shift", "assignedToId", "timeSlot");

-- CreateIndex
CREATE INDEX "ChecklistItem_checklistId_idx" ON "ChecklistItem"("checklistId");

-- CreateIndex
CREATE INDEX "SopSchedule_outletId_idx" ON "SopSchedule"("outletId");

-- CreateIndex
CREATE INDEX "SopSchedule_assignedToId_idx" ON "SopSchedule"("assignedToId");

-- CreateIndex
CREATE UNIQUE INDEX "SopSchedule_sopId_outletId_assignedToId_shift_key" ON "SopSchedule"("sopId", "outletId", "assignedToId", "shift");

-- CreateIndex
CREATE INDEX "AuditTemplate_roleType_idx" ON "AuditTemplate"("roleType");

-- CreateIndex
CREATE INDEX "AuditTemplate_auditTarget_idx" ON "AuditTemplate"("auditTarget");

-- CreateIndex
CREATE INDEX "AuditTemplate_isActive_idx" ON "AuditTemplate"("isActive");

-- CreateIndex
CREATE INDEX "AuditTemplate_jobRoleFilter_idx" ON "AuditTemplate" USING GIN ("jobRoleFilter");

-- CreateIndex
CREATE INDEX "AuditSection_templateId_idx" ON "AuditSection"("templateId");

-- CreateIndex
CREATE INDEX "AuditSectionItem_sectionId_idx" ON "AuditSectionItem"("sectionId");

-- CreateIndex
CREATE INDEX "AuditReport_outletId_date_idx" ON "AuditReport"("outletId", "date");

-- CreateIndex
CREATE INDEX "AuditReport_auditorId_date_idx" ON "AuditReport"("auditorId", "date");

-- CreateIndex
CREATE INDEX "AuditReport_auditeeId_date_idx" ON "AuditReport"("auditeeId", "date");

-- CreateIndex
CREATE INDEX "AuditReport_templateId_idx" ON "AuditReport"("templateId");

-- CreateIndex
CREATE INDEX "AuditReport_status_idx" ON "AuditReport"("status");

-- CreateIndex
CREATE INDEX "AuditReportItem_reportId_idx" ON "AuditReportItem"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSettings_outletId_key" ON "ReviewSettings"("outletId");

-- CreateIndex
CREATE INDEX "InternalFeedback_outletId_createdAt_idx" ON "InternalFeedback"("outletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ads_account_customer_id_key" ON "ads_account"("customer_id");

-- CreateIndex
CREATE INDEX "ads_account_outlet_id_idx" ON "ads_account"("outlet_id");

-- CreateIndex
CREATE INDEX "ads_campaign_account_id_idx" ON "ads_campaign"("account_id");

-- CreateIndex
CREATE INDEX "ads_campaign_outlet_id_idx" ON "ads_campaign"("outlet_id");

-- CreateIndex
CREATE INDEX "ads_campaign_status_idx" ON "ads_campaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ads_campaign_account_id_campaign_id_key" ON "ads_campaign"("account_id", "campaign_id");

-- CreateIndex
CREATE INDEX "ads_metric_daily_date_idx" ON "ads_metric_daily"("date" DESC);

-- CreateIndex
CREATE INDEX "ads_metric_daily_account_id_date_idx" ON "ads_metric_daily"("account_id", "date" DESC);

-- CreateIndex
CREATE INDEX "ads_metric_daily_campaign_id_date_idx" ON "ads_metric_daily"("campaign_id", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ads_metric_daily_date_account_id_campaign_id_key" ON "ads_metric_daily"("date", "account_id", "campaign_id");

-- CreateIndex
CREATE INDEX "ads_keyword_metric_date_idx" ON "ads_keyword_metric"("date" DESC);

-- CreateIndex
CREATE INDEX "ads_keyword_metric_campaign_id_date_idx" ON "ads_keyword_metric"("campaign_id", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ads_keyword_metric_date_campaign_id_ad_group_id_criterion_i_key" ON "ads_keyword_metric"("date", "campaign_id", "ad_group_id", "criterion_id");

-- CreateIndex
CREATE UNIQUE INDEX "ads_invoice_invoice_id_key" ON "ads_invoice"("invoice_id");

-- CreateIndex
CREATE INDEX "ads_invoice_account_id_issue_date_idx" ON "ads_invoice"("account_id", "issue_date" DESC);

-- CreateIndex
CREATE INDEX "ads_invoice_billing_period_start_idx" ON "ads_invoice"("billing_period_start" DESC);

-- CreateIndex
CREATE INDEX "ads_invoice_status_idx" ON "ads_invoice"("status");

-- CreateIndex
CREATE INDEX "ads_sync_log_started_at_idx" ON "ads_sync_log"("started_at" DESC);

-- CreateIndex
CREATE INDEX "ads_sync_log_kind_started_at_idx" ON "ads_sync_log"("kind", "started_at" DESC);

-- CreateIndex
CREATE INDEX "ads_conversion_daily_date_idx" ON "ads_conversion_daily"("date" DESC);

-- CreateIndex
CREATE INDEX "ads_conversion_daily_campaign_id_date_idx" ON "ads_conversion_daily"("campaign_id", "date" DESC);

-- CreateIndex
CREATE INDEX "ads_conversion_daily_conversion_category_idx" ON "ads_conversion_daily"("conversion_category");

-- CreateIndex
CREATE UNIQUE INDEX "ads_conversion_daily_date_campaign_id_conversion_action_id_key" ON "ads_conversion_daily"("date", "campaign_id", "conversion_action_id");

-- CreateIndex
CREATE UNIQUE INDEX "ads_payment_pop_telegram_token_key" ON "ads_payment"("pop_telegram_token");

-- CreateIndex
CREATE INDEX "ads_payment_year_month_idx" ON "ads_payment"("year_month" DESC);

-- CreateIndex
CREATE INDEX "ads_payment_status_idx" ON "ads_payment"("status");

-- CreateIndex
CREATE INDEX "ads_payment_outlet_id_idx" ON "ads_payment"("outlet_id");

-- CreateIndex
CREATE INDEX "ads_payment_campaign_id_idx" ON "ads_payment"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "indeed_ads_job_indeed_job_id_key" ON "indeed_ads_job"("indeed_job_id");

-- CreateIndex
CREATE INDEX "indeed_ads_job_outlet_id_idx" ON "indeed_ads_job"("outlet_id");

-- CreateIndex
CREATE INDEX "indeed_ads_job_campaign_id_idx" ON "indeed_ads_job"("campaign_id");

-- CreateIndex
CREATE INDEX "indeed_ads_job_location_city_idx" ON "indeed_ads_job"("location_city");

-- CreateIndex
CREATE INDEX "indeed_ads_metric_daily_date_idx" ON "indeed_ads_metric_daily"("date" DESC);

-- CreateIndex
CREATE INDEX "indeed_ads_metric_daily_job_id_date_idx" ON "indeed_ads_metric_daily"("job_id", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "indeed_ads_metric_daily_date_job_id_key" ON "indeed_ads_metric_daily"("date", "job_id");

-- CreateIndex
CREATE INDEX "indeed_ads_sync_log_started_at_idx" ON "indeed_ads_sync_log"("started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "indeed_ads_invoice_invoice_number_key" ON "indeed_ads_invoice"("invoice_number");

-- CreateIndex
CREATE INDEX "indeed_ads_invoice_issue_date_idx" ON "indeed_ads_invoice"("issue_date" DESC);

-- CreateIndex
CREATE INDEX "indeed_ads_invoice_status_idx" ON "indeed_ads_invoice"("status");

-- CreateIndex
CREATE INDEX "BankStatement_statementDate_idx" ON "BankStatement"("statementDate");

-- CreateIndex
CREATE INDEX "BankStatementLine_statementId_idx" ON "BankStatementLine"("statementId");

-- CreateIndex
CREATE INDEX "BankStatementLine_txnDate_idx" ON "BankStatementLine"("txnDate");

-- CreateIndex
CREATE INDEX "BankStatementLine_category_outletId_idx" ON "BankStatementLine"("category", "outletId");

-- CreateIndex
CREATE INDEX "RmPayout_settlementDate_idx" ON "RmPayout"("settlementDate");

-- CreateIndex
CREATE INDEX "RmPayout_storeId_idx" ON "RmPayout"("storeId");

-- CreateIndex
CREATE INDEX "RmPayoutLine_payoutId_idx" ON "RmPayoutLine"("payoutId");

-- CreateIndex
CREATE INDEX "RmPayoutLine_orderId_idx" ON "RmPayoutLine"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "RmPayoutLine_rmTransactionId_key" ON "RmPayoutLine"("rmTransactionId");

-- CreateIndex
CREATE INDEX "RecurringExpense_isActive_nextDueDate_idx" ON "RecurringExpense"("isActive", "nextDueDate");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ItemGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPackage" ADD CONSTRAINT "ProductPackage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPackage" ADD CONSTRAINT "ProductPackage_containsPackageId_fkey" FOREIGN KEY ("containsPackageId") REFERENCES "ProductPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_productPackageId_fkey" FOREIGN KEY ("productPackageId") REFERENCES "ProductPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletProduct" ADD CONSTRAINT "OutletProduct_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletProduct" ADD CONSTRAINT "OutletProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productPackageId_fkey" FOREIGN KEY ("productPackageId") REFERENCES "ProductPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_claimBatchId_fkey" FOREIGN KEY ("claimBatchId") REFERENCES "HrClaimBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receiving" ADD CONSTRAINT "Receiving_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receiving" ADD CONSTRAINT "Receiving_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receiving" ADD CONSTRAINT "Receiving_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receiving" ADD CONSTRAINT "Receiving_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receiving" ADD CONSTRAINT "Receiving_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingItem" ADD CONSTRAINT "ReceivingItem_receivingId_fkey" FOREIGN KEY ("receivingId") REFERENCES "Receiving"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingItem" ADD CONSTRAINT "ReceivingItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingItem" ADD CONSTRAINT "ReceivingItem_productPackageId_fkey" FOREIGN KEY ("productPackageId") REFERENCES "ProductPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_productPackageId_fkey" FOREIGN KEY ("productPackageId") REFERENCES "ProductPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_productPackageId_fkey" FOREIGN KEY ("productPackageId") REFERENCES "ProductPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_adjustedById_fkey" FOREIGN KEY ("adjustedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromOutletId_fkey" FOREIGN KEY ("fromOutletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toOutletId_fkey" FOREIGN KEY ("toOutletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_transferredById_fkey" FOREIGN KEY ("transferredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_productPackageId_fkey" FOREIGN KEY ("productPackageId") REFERENCES "ProductPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParLevel" ADD CONSTRAINT "ParLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParLevel" ADD CONSTRAINT "ParLevel_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuIngredient" ADD CONSTRAINT "MenuIngredient_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuIngredient" ADD CONSTRAINT "MenuIngredient_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingRule" ADD CONSTRAINT "PackagingRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTransaction" ADD CONSTRAINT "SalesTransaction_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTransaction" ADD CONSTRAINT "SalesTransaction_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorehubSync" ADD CONSTRAINT "StorehubSync_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SopCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopStep" ADD CONSTRAINT "SopStep_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopOutlet" ADD CONSTRAINT "SopOutlet_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopOutlet" ADD CONSTRAINT "SopOutlet_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopSchedule" ADD CONSTRAINT "SopSchedule_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopSchedule" ADD CONSTRAINT "SopSchedule_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopSchedule" ADD CONSTRAINT "SopSchedule_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTemplate" ADD CONSTRAINT "AuditTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditSection" ADD CONSTRAINT "AuditSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AuditTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditSectionItem" ADD CONSTRAINT "AuditSectionItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "AuditSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReport" ADD CONSTRAINT "AuditReport_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AuditTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReport" ADD CONSTRAINT "AuditReport_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReport" ADD CONSTRAINT "AuditReport_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReport" ADD CONSTRAINT "AuditReport_auditeeId_fkey" FOREIGN KEY ("auditeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReportItem" ADD CONSTRAINT "AuditReportItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AuditReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalFeedback" ADD CONSTRAINT "InternalFeedback_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads_campaign" ADD CONSTRAINT "ads_campaign_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ads_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads_metric_daily" ADD CONSTRAINT "ads_metric_daily_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ads_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads_metric_daily" ADD CONSTRAINT "ads_metric_daily_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ads_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads_keyword_metric" ADD CONSTRAINT "ads_keyword_metric_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ads_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads_invoice" ADD CONSTRAINT "ads_invoice_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ads_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads_sync_log" ADD CONSTRAINT "ads_sync_log_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ads_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indeed_ads_job" ADD CONSTRAINT "indeed_ads_job_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indeed_ads_metric_daily" ADD CONSTRAINT "indeed_ads_metric_daily_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "indeed_ads_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RmPayoutLine" ADD CONSTRAINT "RmPayoutLine_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "RmPayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

