-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_ACTIVATION');

-- CreateEnum
CREATE TYPE "RoleLevel" AS ENUM ('SYSTEM_ADMIN', 'ORG_ADMIN', 'PLANT_MANAGER', 'SUPERVISOR', 'TECHNICIAN', 'OPERATOR', 'VIEWER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PermissionResource" AS ENUM ('PA_DASHBOARD', 'PA_COMPLIANCE_MAP', 'PA_FORMS', 'TA_DASHBOARD', 'TA_WORK_ORDERS', 'TA_MACHINES', 'TA_PROCEDURES', 'DOC_PROCEDURES', 'DOC_CERTIFIED', 'DOC_INSTRUCTIONS', 'AI_VISION', 'AI_CRM', 'AI_RH', 'PLANTS_PROCESS', 'ADMIN', 'SETTINGS');

-- CreateEnum
CREATE TYPE "PermissionAction" AS ENUM ('VIEW', 'CREATE', 'MODIFY', 'UPDATE', 'REVIEW', 'APPROVE', 'CANCEL', 'DELETE', 'OBSOLETE', 'PRINT', 'DOWNLOAD', 'EXPORT');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('CERTIFICATION', 'PROCEDURE', 'MACHINE', 'WORK_INSTRUCTION', 'WORK_ORDER_EVIDENCE', 'PRODUCTION_REPORT');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN', 'LOGOUT', 'ACCESS_DENIED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "logo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxUsers" INTEGER NOT NULL DEFAULT 2000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firebaseUid" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "avatar" TEXT,
    "phone" TEXT,
    "employeeId" TEXT,
    "position" TEXT,
    "accessLevel" TEXT,
    "plantScope" TEXT,
    "processScope" TEXT,
    "subprocessScope" TEXT,
    "organizationId" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLogin" TIMESTAMP(3),
    "loginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordHash" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'es',
    "preferredTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "level" "RoleLevel" NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "resource" "PermissionResource" NOT NULL,
    "action" "PermissionAction" NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Process" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Process_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subprocess" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subprocess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serial" TEXT,
    "availability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mtbf" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mttr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalOts" INTEGER NOT NULL DEFAULT 0,
    "openOts" INTEGER NOT NULL DEFAULT 0,
    "plantId" TEXT,
    "processId" TEXT,
    "subprocessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserArea" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFile" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "title" TEXT,
    "code" TEXT,
    "version" TEXT,
    "status" TEXT,
    "owner" TEXT,
    "nextReview" TIMESTAMP(3),
    "ragEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ragStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Procedure" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reviewer" TEXT,
    "responsible" TEXT,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
    "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "obsoleteDate" TIMESTAMP(3),
    "plantId" TEXT,
    "processId" TEXT,
    "subprocessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Procedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcedureDocument" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcedureDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcedureDocumentVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_review',
    "uploadDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewalDate" TIMESTAMP(3),
    "updatedBy" TEXT,
    "fileId" TEXT,
    "documentId" TEXT NOT NULL,

    CONSTRAINT "ProcedureDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineDocument" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT,
    "fileId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkInstruction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "plantId" TEXT,
    "processId" TEXT,
    "subprocessId" TEXT,
    "creator" TEXT,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estimatedTime" TEXT,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supplies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbnailUrl" TEXT,
    "validationMethod" TEXT,
    "accessibilityLevel" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignedRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "steps" JSONB NOT NULL,
    "expectedResult" JSONB,
    "history" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkInstructionAssignment" (
    "id" TEXT NOT NULL,
    "workInstructionId" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "assignedTo" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "completionTime" TIMESTAMP(3),
    "machineContext" TEXT,
    "timeEst" TEXT,

    CONSTRAINT "WorkInstructionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionReport" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "plantId" TEXT,
    "processId" TEXT,
    "subprocessId" TEXT,
    "schedules" JSONB NOT NULL,
    "fields" JSONB NOT NULL,
    "generalReviewers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notifyOutOfParam" JSONB NOT NULL,
    "notifyLate" JSONB NOT NULL,
    "resultIntegration" TEXT NOT NULL,
    "integratedMinParam" DOUBLE PRECISION,
    "integratedMaxParam" DOUBLE PRECISION,
    "integratedOptimalResult" TEXT,
    "integratedOptimalValue" DOUBLE PRECISION,
    "documentFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "otNumber" TEXT NOT NULL,
    "plantId" TEXT,
    "processId" TEXT,
    "subprocessId" TEXT,
    "machineId" TEXT,
    "plantName" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "subprocessName" TEXT NOT NULL,
    "machineCode" TEXT NOT NULL,
    "machineName" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "detectorName" TEXT NOT NULL,
    "shift" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "machineStatus" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "symptoms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "operatingHours" TEXT,
    "safetyRisk" TEXT,
    "failureMoment" TEXT,
    "alarmCodes" TEXT,
    "alarmMessages" TEXT,
    "sinceWhen" TEXT,
    "frequency" TEXT,
    "productModel" TEXT,
    "recentAdjustments" TEXT,
    "adjustmentsDetail" TEXT,
    "impactProduction" TEXT,
    "impactQuality" TEXT,
    "defectType" TEXT,
    "defectDescription" TEXT,
    "evidenceFiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "assignedTo" TEXT,
    "slaTarget" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderAIData" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "productionImpact" TEXT NOT NULL,
    "qualityImpact" BOOLEAN NOT NULL,
    "operatorInstructions" TEXT NOT NULL,
    "rootCauses" JSONB NOT NULL,
    "suggestedActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderAIData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalReport" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "inspections" TEXT,
    "measurements" TEXT,
    "observations" TEXT,
    "diagnosis" TEXT,
    "aiMatch" TEXT,
    "rootCause" TEXT,
    "actions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "otherActionDetail" TEXT,
    "supplies" JSONB,
    "preventiveMeasures" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicalReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderLog" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "action" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoryEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "criticality" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "hierarchy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "context" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "sources" JSONB,
    "suggestions" JSONB,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "docCodePattern" TEXT NOT NULL DEFAULT 'AAA-1111-A',
    "brandPrimary" TEXT NOT NULL DEFAULT '#2563eb',
    "brandSecondary" TEXT NOT NULL DEFAULT '#4f46e5',
    "brandAccent" TEXT NOT NULL DEFAULT '#0ea5e9',
    "brandLogoUrl" TEXT,
    "brandIconUrl" TEXT,
    "navIcons" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "action" "AuditAction" NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");

-- CreateIndex
CREATE INDEX "Organization_active_idx" ON "Organization"("active");

-- CreateIndex
CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_lastLogin_idx" ON "User"("lastLogin");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_organizationId_key" ON "User"("email", "organizationId");

-- CreateIndex
CREATE INDEX "Role_organizationId_level_idx" ON "Role"("organizationId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_organizationId_key" ON "Role"("name", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_resource_action_key" ON "Permission"("resource", "action");

-- CreateIndex
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "Plant_organizationId_idx" ON "Plant"("organizationId");

-- CreateIndex
CREATE INDEX "Process_plantId_idx" ON "Process"("plantId");

-- CreateIndex
CREATE INDEX "Subprocess_processId_idx" ON "Subprocess"("processId");

-- CreateIndex
CREATE INDEX "Machine_plantId_idx" ON "Machine"("plantId");

-- CreateIndex
CREATE INDEX "Machine_processId_idx" ON "Machine"("processId");

-- CreateIndex
CREATE INDEX "Machine_subprocessId_idx" ON "Machine"("subprocessId");

-- CreateIndex
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE INDEX "UserArea_userId_idx" ON "UserArea"("userId");

-- CreateIndex
CREATE INDEX "UserArea_plantId_idx" ON "UserArea"("plantId");

-- CreateIndex
CREATE UNIQUE INDEX "UserArea_userId_plantId_key" ON "UserArea"("userId", "plantId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFile_storageKey_key" ON "DocumentFile"("storageKey");

-- CreateIndex
CREATE INDEX "DocumentFile_category_entityId_idx" ON "DocumentFile"("category", "entityId");

-- CreateIndex
CREATE INDEX "DocumentFile_owner_idx" ON "DocumentFile"("owner");

-- CreateIndex
CREATE INDEX "Procedure_plantId_idx" ON "Procedure"("plantId");

-- CreateIndex
CREATE INDEX "Procedure_processId_idx" ON "Procedure"("processId");

-- CreateIndex
CREATE INDEX "Procedure_subprocessId_idx" ON "Procedure"("subprocessId");

-- CreateIndex
CREATE INDEX "ProcedureDocument_procedureId_idx" ON "ProcedureDocument"("procedureId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcedureDocument_procedureId_code_key" ON "ProcedureDocument"("procedureId", "code");

-- CreateIndex
CREATE INDEX "ProcedureDocumentVersion_documentId_idx" ON "ProcedureDocumentVersion"("documentId");

-- CreateIndex
CREATE INDEX "ProcedureDocumentVersion_fileId_idx" ON "ProcedureDocumentVersion"("fileId");

-- CreateIndex
CREATE INDEX "MachineDocument_machineId_idx" ON "MachineDocument"("machineId");

-- CreateIndex
CREATE INDEX "MachineDocument_fileId_idx" ON "MachineDocument"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkInstruction_code_key" ON "WorkInstruction"("code");

-- CreateIndex
CREATE INDEX "WorkInstruction_plantId_idx" ON "WorkInstruction"("plantId");

-- CreateIndex
CREATE INDEX "WorkInstruction_processId_idx" ON "WorkInstruction"("processId");

-- CreateIndex
CREATE INDEX "WorkInstruction_subprocessId_idx" ON "WorkInstruction"("subprocessId");

-- CreateIndex
CREATE INDEX "WorkInstructionAssignment_workInstructionId_idx" ON "WorkInstructionAssignment"("workInstructionId");

-- CreateIndex
CREATE INDEX "ProductionReport_plantId_idx" ON "ProductionReport"("plantId");

-- CreateIndex
CREATE INDEX "ProductionReport_processId_idx" ON "ProductionReport"("processId");

-- CreateIndex
CREATE INDEX "ProductionReport_subprocessId_idx" ON "ProductionReport"("subprocessId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_otNumber_key" ON "WorkOrder"("otNumber");

-- CreateIndex
CREATE INDEX "WorkOrder_plantId_idx" ON "WorkOrder"("plantId");

-- CreateIndex
CREATE INDEX "WorkOrder_processId_idx" ON "WorkOrder"("processId");

-- CreateIndex
CREATE INDEX "WorkOrder_subprocessId_idx" ON "WorkOrder"("subprocessId");

-- CreateIndex
CREATE INDEX "WorkOrder_machineId_idx" ON "WorkOrder"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderAIData_workOrderId_key" ON "WorkOrderAIData"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalReport_workOrderId_key" ON "TechnicalReport"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderLog_workOrderId_idx" ON "WorkOrderLog"("workOrderId");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSetting_organizationId_key" ON "OrganizationSetting"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Process" ADD CONSTRAINT "Process_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subprocess" ADD CONSTRAINT "Subprocess_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_subprocessId_fkey" FOREIGN KEY ("subprocessId") REFERENCES "Subprocess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserArea" ADD CONSTRAINT "UserArea_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserArea" ADD CONSTRAINT "UserArea_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_subprocessId_fkey" FOREIGN KEY ("subprocessId") REFERENCES "Subprocess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureDocument" ADD CONSTRAINT "ProcedureDocument_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureDocumentVersion" ADD CONSTRAINT "ProcedureDocumentVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "DocumentFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureDocumentVersion" ADD CONSTRAINT "ProcedureDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProcedureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineDocument" ADD CONSTRAINT "MachineDocument_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineDocument" ADD CONSTRAINT "MachineDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "DocumentFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkInstruction" ADD CONSTRAINT "WorkInstruction_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkInstruction" ADD CONSTRAINT "WorkInstruction_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkInstruction" ADD CONSTRAINT "WorkInstruction_subprocessId_fkey" FOREIGN KEY ("subprocessId") REFERENCES "Subprocess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkInstructionAssignment" ADD CONSTRAINT "WorkInstructionAssignment_workInstructionId_fkey" FOREIGN KEY ("workInstructionId") REFERENCES "WorkInstruction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_subprocessId_fkey" FOREIGN KEY ("subprocessId") REFERENCES "Subprocess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_documentFileId_fkey" FOREIGN KEY ("documentFileId") REFERENCES "DocumentFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_subprocessId_fkey" FOREIGN KEY ("subprocessId") REFERENCES "Subprocess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAIData" ADD CONSTRAINT "WorkOrderAIData_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalReport" ADD CONSTRAINT "TechnicalReport_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLog" ADD CONSTRAINT "WorkOrderLog_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationSetting" ADD CONSTRAINT "OrganizationSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
